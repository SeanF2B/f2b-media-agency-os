// Outreach server store: schema bootstrap, encrypted connections, settings, audit, alerts.
import { env } from "cloudflare:workers";
import { aiCredentialStorageReady, decryptAiCredential, encryptAiCredential } from "@/lib/ai-credentials";
import { OUTREACH_SCHEMA } from "@/lib/outreach/schema-sql.mjs";

export type ConnectionProvider = "microsoft" | "google" | "telegram" | "postmaster";
export type OutreachSettings = {
  cooldownDays: number;            // 0 = no re-contact gap; unsubscribes are always permanent
  bookingUrl: string;
  seatPriceCents: { microsoft: number | null; google: number | null; smtp: number | null };
  workersPlanCents: number | null;
  defaultTargetDaily: number;
  dmarcReportEmail: string;
  senderAddress: string;           // postal address for the footer (CAN-SPAM / ePrivacy best practice)
  appUrl: string;
};

export const DEFAULT_SETTINGS: OutreachSettings = {
  cooldownDays: 90, bookingUrl: "", seatPriceCents: { microsoft: 400, google: 700, smtp: null }, workersPlanCents: null,
  defaultTargetDaily: 30, dmarcReportEmail: "", senderAddress: "", appUrl: "",
};

let schemaReady: Promise<void> | null = null;

export function db(): D1Database {
  if (!env.DB) throw new Error("The private workspace database is not available.");
  return env.DB;
}

/** Creates the Outreach tables once per isolate (CREATE … IF NOT EXISTS, batched). */
export function ensureOutreachSchema(): Promise<void> {
  if (!schemaReady) {
    const database = db();
    schemaReady = database.batch(OUTREACH_SCHEMA.map((statement) => database.prepare(statement))).then(() => undefined).catch((error: unknown) => { schemaReady = null; throw error; });
  }
  return schemaReady;
}

export const nowIso = () => new Date().toISOString();
export const uuid = () => crypto.randomUUID();
export const todayUtc = () => new Date().toISOString().slice(0, 10);

export function parseJson<T>(text: unknown, fallback: T): T {
  if (typeof text !== "string" || !text) return fallback;
  try { return JSON.parse(text) as T; } catch { return fallback; }
}

// ---------------- settings ----------------
export async function getSettings(ownerId: string): Promise<OutreachSettings> {
  await ensureOutreachSchema();
  const row = await db().prepare("SELECT data FROM outreach_settings WHERE owner_id = ?1").bind(ownerId).first<{ data: string }>();
  const saved = parseJson<Partial<OutreachSettings>>(row?.data, {});
  return { ...DEFAULT_SETTINGS, ...saved, seatPriceCents: { ...DEFAULT_SETTINGS.seatPriceCents, ...(saved.seatPriceCents || {}) } };
}

export async function saveSettings(ownerId: string, patch: Partial<OutreachSettings>): Promise<OutreachSettings> {
  const current = await getSettings(ownerId);
  const next: OutreachSettings = { ...current, ...patch, seatPriceCents: { ...current.seatPriceCents, ...(patch.seatPriceCents || {}) } };
  next.cooldownDays = Math.max(0, Math.min(3650, Math.floor(Number(next.cooldownDays) || 0)));
  next.defaultTargetDaily = Math.max(1, Math.min(50, Math.floor(Number(next.defaultTargetDaily) || 30)));
  await db().prepare("INSERT INTO outreach_settings (owner_id, data, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(owner_id) DO UPDATE SET data = excluded.data, updated_at = excluded.updated_at").bind(ownerId, JSON.stringify(next), nowIso()).run();
  return next;
}

