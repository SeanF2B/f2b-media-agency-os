import { logUsageEvent } from "../usage-meter";
// F2B Agency OS · AI phone agent: storage (D1), Twilio calls/numbers and posting calls into Conversations.
import { env } from "cloudflare:workers";
import { addMessage, getClientBot, loadSettings, saveClientBot, saveSettings, twilioCredentials, upsertThread, BLANK_BOT, type Channel } from "@/lib/conversations/core";
import { BLANK_AGENT, OUTCOME_LABEL, inCallWindow, sanitizeAgent, signCallToken, voiceNoteBody, e164, type OutboundTrigger, type TranscriptLine, type VoiceAgentSettings, type VoiceChannel } from "./core";

const db = () => env.DB!;
let tablesReady = false;
export async function ensureVoiceTables() {
  if (tablesReady) return;
  await db().batch([
    db().prepare("CREATE TABLE IF NOT EXISTS voice_agents (owner_id TEXT NOT NULL, client_id TEXT NOT NULL, number TEXT NOT NULL DEFAULT '', data TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL, PRIMARY KEY (owner_id, client_id))"),
    db().prepare("CREATE INDEX IF NOT EXISTS voice_agents_number ON voice_agents (number)"),
    db().prepare(`CREATE TABLE IF NOT EXISTS voice_calls (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, client_id TEXT NOT NULL DEFAULT '', call_sid TEXT NOT NULL DEFAULT '', direction TEXT NOT NULL, channel TEXT NOT NULL DEFAULT 'phone', trigger TEXT NOT NULL DEFAULT '', our_number TEXT NOT NULL DEFAULT '', contact_number TEXT NOT NULL DEFAULT '', contact_id TEXT NOT NULL DEFAULT '', contact_name TEXT NOT NULL DEFAULT '', purpose TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'queued', outcome TEXT NOT NULL DEFAULT '', summary TEXT NOT NULL DEFAULT '', transcript TEXT NOT NULL DEFAULT '[]', booking_id TEXT NOT NULL DEFAULT '', thread_id TEXT NOT NULL DEFAULT '', message_id TEXT NOT NULL DEFAULT '', recording_key TEXT NOT NULL DEFAULT '', recording_sid TEXT NOT NULL DEFAULT '', duration_sec INTEGER NOT NULL DEFAULT 0, started_at TEXT NOT NULL DEFAULT '', ended_at TEXT NOT NULL DEFAULT '', error TEXT NOT NULL DEFAULT '', dedupe_key TEXT, created_at TEXT NOT NULL)`),
    db().prepare("CREATE INDEX IF NOT EXISTS voice_calls_sid ON voice_calls (call_sid)"),
    db().prepare("CREATE INDEX IF NOT EXISTS voice_calls_owner ON voice_calls (owner_id, client_id, created_at)"),
    db().prepare("CREATE UNIQUE INDEX IF NOT EXISTS voice_calls_dedupe ON voice_calls (owner_id, dedupe_key)"),
    db().prepare("CREATE INDEX IF NOT EXISTS voice_calls_queue ON voice_calls (status, started_at)"),
  ]);
  tablesReady = true;
}

export type CallRow = { id: string; owner_id: string; client_id: string; call_sid: string; direction: "inbound" | "outbound"; channel: VoiceChannel; trigger: string; our_number: string; contact_number: string; contact_id: string; contact_name: string; purpose: string; status: string; outcome: string; summary: string; transcript: string; booking_id: string; thread_id: string; message_id: string; recording_key: string; recording_sid: string; duration_sec: number; started_at: string; ended_at: string; error: string; created_at: string };

