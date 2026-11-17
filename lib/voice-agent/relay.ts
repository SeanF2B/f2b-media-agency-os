// F2B Agency OS · AI phone agent: the live call. Twilio ConversationRelay opens a WebSocket here, sends the
// caller's words as text, and speaks whatever we send back. The brain runs on the account's AI key and can
// check Scheduling availability, book appointments, take messages, transfer to a person and hang up.
import { env } from "cloudflare:workers";
import { aiEndpoint, aiHeaders, aiModel, resolveAiProvider } from "@/lib/ai-provider";
import { getClientBot, twilioCredentials } from "@/lib/conversations/core";
import { loadSchedulingWorkspace, schedulingDeps } from "@/lib/scheduling/context";
import { availableSlots, createBooking, getCalendar, listCalendars, SchedulingError } from "@/lib/scheduling/server";
import { AGENT_TOOLS, OUTCOME_LABEL, localParts, peekCallToken, pickSlots, spokenTime, systemPrompt, transcriptText, verifyCallToken, type CalendarLite, type TranscriptLine } from "./core";
import { contactForNumber, getAgent, getCall, markDoNotCall, noteOnPipeline, publicBase, saveTranscript, updateCall, type CallRow } from "./server";

type Item = Record<string, unknown>;
const outputText = (r: any) => (r?.output || []).flatMap((i: any) => (i.type === "message" ? i.content || [] : [])).filter((p: any) => p.type === "output_text").map((p: any) => p.text).join(" ").trim();

function knowledgeFromBot(bot: Awaited<ReturnType<typeof getClientBot>>) {
  if (!bot) return "";
  return ([["About", bot.about], ["Services", bot.services], ["Prices", bot.prices], ["Opening hours", bot.hours], ["Area", bot.area], ["Team", bot.team], ["FAQs", bot.faqs], ["House rules", bot.rules]] as Array<[string, string]>).filter(([, v]) => v?.trim()).map(([k, v]) => `${k}: ${v.trim()}`).join("\n");
}

/** Called by the worker for wss://…/api/marketing-public/voice/relay?t=… */
export async function handleRelaySocket(request: Request, ctx: ExecutionContext): Promise<Response> {
  if (request.headers.get("Upgrade")?.toLowerCase() !== "websocket") return new Response("Expected a WebSocket.", { status: 426 });
  const token = new URL(request.url).searchParams.get("t") || "";
  const peek = peekCallToken(token);
  if (!peek || !env.DB) return new Response("Forbidden", { status: 403 });
  const creds = await twilioCredentials(peek.o).catch(() => null);
  const verified = creds ? await verifyCallToken(creds.token, token) : null;
  if (!verified) return new Response("Forbidden", { status: 403 });
  const call = await getCall(verified.o, verified.c);
  if (!call) return new Response("Not found", { status: 404 });

  const pair = new WebSocketPair();
  const [client, server] = Object.values(pair) as [WebSocket, WebSocket];
  server.accept();
  const session = new CallSession(server, call, new URL(request.url).origin);
  let done: () => void = () => undefined;
  ctx.waitUntil(new Promise<void>((resolve) => { done = resolve; }));
  server.addEventListener("message", (ev) => { session.onMessage(String(ev.data)).catch((e) => console.error("voice relay", e)); });
  const close = () => { session.finish().catch(() => undefined).finally(done); };
  server.addEventListener("close", close);
  server.addEventListener("error", close);
  return new Response(null, { status: 101, webSocket: client });
}

class CallSession {
  private input: Item[] = [];
  private transcript: TranscriptLine[] = [];
  private started = Date.now();
  private busy: Promise<void> = Promise.resolve();
  private turn = 0;
  private ended = false;
  private finished = false;
  private instructions = "";
  private calendars: CalendarLite[] = [];
  private contact = { id: "", name: "", known: false };
  private agent: Awaited<ReturnType<typeof getAgent>> | null = null;
  private bookingId = "";
  private outcome = "";
  private summary = "";
  private model = "";
  private maxTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(private ws: WebSocket, private call: CallRow, private origin: string) {}

  private send(msg: Record<string, unknown>) { try { this.ws.send(JSON.stringify(msg)); } catch { /* socket gone */ } }
  private say(text: string, last = true) { if (text) { this.send({ type: "text", token: text, last }); this.log("ai", text); } }
  private log(who: TranscriptLine["who"], text: string) { this.transcript.push({ t: Date.now() - this.started, who, text: text.slice(0, 1000) }); }

