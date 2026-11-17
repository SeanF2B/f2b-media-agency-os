// AI phone agent: settings, client-card switches, phone numbers, manual/test calls, call log, recordings.
import { env } from "cloudflare:workers";
import { authorizeAdmin, authorizeAdminOrSubAccount, respond } from "@/lib/settings-auth";
import { listCalendars } from "@/lib/scheduling/server";
import { LANGUAGES, OUTBOUND_TRIGGERS, VOICES, e164 } from "@/lib/voice-agent/core";
import { assignExistingNumber, buyNumber, ensureVoiceTables, getAgent, getCall, getToggles, listOwnedNumbers, queueOutboundCall, saveAgent, searchNumbers, setToggle, publicBase } from "@/lib/voice-agent/server";

export const dynamic = "force-dynamic";
const str = (v: unknown, n = 200) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const clientKey = (v: unknown) => { const s = str(v, 100); return s === "agency" ? "" : s; };

export async function GET(request: Request) {
  const url = new URL(request.url), view = url.searchParams.get("view") || "settings";
  // Call details + recordings: anyone who can open this account's Conversations.
  if (view === "call" || view === "recording") {
    const auth = await authorizeAdminOrSubAccount("open call recordings", "Conversations");
    if (auth.error) return auth.error;
    const call = await getCall(auth.ownerId, str(url.searchParams.get("id"), 80));
    if (!call || (auth.scope && !auth.scope.includes(call.client_id))) return respond({ error: "That call could not be found." }, 404);
    if (view === "recording") {
      if (!call.recording_key || !env.BUCKET) return respond({ error: "No recording for this call." }, 404);
      const obj = await env.BUCKET.get(call.recording_key);
      if (!obj) return respond({ error: "The recording has expired." }, 404);
      return new Response(obj.body, { headers: { "Content-Type": "audio/mpeg", "Cache-Control": "private, max-age=3600", "Content-Disposition": `inline; filename="call-${call.id.slice(0, 8)}.mp3"` } });
    }
    let transcript = []; try { transcript = JSON.parse(call.transcript || "[]").filter((l: { who: string }) => l.who !== "system"); } catch { /* empty */ }
    return respond({ call: { id: call.id, direction: call.direction, channel: call.channel, status: call.status, outcome: call.outcome, summary: call.summary, durationSec: call.duration_sec, startedAt: call.started_at, contactName: call.contact_name, contactNumber: call.contact_number, bookingId: call.booking_id, hasRecording: Boolean(call.recording_key), error: call.error }, transcript });
  }
  if (view === "toggles") {
    const auth = await authorizeAdmin("change AI switches");
    if (auth.error) return auth.error;
    return respond({ toggles: await getToggles(auth.ownerId, clientKey(url.searchParams.get("clientId"))) });
  }
  const auth = await authorizeAdmin("manage the AI phone agent");
  if (auth.error) return auth.error;
  await ensureVoiceTables();
  const clientId = clientKey(url.searchParams.get("clientId"));
  if (view === "calls") {
    const rows = (await env.DB!.prepare("SELECT id, direction, channel, trigger, contact_name, contact_number, status, outcome, summary, duration_sec, created_at FROM voice_calls WHERE owner_id=?1 AND client_id=?2 ORDER BY created_at DESC LIMIT 50").bind(auth.ownerId, clientId).all()).results || [];
    return respond({ calls: rows });
  }
  if (view === "owned-numbers") {
    try { return respond({ numbers: await listOwnedNumbers(auth.ownerId) }); } catch (e) { return respond({ error: e instanceof Error ? e.message : "Could not load numbers." }, 400); }
  }
  const [agent, calendars] = await Promise.all([getAgent(auth.ownerId, clientId), listCalendars(env.DB as never, auth.ownerId, clientId).catch(() => [])]);
  return respond({ agent, calendars: calendars.map((c) => ({ id: c.id, name: c.name, kind: c.kind, durationMin: c.durationMin, active: c.active })), voices: VOICES, languages: LANGUAGES, triggers: OUTBOUND_TRIGGERS, toggles: await getToggles(auth.ownerId, clientId) });
}

