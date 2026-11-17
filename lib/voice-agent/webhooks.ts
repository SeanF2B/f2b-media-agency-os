// F2B Agency OS · AI phone agent: Twilio voice webhooks (public; every request is signature-checked).
import { env } from "cloudflare:workers";
import { twilioCredentials, verifyTwilio } from "@/lib/conversations/core";
import { loadSchedulingWorkspace } from "@/lib/scheduling/context";
import { defaultGreeting, e164, inCallWindow, peekCallToken, relayTwiml, signCallToken, twiml, verifyCallToken, xmlEsc, type VoiceAgentSettings } from "./core";
import { contactForNumber, createCallRow, findAgentByNumber, getAgent, getCall, getCallBySid, postCallToConversation, publicBase, updateCall, voiceUrls } from "./server";

const xml = (body: string, status = 200) => new Response(twiml(body), { status, headers: { "Content-Type": "text/xml; charset=utf-8", "Cache-Control": "no-store" } });
const say = (text: string) => `<Say voice="Polly.Amy-Neural" language="en-GB">${xmlEsc(text)}</Say>`;

async function formParams(request: Request) {
  const params: Record<string, string> = {};
  try { (await request.formData()).forEach((v, k) => { if (typeof v === "string") params[k] = v; }); } catch { /* empty */ }
  return params;
}
async function signed(request: Request, ownerId: string, params: Record<string, string>) {
  const creds = await twilioCredentials(ownerId).catch(() => null);
  if (!creds) return null;
  const url = new URL(request.url), host = request.headers.get("host") || url.host;
  const candidates = [...new Set([request.url, `https://${host}${url.pathname}${url.search}`, `https://${url.host}${url.pathname}${url.search}`])];
  return (await verifyTwilio(creds.token, candidates, params, request.headers.get("x-twilio-signature") || "")) ? creds : null;
}
async function businessName(clientId: string) {
  const ws = await loadSchedulingWorkspace().catch(() => null);
  return ws?.clients.find((c) => c.id === clientId)?.name || ws?.agencyName || "";
}
const withinHours = (agent: VoiceAgentSettings) => inCallWindow({ callWindow: agent.callWindow, timezone: agent.timezone });

/** A customer rings the client's AI number. */
export async function incoming(request: Request) {
  if (!env.DB) return xml("", 503);
  const params = await formParams(request);
  const to = e164(params.To), from = e164(params.From);
  const found = await findAgentByNumber(to);
  if (!found) return xml(say("Sorry, this number isn't set up yet.") + "<Hangup/>");
  const creds = await signed(request, found.ownerId, params);
  if (!creds) return xml("", 403);
  const { agent, ownerId, clientId } = found;
  const base = publicBase(new URL(request.url).origin);
  // AI answering off → straight to the business's own phone (or a polite message).
  const afterHours = !withinHours(agent);
  if (!agent.inboundEnabled || (afterHours && agent.afterHours === "transfer")) {
    return xml(agent.transferNumber ? `<Dial callerId="${xmlEsc(to)}" timeout="25">${xmlEsc(agent.transferNumber)}</Dial>` : say("Thanks for calling. Nobody can take your call right now, please send us a text and we'll get back to you.") + "<Hangup/>");
  }
  const contact = await contactForNumber(ownerId, clientId, from, params.CallerName || "", "Phone call").catch(() => ({ id: "", name: "", known: false }));
  const callId = await createCallRow({ ownerId, clientId, direction: "inbound", channel: /^whatsapp:/i.test(params.From || "") ? "whatsapp" : "phone", trigger: "inbound", ourNumber: to, contactNumber: from, contactId: contact.id, contactName: contact.name, callSid: params.CallSid || "", status: "ringing", purpose: afterHours && agent.afterHours === "message" ? "It's outside opening hours: take a message and promise a call back." : "" });
  if (!callId) return xml(say("Sorry, something went wrong.") + "<Hangup/>");
  const token = await signCallToken(creds.token, ownerId, callId);
  const greeting = defaultGreeting(agent, await businessName(clientId), "inbound");
  const urls = voiceUrls(base);
  return xml(relayTwiml({ wsUrl: `${urls.relay}?t=${encodeURIComponent(token)}`, actionUrl: `${urls.action}?t=${encodeURIComponent(token)}`, greeting, agent, params: { greeting } }));
}

