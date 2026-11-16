// Instantly warm-up bridge: Instantly warms the mailbox on its network; Agency OS keeps campaigns,
// replies and the CRM. After the warm-up period the mailbox moves to campaign sending by itself.
import { createInstantly, externalWarmupProgress, WARMUP_STATES, ACCOUNT_STATES, type InstantlyClient } from "@/lib/outreach/providers/instantly.mjs";
import { audit, db, loadConnection, nowIso, parseJson } from "./store";

type Row = Record<string, any>;

export type ExternalWarmup = { provider: "instantly"; startedAt: string; paused?: boolean; session?: { id: string; authUrl: string; expiresAt: string } | null; stats?: Row | null; statsAt?: string; accountState?: string; warmupState?: string };

export async function instantlyFor(ownerId: string): Promise<InstantlyClient | null> {
  const connection = await loadConnection<{ apiKey: string }>(ownerId, "instantly");
  return connection?.secret?.apiKey ? createInstantly({ apiKey: connection.secret.apiKey }) : null;
}

export function readExternal(healthJson: string | null | undefined): ExternalWarmup | null {
  const value = parseJson<Row>(healthJson, {}).external;
  return value && value.provider === "instantly" ? value as ExternalWarmup : null;
}

async function writeExternal(mailboxId: string, external: ExternalWarmup | null) {
  const sql = external
    ? "UPDATE outreach_mailboxes SET health_json = json_set(COALESCE(NULLIF(health_json, ''), '{}'), '$.external', json(?2)), updated_at = ?3 WHERE id = ?1"
    : "UPDATE outreach_mailboxes SET health_json = json_remove(COALESCE(NULLIF(health_json, ''), '{}'), '$.external'), updated_at = ?3 WHERE id = ?1";
  await db().prepare(sql).bind(mailboxId, external ? JSON.stringify(external) : null, nowIso()).run();
}

/**
 * Puts a mailbox into Instantly warm-up. If Instantly doesn't have the mailbox yet, starts the
 * one-time Google/Microsoft sign-in and returns its link (the user clicks it once).
 */
export async function beginExternalWarmup(ownerId: string, actor: string, mailbox: Row, client: InstantlyClient): Promise<{ state: "started" | "connect"; message: string; authUrl?: string; sessionId?: string }> {
  const current = readExternal(mailbox.health_json);
  const account = await client.getAccount(mailbox.email);
  if (!account) {
    const session = await client.startOAuth(mailbox.host === "google" ? "google" : "microsoft");
    await writeExternal(mailbox.id, { provider: "instantly", startedAt: current?.startedAt || "", session: { id: session.sessionId, authUrl: session.authUrl, expiresAt: session.expiresAt } });
    return { state: "connect", authUrl: session.authUrl, sessionId: session.sessionId, message: `Sign in once as ${mailbox.email} to add it to Instantly (the link works for 10 minutes). Warm-up starts straight after.` };
  }
  await client.enableWarmup([mailbox.email]);
  const startedAt = current?.startedAt || nowIso();
  await writeExternal(mailbox.id, { provider: "instantly", startedAt, paused: false, session: null, stats: current?.stats || null, statsAt: current?.statsAt });
  await audit(ownerId, actor, "instantly-warmup-start", mailbox.email);
  const progress = externalWarmupProgress(startedAt);
  return { state: "started", message: progress.ready ? "Instantly warm-up resumed." : `Warming with Instantly — day ${progress.day} of ${progress.days}. Campaigns unlock automatically after day ${progress.days}.` };
}

/** Checks a pending Instantly sign-in; on success switches warm-up on. */
export async function completeExternalConnect(ownerId: string, actor: string, mailbox: Row, client: InstantlyClient) {
  const external = readExternal(mailbox.health_json);
  if (!external?.session?.id) return { state: "none" as const, message: "No Instantly sign-in is waiting for this mailbox." };
  const status = await client.oauthStatus(external.session.id);
  if (status.status === "pending") return { state: "pending" as const, message: "Waiting for the sign-in to finish…" };
  if (status.status === "success") {
    if (status.email && status.email.toLowerCase() !== String(mailbox.email).toLowerCase()) {
      return { state: "error" as const, message: `You signed in as ${status.email}, not ${mailbox.email}. That account was added to Instantly; sign in again with ${mailbox.email}.` };
    }
    return { ...(await beginExternalWarmup(ownerId, actor, mailbox, client)) };
  }
  await writeExternal(mailbox.id, { ...external, session: null });
  return { state: "error" as const, message: status.status === "expired" ? "The sign-in link expired. Click the flame to get a new one." : `Instantly couldn't add the mailbox: ${status.error || "sign-in failed"}.` };
}

