// Public Twilio webhook (SMS + WhatsApp). Lives under /api/marketing-public so the existing public Access bypass already covers it.
// Every request is verified with Twilio's X-Twilio-Signature (HMAC-SHA1 with the saved Auth Token) before anything is stored.
import { env } from "cloudflare:workers";
import { addMessage, botReply, e164, findOwnerByNumber, loadSettings, twilioCredentials, upsertThread, verifyTwilio, type Channel } from "@/lib/conversations/core";

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
  const body = text || "[Customer sent a photo or file. Open Twilio to view it.]";
  const sid = String(params.MessageSid || "");
  if (sid) { const dup = await env.DB.prepare("SELECT 1 FROM conv_messages WHERE twilio_sid=?1 AND owner_id=?2").bind(sid, found.ownerId).first().catch(() => null); if (dup) return xml(""); }
  const thread = await upsertThread(found.ownerId, { channel, ourNumber, contact, contactName: String(params.ProfileName || ""), clientId: found.config.clientId });
  await addMessage(found.ownerId, thread.id, { direction: "in", sender: "customer", body, sid });
  const { settings } = await loadSettings(found.ownerId);
  if (!settings.botEnabled || !thread.bot_on || thread.status === "handoff" || thread.status === "closed") return xml("");
  const recent = await env.DB.prepare("SELECT COUNT(*) AS n FROM conv_messages WHERE thread_id=?1 AND sender='bot' AND created_at > ?2").bind(thread.id, new Date(Date.now() - 3600_000).toISOString()).first<{ n: number }>();
  if ((recent?.n || 0) >= 20) return xml("");
  const rows = ((await env.DB.prepare("SELECT sender, body FROM conv_messages WHERE thread_id=?1 ORDER BY created_at DESC LIMIT 14").bind(thread.id).all<{ sender: string; body: string }>()).results || []).reverse();
  const workspace = await env.DB.prepare("SELECT json_extract(value,'$.name') AS name FROM workspace_documents, json_each(data,'$.clients') WHERE id='f2b-agency' AND json_extract(value,'$.id')=?1").bind(found.config.clientId).first<{ name: string }>().catch(() => null);
  const reply = await botReply(found.ownerId, { settings, config: found.config, clientName: workspace?.name || found.config.label || "", channel, history: rows });
  if (!reply) { await env.DB.prepare("UPDATE conv_threads SET status='handoff' WHERE id=?1").bind(thread.id).run(); return xml(""); }
  await addMessage(found.ownerId, thread.id, { direction: "out", sender: "bot", body: reply.text });
  if (reply.handoff) await env.DB.prepare("UPDATE conv_threads SET bot_on=0, status='handoff' WHERE id=?1").bind(thread.id).run();
  return xml(`<Message>${esc(reply.text)}</Message>`);
}
