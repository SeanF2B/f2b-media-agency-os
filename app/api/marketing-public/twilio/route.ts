// Public Twilio webhook (SMS + WhatsApp). Lives under /api/marketing-public so the existing public Access bypass already covers it.
// Every request is verified with Twilio's X-Twilio-Signature (HMAC-SHA1 with the saved Auth Token) before anything is stored.
import { env } from "cloudflare:workers";
import { detectMediaType, MEDIA_SCHEMA_SQL, newFileKey, publicMediaUrl } from "@/lib/media-library/core";
import { logUsageEvent } from "@/lib/usage-meter";
import { addMessage, botLinksFor, botReply, hasSchedulingLink, holdBotReply, leadToCrm, e164, findOwnerByNumber, loadSettings, twilioCredentials, upsertThread, verifyTwilio, type Channel } from "@/lib/conversations/core";

export const dynamic = "force-dynamic";
const xml = (body: string, status = 200) => new Response(`<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`, { status, headers: { "Content-Type": "text/xml; charset=utf-8", "Cache-Control": "no-store" } });
const esc = (s: string) => s.replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);

export async function GET() { return new Response("F2B Twilio webhook is active. Point Twilio's incoming-message webhook here with HTTP POST.", { status: 200 }); }

export async function POST(request: Request) {
  if (!env.DB) return xml("", 503);
  let form: FormData;
  try { form = await request.formData(); } catch { return xml("", 400); }
  const params: Record<string, string> = {};
  form.forEach((v, k) => { if (typeof v === "string") params[k] = v; });
  const from = String(params.From || ""), to = String(params.To || "");
  const channel: Channel = /^whatsapp:/i.test(from) ? "whatsapp" : "sms";
  const contact = e164(from), ourNumber = e164(to), text = String(params.Body || "").trim().slice(0, 1600);
  if (!contact || !ourNumber) return xml("", 400);
  const found = await findOwnerByNumber(ourNumber, channel);
  if (!found) return xml("", 403);
  const creds = await twilioCredentials(found.ownerId);
  if (!creds) return xml("", 403);
  const url = new URL(request.url), host = request.headers.get("host") || url.host;
  const candidates = [...new Set([request.url, `https://${host}${url.pathname}${url.search}`, `https://${url.host}${url.pathname}${url.search}`])];
  if (!(await verifyTwilio(creds.token, candidates, params, request.headers.get("x-twilio-signature") || ""))) return xml("", 403);
  if (!text && !Number(params.NumMedia || 0)) return xml("");
  // Photos the customer sends are copied into the client's Media Library so they show in the chat (and can go on a booking).
  const mediaLines: string[] = [];
  const media = Math.min(5, Number(params.NumMedia || 0));
  if (media > 0 && env.BUCKET) {
    for (const stmt of MEDIA_SCHEMA_SQL.slice(0, 3)) await env.DB.prepare(stmt).run().catch(() => undefined);
    for (let i = 0; i < media; i++) {
      const src = String(params[`MediaUrl${i}`] || ""); if (!/^https:\/\/api\.twilio\.com\//.test(src)) continue;
      try {
        const res = await fetch(src, { headers: { authorization: `Basic ${btoa(`${creds.sid}:${creds.token}`)}` }, redirect: "follow" });
        if (!res.ok) continue;
        const bytes = new Uint8Array(await res.arrayBuffer()); if (!bytes.byteLength || bytes.byteLength > 20_000_000) continue;
        const type = detectMediaType(bytes); if (!type || type.kind === "document") continue;
        const key = newFileKey(type.ext);
        await env.BUCKET.put(key, bytes, { httpMetadata: { contentType: type.mime, cacheControl: "public, max-age=31536000, immutable" } });
        const now = new Date().toISOString();
        await env.DB.prepare("INSERT INTO media_library_items (id, owner_id, scope_id, name, folder, kind, mime, size, file_key, source, source_id, created_by, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, 'Conversation photos', ?5, ?6, ?7, ?8, 'conversation', ?9, ?10, ?11, ?11)")
          .bind(crypto.randomUUID(), found.ownerId, found.config.clientId || "", `${String(params.ProfileName || contact).slice(0, 60)} photo`, type.kind, type.mime, bytes.byteLength, key, String(params.MessageSid || ""), contact, now).run().catch(() => undefined);
        mediaLines.push(`📷 ${publicMediaUrl(key)}`);
      } catch { /* skip this file */ }
    }
  }
  const body = [text, ...mediaLines].filter(Boolean).join("\n") || "[Customer sent a photo or file. Open Twilio to view it.]";
  const sid = String(params.MessageSid || "");
  if (sid) { const dup = await env.DB.prepare("SELECT 1 FROM conv_messages WHERE twilio_sid=?1 AND owner_id=?2").bind(sid, found.ownerId).first().catch(() => null); if (dup) return xml(""); }
  const thread = await upsertThread(found.ownerId, { channel, ourNumber, contact, contactName: String(params.ProfileName || ""), clientId: found.config.clientId });
  const seen = await env.DB.prepare("SELECT COUNT(*) AS n FROM conv_messages WHERE thread_id=?1").bind(thread.id).first<{ n: number }>();
  await addMessage(found.ownerId, thread.id, { direction: "in", sender: "customer", body, sid });
  // Rebilling: the message received is charged by Twilio (logged once per Twilio message id).
  await logUsageEvent(env.DB, { clientId: found.config.clientId || "", kind: channel, units: channel === "sms" ? Math.max(1, Number(params.NumSegments) || 1) : 1, provider: "Twilio", feature: `Messages received · ${channel === "whatsapp" ? "WhatsApp" : "SMS"}`, endpoint: "inbound", id: sid ? `in-${sid}` : undefined }).catch(() => undefined);
  if (!seen?.n) await leadToCrm(found.ownerId, { clientId: found.config.clientId, channel, contact, name: String(params.ProfileName || ""), firstMessage: body });
  const { settings } = await loadSettings(found.ownerId);
  if (!settings.botEnabled || !thread.bot_on || thread.status === "handoff" || thread.status === "closed") return xml("");
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM conv_messages WHERE thread_id=?1 AND sender='bot' AND created_at > ?2").bind(thread.id, new Date(Date.now() - 3600_000).toISOString()).first<{ n: number }>();
  if ((recent?.n || 0) >= 20) return xml("");
  const rows = ((await env.DB.prepare("SELECT sender, body FROM conv_messages WHERE thread_id=?1 ORDER BY created_at DESC LIMIT 14").bind(thread.id).all<{ sender: string; body: string }>()).results || []).reverse();
  const workspace = await env.DB.prepare("SELECT json_extract(value,'$.name') AS name FROM workspace_documents, json_each(data,'$.clients') WHERE id='f2b-agency' AND json_extract(value,'$.id')=?1").bind(found.config.clientId).first<{ name: string }>().catch(() => null);
  const reply = await botReply(found.ownerId, { settings, config: found.config, clientName: workspace?.name || found.config.label || "", channel, history: rows });
  if (!reply) { await env.DB.prepare("UPDATE conv_threads SET status='handoff' WHERE id=?1").bind(thread.id).run(); return xml(""); }
  // House rule: the AI never sends a booking / scheduling link itself; it waits in AI approvals.
  if (hasSchedulingLink(reply.text, await botLinksFor(found.ownerId, found.config.clientId))) { await holdBotReply(found.ownerId, thread.id, reply.text, "AI wanted to send a booking link"); return xml(""); }
  await addMessage(found.ownerId, thread.id, { direction: "out", sender: "bot", body: reply.text });
  if (reply.handoff) await env.DB.prepare("UPDATE conv_threads SET bot_on=0, status='handoff' WHERE id=?1").bind(thread.id).run();
  await logUsageEvent(env.DB, { clientId: found.config.clientId || "", kind: channel, units: channel === "sms" ? Math.max(1, Math.ceil(reply.text.length / 153)) : 1, provider: "Twilio", feature: `Conversation AI · ${channel}`, endpoint: "reply" }).catch(() => undefined);
  return xml(`<Message>${esc(reply.text)}</Message>`);
}