/* ---------------- agent settings ---------------- */
export async function getAgent(ownerId: string, clientId: string): Promise<VoiceAgentSettings> {
  await ensureVoiceTables();
  const row = await db().prepare("SELECT data FROM voice_agents WHERE owner_id=?1 AND client_id=?2").bind(ownerId, clientId).first<{ data: string }>();
  if (!row) return { ...BLANK_AGENT };
  try { return sanitizeAgent(JSON.parse(row.data)); } catch { return { ...BLANK_AGENT }; }
}
export async function saveAgent(ownerId: string, clientId: string, input: unknown) {
  const current = await getAgent(ownerId, clientId);
  const next = sanitizeAgent(input, current);
  if (next.number) {
    const clash = await db().prepare("SELECT client_id FROM voice_agents WHERE number=?1 AND NOT (owner_id=?2 AND client_id=?3) LIMIT 1").bind(next.number, ownerId, clientId).first<{ client_id: string }>();
    if (clash) throw new Error("That number already answers for another account. Pick a different number.");
  }
  await db().prepare("INSERT INTO voice_agents (owner_id, client_id, number, data, updated_at) VALUES (?1,?2,?3,?4,?5) ON CONFLICT(owner_id, client_id) DO UPDATE SET number=excluded.number, data=excluded.data, updated_at=excluded.updated_at")
    .bind(ownerId, clientId, next.number, JSON.stringify(next), new Date().toISOString()).run();
  return next;
}
export async function findAgentByNumber(number: string) {
  await ensureVoiceTables();
  const row = await db().prepare("SELECT owner_id, client_id, data FROM voice_agents WHERE number=?1 LIMIT 1").bind(e164(number)).first<{ owner_id: string; client_id: string; data: string }>();
  if (!row) return null;
  try { return { ownerId: row.owner_id, clientId: row.client_id, agent: sanitizeAgent(JSON.parse(row.data)) }; } catch { return null; }
}
/** The three switches on the client card. AI chat = the client's chat bot on/off. */
export async function getToggles(ownerId: string, clientId: string) {
  const [agent, bot] = await Promise.all([getAgent(ownerId, clientId), getClientBot(ownerId, clientId)]);
  return { chat: bot ? bot.enabled : false, inbound: agent.inboundEnabled, outbound: agent.outboundEnabled, number: agent.number };
}
export async function setToggle(ownerId: string, clientId: string, which: "chat" | "inbound" | "outbound", on: boolean) {
  if (which === "chat") {
    const bot = (await getClientBot(ownerId, clientId)) || { ...BLANK_BOT };
    await saveClientBot(ownerId, clientId, { ...bot, enabled: on });
    return;
  }
  await saveAgent(ownerId, clientId, which === "inbound" ? { inboundEnabled: on } : { outboundEnabled: on });
}