export async function POST(request: Request) {
  let b: Record<string, any>; try { b = await request.json(); } catch { return respond({ error: "Send a valid request." }, 400); }
  const action = str(b.action, 40);
  const base = publicBase(new URL(request.url).origin);
  // Manual "AI call" from a contact or conversation: staff with Conversations access to that account.
  if (action === "call-contact") {
    const auth = await authorizeAdminOrSubAccount("start an AI call", "Conversations");
    if (auth.error) return auth.error;
    const clientId = clientKey(b.clientId);
    if (auth.scope && !auth.scope.includes(clientId)) return respond({ error: "You can't call for that account." }, 403);
    const to = e164(b.phone);
    let contactId = str(b.contactId, 80), name = str(b.name, 80);
    if (!contactId && to) { const c = await env.DB!.prepare("SELECT id, first_name, last_name FROM crm_contacts WHERE owner_id=?1 AND phone=?2 AND COALESCE(client_id,'')=?3 LIMIT 1").bind(auth.ownerId, to, clientId).first<{ id: string; first_name: string; last_name: string }>().catch(() => null); if (c) { contactId = c.id; name ||= `${c.first_name} ${c.last_name}`.trim(); } }
    const agent = await getAgent(auth.ownerId, clientId);
    const r = await queueOutboundCall({ ownerId: auth.ownerId, clientId, trigger: "manual", to, contactId, contactName: name, purpose: str(b.purpose, 600) || agent.outbound.manual.script, channel: b.channel === "whatsapp" ? "whatsapp" : b.channel === "phone" ? "phone" : undefined, delayMin: 0, base, force: false });
    return r.queued ? respond({ ok: true, id: r.id, message: "Calling now. The call will appear in Conversations as a voice note." }) : respond({ error: r.reason }, 400);
  }
  const auth = await authorizeAdmin("manage the AI phone agent");
  if (auth.error) return auth.error;
  const clientId = clientKey(b.clientId);
  try {
    if (action === "save") return respond({ agent: await saveAgent(auth.ownerId, clientId, b.agent), toggles: await getToggles(auth.ownerId, clientId) });
    if (action === "toggle") {
      const which = (["chat", "inbound", "outbound"] as const).find((w) => w === b.which);
      if (!which) return respond({ error: "Choose a switch." }, 400);
      await setToggle(auth.ownerId, clientId, which, b.on === true);
      const toggles = await getToggles(auth.ownerId, clientId);
      const warning = which !== "chat" && b.on === true && !toggles.number ? "Switched on. Give the agent a phone number in AI agent settings so it can take calls." : "";
      return respond({ toggles, warning });
    }
    if (action === "search-numbers") return respond({ numbers: await searchNumbers(auth.ownerId, { country: str(b.country, 2).toUpperCase() || "IE", contains: str(b.contains, 10), type: b.type === "Mobile" ? "Mobile" : "Local" }) });
    if (action === "buy-number") return respond({ number: await buyNumber(auth.ownerId, clientId, str(b.number, 20), base, { addressSid: str(b.addressSid, 40), bundleSid: str(b.bundleSid, 40), label: str(b.label, 60) }), agent: await getAgent(auth.ownerId, clientId) });
    if (action === "assign-number") return respond({ number: await assignExistingNumber(auth.ownerId, clientId, str(b.number, 20), base), agent: await getAgent(auth.ownerId, clientId) });
    if (action === "test-call") {
      const to = e164(b.phone);
      const r = await queueOutboundCall({ ownerId: auth.ownerId, clientId, trigger: "manual", to, contactName: str(b.name, 60) || "you", purpose: "This is a test call from the owner to try the AI agent. Behave exactly as you would with a real customer who rang in: greet them, help, and offer to book.", delayMin: 0, base, force: true, channel: b.channel === "whatsapp" ? "whatsapp" : "phone" });
      return r.queued ? respond({ ok: true, message: "Ringing you now…" }) : respond({ error: r.reason }, 400);
    }
    return respond({ error: "Unknown action." }, 400);
  } catch (e) { return respond({ error: e instanceof Error ? e.message : "Something went wrong." }, 400); }
}