  async onMessage(raw: string) {
    let m: any; try { m = JSON.parse(raw); } catch { return; }
    if (m.type === "setup") return this.setup(m);
    if (m.type === "prompt" && m.last !== false) {
      const text = String(m.voicePrompt || "").trim();
      if (!text || this.ended) return;
      this.log("caller", text);
      this.input.push({ role: "user", content: text });
      const turn = ++this.turn;
      this.busy = this.busy.then(() => (turn === this.turn ? this.respond() : undefined)).catch((e) => console.error("voice turn", e));
      return;
    }
    if (m.type === "interrupt") {
      // The caller talked over the AI: keep only what was actually heard.
      const heard = String(m.utteranceUntilInterrupt || "");
      const last = [...this.input].reverse().find((i) => i.role === "assistant") as { content?: string } | undefined;
      if (last && heard) last.content = `${heard}…`;
      return;
    }
    if (m.type === "dtmf") { this.input.push({ role: "user", content: `(caller pressed ${String(m.digit).slice(0, 4)})` }); return; }
    if (m.type === "error") this.log("system", `Voice error: ${String(m.description || "").slice(0, 200)}`);
  }

  private async setup(m: any) {
    const call = this.call;
    if (m.callSid && !call.call_sid) await updateCall(call.id, { call_sid: String(m.callSid) });
    await updateCall(call.id, { status: "live", started_at: new Date().toISOString() });
    this.started = Date.now();
    const agent = this.agent = await getAgent(call.owner_id, call.client_id);
    this.maxTimer = setTimeout(() => { this.say("I'm sorry, I have to wrap up now. The team will follow up with you. Bye for now!"); this.end("other", "Call reached the time limit."); }, agent.maxCallMin * 60_000);
    const [ws, bot, cals] = await Promise.all([
      loadSchedulingWorkspace().catch(() => null),
      getClientBot(call.owner_id, call.client_id).catch(() => null),
      listCalendars(env.DB as never, call.owner_id, call.client_id || null).catch(() => []),
    ]);
    this.calendars = (cals as any[]).filter((c) => c.active !== false && (agent.calendarIds.length ? agent.calendarIds.includes(c.id) : true)).slice(0, 12)
      .map((c) => ({ id: c.id, name: c.name, kind: c.kind, durationMin: c.durationMin, locationType: c.locationType, description: c.description, price: c.price, currency: c.currency }));
    const businessName = ws?.clients.find((c) => c.id === call.client_id)?.name || ws?.agencyName || "the business";
    this.contact = await contactForNumber(call.owner_id, call.client_id, call.contact_number, call.contact_name, call.direction === "inbound" ? "Phone call" : "AI call").catch(() => ({ id: "", name: "", known: false }));
    if (this.contact.id && !call.contact_id) await updateCall(call.id, { contact_id: this.contact.id });
    this.instructions = systemPrompt({ agent, businessName, knowledge: knowledgeFromBot(bot), calendars: this.calendars, direction: call.direction, purpose: call.purpose, caller: { name: this.contact.name || call.contact_name, phone: call.contact_number, known: this.contact.known }, nowIso: new Date().toISOString(), script: "" });
    // The greeting was spoken by Twilio (welcomeGreeting); record it so the transcript reads naturally.
    const greeting = typeof m.customParameters?.greeting === "string" ? m.customParameters.greeting : "";
    if (greeting) { this.log("ai", greeting); this.input.push({ role: "assistant", content: greeting }); }
    // Recording (dual channel), saved to the account's storage when Twilio finishes it.
    if (agent.recordCalls && m.callSid) this.startRecording(String(m.callSid)).catch((e) => this.log("system", `Recording didn't start: ${e instanceof Error ? e.message : ""}`.slice(0, 200)));
  }