/* ---------------- Twilio helpers ---------------- */
type Creds = { sid: string; token: string };
async function twilio(creds: Creds, path: string, init: { method?: string; form?: Record<string, string> } = {}) {
  const res = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${creds.sid}${path}`, {
    method: init.method || (init.form ? "POST" : "GET"),
    headers: { Authorization: "Basic " + btoa(`${creds.sid}:${creds.token}`), ...(init.form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}) },
    body: init.form ? new URLSearchParams(init.form) : undefined,
    signal: AbortSignal.timeout(15_000),
  });
  const json = await res.json().catch(() => ({})) as Record<string, any>;
  if (!res.ok) throw new Error(String(json.message || `Twilio returned HTTP ${res.status}.`));
  return json;
}
export async function requireCreds(ownerId: string) {
  const creds = await twilioCredentials(ownerId);
  if (!creds) throw new Error("Connect Twilio first (Leads → Conversations → Conversation settings).");
  return creds;
}
export const publicBase = (origin?: string) => (origin || env.TASK_APP_URL || "https://f2b-media-agency-os.f2b-media.workers.dev").replace(/\/$/, "");
export const voiceUrls = (base: string) => ({
  incoming: `${base}/api/marketing-public/voice/incoming`,
  answer: `${base}/api/marketing-public/voice/answer`,
  action: `${base}/api/marketing-public/voice/action`,
  status: `${base}/api/marketing-public/voice/status`,
  recording: `${base}/api/marketing-public/voice/recording`,
  relay: `${base.replace(/^http/, "ws")}/api/marketing-public/voice/relay`,
  sms: `${base}/api/marketing-public/twilio`,
});

export async function searchNumbers(ownerId: string, p: { country: string; contains?: string; type?: "Local" | "Mobile" }) {
  const creds = await requireCreds(ownerId);
  const country = /^[A-Z]{2}$/.test(p.country) ? p.country : "IE";
  const q = new URLSearchParams({ VoiceEnabled: "true", PageSize: "20" });
  if (p.contains && /^[\d*]{2,10}$/.test(p.contains)) q.set("Contains", p.contains);
  const j = await twilio(creds, `/AvailablePhoneNumbers/${country}/${p.type === "Mobile" ? "Mobile" : "Local"}.json?${q}`);
  return ((j.available_phone_numbers || []) as any[]).map((n) => ({ number: String(n.phone_number), friendly: String(n.friendly_name || n.phone_number), locality: String(n.locality || n.region || ""), sms: Boolean(n.capabilities?.SMS ?? n.capabilities?.sms), addressRequired: String(n.address_requirements || "none") }));
}

/** Buys a number on the agency's Twilio, points voice + SMS at the OS and links it to this client. */
export async function buyNumber(ownerId: string, clientId: string, number: string, base: string, extra: { addressSid?: string; bundleSid?: string; label?: string } = {}) {
  const creds = await requireCreds(ownerId);
  const urls = voiceUrls(base);
  const form: Record<string, string> = { PhoneNumber: e164(number), VoiceUrl: urls.incoming, VoiceMethod: "POST", StatusCallback: urls.status, StatusCallbackMethod: "POST", SmsUrl: urls.sms, SmsMethod: "POST", FriendlyName: (extra.label || "F2B AI agent").slice(0, 60) };
  if (extra.addressSid && /^AD[a-f0-9]{32}$/i.test(extra.addressSid)) form.AddressSid = extra.addressSid;
  if (extra.bundleSid && /^BU[a-f0-9]{32}$/i.test(extra.bundleSid)) form.BundleSid = extra.bundleSid;
  const j = await twilio(creds, "/IncomingPhoneNumbers.json", { form });
  await linkNumber(ownerId, clientId, String(j.phone_number || number), extra.label || "");
  return String(j.phone_number || number);
}
/** Points an already-owned Twilio number at the OS (voice + SMS) and links it to this client. */
export async function assignExistingNumber(ownerId: string, clientId: string, number: string, base: string) {
  const creds = await requireCreds(ownerId);
  const n = e164(number);
  const found = await twilio(creds, `/IncomingPhoneNumbers.json?PhoneNumber=${encodeURIComponent(n)}`);
  const sid = found.incoming_phone_numbers?.[0]?.sid;
  if (!sid) throw new Error("That number isn't in your Twilio account.");
  const urls = voiceUrls(base);
  await twilio(creds, `/IncomingPhoneNumbers/${sid}.json`, { form: { VoiceUrl: urls.incoming, VoiceMethod: "POST", StatusCallback: urls.status, StatusCallbackMethod: "POST" } });
  await linkNumber(ownerId, clientId, n, "");
  return n;
}
export async function listOwnedNumbers(ownerId: string) {
  const creds = await requireCreds(ownerId);
  const j = await twilio(creds, "/IncomingPhoneNumbers.json?PageSize=100");
  return ((j.incoming_phone_numbers || []) as any[]).map((n) => ({ number: String(n.phone_number), friendly: String(n.friendly_name || ""), voiceUrl: String(n.voice_url || "") }));
}
async function linkNumber(ownerId: string, clientId: string, number: string, label: string) {
  await saveAgent(ownerId, clientId, { number });
  // Also add it to Conversations so texts to this number land in the client's inbox.
  const { settings } = await loadSettings(ownerId);
  if (!settings.numbers.some((x) => x.number === e164(number) && x.channel === "sms")) await saveSettings(ownerId, { numbers: [...settings.numbers, { number: e164(number), channel: "sms", clientId, label: label.slice(0, 60), info: "" }] });
}

/* ---------------- calls ---------------- */
export async function createCallRow(p: { ownerId: string; clientId: string; direction: "inbound" | "outbound"; channel: VoiceChannel; trigger?: string; ourNumber: string; contactNumber: string; contactId?: string; contactName?: string; purpose?: string; callSid?: string; status?: string; startAt?: string; dedupeKey?: string }) {
  await ensureVoiceTables();
  const id = crypto.randomUUID(), now = new Date().toISOString();
  const res = await db().prepare("INSERT OR IGNORE INTO voice_calls (id, owner_id, client_id, call_sid, direction, channel, trigger, our_number, contact_number, contact_id, contact_name, purpose, status, started_at, dedupe_key, created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16)")
    .bind(id, p.ownerId, p.clientId, p.callSid || "", p.direction, p.channel, p.trigger || "", p.ourNumber, p.contactNumber, p.contactId || "", (p.contactName || "").slice(0, 80), (p.purpose || "").slice(0, 500), p.status || "queued", p.startAt || now, p.dedupeKey || null, now).run();
  if (!res.meta?.changes) return null; // already queued (dedupe)
  return id;
}
export async function getCall(ownerId: string, id: string) {
  await ensureVoiceTables();
  return db().prepare("SELECT * FROM voice_calls WHERE id=?1 AND owner_id=?2").bind(id, ownerId).first<CallRow>();
}
export async function getCallBySid(sid: string) {
  await ensureVoiceTables();
  return db().prepare("SELECT * FROM voice_calls WHERE call_sid=?1 LIMIT 1").bind(sid).first<CallRow>();
}
export async function updateCall(id: string, patch: Partial<Record<keyof CallRow, string | number>>) {
  const keys = Object.keys(patch).filter((k) => /^[a-z_]+$/.test(k));
  if (!keys.length) return;
  await db().prepare(`UPDATE voice_calls SET ${keys.map((k, i) => `${k}=?${i + 2}`).join(", ")} WHERE id=?1`).bind(id, ...keys.map((k) => (patch as any)[k])).run();
  // Rebilling: call minutes (rounded up), one usage row per call, updated if the length changes.
  const secs = Number(patch.duration_sec || 0);
  if (secs > 0) {
    const row = await db().prepare("SELECT client_id, direction FROM voice_calls WHERE id=?1").bind(id).first<{ client_id: string; direction: string }>().catch(() => null);
    if (row) await logUsageEvent(db(), { id: `voice-${id}`, clientId: row.client_id, kind: "voice", units: Math.ceil(secs / 60), provider: "Twilio", feature: `Phone calls · ${row.direction}`, endpoint: "call" }).catch(() => undefined);
  }
}

/** Looks up (or creates) the CRM contact for a phone number in this account. */
export async function contactForNumber(ownerId: string, clientId: string, phone: string, name = "", source = "Phone call") {
  const now = new Date().toISOString();
  const found = await db().prepare("SELECT id, first_name, last_name FROM crm_contacts WHERE owner_id=?1 AND phone=?2 AND COALESCE(client_id,'')=?3 LIMIT 1").bind(ownerId, phone, clientId).first<{ id: string; first_name: string; last_name: string }>().catch(() => null);
  if (found) return { id: found.id, name: `${found.first_name} ${found.last_name}`.trim(), known: true };
  if (!phone) return { id: "", name, known: false };
  const id = crypto.randomUUID(), parts = (name || "").split(/\s+/).filter(Boolean);
  await db().prepare("INSERT INTO crm_contacts (id, owner_id, client_id, first_name, last_name, email, phone, company, source, notes, created_at, updated_at) VALUES (?1,?2,?3,?4,?5,'',?6,'',?7,'',?8,?8)").bind(id, ownerId, clientId || null, parts[0] || phone, parts.slice(1).join(" "), phone, source, now).run().catch(() => undefined);
  return { id, name, known: false };
}
export async function isDoNotCall(ownerId: string, contactId: string) {
  if (!contactId) return false;
  const row = await db().prepare("SELECT 1 FROM crm_flags WHERE owner_id=?1 AND kind='contact' AND ref_id=?2 AND flag IN ('dnd','spam') LIMIT 1").bind(ownerId, contactId).first().catch(() => null);
  return Boolean(row);
}
export async function markDoNotCall(ownerId: string, contactId: string) {
  if (!contactId) return;
  await db().prepare("CREATE TABLE IF NOT EXISTS crm_flags (owner_id TEXT NOT NULL, kind TEXT NOT NULL, ref_id TEXT NOT NULL, flag TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (owner_id, kind, ref_id, flag))").run();
  await db().prepare("INSERT OR IGNORE INTO crm_flags (owner_id, kind, ref_id, flag, created_at) VALUES (?1,'contact',?2,'dnd',?3)").bind(ownerId, contactId, new Date().toISOString()).run();
}

/**
 * Queues an outbound AI call. It is placed straight away when the delay is 0 and we're inside the
 * call window, otherwise the 5-minute cron places it (processVoiceQueue).
 */
export async function queueOutboundCall(p: { ownerId: string; clientId: string; trigger: OutboundTrigger; to: string; contactId?: string; contactName?: string; purpose?: string; channel?: VoiceChannel; delayMin?: number; dedupeKey?: string; base?: string; force?: boolean }) {
  const agent = await getAgent(p.ownerId, p.clientId);
  const rule = agent.outbound[p.trigger];
  if (!p.force) {
    if (!agent.outboundEnabled) return { queued: false, reason: "Outbound AI calls are switched off for this account." };
    if (!rule.enabled) return { queued: false, reason: "That kind of AI call is switched off in the agent settings." };
  }
  if (!agent.number) return { queued: false, reason: "Give this account's AI agent a phone number first." };
  const to = e164(p.to);
  if (!/^\+\d{7,15}$/.test(to)) return { queued: false, reason: "That contact has no valid phone number." };
  if (await isDoNotCall(p.ownerId, p.contactId || "")) return { queued: false, reason: "That contact is marked Do not disturb." };
  const delay = p.delayMin ?? rule.delayMin;
  const startAt = new Date(Date.now() + delay * 60_000).toISOString();
  const id = await createCallRow({ ownerId: p.ownerId, clientId: p.clientId, direction: "outbound", channel: p.channel || rule.channel, trigger: p.trigger, ourNumber: agent.number, contactNumber: to, contactId: p.contactId, contactName: p.contactName, purpose: p.purpose || rule.script, status: "queued", startAt, dedupeKey: p.dedupeKey });
  if (!id) return { queued: false, reason: "That call is already queued." };
  if (delay <= 0 && (p.force || inCallWindow(agent))) await placeCall(id, p.base).catch((e) => console.error("placeCall", e));
  return { queued: true, id };
}

export async function placeCall(callId: string, base?: string) {
  const call = await db().prepare("SELECT * FROM voice_calls WHERE id=?1").bind(callId).first<CallRow>();
  if (!call || call.status !== "queued") return;
  await updateCall(callId, { status: "dialing" });
  try {
    const creds = await requireCreds(call.owner_id);
    const urls = voiceUrls(publicBase(base));
    const token = await signCallToken(creds.token, call.owner_id, call.id);
    const prefix = call.channel === "whatsapp" ? "whatsapp:" : "";
    const form: Record<string, string> = { To: prefix + call.contact_number, From: prefix + call.our_number, Url: `${urls.answer}?t=${encodeURIComponent(token)}`, Method: "POST", StatusCallback: `${urls.status}?t=${encodeURIComponent(token)}`, StatusCallbackMethod: "POST", Timeout: "30" };
    let j: Record<string, any>;
    try { j = await twilio(creds, "/Calls.json", { form }); }
    catch (e) {
      // WhatsApp calling needs the WhatsApp sender enabled for voice in Twilio; fall back to a normal call.
      if (call.channel !== "whatsapp") throw e;
      await updateCall(callId, { error: `WhatsApp call not possible (${e instanceof Error ? e.message : "refused"}), rang by phone instead.`.slice(0, 300), channel: "phone" });
      j = await twilio(creds, "/Calls.json", { form: { ...form, To: call.contact_number, From: call.our_number } });
    }
    await updateCall(callId, { call_sid: String(j.sid || ""), status: "ringing" });
  } catch (e) {
    await updateCall(callId, { status: "failed", outcome: "failed", error: (e instanceof Error ? e.message : "Could not place the call").slice(0, 300), ended_at: new Date().toISOString() });
    await postCallToConversation(callId).catch(() => undefined);
  }
}

/** Cron: place queued outbound calls whose time has come (inside each account's call window). */
export async function processVoiceQueue(now = new Date()) {
  if (!env.DB) return;
  await ensureVoiceTables();
  const due = (await db().prepare("SELECT id, owner_id, client_id FROM voice_calls WHERE status='queued' AND started_at<=?1 ORDER BY started_at LIMIT 10").bind(now.toISOString()).all<{ id: string; owner_id: string; client_id: string }>()).results || [];
  for (const row of due) {
    const agent = await getAgent(row.owner_id, row.client_id);
    if (!agent.outboundEnabled) { await updateCall(row.id, { status: "cancelled", outcome: "other", error: "Outbound calls were switched off." }); continue; }
    if (!inCallWindow(agent, now.getTime())) continue;
    await placeCall(row.id);
  }
  // Calls stuck "live" for over an hour (socket dropped without a status callback) are closed off.
  await db().prepare("UPDATE voice_calls SET status='completed' WHERE status IN ('ringing','dialing','live') AND created_at < ?1").bind(new Date(now.getTime() - 3_600_000).toISOString()).run();
  await queueReminderCalls(now).catch((e) => console.error("reminder calls", e));
  await scanNewLeads(now).catch((e) => console.error("speed to lead", e));
}

/** Finds website-form leads created since the last tick for accounts with "New lead call-back" on. */
async function scanNewLeads(now: Date) {
  await db().prepare("CREATE TABLE IF NOT EXISTS voice_cursors (owner_id TEXT NOT NULL, client_id TEXT NOT NULL, value TEXT NOT NULL, PRIMARY KEY (owner_id, client_id))").run();
  const agents = (await db().prepare("SELECT owner_id, client_id, data FROM voice_agents WHERE number<>'' AND data LIKE '%\"outboundEnabled\":true%'").all<{ owner_id: string; client_id: string; data: string }>()).results || [];
  for (const a of agents) {
    let agent: VoiceAgentSettings; try { agent = sanitizeAgent(JSON.parse(a.data)); } catch { continue; }
    const stamp = now.toISOString();
    const cursor = (await db().prepare("SELECT value FROM voice_cursors WHERE owner_id=?1 AND client_id=?2").bind(a.owner_id, a.client_id).first<{ value: string }>())?.value;
    if (!agent.outbound.speed_to_lead.enabled || !cursor) { await db().prepare("INSERT INTO voice_cursors (owner_id, client_id, value) VALUES (?1,?2,?3) ON CONFLICT(owner_id, client_id) DO UPDATE SET value=excluded.value").bind(a.owner_id, a.client_id, stamp).run(); continue; }
    const rows = (await db().prepare("SELECT id, created_at FROM crm_contacts WHERE owner_id=?1 AND updated_at>=?2 AND created_at>=?2 AND COALESCE(client_id,'')=?3 AND source LIKE 'Website form%' AND phone<>'' ORDER BY created_at LIMIT 20").bind(a.owner_id, cursor, a.client_id).all<{ id: string; created_at: string }>()).results || [];
    for (const r of rows) await speedToLead(a.owner_id, a.client_id, r.id);
    const next = rows.length === 20 ? rows[rows.length - 1].created_at : stamp;
    await db().prepare("UPDATE voice_cursors SET value=?3 WHERE owner_id=?1 AND client_id=?2").bind(a.owner_id, a.client_id, next).run();
  }
}

/** Day-before confirmation calls for appointments, for accounts that switched them on. */
async function queueReminderCalls(now: Date) {
  const agents = (await db().prepare("SELECT owner_id, client_id, data FROM voice_agents WHERE number<>'' AND data LIKE '%\"outboundEnabled\":true%'").all<{ owner_id: string; client_id: string; data: string }>()).results || [];
  for (const a of agents) {
    let agent: VoiceAgentSettings; try { agent = sanitizeAgent(JSON.parse(a.data)); } catch { continue; }
    if (!agent.outbound.reminder.enabled || !inCallWindow(agent, now.getTime())) continue;
    const from = new Date(now.getTime() + 18 * 3_600_000).toISOString(), to = new Date(now.getTime() + 30 * 3_600_000).toISOString();
    const rows = (await db().prepare("SELECT id, name, phone, contact_id, start_at FROM sched_bookings WHERE owner_id=?1 AND client_id=?2 AND status='booked' AND start_at>=?3 AND start_at<?4 AND phone<>'' LIMIT 20").bind(a.owner_id, a.client_id, from, to).all<{ id: string; name: string; phone: string; contact_id: string; start_at: string }>().catch(() => ({ results: [] }))).results || [];
    for (const b of rows) {
      const when = new Intl.DateTimeFormat("en-IE", { timeZone: agent.timezone, weekday: "long", hour: "numeric", minute: "2-digit" }).format(new Date(b.start_at));
      await queueOutboundCall({ ownerId: a.owner_id, clientId: a.client_id, trigger: "reminder", to: b.phone, contactId: b.contact_id, contactName: b.name, purpose: `Confirm their appointment on ${when} (booking ${b.id}). If they can't make it, offer to move it using check_availability and book_appointment, and tell them the old time will be cancelled by the team. ${agent.outbound.reminder.script}`.trim(), delayMin: 0, dedupeKey: `reminder:${b.id}` });
    }
  }
}

