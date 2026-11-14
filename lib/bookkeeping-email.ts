import { env } from "cloudflare:workers";

// Gmail connection for Bookkeeping: one connected inbox per client (or the agency). The refresh token is
// encrypted with the same key as the other Google connections and never leaves the server.
const toB64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes));
const fromB64 = (value: string) => Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
async function key() {
  if (!env.GOOGLE_ADS_TOKEN_ENCRYPTION_KEY) throw new Error("Google token storage is not configured.");
  return crypto.subtle.importKey("raw", fromB64(env.GOOGLE_ADS_TOKEN_ENCRYPTION_KEY), "AES-GCM", false, ["encrypt", "decrypt"]);
}
export const gmailOAuthReady = () => Boolean(env.DB && env.GOOGLE_ADS_CLIENT_ID && env.GOOGLE_ADS_CLIENT_SECRET && env.GOOGLE_ADS_TOKEN_ENCRYPTION_KEY);
export const GMAIL_SCOPE = "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/userinfo.email";

async function ensure(db: D1Database) {
  await db.prepare("CREATE TABLE IF NOT EXISTS bookkeeping_gmail (owner_id TEXT NOT NULL, scope_id TEXT NOT NULL, encrypted_refresh_token TEXT NOT NULL, token_iv TEXT NOT NULL, account_email TEXT NOT NULL DEFAULT '', connected_at TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY (owner_id, scope_id))").run();
}

export async function saveGmail(ownerId: string, scopeId: string, refreshToken: string, email: string) {
  const db = env.DB!; await ensure(db);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await key(), new TextEncoder().encode(refreshToken));
  const now = new Date().toISOString();
  await db.prepare("INSERT INTO bookkeeping_gmail (owner_id, scope_id, encrypted_refresh_token, token_iv, account_email, connected_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6) ON CONFLICT(owner_id, scope_id) DO UPDATE SET encrypted_refresh_token = excluded.encrypted_refresh_token, token_iv = excluded.token_iv, account_email = excluded.account_email, updated_at = excluded.updated_at")
    .bind(ownerId, scopeId, toB64(new Uint8Array(cipher)), toB64(iv), email, now).run();
}

export async function gmailConnection(ownerId: string, scopeId: string) {
  const db = env.DB!; await ensure(db);
  return db.prepare("SELECT encrypted_refresh_token, token_iv, account_email, connected_at FROM bookkeeping_gmail WHERE owner_id = ?1 AND scope_id = ?2").bind(ownerId, scopeId).first<{ encrypted_refresh_token: string; token_iv: string; account_email: string; connected_at: string }>();
}

export async function removeGmail(ownerId: string, scopeId: string) {
  const db = env.DB!; await ensure(db);
  await db.prepare("DELETE FROM bookkeeping_gmail WHERE owner_id = ?1 AND scope_id = ?2").bind(ownerId, scopeId).run();
}

async function accessToken(saved: { encrypted_refresh_token: string; token_iv: string }) {
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(saved.token_iv) }, await key(), fromB64(saved.encrypted_refresh_token));
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: env.GOOGLE_ADS_CLIENT_ID!, client_secret: env.GOOGLE_ADS_CLIENT_SECRET!, refresh_token: new TextDecoder().decode(plain), grant_type: "refresh_token" }), signal: AbortSignal.timeout(12000) });
  const result = await response.json() as { access_token?: string; error?: string };
  if (!response.ok || !result.access_token) throw new Error(result.error === "invalid_grant" ? "Gmail access expired. Reconnect the inbox." : "Gmail couldn't refresh its access. Try reconnecting.");
  return result.access_token;
}

export type ReceiptEmail = { id: string; from: string; subject: string; date: string; attachments: string[] };

// Recent emails that look like receipts or supplier invoices (with an attachment), newest first.
export async function recentReceipts(saved: { encrypted_refresh_token: string; token_iv: string }, max = 15): Promise<ReceiptEmail[]> {
  const token = await accessToken(saved);
  const q = "has:attachment newer_than:90d (invoice OR receipt OR bill OR \"payment confirmation\" OR \"order confirmation\")";
  const list = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${new URLSearchParams({ q, maxResults: String(max) })}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(12000) });
  const body = await list.json() as { messages?: Array<{ id: string }>; error?: { message?: string } };
  if (!list.ok) throw new Error(body.error?.message || "Gmail couldn't be read.");
  const ids = (body.messages || []).map((m) => m.id);
  const rows = await Promise.all(ids.map(async (id) => {
    const r = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=full&fields=id,internalDate,payload(headers,parts(filename,parts(filename)))`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(12000) });
    if (!r.ok) return null;
    const m = await r.json() as { id: string; internalDate?: string; payload?: { headers?: Array<{ name: string; value: string }>; parts?: Array<{ filename?: string; parts?: Array<{ filename?: string }> }> } };
    const header = (name: string) => m.payload?.headers?.find((h) => h.name.toLowerCase() === name)?.value || "";
    const files = (m.payload?.parts || []).flatMap((part) => [part.filename || "", ...(part.parts || []).map((inner) => inner.filename || "")]).filter(Boolean);
    return { id: m.id, from: header("from").replace(/<.*>/, "").replace(/"/g, "").trim() || header("from"), subject: header("subject"), date: m.internalDate ? new Date(Number(m.internalDate)).toISOString().slice(0, 10) : "", attachments: files };
  }));
  return rows.filter((row): row is ReceiptEmail => Boolean(row));
}
