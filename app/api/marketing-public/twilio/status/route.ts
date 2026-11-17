// Public Twilio delivery-status webhook (StatusCallback on every message the OS sends).
// Updates the ticks in Conversations: sent ✓, delivered ✓✓, read (blue ✓✓) or failed. Verified with X-Twilio-Signature.
import { env } from "cloudflare:workers";
import { ensureTables, twilioCredentials, verifyTwilio } from "@/lib/conversations/core";
import { nextStatus } from "@/lib/conversations/whatsapp";

export const dynamic = "force-dynamic";
const ok = (status = 204) => new Response(null, { status, headers: { "Cache-Control": "no-store" } });

// Plain-English reasons for the failures customers actually hit.
const REASONS: Record<string, string> = {
  "63016": "The 24-hour window had closed. Send a template instead.",
  "63003": "This number isn't on WhatsApp.",
  "63024": "WhatsApp rejected the recipient number.",
  "63049": "Meta held back this marketing message for this customer.",
  "63032": "The customer has blocked or opted out of this business.",
  "30008": "Unknown delivery error from the carrier.",
  "21610": "The customer replied STOP, so texts to them are blocked.",
};

export async function POST(request: Request) {
  if (!env.DB) return ok(503);
  let form: FormData;
  try { form = await request.formData(); } catch { return ok(400); }
  const params: Record<string, string> = {};
  form.forEach((v, k) => { if (typeof v === "string") params[k] = v; });
  const sid = String(params.MessageSid || params.SmsSid || ""), accountSid = String(params.AccountSid || "");
  if (!/^(SM|MM)[0-9a-f]{32}$/i.test(sid) || !/^AC[0-9a-zA-Z]{30,40}$/.test(accountSid)) return ok(400);
  await ensureTables();
  const owner = await env.DB.prepare("SELECT owner_id FROM conv_settings WHERE account_sid=?1 LIMIT 1").bind(accountSid).first<{ owner_id: string }>();
  if (!owner) return ok(403);
  const creds = await twilioCredentials(owner.owner_id);
  if (!creds) return ok(403);
  const url = new URL(request.url), host = request.headers.get("host") || url.host;
  const candidates = [...new Set([request.url, `https://${host}${url.pathname}${url.search}`, `https://${url.host}${url.pathname}${url.search}`])];
  if (!(await verifyTwilio(creds.token, candidates, params, request.headers.get("x-twilio-signature") || ""))) return ok(403);
  const row = await env.DB.prepare("SELECT id, status FROM conv_messages WHERE twilio_sid=?1 AND owner_id=?2 LIMIT 1").bind(sid, owner.owner_id).first<{ id: string; status: string }>();
  if (!row) return ok();
  const incoming = String(params.MessageStatus || params.SmsStatus || "");
  const status = nextStatus(row.status || "", incoming);
  const code = String(params.ErrorCode || "");
  const failed = status === "failed" || status === "undelivered";
  const error = failed ? (REASONS[code] || (code ? `Not delivered (Twilio error ${code}).` : "Not delivered.")) : "";
  if (status !== row.status || failed) await env.DB.prepare("UPDATE conv_messages SET status=?2, error=CASE WHEN ?3 <> '' THEN ?3 ELSE error END WHERE id=?1").bind(row.id, status, error).run();
  return ok();
}

export async function GET() { return new Response("F2B Twilio status webhook is active.", { status: 200 }); }
