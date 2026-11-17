// F2B Agency OS · AI phone agent (pure logic, no Cloudflare imports so it can be unit tested).
// Engine: Twilio ConversationRelay (Twilio does speech-to-text and text-to-speech, the OS runs the brain
// and books straight into Scheduling). Settings are stored per client in D1 (voice_agents).

export type VoiceChannel = "phone" | "whatsapp";
export type OutboundTrigger = "speed_to_lead" | "automation" | "manual" | "reminder";
export type OutboundRule = { enabled: boolean; channel: VoiceChannel; delayMin: number; script: string };

export type VoiceAgentSettings = {
  /** Master switches shown on the client card. AI chat lives on the client's chat bot (conv_client_bots). */
  inboundEnabled: boolean;
  outboundEnabled: boolean;
  agentName: string;
  voiceId: string;          // one of VOICES ids, or "custom"
  customVoice: string;      // ElevenLabs voice id (e.g. a cloned voice) when voiceId = "custom"
  language: string;         // BCP-47, e.g. en-IE
  speed: number;            // 0.8 – 1.2 (ElevenLabs only)
  greeting: string;
  instructions: string;     // extra training: how to talk, what to ask, what never to say
  knowledge: string;        // extra facts on top of the chat bot's training
  calendarIds: string[];    // Scheduling calendars the agent may book into
  transferNumber: string;   // human to put callers through to
  afterHours: "answer" | "transfer" | "message";
  recordCalls: boolean;
  announceRecording: boolean;
  maxCallMin: number;
  number: string;           // the Twilio number this agent answers (E.164)
  outbound: Record<OutboundTrigger, OutboundRule>;
  callWindow: { start: string; end: string; days: number[] }; // when outbound calls may be placed (local time)
  timezone: string;
};

export type Voice = { id: string; label: string; provider: "ElevenLabs" | "Google" | "Amazon"; voice: string; accent: string; gender: "Female" | "Male" };
// ElevenLabs voices are the most natural; Google/Amazon are cheaper fall-backs. Voice ids are the providers' public ids.
export const VOICES: Voice[] = [
  { id: "el-alice", label: "Alice", provider: "ElevenLabs", voice: "Xb7hH8MSUJpSbSDYk0k2", accent: "British", gender: "Female" },
  { id: "el-lily", label: "Lily", provider: "ElevenLabs", voice: "pFZP5JQG7iQjIQuC4Bku", accent: "British", gender: "Female" },
  { id: "el-charlotte", label: "Charlotte", provider: "ElevenLabs", voice: "XB0fDUnXU5powFXDhCwa", accent: "British", gender: "Female" },
  { id: "el-george", label: "George", provider: "ElevenLabs", voice: "JBFqnCBsd6RMkjVDRZzb", accent: "British", gender: "Male" },
  { id: "el-daniel", label: "Daniel", provider: "ElevenLabs", voice: "onwK4e9ZLuTAKqWW03F9", accent: "British", gender: "Male" },
  { id: "el-rachel", label: "Rachel", provider: "ElevenLabs", voice: "21m00Tcm4TlvDq8ikWAM", accent: "American", gender: "Female" },
  { id: "el-adam", label: "Adam", provider: "ElevenLabs", voice: "pNInz6obpgDQGcFmaJgB", accent: "American", gender: "Male" },
  { id: "aws-niamh", label: "Niamh", provider: "Amazon", voice: "Niamh-Neural", accent: "Irish", gender: "Female" },
  { id: "aws-amy", label: "Amy", provider: "Amazon", voice: "Amy-Neural", accent: "British", gender: "Female" },
  { id: "aws-brian", label: "Brian", provider: "Amazon", voice: "Brian-Neural", accent: "British", gender: "Male" },
  { id: "g-gb-a", label: "Sophie", provider: "Google", voice: "en-GB-Neural2-A", accent: "British", gender: "Female" },
  { id: "g-gb-b", label: "Oliver", provider: "Google", voice: "en-GB-Neural2-B", accent: "British", gender: "Male" },
];
export const LANGUAGES = [["en-IE", "English (Ireland)"], ["en-GB", "English (UK)"], ["en-US", "English (US)"], ["ga-IE", "Irish"], ["es-ES", "Spanish"], ["pl-PL", "Polish"], ["pt-BR", "Portuguese (Brazil)"], ["fr-FR", "French"]] as const;