/** Speed-to-lead: ring new website-form leads (called from the automations tick with new form leads). */
export async function speedToLead(ownerId: string, clientId: string, contactId: string, base?: string) {
  const agent = await getAgent(ownerId, clientId);
  if (!agent.outboundEnabled || !agent.outbound.speed_to_lead.enabled || !agent.number) return;
  const c = await db().prepare("SELECT first_name, last_name, phone, source, notes FROM crm_contacts WHERE id=?1 AND owner_id=?2").bind(contactId, ownerId).first<{ first_name: string; last_name: string; phone: string; source: string; notes: string }>();
  if (!c?.phone) return;
  await queueOutboundCall({ ownerId, clientId, trigger: "speed_to_lead", to: c.phone, contactId, contactName: `${c.first_name} ${c.last_name}`.trim(), purpose: `They just filled in a form on the website (${c.source}). ${c.notes ? `What they wrote: ${c.notes.slice(0, 300)}. ` : ""}Thank them, find out what they need and book them in. ${agent.outbound.speed_to_lead.script}`.trim(), dedupeKey: `lead:${contactId}`, base });
}

/* ---------------- after the call: voice note in Conversations ---------------- */
export async function postCallToConversation(callId: string) {
  const call = await db().prepare("SELECT * FROM voice_calls WHERE id=?1").bind(callId).first<CallRow>();
  if (!call || call.message_id) return;
  const channel: Channel = call.channel === "whatsapp" ? "whatsapp" : "sms";
  // Use the customer's existing WhatsApp chat when there is one, so the call sits with their messages.
  const existingWa = channel === "sms" ? await db().prepare("SELECT id FROM conv_threads WHERE owner_id=?1 AND contact=?2 AND channel='whatsapp' AND client_id=?3 LIMIT 1").bind(call.owner_id, call.contact_number, call.client_id).first<{ id: string }>().catch(() => null) : null;
  const thread = existingWa ? { id: existingWa.id } : await upsertThread(call.owner_id, { channel, ourNumber: call.our_number, contact: call.contact_number, contactName: call.contact_name, clientId: call.client_id });
  if (!thread?.id) return;
  const body = voiceNoteBody({ callId: call.id, direction: call.direction, durationSec: call.duration_sec, outcome: OUTCOME_LABEL[call.outcome] ?? call.outcome, summary: call.summary || (call.error ? call.error : "") });
  const m = await addMessage(call.owner_id, thread.id, { direction: call.direction === "inbound" ? "in" : "out", sender: call.direction === "inbound" ? "customer" : "bot", body });
  await updateCall(call.id, { thread_id: thread.id, message_id: m.id });
}

