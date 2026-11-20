// Domain Guard: watches every domain in the F2B Cloudflare account for hijacks and tampering,
// and raises high-priority alerts (Telegram + email) the moment something changes.
//
// Runs from the 5-minute cron, checking a few domains per tick in rotation (stays well inside the
// Worker's per-run subrequest limit and the D1 free read budget; every lookup is by primary key/index).
// Uses the same Cloudflare token as Domains & DNS and the existing F2B Telegram bot (send-only).
import { env } from "cloudflare:workers";
import { cloudflareAccountId, cloudflareToken, telegramConfig } from "@/lib/outreach/server/store";
import { createTelegram } from "@/lib/outreach/telegram.mjs";
import { logSystemEmail } from "@/lib/email-log";
import { evaluate, externalHosts, formatEmail, formatTelegram, hackSignals, normaliseHost, recordKey, repeatAfter, type GuardFinding, type GuardObservation, type GuardSite } from "@/lib/domain-guard.mjs";

const CF_API = "https://api.cloudflare.com/client/v4";
const DEFAULT_APP_URL = "https://f2b-media-agency-os.f2b-media.workers.dev";
const ZONES_PER_TICK = 2;
const CACHE_MS = 3_600_000;
// Findings that describe a current condition: they auto-resolve once the condition clears.
const CONDITION_KEYS = /:(posture-|down$|unlocked$|zone-|expiry-|ns-public)/;

type ZoneInfo = { id: string; name: string; status: string; paused: boolean; nameServers: string[] };
type StateRow = { domain: string; baseline_json: string | null; fail_count: number; checked_at: string | null };
export type GuardEvent = { id: string; domain: string; severity: string; findingKey: string; title: string; detail: string; createdAt: string; lastAlertAt: string | null; acknowledgedAt: string | null; acknowledgedBy: string | null };

function database(): D1Database {
  if (!env.DB) throw new Error("The private workspace database is not available.");
  return env.DB;
}

let schemaReady: Promise<void> | null = null;
export function ensureGuardSchema(): Promise<void> {
  if (!schemaReady) {
    const db = database();
    schemaReady = db.batch([
      db.prepare("CREATE TABLE IF NOT EXISTS domain_guard_state (domain TEXT PRIMARY KEY, zone_id TEXT, baseline_json TEXT, fail_count INTEGER NOT NULL DEFAULT 0, checked_at TEXT)"),
      db.prepare("CREATE TABLE IF NOT EXISTS domain_guard_events (id TEXT PRIMARY KEY, domain TEXT NOT NULL, severity TEXT NOT NULL, finding_key TEXT NOT NULL, title TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, last_alert_at TEXT, acknowledged_at TEXT, acknowledged_by TEXT)"),
      db.prepare("CREATE INDEX IF NOT EXISTS domain_guard_events_key ON domain_guard_events (finding_key, created_at)"),
      db.prepare("CREATE INDEX IF NOT EXISTS domain_guard_events_domain ON domain_guard_events (domain, acknowledged_at)"),
      db.prepare("CREATE TABLE IF NOT EXISTS domain_guard_meta (k TEXT PRIMARY KEY, v TEXT NOT NULL, updated_at TEXT NOT NULL)"),
    ]).then(() => undefined).catch((error: unknown) => { schemaReady = null; throw error; });
  }
  return schemaReady;
}

/** Owner id plus where alert emails go: SECURITY_ALERT_EMAIL if set, else the admin email saved in Settings. */
async function workspaceOwner(): Promise<{ ownerId: string; alertEmail: string } | null> {
  const row = await database().prepare("SELECT owner_id, data FROM workspace_documents WHERE id = ?1").bind("f2b-agency").first<{ owner_id: string; data: string }>();
  if (!row) return null;
  let saved = "";
  try { const ws = JSON.parse(row.data || "{}"); saved = String(ws?.settings?.adminEmail || ws?.settings?.companyEmail || ""); } catch { /* none */ }
  const configured = String((env as unknown as Record<string, string | undefined>).SECURITY_ALERT_EMAIL || "");
  return { ownerId: row.owner_id, alertEmail: (configured || saved).trim().toLowerCase() };
}