const BLANK_RULE: OutboundRule = { enabled: false, channel: "phone", delayMin: 0, script: "" };
export const OUTBOUND_TRIGGERS: Array<{ id: OutboundTrigger; label: string; help: string }> = [
  { id: "speed_to_lead", label: "New lead call-back", help: "Rings new website-form leads within minutes to book them in." },
  { id: "automation", label: "Automation step", help: "Allows the \"Make an AI call\" step in Automations (no-shows, quote chasers…)." },
  { id: "manual", label: "AI call button", help: "Shows an AI call button on contacts and conversations." },
  { id: "reminder", label: "Appointment confirm calls", help: "Rings the day before to confirm or move the appointment." },
];

export const BLANK_AGENT: VoiceAgentSettings = {
  inboundEnabled: false, outboundEnabled: false, agentName: "", voiceId: "el-alice", customVoice: "", language: "en-IE", speed: 1,
  greeting: "", instructions: "", knowledge: "", calendarIds: [], transferNumber: "", afterHours: "answer", recordCalls: true, announceRecording: true,
  maxCallMin: 10, number: "",
  outbound: { speed_to_lead: { ...BLANK_RULE, delayMin: 2 }, automation: { ...BLANK_RULE }, manual: { ...BLANK_RULE, enabled: true }, reminder: { ...BLANK_RULE, delayMin: 0 } },
  callWindow: { start: "09:00", end: "19:00", days: [1, 2, 3, 4, 5, 6] }, timezone: "Europe/Dublin",
};

const str = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
const hhmm = (v: unknown, fallback: string) => (typeof v === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(v) ? v : fallback);
export const e164 = (value: unknown) => { const d = String(value || "").replace(/^whatsapp:/i, "").replace(/[^\d+]/g, ""); return d ? (d.startsWith("+") ? d : "+" + d.replace(/^00/, "")) : ""; };
export const validPhone = (v: string) => /^\+[1-9]\d{6,14}$/.test(v);