  private async startRecording(callSid: string) {
    const creds = await twilioCredentials(this.call.owner_id);
    if (!creds) return;
    const url = new URL(`${publicBase(this.origin)}/api/marketing-public/voice/recording`);
    url.searchParams.set("c", this.call.id);
    await fetch(`https://api.twilio.com/2010-04-01/Accounts/${creds.sid}/Calls/${callSid}/Recordings.json`, { method: "POST", headers: { Authorization: "Basic " + btoa(`${creds.sid}:${creds.token}`), "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ RecordingChannels: "dual", RecordingStatusCallback: url.toString(), RecordingStatusCallbackMethod: "POST", RecordingStatusCallbackEvent: "completed" }), signal: AbortSignal.timeout(8000) });
  }

  private async respond() {
    if (this.ended) return;
    const provider = await resolveAiProvider(env as any, this.call.owner_id);
    const endpoint = provider ? aiEndpoint(env as any, "responses", provider) : null;
    if (!provider || !endpoint) { this.say("Sorry, I'm having trouble on my end. I'll get someone from the team to call you back."); return this.end("message_taken", "AI key missing: caller asked to be called back."); }
    this.model ||= aiModel(env as any, undefined, provider) || "";
    for (let hop = 0; hop < 4 && !this.ended; hop++) {
      let data: any;
      try {
        const res = await fetch(endpoint, { method: "POST", headers: aiHeaders(env as any, provider)!, body: JSON.stringify({ model: this.model, instructions: this.instructions, input: this.input.slice(-40), tools: AGENT_TOOLS, tool_choice: "auto", max_output_tokens: 300 }), signal: AbortSignal.timeout(12_000) });
        if (!res.ok) throw new Error(`AI HTTP ${res.status}`);
        data = await res.json();
      } catch (e) {
        this.log("system", `AI error: ${e instanceof Error ? e.message : ""}`);
        this.say("Sorry, could you say that again?");
        return;
      }
      const output = (data?.output || []) as any[];
      const text = outputText(data);
      const calls = output.filter((o) => o.type === "function_call");
      if (text) { this.say(text); this.input.push({ role: "assistant", content: text }); }
      if (!calls.length) return;
      for (const fc of calls) {
        this.input.push({ type: "function_call", call_id: fc.call_id, name: fc.name, arguments: fc.arguments || "{}" });
        let args: any = {}; try { args = JSON.parse(fc.arguments || "{}"); } catch { /* empty */ }
        const result = await this.runTool(String(fc.name), args);
        this.input.push({ type: "function_call_output", call_id: fc.call_id, output: JSON.stringify(result).slice(0, 4000) });
        if (this.ended) return;
      }
    }
  }

  private async runTool(name: string, a: any): Promise<unknown> {
    const call = this.call, agent = this.agent!;
    this.log("system", `${name}(${JSON.stringify(a).slice(0, 200)})`);
    try {
      if (name === "check_availability") {
        const cal = this.calendars.find((c) => c.id === a.calendar_id) || (this.calendars.length === 1 ? this.calendars[0] : null);
        if (!cal) return { error: "Unknown calendar. Use one of the ids listed." };
        const full = await getCalendar(env.DB as never, call.owner_id, cal.id);
        if (!full) return { error: "That calendar is gone." };
        const today = localParts(Date.now(), full.timezone).date;
        const from = typeof a.date === "string" && /^\d{4}-\d{2}-\d{2}$/.test(a.date) && a.date >= today ? a.date : today;
        const slots = await availableSlots(schedulingDeps(new Request(publicBase(this.origin))), full, { fromDate: from, days: a.date ? 3 : 10 });
        const picks = pickSlots(slots, full.timezone, String(a.part_of_day || "any"), 6);
        return picks.length ? { timezone: full.timezone, slots: picks.map((s) => ({ start: s, say: spokenTime(s, full.timezone) })) } : { slots: [], note: "Nothing free then. Offer another day or take a message." };
      }
      if (name === "book_appointment") {
        const full = await getCalendar(env.DB as never, call.owner_id, String(a.calendar_id || ""));
        if (!full || !this.calendars.some((c) => c.id === full.id)) return { error: "Unknown calendar." };
        const ws = await loadSchedulingWorkspace();
        if (!ws) return { error: "Booking system unavailable. Take a message instead." };
        const r = await createBooking(schedulingDeps(new Request(publicBase(this.origin))), { cal: full, start: String(a.start || ""), name: String(a.name || this.contact.name || "Caller").slice(0, 120), email: typeof a.email === "string" ? a.email : "", phone: call.contact_number, location: typeof a.address === "string" ? a.address : "", notes: `Booked by the AI phone agent. ${typeof a.notes === "string" ? a.notes : ""}`.trim().slice(0, 1000), source: "internal", createdBy: "AI phone agent", workspace: ws, notifyCustomer: true });
        this.bookingId = String((r as any)?.booking?.id || (r as any)?.id || "");
        this.outcome = "booked";
        await updateCall(call.id, { booking_id: this.bookingId, outcome: "booked" });
        return { booked: true, when: spokenTime(String(a.start), full.timezone), confirmation: a.email ? "Email confirmation sent." : "No email given; the team will confirm." };
      }
      if (name === "take_message") {
        const text = `📞 Message from a call (${new Date().toLocaleString("en-IE", { timeZone: agent.timezone })}): ${String(a.message || "").slice(0, 600)}${a.callback_time ? ` · Best time to call back: ${String(a.callback_time).slice(0, 80)}` : ""}${a.name ? ` · Name: ${String(a.name).slice(0, 80)}` : ""}`;
        if (a.name && this.contact.id && !this.contact.known) await env.DB!.prepare("UPDATE crm_contacts SET first_name=?2, last_name=?3 WHERE id=?1").bind(this.contact.id, String(a.name).split(/\s+/)[0].slice(0, 60), String(a.name).split(/\s+/).slice(1).join(" ").slice(0, 60)).run().catch(() => undefined);
        await noteOnPipeline(call.owner_id, call.client_id, this.contact.id, `Call-back · ${a.name || call.contact_number}`, text);
        this.outcome ||= "message_taken";
        return { saved: true };
      }
      if (name === "transfer_to_human") {
        if (!agent.transferNumber) return { error: "No one is available to transfer to. Take a message instead." };
        this.say("No problem, I'll put you through now. One moment.");
        this.end("transferred", `Put through to the team: ${String(a.reason || "").slice(0, 200)}`, { transfer: agent.transferNumber });
        return { ok: true };
      }
      if (name === "end_call") {
        if (a.outcome === "do_not_call") await markDoNotCall(call.owner_id, this.contact.id);
        setTimeout(() => this.end(String(a.outcome || "other"), String(a.summary || "")), 2500); // let the goodbye play
        this.ended = true;
        return { ok: true };
      }
      return { error: "Unknown tool." };
    } catch (e) {
      const msg = e instanceof SchedulingError ? e.message : "Something went wrong.";
      this.log("system", `Tool error: ${e instanceof Error ? e.message : ""}`);
      return { error: msg };
    }
  }

  private end(outcome: string, summary: string, handoff: Record<string, string> = {}) {
    this.ended = true;
    this.outcome = this.outcome === "booked" && outcome !== "transferred" ? "booked" : outcome;
    this.summary = summary;
    this.send({ type: "end", handoffData: JSON.stringify({ outcome: this.outcome, ...handoff }) });
  }

  async finish() {
    if (this.finished) return;
    this.finished = true;
    if (this.maxTimer) clearTimeout(this.maxTimer);
    const durationSec = Math.round((Date.now() - this.started) / 1000);
    const summary = this.summary || (this.transcript.filter((l) => l.who === "caller").length ? await this.summarise() : "");
    await saveTranscript(this.call.id, this.transcript).catch(() => undefined);
    await updateCall(this.call.id, { outcome: this.outcome || "other", summary: summary.slice(0, 600), duration_sec: durationSec, ended_at: new Date().toISOString() }).catch(() => undefined);
    if (this.contact.id) await noteOnPipeline(this.call.owner_id, this.call.client_id, this.contact.id, `${this.call.direction === "inbound" ? "Phone enquiry" : "AI call"} · ${this.contact.name || this.call.contact_number}`, `📞 AI ${this.call.direction === "inbound" ? "answered a call" : "called"} (${OUTCOME_LABEL[this.outcome] || "call"}): ${summary}`).catch(() => undefined);
    // The voice note itself is posted once Twilio's "completed" status (or the recording) arrives, so the duration and audio are final.
  }

  private async summarise() {
    try {
      const provider = await resolveAiProvider(env as any, this.call.owner_id);
      const endpoint = provider ? aiEndpoint(env as any, "responses", provider) : null;
      if (!provider || !endpoint) return "";
      const res = await fetch(endpoint, { method: "POST", headers: aiHeaders(env as any, provider)!, body: JSON.stringify({ model: aiModel(env as any, undefined, provider), instructions: "Summarise this phone call for the business owner in one or two plain sentences: who called, what they wanted, what was agreed. UK/Irish English.", input: transcriptText(this.transcript.filter((l) => l.who !== "system")).slice(0, 12000), max_output_tokens: 160 }), signal: AbortSignal.timeout(10_000) });
      if (!res.ok) return "";
      return outputText(await res.json()).slice(0, 600);
    } catch { return ""; }
  }
}
