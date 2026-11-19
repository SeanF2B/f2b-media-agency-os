// Public Meta webhook for Facebook Messenger + Instagram DMs. Under /api/marketing-public so the existing public Access bypass covers it.
// GET = Meta's subscription handshake. POST = messages, verified with X-Hub-Signature-256 (HMAC-SHA256 of the raw body with the app secret).
import { env } from "cloudflare:workers";
import { addMessage, botReply, ensureTables, leadToCrm, loadSettings, upsertThread } from "@/lib/conversations/core";
import { ensureMetaTables, findMetaPage, metaProfileName, sendMeta } from "@/lib/conversations/meta";
import { inboundBody, metaSendMode, metaVerifyToken, parseMetaWebhook, verifyMetaSignature } from "@/lib/conversations/meta-rules";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (url.searchParams.get("hub.mode") !== "subscribe") return new Response("F2B Meta messaging webhook is active.", { status: 200 });
  const expected = env.META_APP_SECRET ? await metaVerifyToken(env.META_APP_SECRET) : "";
  if (!expected || url.searchParams.get("hub.verify_token") !== expected) return new Response("Verify token mismatch", { status: 403 });
  return new Response(url.searchParams.get("hub.challenge") || "", { status: 200, headers: { "Content-Type": "text/plain" } });
}

export async function POST(request: Request) {
  if (!env.DB || !env.META_APP_SECRET) return new Response("", { status: 503 });
  const raw = await request.text();
  if (!(await verifyMetaSignature(env.META_APP_SECRET, raw, request.headers.get("x-hub-signature-256")))) return new Response("", { status: 403 });
  let body: unknown; try { body = JSON.parse(raw); } catch { return new Response("", { status: 400 }); }
  await ensureTables(); await ensureMetaTables();
  for (const m of parseMetaWebhook(body).slice(0, 25)) {
    try {
      const found = await findMetaPage(m.channel, m.accountId);
      if (!found) continue;
      const db = env.DB;
      if (m.mid) { const dup = await db.prepare("SELECT 1 FROM conv_messages WHERE twilio_sid=?1 AND owner_id=?2").bind(m.mid, found.ownerId).first().catch(() => null); if (dup) continue; }
      // Our own sends come back as echoes; skip those (already saved). Echoes from Business Suite / the Instagram app are saved as staff replies.
      if (m.echo && m.appId && m.appId === String(env.META_APP_ID || "")) continue;
      const ourId = m.channel === "instagram" ? found.page.igId : found.page.pageId;
      let thread = await db.prepare("SELECT * FROM conv_threads WHERE owner_id=?1 AND our_number=?2 AND contact=?3 AND channel=?4").bind(found.ownerId, ourId, m.contactId, m.channel).first<any>();
      const isNew = !thread;
      if (!thread) {
        const token = await found.token();
        const name = await metaProfileName(m.channel, m.contactId, token);
        thread = await upsertThread(found.ownerId, { channel: m.channel, ourNumber: ourId, contact: m.contactId, contactName: name, clientId: found.page.clientId });
      }
      const text = inboundBody(m);
      if (m.echo) { await addMessage(found.ownerId, thread.id, { direction: "out", sender: "staff", body: text, sid: m.mid, status: "sent" }); continue; }
      await addMessage(found.ownerId, thread.id, { direction: "in", sender: "customer", body: text, sid: m.mid });
      if (isNew) await leadToCrm(found.ownerId, { clientId: found.page.clientId, channel: m.channel, contact: m.contactId, name: String(thread.contact_name || ""), firstMessage: text });
      // AI bot: same brain and rules as WhatsApp/SMS, and only inside the 24-hour window.
      const { settings } = await loadSettings(found.ownerId);
      if (!settings.botEnabled || !thread.bot_on || thread.status === "handoff" || thread.status === "closed") continue;
      if (!metaSendMode(m.at, false).ok) continue;
      const recent = await db.prepare("SELECT COUNT(*) AS n FROM conv_messages WHERE thread_id=?1 AND sender='bot' AND created_at > ?2").bind(thread.id, new Date(Date.now() - 3600_000).toISOString()).first<{ n: number }>();
      if ((recent?.n || 0) >= 20) continue;
      const rows = ((await db.prepare("SELECT sender, body FROM conv_messages WHERE thread_id=?1 ORDER BY created_at DESC LIMIT 14").bind(thread.id).all<{ sender: string; body: string }>()).results || []).reverse();
      const client = await db.prepare("SELECT json_extract(value,'$.name') AS name FROM workspace_documents, json_each(data,'$.clients') WHERE id='f2b-agency' AND json_extract(value,'$.id')=?1").bind(found.page.clientId).first<{ name: string }>().catch(() => null);
      const reply = await botReply(found.ownerId, { settings, config: { number: ourId, channel: "whatsapp", clientId: found.page.clientId, label: client?.name || found.page.pageName, info: "" }, clientName: client?.name || found.page.pageName, channel: m.channel, history: rows });
      if (!reply) { await db.prepare("UPDATE conv_threads SET status='handoff' WHERE id=?1").bind(thread.id).run(); continue; }
      let sid = "", error = "";
      try { sid = await sendMeta(found.ownerId, { accountId: ourId, contactId: m.contactId, text: reply.text }); } catch (e) { error = e instanceof Error ? e.message : "Could not send."; }
      await addMessage(found.ownerId, thread.id, { direction: "out", sender: "bot", body: reply.text, sid, error });
      if (reply.handoff || error) await db.prepare("UPDATE conv_threads SET bot_on=0, status='handoff' WHERE id=?1").bind(thread.id).run();
    } catch (e) { console.error("meta webhook message", e instanceof Error ? e.message : e); }
  }
  // Always 200 so Meta doesn't retry and disable the webhook over one bad message.
  return new Response("EVENT_RECEIVED", { status: 200 });
}
