// F2B Agency OS · Facebook Messenger + Instagram DM rules that don't need the database (unit tested).
// Meta sends one webhook for both: object "page" (Messenger) or "instagram" (Instagram DMs).

export type MetaChannel = "messenger" | "instagram";
export type MetaInbound = {
  channel: MetaChannel;
  /** The Page id (Messenger) or Instagram professional account id (Instagram) the message was sent to. */
  accountId: string;
  /** The customer's page-scoped / Instagram-scoped id. */
  contactId: string;
  mid: string;
  text: string;
  attachments: Array<{ type: string; url: string }>;
  /** True when the business sent it (from Meta Business Suite, the Instagram app, or this OS). */
  echo: boolean;
  appId: string;
  at: string;
};

/** Pull every customer / echo message out of a Meta webhook body. Reactions, reads and deliveries are ignored. */
export function parseMetaWebhook(body: unknown): MetaInbound[] {
  const b = (body && typeof body === "object" ? body : {}) as { object?: string; entry?: unknown[] };
  const channel: MetaChannel | null = b.object === "page" ? "messenger" : b.object === "instagram" ? "instagram" : null;
  if (!channel || !Array.isArray(b.entry)) return [];
  const out: MetaInbound[] = [];
  for (const entry of b.entry as Array<{ id?: string; messaging?: unknown[] }>) {
    const accountId = String(entry?.id || "");
    for (const ev of (Array.isArray(entry?.messaging) ? entry.messaging : []) as Array<Record<string, any>>) {
      const m = ev?.message;
      if (!m || typeof m !== "object" || m.is_deleted || m.is_unsupported) continue;
      const echo = Boolean(m.is_echo);
      const contactId = String(echo ? ev?.recipient?.id || "" : ev?.sender?.id || "");
      if (!contactId || !accountId || contactId === accountId) continue;
      const attachments = (Array.isArray(m.attachments) ? m.attachments : [])
        .map((a: any) => ({ type: String(a?.type || "file"), url: String(a?.payload?.url || "") }))
        .filter((a: { url: string }) => /^https:\/\//.test(a.url));
      const text = String(m.text || "").slice(0, 4000);
      if (!text && !attachments.length) continue;
      const ts = Number(ev?.timestamp || 0);
      out.push({ channel, accountId, contactId, mid: String(m.mid || ""), text, attachments, echo, appId: String(m.app_id || ""), at: ts > 0 ? new Date(ts).toISOString() : new Date().toISOString() });
    }
  }
  return out;
}

/** What the chat shows for a message: its text plus one line per photo / file. */
export function inboundBody(m: Pick<MetaInbound, "text" | "attachments">) {
  const lines = m.attachments.map((a) => (a.type === "image" ? `📷 ${a.url}` : a.type === "video" ? `🎬 ${a.url}` : a.type === "audio" ? `🎙️ ${a.url}` : `📎 ${a.url}`));
  return [m.text, ...lines].filter(Boolean).join("\n") || "[Customer sent something the inbox can't show yet]";
}

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((x) => x.toString(16).padStart(2, "0")).join("");
export async function hmacSha256Hex(secret: string, data: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data)));
}
/** Meta signs every webhook body with the app secret: header `X-Hub-Signature-256: sha256=<hex>`. Constant-time compare. */
export async function verifyMetaSignature(appSecret: string, rawBody: string, header: string | null) {
  if (!appSecret || !header || !header.startsWith("sha256=")) return false;
  const expect = await hmacSha256Hex(appSecret, rawBody), got = header.slice(7).toLowerCase();
  if (expect.length !== got.length) return false;
  let diff = 0;
  for (let i = 0; i < expect.length; i++) diff |= expect.charCodeAt(i) ^ got.charCodeAt(i);
  return diff === 0;
}
/** Verify token for Meta's webhook handshake: derived from the app secret so no extra secret has to be added. */
export async function metaVerifyToken(appSecret: string) { return "f2b-" + (await hmacSha256Hex(appSecret, "f2b-meta-messaging-webhook")).slice(0, 24); }

/**
 * Meta's reply rules: free replies for 24h after the customer's last message. A person (never the bot)
 * may still answer for 7 days using the HUMAN_AGENT tag. After that the chat is locked until they write again.
 */
export function metaSendMode(lastInAt: string | null | undefined, byStaff: boolean, now = Date.now()): { ok: boolean; tag?: "HUMAN_AGENT"; reason?: string } {
  const t = lastInAt ? Date.parse(lastInAt) : NaN;
  if (!Number.isFinite(t)) return { ok: false, reason: "This customer hasn't messaged yet. Meta only lets you reply after they write to you." };
  const age = now - t;
  if (age <= 24 * 3_600_000) return { ok: true };
  if (byStaff && age <= 7 * 24 * 3_600_000) return { ok: true, tag: "HUMAN_AGENT" };
  return { ok: false, reason: byStaff ? "It's been more than 7 days since they last wrote. Meta won't deliver a reply until they message again." : "Outside the 24-hour window, so only a person can reply." };
}

export const META_MESSAGING_SCOPES = ["pages_show_list", "pages_messaging", "pages_manage_metadata", "pages_read_engagement", "business_management", "instagram_basic", "instagram_manage_messages"];