export function sanitizeAgent(input: unknown, base: VoiceAgentSettings = BLANK_AGENT): VoiceAgentSettings {
  const v = (input && typeof input === "object" ? input : {}) as Record<string, any>;
  const pick = <K extends keyof VoiceAgentSettings>(k: K) => (k in v ? v[k] : base[k]);
  const voiceId = String(pick("voiceId"));
  const outIn = (v.outbound && typeof v.outbound === "object" ? v.outbound : {}) as Record<string, any>;
  const outbound = {} as Record<OutboundTrigger, OutboundRule>;
  for (const t of OUTBOUND_TRIGGERS) {
    const r = outIn[t.id] && typeof outIn[t.id] === "object" ? outIn[t.id] : {}, b = base.outbound?.[t.id] || BLANK_RULE;
    outbound[t.id] = { enabled: "enabled" in r ? r.enabled === true : b.enabled, channel: (("channel" in r ? r.channel : b.channel) === "whatsapp" ? "whatsapp" : "phone"), delayMin: Math.max(0, Math.min(1440, Math.round(Number("delayMin" in r ? r.delayMin : b.delayMin) || 0))), script: "script" in r ? str(r.script, 1500) : b.script };
  }
  const cw = (v.callWindow && typeof v.callWindow === "object" ? v.callWindow : base.callWindow) as Record<string, any>;
  const transfer = e164(pick("transferNumber")), number = e164(pick("number"));
  return {
    inboundEnabled: pick("inboundEnabled") === true,
    outboundEnabled: pick("outboundEnabled") === true,
    agentName: str(pick("agentName"), 60),
    voiceId: voiceId === "custom" || VOICES.some((x) => x.id === voiceId) ? voiceId : BLANK_AGENT.voiceId,
    customVoice: str(pick("customVoice"), 80).replace(/[^A-Za-z0-9_.-]/g, ""),
    language: LANGUAGES.some(([code]) => code === pick("language")) ? String(pick("language")) : "en-IE",
    speed: Math.max(0.8, Math.min(1.2, Number(pick("speed")) || 1)),
    greeting: str(pick("greeting"), 400),
    instructions: str(pick("instructions"), 4000),
    knowledge: str(pick("knowledge"), 6000),
    calendarIds: (Array.isArray(pick("calendarIds")) ? pick("calendarIds") as unknown[] : []).map((x) => str(x, 80)).filter(Boolean).slice(0, 20),
    transferNumber: validPhone(transfer) ? transfer : "",
    afterHours: (["answer", "transfer", "message"] as const).includes(pick("afterHours")) ? pick("afterHours") : "answer",
    recordCalls: pick("recordCalls") !== false,
    announceRecording: pick("announceRecording") !== false,
    maxCallMin: Math.max(2, Math.min(30, Math.round(Number(pick("maxCallMin")) || 10))),
    number: validPhone(number) ? number : "",
    outbound,
    callWindow: { start: hhmm(cw?.start, "09:00"), end: hhmm(cw?.end, "19:00"), days: (Array.isArray(cw?.days) ? cw.days : [1, 2, 3, 4, 5, 6]).map(Number).filter((d: number) => d >= 0 && d <= 6).slice(0, 7) },
    timezone: str(pick("timezone"), 60) || "Europe/Dublin",
  };
}

/** Voice attributes for <ConversationRelay>. */
export function relayVoice(a: Pick<VoiceAgentSettings, "voiceId" | "customVoice" | "speed">) {
  if (a.voiceId === "custom" && a.customVoice) return { ttsProvider: "ElevenLabs", voice: `${a.customVoice}-flash_v2_5-${a.speed.toFixed(1)}_0.8_0.8` };
  const v = VOICES.find((x) => x.id === a.voiceId) || VOICES[0];
  return v.provider === "ElevenLabs" ? { ttsProvider: "ElevenLabs", voice: `${v.voice}-flash_v2_5-${a.speed.toFixed(1)}_0.8_0.8` } : { ttsProvider: v.provider, voice: v.voice };
}