async function cf<T>(token: string, path: string): Promise<{ ok: boolean; status: number; result: T | null }> {
  try {
    const response = await fetch(`${CF_API}${path}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(12_000) });
    const payload = await response.json().catch(() => null) as { success?: boolean; result?: T } | null;
    return { ok: response.ok && Boolean(payload?.success), status: response.status, result: payload?.result ?? null };
  } catch { return { ok: false, status: 0, result: null }; }
}

async function readMeta<T>(key: string): Promise<{ value: T; updatedAt: string } | null> {
  const row = await database().prepare("SELECT v, updated_at FROM domain_guard_meta WHERE k = ?1").bind(key).first<{ v: string; updated_at: string }>();
  if (!row) return null;
  try { return { value: JSON.parse(row.v) as T, updatedAt: row.updated_at }; } catch { return null; }
}
async function writeMeta(key: string, value: unknown) {
  await database().prepare("INSERT INTO domain_guard_meta (k, v, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(k) DO UPDATE SET v = excluded.v, updated_at = excluded.updated_at").bind(key, JSON.stringify(value), new Date().toISOString()).run();
}
const fresh = (updatedAt: string | undefined, now: Date) => Boolean(updatedAt && now.getTime() - new Date(updatedAt).getTime() < CACHE_MS);

async function zoneList(token: string, now: Date, missing: Set<string>): Promise<ZoneInfo[]> {
  const cached = await readMeta<ZoneInfo[]>("zones");
  if (cached && fresh(cached.updatedAt, now)) return cached.value;
  const response = await cf<Array<{ id: string; name: string; status: string; paused: boolean; name_servers?: string[] }>>(token, "/zones?per_page=50");
  if (!response.ok || !response.result) { if (response.status === 403) missing.add("Zone Read"); return cached?.value || []; }
  const zones = response.result.map((zone) => ({ id: zone.id, name: zone.name.toLowerCase(), status: zone.status, paused: Boolean(zone.paused), nameServers: (zone.name_servers || []).map((ns) => ns.toLowerCase()) }));
  await writeMeta("zones", zones);
  return zones;
}

type RegistrarInfo = Record<string, { locked?: boolean; autoRenew?: boolean; expiresAt?: string }>;
async function registrarInfo(token: string, now: Date, missing: Set<string>): Promise<RegistrarInfo> {
  const cached = await readMeta<RegistrarInfo>("registrar");
  if (cached && fresh(cached.updatedAt, now)) return cached.value;
  const account = cloudflareAccountId();
  if (!account) return cached?.value || {};
  const response = await cf<Array<{ name: string; locked?: boolean; auto_renew?: boolean; expires_at?: string }>>(token, `/accounts/${account}/registrar/domains`);
  if (!response.ok || !response.result) { if (response.status === 403) missing.add("Registrar: Domains Read"); return cached?.value || {}; }
  const info: RegistrarInfo = {};
  for (const d of response.result) info[d.name.toLowerCase()] = { locked: d.locked, autoRenew: d.auto_renew, expiresAt: d.expires_at };
  await writeMeta("registrar", info);
  return info;
}

/** Public view of the nameservers (what the registrar actually points at), via DNS-over-HTTPS. */
async function publicNameServers(domain: string): Promise<string[] | null> {
  try {
    const response = await fetch(`https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(domain)}&type=NS`, { headers: { Accept: "application/dns-json" }, signal: AbortSignal.timeout(8_000) });
    if (!response.ok) return null;
    const payload = await response.json() as { Status?: number; Answer?: Array<{ type: number; data: string }> };
    if (payload.Status !== 0) return null;
    return (payload.Answer || []).filter((a) => a.type === 2).map((a) => a.data.toLowerCase().replace(/\.$/, "")).sort();
  } catch { return null; }
}

/** Loads the homepage like a visitor would, following redirects by hand so every hop is recorded. */
async function checkSite(domain: string): Promise<GuardSite> {
  let url = `https://${domain}/`;
  const hops: string[] = [normaliseHost(url)];
  try {
    for (let i = 0; i < 4; i++) {
      const response = await fetch(url, { redirect: "manual", headers: { "User-Agent": "Mozilla/5.0 (compatible; F2B-DomainGuard/1.0)", Accept: "text/html" }, signal: AbortSignal.timeout(10_000) });
      const location = response.headers.get("location");
      if (response.status >= 300 && response.status < 400 && location) {
        const next = new URL(location, url).toString();
        await response.body?.cancel().catch(() => undefined);
        hops.push(next.startsWith("http://") ? `${normaliseHost(next)} (http!)` : normaliseHost(next));
        url = next;
        continue;
      }
      if (response.status >= 500 || response.status === 404 || response.status === 410) {
        await response.body?.cancel().catch(() => undefined);
        return { ok: false, status: response.status, error: `Homepage returned HTTP ${response.status}`, finalUrl: url, hops };
      }
      const type = response.headers.get("content-type") || "";
      let html = "";
      if (response.status === 200 && /html/i.test(type)) html = (await response.text()).slice(0, 600_000);
      else await response.body?.cancel().catch(() => undefined);
      const finalHost = normaliseHost(url);
      return { ok: true, status: response.status, finalUrl: url, hops, external: html ? externalHosts(html, finalHost) : [], signals: html ? hackSignals(html) : [] };
    }
    return { ok: false, error: "Too many redirects", finalUrl: url, hops };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    return { ok: false, error: /certificate|tls|ssl/i.test(message) ? `TLS/certificate problem: ${message}` : "Could not connect to the website", finalUrl: url, hops };
  }
}

type Observation = GuardObservation & { publicNs: string[] | null; postureCheckedAt?: string };

// DNS records, live nameservers and the website are checked every pass; slow-changing settings
// (HTTPS / TLS / SSL mode / DNSSEC) at most hourly, to keep each cron run light.
async function observe(token: string, zone: ZoneInfo, registrar: RegistrarInfo, missing: Set<string>, baseline: Observation | null, now: Date): Promise<Observation> {
  const postureDue = !baseline?.postureCheckedAt || now.getTime() - new Date(baseline.postureCheckedAt).getTime() >= CACHE_MS;
  const skip = Promise.resolve({ ok: false, status: -1, result: null });
  const dnsRequest = cf<Array<{ type: string; name: string; content: string; priority?: number; proxied?: boolean }>>(token, `/zones/${zone.id}/dns_records?per_page=500`);
  // Email-only domains (e.g. outreach sending domains) have no website: skip the site check for them.
  const hasWebsite = dnsRequest.then((r) => !r.ok || !r.result || r.result.some((rec) => /^(A|AAAA|CNAME)$/.test(rec.type) && (rec.name === zone.name || rec.name === `www.${zone.name}`)));
  const [dns, settings, dnssec, publicNs, site] = await Promise.all([
    dnsRequest,
    postureDue ? cf<Array<{ id: string; value: unknown }>>(token, `/zones/${zone.id}/settings`) : skip as Promise<{ ok: boolean; status: number; result: Array<{ id: string; value: unknown }> | null }>,
    postureDue ? cf<{ status?: string }>(token, `/zones/${zone.id}/dnssec`) : skip as Promise<{ ok: boolean; status: number; result: { status?: string } | null }>,
    publicNameServers(zone.name),
    hasWebsite.then((web) => (web ? checkSite(zone.name) : null)),
  ]);
  if (dns.status === 403) missing.add("DNS Read");
  if (settings.status === 403) missing.add("Zone Settings Read");
  if (dnssec.status === 403) missing.add("DNS Read (DNSSEC)");
  const settingValue = (id: string) => { const v = settings.result?.find((s) => s.id === id)?.value; return typeof v === "string" ? v : undefined; };
  return {
    domain: zone.name,
    zone: { status: zone.status, paused: zone.paused, nameServers: zone.nameServers },
    records: dns.ok && dns.result ? dns.result.map((r) => recordKey(r)).sort() : null,
    settings: settings.ok ? { always_use_https: settingValue("always_use_https"), min_tls_version: settingValue("min_tls_version"), ssl: settingValue("ssl") } : postureDue ? null : baseline?.settings ?? null,
    dnssec: dnssec.ok ? dnssec.result?.status || null : postureDue ? null : baseline?.dnssec ?? null,
    postureCheckedAt: postureDue ? now.toISOString() : baseline?.postureCheckedAt,
    registrar: registrar[zone.name] || null,
    site,
    publicNs,
  };
}

async function cfPatch(token: string, path: string, body: unknown): Promise<boolean> {
  try {
    const response = await fetch(`${CF_API}${path}`, { method: "PATCH", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(12_000) });
    const payload = await response.json().catch(() => null) as { success?: boolean } | null;
    return response.ok && Boolean(payload?.success);
  } catch { return false; }
}

/**
 * House rule: every domain in the account (including any added in future) runs with Always HTTPS,
 * minimum TLS 1.2 and DNSSEC switched on. Safe to apply automatically (no origin or DNS-record changes).
 * SSL mode and registrar lock are only alerted on, never changed, as those can be deliberate.
 * Set the Worker var DOMAIN_GUARD_AUTO_SECURE=off to turn this off.
 */
async function autoSecure(token: string, zone: ZoneInfo, observation: Observation, missing: Set<string>): Promise<GuardFinding | null> {
  if (String((env as unknown as Record<string, string | undefined>).DOMAIN_GUARD_AUTO_SECURE || "").toLowerCase() === "off") return null;
  if (zone.status !== "active" || zone.paused) return null;
  const fixed: string[] = [];
  const s = observation.settings;
  if (s?.always_use_https === "off") {
    if (await cfPatch(token, `/zones/${zone.id}/settings/always_use_https`, { value: "on" })) { s.always_use_https = "on"; fixed.push("Always use HTTPS turned on"); } else missing.add("Zone Settings Edit");
  }
  if (s?.min_tls_version && Number(s.min_tls_version) < 1.2) {
    if (await cfPatch(token, `/zones/${zone.id}/settings/min_tls_version`, { value: "1.2" })) { fixed.push(`Minimum TLS raised from ${s.min_tls_version} to 1.2`); s.min_tls_version = "1.2"; } else missing.add("Zone Settings Edit");
  }
  if (observation.dnssec === "disabled") {
    if (await cfPatch(token, `/zones/${zone.id}/dnssec`, { status: "active" })) { observation.dnssec = "pending"; fixed.push("DNSSEC switched on (finishes once the DS record is at the registrar; automatic for Cloudflare-registered domains)"); } else missing.add("Zone DNSSEC Edit");
  }
  return fixed.length ? { severity: "info", key: `${zone.name}:auto-secured:${fixed.length}:${new Date().toISOString().slice(0, 10)}`, title: `${zone.name}: security settings applied automatically`, detail: fixed.join("\n") } : null;
}

/** Public NS must be the Cloudflare nameservers assigned to the zone; anything else = domain pointed away. */
function nameServerFinding(observation: Observation): GuardFinding | null {
  const assigned = [...(observation.zone?.nameServers || [])].sort();
  const live = observation.publicNs;
  if (!live || !live.length || !assigned.length) return null;
  if (live.every((ns) => assigned.includes(ns))) return null;
  return { severity: "critical", key: `${observation.domain}:ns-public`, title: `${observation.domain}: domain no longer points at Cloudflare`, detail: `Live nameservers: ${live.join(", ")}\nExpected: ${assigned.join(", ")}\nSomeone may have changed the nameservers at the registrar (hijack). Check the registrar account now.` };
}

async function sendAlerts(findings: GuardFinding[], ownerId: string, alertEmail: string) {
  const pushable = findings.filter((f) => f.severity !== "info");
  if (!pushable.length) return;
  const vars = env as unknown as Record<string, string | undefined>;
  const appUrl = String(vars.F2B_APP_URL || DEFAULT_APP_URL);
  const jobs: Promise<unknown>[] = [];
  const telegram = await telegramConfig(ownerId).catch(() => null);
  const telegramReady = Boolean(telegram?.botToken && telegram.chatId);
  if (telegram && telegramReady) {
    const message = formatTelegram(pushable, appUrl);
    jobs.push(createTelegram(telegram).send(message.text, message.buttons));
  }
  // Email for anything critical (and for warnings when Telegram isn't set up).
  const emailWorthy = pushable.some((f) => f.severity === "critical") || !telegramReady;
  if (emailWorthy && alertEmail && env.RESEND_API_KEY && env.TASK_NOTIFICATION_FROM) {
    const email = formatEmail(pushable);
    jobs.push(fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: env.TASK_NOTIFICATION_FROM, to: [alertEmail], subject: email.subject, text: email.text, html: email.html, headers: { "X-Priority": "1", Importance: "high" } }),
      signal: AbortSignal.timeout(15_000),
    }).then(async (response) => {
      if (!response.ok) throw new Error(`Resend HTTP ${response.status}`);
      await logSystemEmail(database() as never, { ownerId, to: alertEmail, subject: email.subject, text: email.text, html: email.html, kind: "security" });
    }));
  }
  const results = await Promise.allSettled(jobs);
  for (const result of results) if (result.status === "rejected") console.error("domain guard alert failed", result.reason);
}