/** An outbound call we placed was answered. */
export async function answer(request: Request) {
  const params = await formParams(request);
  const t = new URL(request.url).searchParams.get("t") || "";
  const call = await callFromToken(t);
  if (!call) return xml("<Hangup/>", 403);
  if (!(await signed(request, call.owner_id, params))) return xml("", 403);
  // Answering machines: Twilio flags them when AnsweredBy is set; just hang up and log it.
  if (/machine|fax/i.test(params.AnsweredBy || "")) { await updateCall(call.id, { outcome: "voicemail" }); return xml("<Hangup/>"); }
  const agent = await getAgent(call.owner_id, call.client_id);
  const urls = voiceUrls(publicBase(new URL(request.url).origin));
  const greeting = defaultGreeting(agent, await businessName(call.client_id), "outbound", call.contact_name);
  return xml(relayTwiml({ wsUrl: `${urls.relay}?t=${encodeURIComponent(t)}`, actionUrl: `${urls.action}?t=${encodeURIComponent(t)}`, greeting, agent, params: { greeting } }));
}

/** ConversationRelay finished: transfer to a person, or hang up. */
export async function action(request: Request) {
  const params = await formParams(request);
  const call = await callFromToken(new URL(request.url).searchParams.get("t") || "");
  if (!call) return xml("<Hangup/>");
  if (!(await signed(request, call.owner_id, params))) return xml("", 403);
  let handoff: { outcome?: string; transfer?: string } = {};
  try { handoff = JSON.parse(params.HandoffData || "{}"); } catch { /* empty */ }
  if (handoff.transfer && /^\+\d{7,15}$/.test(handoff.transfer)) {
    await updateCall(call.id, { outcome: "transferred" });
    return xml(`<Dial callerId="${xmlEsc(call.our_number)}" timeout="25">${xmlEsc(handoff.transfer)}</Dial>${say("Sorry, nobody could pick up. We'll call you back shortly.")}`);
  }
  return xml("<Hangup/>");
}

/** Call status: when the call completes, post it to Conversations as a voice note. */
export async function status(request: Request) {
  const params = await formParams(request);
  const t = new URL(request.url).searchParams.get("t") || "";
  const call = t ? await callFromToken(t) : params.CallSid ? await getCallBySid(params.CallSid) : null;
  if (!call) return new Response("", { status: 204 });
  if (!(await signed(request, call.owner_id, params))) return new Response("", { status: 403 });
  const st = String(params.CallStatus || "");
  if (["completed", "busy", "no-answer", "failed", "canceled"].includes(st)) {
    const outcome = st === "busy" ? "busy" : st === "no-answer" ? "no_answer" : st === "failed" || st === "canceled" ? "failed" : "";
    const patch: Record<string, string | number> = { status: "completed", duration_sec: Math.max(Number(params.CallDuration || 0), call.duration_sec || 0) };
    if (outcome && !call.outcome) patch.outcome = outcome;
    if (!call.ended_at) patch.ended_at = new Date().toISOString();
    await updateCall(call.id, patch);
    // With recording on, the voice note is posted when the recording is saved (so it has audio); otherwise now.
    const agent = await getAgent(call.owner_id, call.client_id);
    if (!agent.recordCalls || st !== "completed" || !Number(params.CallDuration || 0)) await postCallToConversation(call.id);
  }
  return new Response("", { status: 204 });
}

/** Recording finished: copy it into storage (private), then post the voice note. */
export async function recording(request: Request) {
  const params = await formParams(request);
  const callId = new URL(request.url).searchParams.get("c") || "";
  const call = params.CallSid ? await getCallBySid(params.CallSid) : null;
  if (!call || (callId && call.id !== callId)) return new Response("", { status: 204 });
  const creds = await signed(request, call.owner_id, params);
  if (!creds) return new Response("", { status: 403 });
  if (params.RecordingStatus === "completed" && params.RecordingUrl && /^https:\/\/api\.twilio\.com\//.test(params.RecordingUrl) && env.BUCKET) {
    try {
      const res = await fetch(`${params.RecordingUrl}.mp3`, { headers: { Authorization: "Basic " + btoa(`${creds.sid}:${creds.token}`) } });
      if (res.ok) {
        const key = `voice-calls/${call.owner_id.replace(/[^A-Za-z0-9_-]/g, "_")}/${call.id}.mp3`;
        await env.BUCKET.put(key, await res.arrayBuffer(), { httpMetadata: { contentType: "audio/mpeg" } });
        await updateCall(call.id, { recording_key: key, recording_sid: String(params.RecordingSid || ""), duration_sec: Math.max(Number(params.RecordingDuration || 0), call.duration_sec || 0) });
      }
    } catch (e) { console.error("voice recording copy", e); }
  }
  await postCallToConversation(call.id);
  return new Response("", { status: 204 });
}

async function callFromToken(t: string) {
  if (!t) return null;
  const ownerId = peekCallToken(t)?.o;
  if (!ownerId) return null;
  const creds = await twilioCredentials(ownerId).catch(() => null);
  const tok = creds ? await verifyCallToken(creds.token, t) : null;
  return tok ? getCall(tok.o, tok.c) : null;
}