// ---------------- connections (secrets encrypted with the agency key) ----------------
export async function saveConnection(ownerId: string, provider: ConnectionProvider, secret: Record<string, unknown>, config: Record<string, unknown>, status: "ok" | "error" | "unverified", lastError = "") {
  if (!aiCredentialStorageReady()) throw new Error("Secure storage needs a one-time server setup (AGENCY_CREDENTIALS_ENCRYPTION_KEY).");
  await ensureOutreachSchema();
  const serialised = JSON.stringify(secret);
  const encrypted = await encryptAiCredential(serialised);
  const now = nowIso();
  await db().prepare(`INSERT INTO outreach_connections (owner_id, provider, encrypted_secret, secret_iv, fingerprint, config_json, status, last_error, verified_at, created_at, updated_at)
    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?10)
    ON CONFLICT(owner_id, provider) DO UPDATE SET encrypted_secret = excluded.encrypted_secret, secret_iv = excluded.secret_iv, fingerprint = excluded.fingerprint, config_json = excluded.config_json, status = excluded.status, last_error = excluded.last_error, verified_at = excluded.verified_at, updated_at = excluded.updated_at`)
    .bind(ownerId, provider, encrypted.ciphertext, encrypted.iv, serialised.slice(-6).replace(/[^a-z0-9]/gi, "") || "set", JSON.stringify(config), status, lastError.slice(0, 300), status === "ok" ? now : null, now).run();
}

export async function updateConnectionStatus(ownerId: string, provider: ConnectionProvider, status: "ok" | "error", lastError = "") {
  await db().prepare("UPDATE outreach_connections SET status = ?3, last_error = ?4, verified_at = CASE WHEN ?3 = 'ok' THEN ?5 ELSE verified_at END, updated_at = ?5 WHERE owner_id = ?1 AND provider = ?2").bind(ownerId, provider, status, lastError.slice(0, 300), nowIso()).run();
}

export async function loadConnection<S = Record<string, unknown>>(ownerId: string, provider: ConnectionProvider): Promise<{ secret: S; config: Record<string, unknown>; status: string; lastError: string } | null> {
  await ensureOutreachSchema();
  const row = await db().prepare("SELECT encrypted_secret, secret_iv, config_json, status, last_error FROM outreach_connections WHERE owner_id = ?1 AND provider = ?2").bind(ownerId, provider).first<{ encrypted_secret: string; secret_iv: string; config_json: string; status: string; last_error: string }>();
  if (!row) return null;
  const secret = parseJson<S>(await decryptAiCredential(row.secret_iv, row.encrypted_secret), {} as S);
  return { secret, config: parseJson(row.config_json, {}), status: row.status, lastError: row.last_error };
}

export async function listConnections(ownerId: string) {
  await ensureOutreachSchema();
  const rows = await db().prepare("SELECT provider, config_json, status, last_error, verified_at, fingerprint FROM outreach_connections WHERE owner_id = ?1").bind(ownerId).all<{ provider: string; config_json: string; status: string; last_error: string; verified_at: string | null; fingerprint: string }>();
  return (rows.results || []).map((row) => ({ provider: row.provider, config: parseJson<Record<string, unknown>>(row.config_json, {}), status: row.status, lastError: row.last_error, verifiedAt: row.verified_at, fingerprint: row.fingerprint }));
}

export async function removeConnection(ownerId: string, provider: ConnectionProvider) {
  await db().prepare("DELETE FROM outreach_connections WHERE owner_id = ?1 AND provider = ?2").bind(ownerId, provider).run();
}

// ---------------- Telegram: reuse the existing bot from server secrets first ----------------
export type TelegramConfig = { botToken: string; chatId: string; source: "worker-secret" | "saved-api-key" | "outreach-settings" };