export const xmlEsc = (s: string) => String(s).replace(/[<>&'"]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", "'": "&apos;", '"': "&quot;" })[c]!);
export const twiml = (body: string) => `<?xml version="1.0" encoding="UTF-8"?><Response>${body}</Response>`;

export function defaultGreeting(a: Pick<VoiceAgentSettings, "agentName" | "announceRecording" | "recordCalls" | "greeting">, businessName: string, direction: "inbound" | "outbound", contactName = "") {
  const name = a.agentName || "the virtual assistant";
  const first = contactName.split(/\s+/)[0] || "";
  let text = a.greeting && direction === "inbound" ? a.greeting
    : direction === "inbound" ? `Hi, thanks for calling ${businessName || "us"}. I'm ${name}, the AI assistant. How can I help?`
    : `Hi${first ? ` ${first}` : ""}, it's ${name}, the AI assistant calling from ${businessName || "the team"}. Have you got a quick minute?`;
  text = text.replace(/\{\{\s*business\s*\}\}/gi, businessName).replace(/\{\{\s*name\s*\}\}/gi, first);
  if (a.recordCalls && a.announceRecording && !/record/i.test(text)) text = direction === "inbound" ? text.replace(/(\.|!)\s*/, `$1 This call is recorded. `) : `${text} Just so you know, this call is recorded.`;
  return text.slice(0, 500);
}

/** TwiML that hands the call to the AI over a WebSocket. */
export function relayTwiml(p: { wsUrl: string; actionUrl: string; greeting: string; agent: VoiceAgentSettings; params?: Record<string, string> }) {
  const v = relayVoice(p.agent);
  const lang = p.agent.language;
  const params = Object.entries(p.params || {}).map(([k, val]) => `<Parameter name="${xmlEsc(k)}" value="${xmlEsc(val)}"/>`).join("");
  return (`<Connect action="${xmlEsc(p.actionUrl)}"><ConversationRelay url="${xmlEsc(p.wsUrl)}" welcomeGreeting="${xmlEsc(p.greeting)}" welcomeGreetingInterruptible="speech" language="${xmlEsc(lang)}" ttsProvider="${v.ttsProvider}" voice="${xmlEsc(v.voice)}" transcriptionProvider="Deepgram" speechModel="nova-3-general" interruptible="speech" dtmfDetection="true" hints="appointment,consultation,Eircode">${params}</ConversationRelay></Connect>`);
}

/* ---------------- signed tokens (so only Twilio calls we started can open the AI socket) ---------------- */
const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (s: string) => Uint8Array.from(atob(s.replace(/-/g, "+").replace(/_/g, "/") + "===".slice((s.length + 3) % 4)), (c) => c.charCodeAt(0));
async function hmac(secret: string, data: string) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(new Uint8Array(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data))));
}
export type CallToken = { o: string; c: string; e: number };
export async function signCallToken(secret: string, ownerId: string, callId: string, ttlSec = 3 * 3600, now = Date.now()) {
  const payload = b64url(new TextEncoder().encode(JSON.stringify({ o: ownerId, c: callId, e: Math.floor(now / 1000) + ttlSec } satisfies CallToken)));
  return `${payload}.${await hmac(secret, payload)}`;
}
/** Reads the token without checking it (to find whose secret to check it with). */
export function peekCallToken(token: string): CallToken | null {
  try { const [p] = String(token).split("."); const t = JSON.parse(new TextDecoder().decode(fromB64url(p))); return t && typeof t.o === "string" && typeof t.c === "string" && typeof t.e === "number" ? t : null; } catch { return null; }
}
export async function verifyCallToken(secret: string, token: string, now = Date.now()): Promise<CallToken | null> {
  const [p, sig] = String(token).split(".");
  if (!p || !sig) return null;
  const expect = await hmac(secret, p);
  if (expect.length !== sig.length) return null;
  let diff = 0; for (let i = 0; i < expect.length; i++) diff |= expect.charCodeAt(i) ^ sig.charCodeAt(i);
  if (diff) return null;
  const t = peekCallToken(token);
  return t && t.e * 1000 > now ? t : null;
}