/** Records findings as events and returns the ones that should be pushed now (new, or due a reminder). */
async function recordFindings(domain: string, findings: GuardFinding[], now: Date): Promise<GuardFinding[]> {
  const db = database();
  const due: GuardFinding[] = [];
  const iso = now.toISOString();
  for (const finding of findings) {
    const existing = await db.prepare("SELECT id, last_alert_at, acknowledged_at, acknowledged_by FROM domain_guard_events WHERE finding_key = ?1 ORDER BY created_at DESC LIMIT 1").bind(finding.key).first<{ id: string; last_alert_at: string | null; acknowledged_at: string | null; acknowledged_by: string | null }>();
    // A condition that cleared (auto-resolved) and has come back is a new event.
    const reopened = existing?.acknowledged_by === "auto-resolved";
    if (!existing || reopened) {
      await db.prepare("INSERT INTO domain_guard_events (id, domain, severity, finding_key, title, detail, created_at, last_alert_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)")
        .bind(crypto.randomUUID(), domain, finding.severity, finding.key, finding.title.slice(0, 300), finding.detail.slice(0, 3000), iso, finding.severity === "info" ? null : iso).run();
      due.push(finding);
      continue;
    }
    if (existing.acknowledged_at) continue; // someone has marked it as known
    const last = existing.last_alert_at ? new Date(existing.last_alert_at).getTime() : 0;
    if (finding.severity !== "info" && now.getTime() - last >= repeatAfter(finding.severity)) {
      await db.prepare("UPDATE domain_guard_events SET last_alert_at = ?2, detail = ?3 WHERE id = ?1").bind(existing.id, iso, finding.detail.slice(0, 3000)).run();
      due.push({ ...finding, title: `Still unresolved: ${finding.title}` });
    }
  }
  // Conditions that have cleared resolve themselves.
  const activeKeys = new Set(findings.map((f) => f.key));
  const open = await db.prepare("SELECT id, finding_key FROM domain_guard_events WHERE domain = ?1 AND acknowledged_at IS NULL").bind(domain).all<{ id: string; finding_key: string }>();
  for (const row of open.results || []) {
    if (CONDITION_KEYS.test(row.finding_key) && !activeKeys.has(row.finding_key)) {
      await db.prepare("UPDATE domain_guard_events SET acknowledged_at = ?2, acknowledged_by = 'auto-resolved' WHERE id = ?1").bind(row.id, iso).run();
    }
  }
  return due;
}