export async function saveTranscript(callId: string, lines: TranscriptLine[]) {
  await updateCall(callId, { transcript: JSON.stringify(lines.slice(-400)) });
}

/** Adds a note to the contact's open deal (or creates a lead) so calls show up in the pipeline. */
export async function noteOnPipeline(ownerId: string, clientId: string, contactId: string, title: string, note: string) {
  if (!contactId) return;
  const now = new Date().toISOString();
  const opp = await db().prepare("SELECT o.id, o.notes FROM crm_opportunities o JOIN crm_pipeline_stages s ON s.id=o.stage_id AND s.owner_id=o.owner_id WHERE o.owner_id=?1 AND o.contact_id=?2 AND s.category='open' ORDER BY o.updated_at DESC LIMIT 1").bind(ownerId, contactId).first<{ id: string; notes: string }>().catch(() => null);
  if (opp) { await db().prepare("UPDATE crm_opportunities SET notes=?2, updated_at=?3 WHERE id=?1").bind(opp.id, `${opp.notes ? opp.notes + "\n\n" : ""}${note}`.slice(-4000), now).run(); return; }
  const pipeline = (clientId ? await db().prepare("SELECT id FROM crm_pipelines WHERE owner_id=?1 AND archived=0 AND client_id=?2 ORDER BY created_at LIMIT 1").bind(ownerId, clientId).first<{ id: string }>().catch(() => null) : null)
    || await db().prepare("SELECT id FROM crm_pipelines WHERE owner_id=?1 AND archived=0 ORDER BY created_at LIMIT 1").bind(ownerId).first<{ id: string }>().catch(() => null);
  if (!pipeline) return;
  const stage = await db().prepare("SELECT id FROM crm_pipeline_stages WHERE owner_id=?1 AND pipeline_id=?2 AND category='open' ORDER BY position LIMIT 1").bind(ownerId, pipeline.id).first<{ id: string }>().catch(() => null);
  if (!stage) return;
  await db().prepare("INSERT INTO crm_opportunities (id, owner_id, pipeline_id, stage_id, contact_id, client_id, title, value, currency, source, notes, created_at, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,0,'EUR','Phone call',?8,?9,?9)").bind(crypto.randomUUID(), ownerId, pipeline.id, stage.id, contactId, clientId || null, title.slice(0, 120), note.slice(0, 4000), now).run().catch(() => undefined);
}