export async function telegramConfig(ownerId: string): Promise<TelegramConfig | null> {
  const vars = env as unknown as Record<string, string | undefined>;
  const secretToken = String(vars.TELEGRAM_BOT_TOKEN || vars.F2B_TELEGRAM_BOT_TOKEN || "").trim();
  const secretChat = String(vars.TELEGRAM_CHAT_ID || vars.F2B_TELEGRAM_CHAT_ID || "").trim();
  const saved = await loadConnection<{ botToken?: string }>(ownerId, "telegram").catch(() => null);
  const savedChat = String(saved?.config?.chatId || "");
  if (secretToken) return { botToken: secretToken, chatId: secretChat || savedChat, source: "worker-secret" };
  // A key saved under Settings → Other API keys with "Telegram" in its name.
  try {
    const row = await db().prepare("SELECT encrypted_key, key_iv, note FROM agency_custom_api_keys WHERE owner_id = ?1 AND lower(label) LIKE '%telegram%' ORDER BY updated_at DESC LIMIT 1").bind(ownerId).first<{ encrypted_key: string; key_iv: string; note: string }>();
    if (row) {
      const token = (await decryptAiCredential(row.key_iv, row.encrypted_key)).trim();
      const noteChat = /-?\d{5,}/.exec(row.note || "")?.[0] || "";
      return { botToken: token, chatId: savedChat || secretChat || noteChat, source: "saved-api-key" };
    }
  } catch { /* table may not exist yet */ }
  if (saved?.secret?.botToken) return { botToken: saved.secret.botToken, chatId: savedChat || secretChat, source: "outreach-settings" };
  return null;
}

// ---------------- Cloudflare token (same one Domains & DNS uses) ----------------
export async function cloudflareToken(ownerId: string): Promise<string | null> {
  const secret = String(env.CLOUDFLARE_DNS_API_TOKEN || "").trim();
  if (secret) return secret;
  try {
    const row = await db().prepare("SELECT encrypted_key, key_iv FROM agency_cloudflare_dns_token WHERE owner_id = ?1").bind(ownerId).first<{ encrypted_key: string; key_iv: string }>();
    return row ? await decryptAiCredential(row.key_iv, row.encrypted_key) : null;
  } catch { return null; }
}
export const cloudflareAccountId = () => String(env.F2B_CF_ACCOUNT_ID || "").trim();
export const purchasesEnabled = () => String((env as unknown as Record<string, string | undefined>).OUTREACH_PURCHASES_ENABLED || "") === "true";

// ---------------- audit, alerts, AI usage ----------------
export async function audit(ownerId: string, actor: string, action: string, target = "", detail: Record<string, unknown> = {}) {
  await db().prepare("INSERT INTO outreach_audit (id, owner_id, actor, action, target, detail_json, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)").bind(uuid(), ownerId, actor.slice(0, 120), action.slice(0, 80), target.slice(0, 200), JSON.stringify(detail).slice(0, 4000), nowIso()).run();
}

/** Runs send() at most once per key per `hours`. Returns true when it sent. */
export async function alertOnce(ownerId: string, key: string, detail: string, send: () => Promise<unknown>, hours = 20): Promise<boolean> {
  const row = await db().prepare("SELECT last_sent_at FROM outreach_alerts WHERE owner_id = ?1 AND alert_key = ?2").bind(ownerId, key).first<{ last_sent_at: string }>();
  if (row && Date.now() - new Date(row.last_sent_at).getTime() < hours * 3_600_000) return false;
  await send();
  await db().prepare("INSERT INTO outreach_alerts (owner_id, alert_key, last_sent_at, detail) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(owner_id, alert_key) DO UPDATE SET last_sent_at = excluded.last_sent_at, detail = excluded.detail").bind(ownerId, key, nowIso(), detail.slice(0, 500)).run();
  return true;
}

export async function recordAiUsage(ownerId: string, feature: string, usage: { tokensIn: number; tokensOut: number; costUsd: number }) {
  await db().prepare(`INSERT INTO outreach_ai_usage (owner_id, day, feature, calls, tokens_in, tokens_out, cost_usd) VALUES (?1, ?2, ?3, 1, ?4, ?5, ?6)
    ON CONFLICT(owner_id, day, feature) DO UPDATE SET calls = calls + 1, tokens_in = tokens_in + excluded.tokens_in, tokens_out = tokens_out + excluded.tokens_out, cost_usd = cost_usd + excluded.cost_usd`)
    .bind(ownerId, todayUtc(), feature, Math.max(0, Math.round(usage.tokensIn)), Math.max(0, Math.round(usage.tokensOut)), Math.max(0, usage.costUsd || 0)).run();
}