/**
 * One Domain Guard pass. From cron: the couple of least-recently-checked domains.
 * From "Check now": up to `limit` domains (or one named domain).
 */
export async function processDomainGuard(now = new Date(), options: { limit?: number; domain?: string } = {}): Promise<{ checked: string[]; alerts: number; missingPermissions: string[]; skipped?: string }> {
  if (!env.DB) return { checked: [], alerts: 0, missingPermissions: [], skipped: "no database" };
  await ensureGuardSchema();
  const owner = await workspaceOwner();
  if (!owner) return { checked: [], alerts: 0, missingPermissions: [], skipped: "no workspace" };
  const token = await cloudflareToken(owner.ownerId);
  if (!token) return { checked: [], alerts: 0, missingPermissions: [], skipped: "no Cloudflare token" };
  const missing = new Set<string>();
  const zones = await zoneList(token, now, missing);
  if (!zones.length) { await writeMeta("permissions", [...missing]); return { checked: [], alerts: 0, missingPermissions: [...missing], skipped: "no domains" }; }
  const db = database();
  const states = await db.prepare("SELECT domain, baseline_json, fail_count, checked_at FROM domain_guard_state").all<StateRow>();
  const byDomain = new Map((states.results || []).map((row) => [row.domain, row]));
  const only = options.domain?.toLowerCase();
  const wanted = only
    ? zones.filter((z) => z.name === only)
    : [...zones].sort((a, b) => String(byDomain.get(a.name)?.checked_at || "").localeCompare(String(byDomain.get(b.name)?.checked_at || ""))).slice(0, options.limit || ZONES_PER_TICK);
  const registrar = await registrarInfo(token, now, missing);
  const toPush: GuardFinding[] = [];
  const checked: string[] = [];

  for (const zone of wanted) {
    const state = byDomain.get(zone.name);
    let baseline: Observation | null = null;
    try { baseline = state?.baseline_json ? JSON.parse(state.baseline_json) as Observation : null; } catch { baseline = null; }
    const observation = await observe(token, zone, registrar, missing, baseline, now);
    const failCount = !observation.site || observation.site.ok ? 0 : (state?.fail_count || 0) + 1;
    const secured = await autoSecure(token, zone, observation, missing);
    const findings = evaluate({ ...observation, failCount }, baseline, now);
    if (secured) findings.push(secured);
    const nsFinding = nameServerFinding(observation);
    if (nsFinding) findings.push(nsFinding);
    toPush.push(...await recordFindings(zone.name, findings, now));

    // New baseline: keep the last good values when this run couldn't read something.
    const site = observation.site?.ok
      ? { ...observation.site, external: [...new Set([...(baseline?.site?.external || []), ...(observation.site.external || [])])].sort().slice(0, 80) }
      : baseline?.site || null;
    const nextBaseline = { ...observation, records: observation.records ?? baseline?.records ?? null, settings: observation.settings ?? baseline?.settings ?? null, dnssec: observation.dnssec ?? baseline?.dnssec ?? null, site };
    await db.prepare("INSERT INTO domain_guard_state (domain, zone_id, baseline_json, fail_count, checked_at) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(domain) DO UPDATE SET zone_id = excluded.zone_id, baseline_json = excluded.baseline_json, fail_count = excluded.fail_count, checked_at = excluded.checked_at")
      .bind(zone.name, zone.id, JSON.stringify(nextBaseline), failCount, now.toISOString()).run();
    checked.push(zone.name);
  }
  await writeMeta("permissions", [...missing]);
  await sendAlerts(toPush, owner.ownerId, owner.alertEmail);
  return { checked, alerts: toPush.filter((f) => f.severity !== "info").length, missingPermissions: [...missing] };
}