/* ---------------- time helpers ---------------- */
export function localParts(at: number, timeZone: string) {
  const f = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit" });
  const parts = Object.fromEntries(f.formatToParts(new Date(at)).map((x) => [x.type, x.value]));
  const dow = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(parts.weekday);
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}`, dow };
}
/** Is now inside the outbound call window (local time)? */
export function inCallWindow(a: Pick<VoiceAgentSettings, "callWindow" | "timezone">, at = Date.now()) {
  const { time, dow } = localParts(at, a.timezone || "Europe/Dublin");
  return a.callWindow.days.includes(dow) && time >= a.callWindow.start && time < a.callWindow.end;
}
/** "Thursday 20 November at 10:30am" — how a slot is read out on the phone. */
export function spokenTime(iso: string, timeZone: string) {
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat("en-IE", { timeZone, weekday: "long", day: "numeric", month: "long" }).format(d);
  const t = new Intl.DateTimeFormat("en-IE", { timeZone, hour: "numeric", minute: "2-digit", hour12: true }).format(d).replace(/\s/g, "").replace(":00", "").toLowerCase();
  return `${day.replace(",", "")} at ${t}`;
}
export const mmss = (ms: number) => { const s = Math.max(0, Math.round(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; };

/* ---------------- transcript ---------------- */
export type TranscriptLine = { t: number; who: "ai" | "caller" | "system"; text: string };
export function transcriptText(lines: TranscriptLine[]) {
  return lines.map((l) => `[${mmss(l.t)}] ${l.who === "ai" ? "AI" : l.who === "caller" ? "Caller" : "·"}: ${l.text}`).join("\n");
}
/** The chat bubble body. The [[voice:id]] marker tells Conversations to draw the voice-note player. */
export function voiceNoteBody(p: { callId: string; direction: "inbound" | "outbound"; durationSec: number; outcome: string; summary: string }) {
  const head = `📞 ${p.direction === "inbound" ? "Incoming" : "Outgoing"} AI call · ${mmss(p.durationSec * 1000)}${p.outcome ? ` · ${p.outcome}` : ""}`;
  return `[[voice:${p.callId}]] ${head}${p.summary ? `\n${p.summary}` : ""}`.slice(0, 3800);
}
export const VOICE_NOTE_RE = /^\[\[voice:([A-Za-z0-9-]{8,64})\]\]\s?/;

/* ---------------- the agent's brain ---------------- */
export type CalendarLite = { id: string; name: string; kind: string; durationMin: number; locationType: string; description?: string; price?: number; currency?: string };
export function systemPrompt(p: { agent: VoiceAgentSettings; businessName: string; knowledge: string; calendars: CalendarLite[]; direction: "inbound" | "outbound"; purpose: string; caller: { name: string; phone: string; known: boolean }; nowIso: string; script: string }) {
  const { agent } = p;
  const today = new Intl.DateTimeFormat("en-IE", { timeZone: agent.timezone, weekday: "long", day: "numeric", month: "long", year: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(p.nowIso));
  return [
    `You are ${agent.agentName || "the AI assistant"}, answering the phone for ${p.businessName || "the business"}. You are an AI and say so if asked. This is a live phone call: your words are spoken aloud.`,
    "Speak like a friendly local receptionist: short sentences, one question at a time, 1-2 sentences per turn. No lists, no markdown, no emojis, no URLs read out. Say times naturally (\"Thursday at half ten\").",
    `It is now ${today} (${agent.timezone}).`,
    p.direction === "outbound" ? `You placed this call. Purpose: ${p.purpose || "follow up and book an appointment"}. If they're busy, offer to call back or book a time and keep it brief. If they ask not to be called, apologise, say you'll take them off the list, then use end_call with outcome "do_not_call".` : "The caller rang the business.",
    p.script ? `Call script from the owner:\n${p.script}` : "",
    p.caller.known ? `The caller is ${p.caller.name || "an existing contact"} (${p.caller.phone}).` : `Caller number: ${p.caller.phone || "withheld"}. Ask for their name early.`,
    p.calendars.length ? `You can book these (use check_availability then book_appointment; never invent times, only offer slots the tool returns):\n${p.calendars.map((c) => `- ${c.name} [id ${c.id}] · ${c.durationMin} min · ${c.kind}${c.locationType ? ` · ${c.locationType}` : ""}${c.price ? ` · ${c.currency || "EUR"} ${c.price}` : ""}${c.description ? ` · ${c.description.slice(0, 160)}` : ""}`).join("\n")}` : "You cannot book appointments directly: take their details with take_message so the team calls back.",
    "Before booking, confirm: name, the service, the time, and for on-site jobs the address or Eircode. Repeat the time back once. Email is optional (offer to text the confirmation instead).",
    agent.transferNumber ? "If they ask for a person, are upset, or it's urgent/an emergency, use transfer_to_human." : "If they ask for a person or are upset, take a message with take_message and promise a call back.",
    "Only state facts from the business information below. Never invent prices, guarantees or availability. If unsure, say the team will confirm.",
    "When the conversation is finished (booked, message taken, or they say goodbye), say a short goodbye and call end_call.",
    p.knowledge ? `Business information:\n${p.knowledge}` : "",
    agent.knowledge ? `Extra notes for phone calls:\n${agent.knowledge}` : "",
    agent.instructions ? `Training from the owner (follow this):\n${agent.instructions}` : "",
  ].filter(Boolean).join("\n\n");
}

export const AGENT_TOOLS = [
  { type: "function", name: "check_availability", description: "Find free appointment times. Call before offering any time.", parameters: { type: "object", properties: { calendar_id: { type: "string", description: "Which calendar (id from the list)" }, date: { type: "string", description: "First day to look, YYYY-MM-DD (local). Omit for the next available days." }, part_of_day: { type: "string", enum: ["any", "morning", "afternoon", "evening"] } }, required: ["calendar_id"], additionalProperties: false } },
  { type: "function", name: "book_appointment", description: "Book a confirmed time the caller agreed to.", parameters: { type: "object", properties: { calendar_id: { type: "string" }, start: { type: "string", description: "Exact start value returned by check_availability" }, name: { type: "string" }, email: { type: "string" }, address: { type: "string", description: "Address or Eircode for on-site visits" }, notes: { type: "string", description: "What they need, in a sentence" } }, required: ["calendar_id", "start", "name"], additionalProperties: false } },
  { type: "function", name: "take_message", description: "Save a message / call-back request for the team.", parameters: { type: "object", properties: { name: { type: "string" }, message: { type: "string" }, callback_time: { type: "string" } }, required: ["message"], additionalProperties: false } },
  { type: "function", name: "transfer_to_human", description: "Put the caller through to a person.", parameters: { type: "object", properties: { reason: { type: "string" } }, required: ["reason"], additionalProperties: false } },
  { type: "function", name: "end_call", description: "Hang up after saying goodbye.", parameters: { type: "object", properties: { outcome: { type: "string", enum: ["booked", "message_taken", "info_given", "not_interested", "do_not_call", "wrong_number", "voicemail", "other"] }, summary: { type: "string", description: "One-sentence summary for the team" } }, required: ["outcome", "summary"], additionalProperties: false } },
] as const;

export const OUTCOME_LABEL: Record<string, string> = { booked: "Booked", message_taken: "Message taken", info_given: "Answered questions", not_interested: "Not interested", do_not_call: "Asked not to be called", wrong_number: "Wrong number", voicemail: "Voicemail", transferred: "Put through to the team", no_answer: "No answer", busy: "Line busy", failed: "Call failed", other: "" };

/** Pick slots spread across days and filtered by part of day, so the agent offers a few sensible options. */
export function pickSlots(slots: Array<{ start: string }>, timeZone: string, partOfDay = "any", max = 6) {
  const hour = (iso: string) => Number(localParts(Date.parse(iso), timeZone).time.slice(0, 2));
  const fits = (iso: string) => partOfDay === "morning" ? hour(iso) < 12 : partOfDay === "afternoon" ? hour(iso) >= 12 && hour(iso) < 17 : partOfDay === "evening" ? hour(iso) >= 17 : true;
  const byDay = new Map<string, string[]>();
  for (const s of slots) { if (!fits(s.start)) continue; const d = localParts(Date.parse(s.start), timeZone).date; const list = byDay.get(d) || []; list.push(s.start); byDay.set(d, list); }
  const out: string[] = [];
  for (const [, list] of byDay) { const step = Math.max(1, Math.floor(list.length / 3)); for (let i = 0; i < list.length && out.length < max; i += step) { out.push(list[i]); if (out.filter((x) => localParts(Date.parse(x), timeZone).date === localParts(Date.parse(list[0]), timeZone).date).length >= 3) break; } if (out.length >= max) break; }
  return out;
}
