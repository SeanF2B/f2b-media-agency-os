// F2B Agency OS · Facebook Messenger + Instagram DMs, connected per sub-account (Launchpad → Messaging).
// Uses the same Meta app as Meta Ads (META_APP_ID / META_APP_SECRET / META_TOKEN_ENCRYPTION_KEY / META_MARKETING_API_VERSION).
// Page access tokens (from a long-lived user token they don't expire) are AES-GCM encrypted in D1 and never sent to the browser.
import { env } from "cloudflare:workers";
import { configuredMetaApiVersion, decryptMetaToken, encryptMetaToken } from "@/lib/meta-ads-direct";
import { hmacSha256Hex, type MetaChannel } from "./meta-rules";

export type MetaPage = { pageId: string; pageName: string; igId: string; igUsername: string; clientId: string; status: "pending" | "connected"; connectedAt: string; picture: string };

let ready = false;
export async function ensureMetaTables() {
  if (ready) return;
  const db = env.DB!;
  await db.prepare(`CREATE TABLE IF NOT EXISTS conv_meta_pages (owner_id TEXT NOT NULL, client_id TEXT NOT NULL DEFAULT '', page_id TEXT NOT NULL, page_name TEXT NOT NULL DEFAULT '', ig_id TEXT NOT NULL DEFAULT '', ig_username TEXT NOT NULL DEFAULT '', picture TEXT NOT NULL DEFAULT '', enc_token TEXT NOT NULL, token_iv TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', connected_at TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL, PRIMARY KEY (owner_id, client_id, page_id))`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS conv_meta_pages_page ON conv_meta_pages (page_id, status)`).run();
  await db.prepare(`CREATE INDEX IF NOT EXISTS conv_meta_pages_ig ON conv_meta_pages (ig_id, status)`).run();
  // Per-person messaging: which channels each teammate handles, and how their emails are signed.
  await db.prepare(`CREATE TABLE IF NOT EXISTS conv_staff_messaging (owner_id TEXT NOT NULL, staff_id TEXT NOT NULL, data TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL, PRIMARY KEY (owner_id, staff_id))`).run();
  await db.prepare(`ALTER TABLE conv_threads ADD COLUMN assigned_to TEXT NOT NULL DEFAULT ''`).run().catch(() => undefined);
  await db.prepare(`ALTER TABLE conv_threads ADD COLUMN contact_ref TEXT NOT NULL DEFAULT ''`).run().catch(() => undefined);
  ready = true;
}

export function metaMessagingConfigured() { return Boolean(env.META_APP_ID && env.META_APP_SECRET && env.META_TOKEN_ENCRYPTION_KEY && env.META_MARKETING_API_VERSION); }

async function proof(token: string) { return hmacSha256Hex(String(env.META_APP_SECRET || ""), token); }
export async function graph<T = any>(method: "GET" | "POST" | "DELETE", path: string, token: string, params: Record<string, string> = {}, json?: unknown): Promise<T> {
  const url = new URL(`https://graph.facebook.com/${configuredMetaApiVersion()}/${path.replace(/^\//, "")}`);
  const q = new URLSearchParams({ ...params, access_token: token, appsecret_proof: await proof(token) });
  url.search = q.toString();
  const res = await fetch(url, { method, headers: json ? { "content-type": "application/json" } : undefined, body: json ? JSON.stringify(json) : undefined, signal: AbortSignal.timeout(15_000) });
  const body = await res.json().catch(() => ({})) as T & { error?: { message?: string; code?: number; error_subcode?: number } };
  if (!res.ok || (body as any)?.error) {
    const e = (body as any)?.error || {};
    if (e.code === 10 || e.code === 200) throw new Error("Meta hasn't given this app messaging permission for that Page yet (app review / Advanced Access needed).");
    if (e.code === 190) throw new Error("The Facebook connection has expired. Reconnect it in Launchpad → Messaging.");
    if (e.code === 551 || e.error_subcode === 2018278) throw new Error("Meta won't deliver this: the customer's reply window has closed.");
    throw new Error(e.message ? `Meta: ${e.message}` : `Meta refused the request (HTTP ${res.status}).`);
  }
  return body;
}

/** After Facebook Login: save every Page the person manages as "pending" for this sub-account, so they can pick which to connect. */
export async function savePendingPages(ownerId: string, clientId: string, userToken: string) {
  await ensureMetaTables();
  const db = env.DB!, now = new Date().toISOString();
  const r = await graph<{ data?: Array<{ id: string; name: string; access_token: string; picture?: { data?: { url?: string } }; instagram_business_account?: { id: string; username?: string } }> }>("GET", "me/accounts", userToken, { fields: "id,name,access_token,picture{url},instagram_business_account{id,username}", limit: "100" });
  const pages = (r.data || []).filter((p) => p.id && p.access_token);
  await db.prepare("DELETE FROM conv_meta_pages WHERE owner_id=?1 AND client_id=?2 AND status='pending'").bind(ownerId, clientId).run();
  for (const p of pages) {
    const enc = await encryptMetaToken(p.access_token);
    await db.prepare(`INSERT INTO conv_meta_pages (owner_id, client_id, page_id, page_name, ig_id, ig_username, picture, enc_token, token_iv, status, connected_at, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,'pending','',?10)
      ON CONFLICT(owner_id, client_id, page_id) DO UPDATE SET page_name=excluded.page_name, ig_id=excluded.ig_id, ig_username=excluded.ig_username, picture=excluded.picture, enc_token=excluded.enc_token, token_iv=excluded.token_iv, updated_at=excluded.updated_at`)
      .bind(ownerId, clientId, p.id, p.name.slice(0, 120), p.instagram_business_account?.id || "", p.instagram_business_account?.username || "", p.picture?.data?.url || "", enc.ciphertext, enc.iv, now).run();
  }
  return pages.length;
}

type Row = { owner_id: string; client_id: string; page_id: string; page_name: string; ig_id: string; ig_username: string; picture: string; enc_token: string; token_iv: string; status: string; connected_at: string };
const toPage = (r: Row): MetaPage => ({ pageId: r.page_id, pageName: r.page_name, igId: r.ig_id, igUsername: r.ig_username, clientId: r.client_id, status: r.status === "connected" ? "connected" : "pending", connectedAt: r.connected_at, picture: r.picture });

/** Pages for one sub-account ("" = agency), or every sub-account when clientId is undefined. */
export async function listMetaPages(ownerId: string, clientId?: string) {
  await ensureMetaTables();
  const stmt = clientId === undefined
    ? env.DB!.prepare("SELECT * FROM conv_meta_pages WHERE owner_id=?1 ORDER BY page_name LIMIT 300").bind(ownerId)
    : env.DB!.prepare("SELECT * FROM conv_meta_pages WHERE owner_id=?1 AND client_id=?2 ORDER BY page_name LIMIT 100").bind(ownerId, clientId);
  return ((await stmt.all<Row>()).results || []).map(toPage);
}

/** Connect the chosen Pages to a sub-account: subscribe the app to their messages, drop the rest of the pending list. */
export async function connectPages(ownerId: string, clientId: string, pageIds: string[]) {
  await ensureMetaTables();
  const db = env.DB!, now = new Date().toISOString();
  const rows = ((await db.prepare("SELECT * FROM conv_meta_pages WHERE owner_id=?1 AND client_id=?2").bind(ownerId, clientId).all<Row>()).results || []);
  const errors: string[] = [];
  for (const r of rows.filter((x) => pageIds.includes(x.page_id))) {
    // A Page can only belong to one sub-account at a time.
    const other = await db.prepare("SELECT client_id FROM conv_meta_pages WHERE page_id=?1 AND status='connected' AND NOT (owner_id=?2 AND client_id=?3) LIMIT 1").bind(r.page_id, ownerId, clientId).first<{ client_id: string }>();
    if (other) { errors.push(`${r.page_name} is already connected to another account.`); continue; }
    try {
      const token = await decryptMetaToken(r.token_iv, r.enc_token);
      await graph("POST", `${r.page_id}/subscribed_apps`, token, { subscribed_fields: "messages,messaging_postbacks,message_echoes" });
      await db.prepare("UPDATE conv_meta_pages SET status='connected', connected_at=?4, updated_at=?4 WHERE owner_id=?1 AND client_id=?2 AND page_id=?3").bind(ownerId, clientId, r.page_id, now).run();
    } catch (e) { errors.push(`${r.page_name}: ${e instanceof Error ? e.message : "couldn't connect"}`); }
  }
  await db.prepare("DELETE FROM conv_meta_pages WHERE owner_id=?1 AND client_id=?2 AND status='pending'").bind(ownerId, clientId).run();
  return { pages: await listMetaPages(ownerId, clientId), errors };
}

export async function disconnectPage(ownerId: string, clientId: string, pageId: string) {
  await ensureMetaTables();
  const r = await env.DB!.prepare("SELECT * FROM conv_meta_pages WHERE owner_id=?1 AND client_id=?2 AND page_id=?3").bind(ownerId, clientId, pageId).first<Row>();
  if (!r) return;
  try { await graph("DELETE", `${pageId}/subscribed_apps`, await decryptMetaToken(r.token_iv, r.enc_token)); } catch { /* already gone on Meta's side */ }
  await env.DB!.prepare("DELETE FROM conv_meta_pages WHERE owner_id=?1 AND client_id=?2 AND page_id=?3").bind(ownerId, clientId, pageId).run();
}

/** Webhook lookup: which connected Page owns this Page id / Instagram account id. Indexed, one row. */
export async function findMetaPage(channel: MetaChannel, accountId: string) {
  await ensureMetaTables();
  const col = channel === "instagram" ? "ig_id" : "page_id";
  const r = await env.DB!.prepare(`SELECT * FROM conv_meta_pages WHERE ${col}=?1 AND status='connected' LIMIT 1`).bind(accountId).first<Row>();
  return r ? { page: toPage(r), ownerId: r.owner_id, token: () => decryptMetaToken(r.token_iv, r.enc_token) } : null;
}
export async function pageTokenFor(ownerId: string, pageOrIgId: string) {
  await ensureMetaTables();
  const r = await env.DB!.prepare("SELECT * FROM conv_meta_pages WHERE owner_id=?1 AND (page_id=?2 OR ig_id=?2) AND status='connected' LIMIT 1").bind(ownerId, pageOrIgId).first<Row>();
  return r ? { pageId: r.page_id, token: await decryptMetaToken(r.token_iv, r.enc_token) } : null;
}

/** The customer's name (Messenger) or @username (Instagram). Best effort. */
export async function metaProfileName(channel: MetaChannel, contactId: string, token: string) {
  try {
    const r = await graph<{ name?: string; first_name?: string; last_name?: string; username?: string }>("GET", contactId, token, { fields: channel === "instagram" ? "name,username" : "first_name,last_name" });
    return channel === "instagram" ? (r.name || (r.username ? `@${r.username}` : "")) : [r.first_name, r.last_name].filter(Boolean).join(" ");
  } catch { return ""; }
}

/** Send a reply through the Page (works for both Messenger and Instagram DMs). */
export async function sendMeta(ownerId: string, p: { accountId: string; contactId: string; text: string; tag?: "HUMAN_AGENT" }) {
  const t = await pageTokenFor(ownerId, p.accountId);
  if (!t) throw new Error("This Facebook Page is no longer connected. Reconnect it in Launchpad → Messaging.");
  const body: Record<string, unknown> = { recipient: { id: p.contactId }, message: { text: p.text.slice(0, 1900) }, messaging_type: p.tag ? "MESSAGE_TAG" : "RESPONSE" };
  if (p.tag) body.tag = p.tag;
  const r = await graph<{ message_id?: string }>("POST", `${t.pageId}/messages`, t.token, {}, body);
  return String(r.message_id || "");
}

/* ---------------- per-person messaging ---------------- */
export const MESSAGING_CHANNELS = ["whatsapp", "sms", "messenger", "instagram", "email"] as const;
export type MessagingChannel = typeof MESSAGING_CHANNELS[number];
export type StaffMessaging = { channels: Record<MessagingChannel, boolean>; emailName: string; emailReplyTo: string; signature: string; notify: boolean };
export const DEFAULT_STAFF_MESSAGING: StaffMessaging = { channels: { whatsapp: true, sms: true, messenger: true, instagram: true, email: true }, emailName: "", emailReplyTo: "", signature: "", notify: true };
export function sanitizeStaffMessaging(input: unknown): StaffMessaging {
  const v = (input && typeof input === "object" ? input : {}) as Record<string, any>;
  const ch = (v.channels && typeof v.channels === "object" ? v.channels : {}) as Record<string, unknown>;
  const channels = Object.fromEntries(MESSAGING_CHANNELS.map((c) => [c, ch[c] !== false])) as Record<MessagingChannel, boolean>;
  const replyTo = String(v.emailReplyTo || "").trim().slice(0, 200);
  return { channels, emailName: String(v.emailName || "").trim().slice(0, 80), emailReplyTo: /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(replyTo) ? replyTo : "", signature: String(v.signature || "").slice(0, 600), notify: v.notify !== false };
}
export async function getStaffMessaging(ownerId: string, staffIds?: string[]) {
  await ensureMetaTables();
  const rows = ((await env.DB!.prepare("SELECT staff_id, data FROM conv_staff_messaging WHERE owner_id=?1").bind(ownerId).all<{ staff_id: string; data: string }>()).results || []);
  const out: Record<string, StaffMessaging> = {};
  for (const r of rows) { if (staffIds && !staffIds.includes(r.staff_id)) continue; try { out[r.staff_id] = sanitizeStaffMessaging(JSON.parse(r.data)); } catch { /* skip */ } }
  return out;
}
export async function saveStaffMessaging(ownerId: string, staffId: string, data: StaffMessaging) {
  await ensureMetaTables();
  await env.DB!.prepare("INSERT INTO conv_staff_messaging (owner_id, staff_id, data, updated_at) VALUES (?1,?2,?3,?4) ON CONFLICT(owner_id, staff_id) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at").bind(ownerId, staffId, JSON.stringify(data), new Date().toISOString()).run();
}