export type GuardDomainSummary = { domain: string; checkedAt: string | null; finalHost: string; dnssec: string | null; locked: boolean | null; records: number; open: number; worst: string };

/** Data for the Domain Guard panel. */
export async function domainGuardOverview(): Promise<{ domains: GuardDomainSummary[]; events: GuardEvent[]; missingPermissions: string[]; alertEmailSet: boolean; telegramSet: boolean }> {
  await ensureGuardSchema();
  const db = database();
  const [states, events, permissions, owner] = await Promise.all([
    db.prepare("SELECT domain, baseline_json, fail_count, checked_at FROM domain_guard_state ORDER BY domain").all<StateRow>(),
    db.prepare("SELECT id, domain, severity, finding_key, title, detail, created_at, last_alert_at, acknowledged_at, acknowledged_by FROM domain_guard_events ORDER BY created_at DESC LIMIT 60").all<Record<string, string | null>>(),
    readMeta<string[]>("permissions"),
    workspaceOwner(),
  ]);
  const telegram = owner ? await telegramConfig(owner.ownerId).catch(() => null) : null;
  const list: GuardEvent[] = (events.results || []).map((e) => ({ id: String(e.id), domain: String(e.domain), severity: String(e.severity), findingKey: String(e.finding_key), title: String(e.title), detail: String(e.detail || ""), createdAt: String(e.created_at), lastAlertAt: e.last_alert_at, acknowledgedAt: e.acknowledged_at, acknowledgedBy: e.acknowledged_by }));
  const rank: Record<string, number> = { ok: 0, info: 1, warning: 2, critical: 3 };
  const domains = (states.results || []).map((row) => {
    let b: Observation | null = null;
    try { b = row.baseline_json ? JSON.parse(row.baseline_json) as Observation : null; } catch { b = null; }
    const open = list.filter((e) => e.domain === row.domain && !e.acknowledgedAt && e.severity !== "info");
    const worst = open.reduce((acc, e) => ((rank[e.severity] || 0) > (rank[acc] || 0) ? e.severity : acc), "ok");
    return { domain: row.domain, checkedAt: row.checked_at, finalHost: normaliseHost(b?.site?.finalUrl || ""), dnssec: b?.dnssec ?? null, locked: b?.registrar ? b.registrar.locked !== false : null, records: b?.records?.length || 0, open: open.length, worst };
  });
  return { domains, events: list, missingPermissions: permissions?.value || [], alertEmailSet: Boolean(owner?.alertEmail), telegramSet: Boolean(telegram?.botToken && telegram.chatId) };
}

export async function acknowledgeGuardEvent(id: string, actor: string): Promise<boolean> {
  await ensureGuardSchema();
  const result = await database().prepare("UPDATE domain_guard_events SET acknowledged_at = ?2, acknowledged_by = ?3 WHERE id = ?1 AND acknowledged_at IS NULL").bind(id, new Date().toISOString(), actor.slice(0, 120)).run();
  return Boolean(result.meta?.changes);
}