export async function pauseExternalWarmup(ownerId: string, actor: string, mailbox: Row, client: InstantlyClient) {
  const external = readExternal(mailbox.health_json);
  if (!external) return;
  await client.disableWarmup([mailbox.email]);
  await writeExternal(mailbox.id, { ...external, paused: true });
  await audit(ownerId, actor, "instantly-warmup-pause", mailbox.email);
}

/** Moves a warmed mailbox to campaign sending: full ramp credit for the days Instantly already warmed it. */
export async function unlockForCampaigns(mailboxId: string, startedAt: string) {
  await db().prepare("UPDATE outreach_mailboxes SET status = 'ramping', ramp_started_at = COALESCE(?2, ramp_started_at, ?3), paused_reason = '', updated_at = ?3 WHERE id = ?1 AND status IN ('setup', 'paused')").bind(mailboxId, startedAt || null, nowIso()).run();
}

/**
 * Engine pass: pull Instantly warm-up numbers (hourly), flag banned/suspended accounts as critical,
 * and unlock mailboxes for campaigns once the warm-up period is over.
 */
export async function externalWarmupPass(ownerId: string, now: Date, sendCritical: (key: string, title: string, detail: string) => Promise<unknown>) {
  const rows = (await db().prepare("SELECT id, email, host, status, health_json FROM outreach_mailboxes WHERE owner_id = ?1 AND json_extract(health_json, '$.external.provider') = 'instantly'").bind(ownerId).all<Row>()).results || [];
  if (!rows.length) return { mailboxes: 0 };
  let unlocked = 0, refreshed = 0;
  const due = rows.filter((row) => { const external = readExternal(row.health_json); return external?.startedAt && (!external.statsAt || now.getTime() - Date.parse(external.statsAt) > 55 * 60_000); });
  const client = due.length ? await instantlyFor(ownerId) : null;
  if (client && due.length) {
    const stats = await client.warmupAnalytics(due.map((row) => row.email));
    for (const row of due) {
      const external = readExternal(row.health_json)!;
      const account = await client.getAccount(row.email).catch(() => null);
      const warmupState = account ? WARMUP_STATES[Number(account.warmup_status)] || "unknown" : "missing";
      const accountState = account ? ACCOUNT_STATES[Number(account.status)] || "unknown" : "missing";
      await writeExternal(row.id, { ...external, stats: stats[String(row.email).toLowerCase()] || external.stats || null, statsAt: now.toISOString(), warmupState, accountState });
      refreshed += 1;
      if (["banned", "suspended"].includes(warmupState) || ["connection-error", "sending-error"].includes(accountState)) {
        await sendCritical(`instantly:${row.id}:${warmupState}:${accountState}`, `Instantly warm-up problem on ${row.email}`, `Warm-up: ${warmupState}. Account: ${accountState}. Check the mailbox in Instantly; Outreach won't unlock it for campaigns until it's healthy.`);
      }
    }
  }
  for (const row of rows) {
    const external = readExternal(row.health_json);
    if (!external?.startedAt || external.paused || row.status !== "setup") continue;
    if (["banned", "suspended"].includes(String(external.warmupState)) || ["connection-error", "sending-error"].includes(String(external.accountState))) continue;
    if (!externalWarmupProgress(external.startedAt, now.getTime()).ready) continue;
    await unlockForCampaigns(row.id, external.startedAt);
    await audit(ownerId, "engine", "instantly-warmup-complete", row.email, { days: externalWarmupProgress(external.startedAt, now.getTime()).days });
    unlocked += 1;
  }
  return { mailboxes: rows.length, refreshed, unlocked };
}

