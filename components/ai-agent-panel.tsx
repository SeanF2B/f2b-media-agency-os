"use client";
// AI switches on the client card (AI chat · AI calls in · AI calls out) and the AI agent settings pop-up:
// voice, training, calendars it can book, phone number (buy in the OS), outbound call types, test call and call log.
import { useCallback, useEffect, useState } from "react";
import { AiEyesIcon } from "./ai-eyes-icon";
import { appConfirm, appPrompt } from "./app-dialog";

type Rule = { enabled: boolean; channel: "phone" | "whatsapp"; delayMin: number; script: string };
type Agent = {
  inboundEnabled: boolean; outboundEnabled: boolean; agentName: string; voiceId: string; customVoice: string; language: string; speed: number;
  greeting: string; instructions: string; knowledge: string; calendarIds: string[]; transferNumber: string; afterHours: "answer" | "transfer" | "message";
  recordCalls: boolean; announceRecording: boolean; maxCallMin: number; number: string; outbound: Record<string, Rule>;
  callWindow: { start: string; end: string; days: number[] }; timezone: string;
};
type Voice = { id: string; label: string; provider: string; accent: string; gender: string };
type Cal = { id: string; name: string; kind: string; durationMin: number; active: boolean };
type Toggles = { chat: boolean; inbound: boolean; outbound: boolean; number: string };
type CallRow = { id: string; direction: string; channel: string; contact_name: string; contact_number: string; status: string; outcome: string; summary: string; duration_sec: number; created_at: string };

async function api<T>(body?: unknown, query = ""): Promise<T> {
  const res = await fetch(`/api/voice-agent${query}`, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
  const json = await res.json().catch(() => ({})) as T & { error?: string };
  if (!res.ok) throw new Error(json.error || "Something went wrong.");
  return json;
}
const PhoneIcon = () => <svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1 1 .4 1.9.7 2.8a2 2 0 0 1-.5 2.1L8 9.9a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.8.7a2 2 0 0 1 1.7 2Z" /></svg>;
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const OUTCOME: Record<string, string> = { booked: "Booked", message_taken: "Message", info_given: "Answered", not_interested: "Not interested", do_not_call: "Do not call", transferred: "Put through", no_answer: "No answer", busy: "Busy", failed: "Failed", voicemail: "Voicemail", wrong_number: "Wrong number" };
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s) % 60).padStart(2, "0")}`;

/** The three switches on a client card. */
export function AiSwitches({ clientId, clientName, chat = true, phone = true }: { clientId: string; clientName: string; chat?: boolean; phone?: boolean }) {
  const [t, setT] = useState<Toggles | null>(null);
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const [open, setOpen] = useState(false);
  const load = useCallback(() => { api<{ toggles: Toggles }>(undefined, `?view=toggles&clientId=${encodeURIComponent(clientId)}`).then((r) => setT(r.toggles)).catch(() => setT(null)); }, [clientId]);
  useEffect(() => { setT(null); setNote(""); load(); }, [load]);
  const flip = async (which: "chat" | "inbound" | "outbound", on: boolean) => {
    if (!t) return;
    setBusy(which); setNote(""); setT({ ...t, [which]: on });
    try { const r = await api<{ toggles: Toggles; warning?: string }>({ action: "toggle", clientId, which, on }); setT(r.toggles); setNote(r.warning || ""); }
    catch (e) { setT(t); setNote(e instanceof Error ? e.message : "Couldn't change that."); } finally { setBusy(""); }
  };
  if (!t) return null;
  const Sw = ({ k, label, title }: { k: "chat" | "inbound" | "outbound"; label: string; title: string }) => <label className={`va-switch ${t[k] ? "on" : ""}`} title={title}><input type="checkbox" role="switch" checked={t[k]} disabled={busy === k} onChange={(e) => void flip(k, e.target.checked)} /><span aria-hidden="true" />{label}</label>;
  return <div className="va-switches" role="group" aria-label={`AI for ${clientName}`}>
    <span className="va-switches-label"><AiEyesIcon /> AI</span>
    {chat && <Sw k="chat" label="Chat" title="AI replies to SMS and WhatsApp messages" />}
    {phone && <Sw k="inbound" label="Calls in" title="AI answers this account's phone number and books appointments" />}
    {phone && <Sw k="outbound" label="Calls out" title="AI rings leads and contacts (choose which kinds in settings)" />}
    {phone && <button type="button" className="va-gear" title="AI agent settings: voice, training, calendars, number" aria-label="AI agent settings" onClick={() => setOpen(true)}><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3" /><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" /></svg></button>}
    {note && <small className="va-note" role="status">{note}</small>}
    {open && <AiAgentSettings clientId={clientId} clientName={clientName} onClose={() => { setOpen(false); load(); }} />}
  </div>;
}

/** Full settings pop-up for one account's AI agent. */
export function AiAgentSettings({ clientId, clientName, onClose }: { clientId: string; clientName: string; onClose: () => void }) {
  const [a, setA] = useState<Agent | null>(null);
  const [voices, setVoices] = useState<Voice[]>([]);
  const [langs, setLangs] = useState<Array<[string, string]>>([]);
  const [triggers, setTriggers] = useState<Array<{ id: string; label: string; help: string }>>([]);
  const [cals, setCals] = useState<Cal[]>([]);
  const [tab, setTab] = useState<"agent" | "training" | "number" | "outbound" | "calls">("agent");
  const [err, setErr] = useState(""); const [msg, setMsg] = useState(""); const [busy, setBusy] = useState(false);
  const [dirty, setDirty] = useState(false);
  useEffect(() => {
    api<{ agent: Agent; voices: Voice[]; languages: Array<[string, string]>; triggers: Array<{ id: string; label: string; help: string }>; calendars: Cal[] }>(undefined, `?clientId=${encodeURIComponent(clientId)}`)
      .then((r) => { setA(r.agent); setVoices(r.voices); setLangs(r.languages); setTriggers(r.triggers); setCals(r.calendars); }).catch((e) => setErr(e.message));
  }, [clientId]);
  const set = (patch: Partial<Agent>) => { if (!a) return; setA({ ...a, ...patch }); setDirty(true); setMsg(""); };
  const setRule = (id: string, patch: Partial<Rule>) => a && set({ outbound: { ...a.outbound, [id]: { ...a.outbound[id], ...patch } } });
  const save = async () => { if (!a) return; setBusy(true); setErr(""); try { const r = await api<{ agent: Agent }>({ action: "save", clientId, agent: a }); setA(r.agent); setDirty(false); setMsg("Saved. The agent uses this from the next call."); } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't save."); } finally { setBusy(false); } };
  const close = async () => { if (dirty && !(await appConfirm("Close without saving your changes?"))) return; onClose(); };

  return <div className="cv-modal va-modal" role="dialog" aria-modal="true" aria-label={`AI agent settings for ${clientName}`} onMouseDown={(e) => { if (e.target === e.currentTarget) void close(); }}>
    <div className="cv-dialog va-dialog">
      <header><div><h2><AiEyesIcon /> AI agent · {clientName}</h2><small>Answers calls, books into Scheduling and follows up. Every call is saved in Conversations as a voice note with a timestamped transcript.</small></div><button type="button" className="cv-x" aria-label="Close" onClick={() => void close()}>✕</button></header>
      {!a ? <p>{err || "Loading…"}</p> : <>
        <nav className="va-tabs" role="tablist">{([["agent", "Voice & calls"], ["training", "Training"], ["number", "Phone number"], ["outbound", "Outbound"], ["calls", "Call log"]] as const).map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}</nav>

        {tab === "agent" && <div className="va-body">
          <div className="va-row"><label className={`va-switch big ${a.inboundEnabled ? "on" : ""}`}><input type="checkbox" role="switch" checked={a.inboundEnabled} onChange={(e) => set({ inboundEnabled: e.target.checked })} /><span aria-hidden="true" />AI answers incoming calls</label>
            <label className={`va-switch big ${a.outboundEnabled ? "on" : ""}`}><input type="checkbox" role="switch" checked={a.outboundEnabled} onChange={(e) => set({ outboundEnabled: e.target.checked })} /><span aria-hidden="true" />AI makes outbound calls</label></div>
          <div className="cv-2"><label>Agent name<input value={a.agentName} maxLength={60} placeholder="e.g. Sarah" onChange={(e) => set({ agentName: e.target.value })} /></label>
            <label>Language<select value={a.language} onChange={(e) => set({ language: e.target.value })}>{langs.map(([c, l]) => <option key={c} value={c}>{l}</option>)}</select></label></div>
          <fieldset className="va-voices"><legend>Voice</legend>
            {voices.map((v) => <label key={v.id} className={a.voiceId === v.id ? "on" : ""}><input type="radio" name="va-voice" checked={a.voiceId === v.id} onChange={() => set({ voiceId: v.id })} /><b>{v.label}</b><small>{v.accent} · {v.gender} · {v.provider}</small></label>)}
            <label className={a.voiceId === "custom" ? "on" : ""}><input type="radio" name="va-voice" checked={a.voiceId === "custom"} onChange={() => set({ voiceId: "custom" })} /><b>Custom / cloned</b><small>Any ElevenLabs voice ID</small></label>
          </fieldset>
          {a.voiceId === "custom" && <label>ElevenLabs voice ID<input value={a.customVoice} maxLength={80} placeholder="e.g. a voice cloned from the owner" onChange={(e) => set({ customVoice: e.target.value })} spellCheck={false} /></label>}
          <label>Speaking speed <b>{a.speed.toFixed(1)}×</b><input type="range" min={0.8} max={1.2} step={0.1} value={a.speed} onChange={(e) => set({ speed: Number(e.target.value) })} /></label>
          <label>Greeting (optional)<input value={a.greeting} maxLength={400} placeholder={`Hi, thanks for calling ${clientName}. I'm ${a.agentName || "the AI assistant"}. How can I help?`} onChange={(e) => set({ greeting: e.target.value })} /></label>
          <h3>Booking</h3>
          <p className="cv-hint">Calendars the agent can book into (from Scheduling). None ticked means all of this account's calendars.</p>
          <div className="va-cals">{cals.length ? cals.map((c) => <label key={c.id} className="cv-check"><input type="checkbox" checked={a.calendarIds.includes(c.id)} onChange={(e) => set({ calendarIds: e.target.checked ? [...a.calendarIds, c.id] : a.calendarIds.filter((x) => x !== c.id) })} />{c.name} <small>· {c.kind === "consultation" ? "Consultation" : "Service"} · {c.durationMin} min{c.active ? "" : " · paused"}</small></label>) : <p className="cv-hint">No booking calendars yet. Create one in Scheduling (e.g. "Walk-in consultation") and the agent can book it.</p>}</div>
          <h3>Handing over</h3>
          <div className="cv-2"><label>Put callers through to<input value={a.transferNumber} placeholder="+353851234567" onChange={(e) => set({ transferNumber: e.target.value })} /></label>
            <label>Outside opening hours<select value={a.afterHours} onChange={(e) => set({ afterHours: e.target.value as Agent["afterHours"] })}><option value="answer">AI answers as normal</option><option value="message">AI takes a message</option><option value="transfer">Ring the number above</option></select></label></div>
          <div className="va-row"><label>Opening / calling hours<span className="va-inline"><input type="time" value={a.callWindow.start} onChange={(e) => set({ callWindow: { ...a.callWindow, start: e.target.value } })} />to<input type="time" value={a.callWindow.end} onChange={(e) => set({ callWindow: { ...a.callWindow, end: e.target.value } })} /></span></label>
            <span className="va-days">{DAYS.map((d, i) => <button key={d} type="button" className={a.callWindow.days.includes(i) ? "on" : ""} aria-pressed={a.callWindow.days.includes(i)} onClick={() => set({ callWindow: { ...a.callWindow, days: a.callWindow.days.includes(i) ? a.callWindow.days.filter((x) => x !== i) : [...a.callWindow.days, i] } })}>{d}</button>)}</span></div>
          <h3>Recording</h3>
          <label className="cv-check"><input type="checkbox" checked={a.recordCalls} onChange={(e) => set({ recordCalls: e.target.checked })} /> Record calls (saved privately, played back in Conversations)</label>
          {a.recordCalls && <label className="cv-check"><input type="checkbox" checked={a.announceRecording} onChange={(e) => set({ announceRecording: e.target.checked })} /> Tell callers the call is recorded (recommended under GDPR)</label>}
          <label>Longest call (minutes)<input type="number" min={2} max={30} value={a.maxCallMin} onChange={(e) => set({ maxCallMin: Number(e.target.value) })} /></label>
        </div>}

        {tab === "training" && <div className="va-body">
          <p className="cv-hint">The agent already knows everything in this account's chat bot training (services, prices, hours, area, FAQs). Add phone-specific training here.</p>
          <label>How it should handle calls<textarea rows={6} maxLength={4000} value={a.instructions} placeholder={"e.g. Always ask for the Eircode for roof jobs.\nIf someone mentions a leak, treat it as urgent and offer the earliest slot.\nNever quote prices for cover-ups; book a free consultation instead."} onChange={(e) => set({ instructions: e.target.value })} /></label>
          <label>Extra facts for calls<textarea rows={6} maxLength={6000} value={a.knowledge} placeholder={"e.g. Parking at the back of the shop.\nWalk-in consultations Tue–Sat, 15 minutes, free.\nDeposit of €50 for tattoos over 2 hours."} onChange={(e) => set({ knowledge: e.target.value })} /></label>
          <TestCall clientId={clientId} />
        </div>}

        {tab === "number" && <NumberTab clientId={clientId} current={a.number} onLinked={(n) => { setA({ ...a, number: n }); setMsg(`${n} now answers for ${clientName}.`); }} />}

        {tab === "outbound" && <div className="va-body">
          <p className="cv-hint">Choose which kinds of calls the AI may make, and how. Calls only go out inside the calling hours, never to Do-not-disturb contacts, and anyone who says “don't call me” is marked Do not disturb automatically.</p>
          {triggers.map((t) => { const r = a.outbound[t.id]; return <div key={t.id} className={`va-rule ${r.enabled ? "on" : ""}`}>
            <div className="va-rule-head"><label className={`va-switch ${r.enabled ? "on" : ""}`}><input type="checkbox" role="switch" checked={r.enabled} onChange={(e) => setRule(t.id, { enabled: e.target.checked })} /><span aria-hidden="true" /><b>{t.label}</b></label><small>{t.help}</small></div>
            {r.enabled && <div className="va-rule-body">
              <label>Call by<select value={r.channel} onChange={(e) => setRule(t.id, { channel: e.target.value as Rule["channel"] })}><option value="phone">Phone call</option><option value="whatsapp">WhatsApp call (falls back to phone)</option></select></label>
              {t.id === "speed_to_lead" && <label>Wait before calling (minutes)<input type="number" min={0} max={1440} value={r.delayMin} onChange={(e) => setRule(t.id, { delayMin: Number(e.target.value) })} /></label>}
              <label className="va-wide">Script / goal for these calls<textarea rows={3} maxLength={1500} value={r.script} placeholder={t.id === "reminder" ? "e.g. Remind them to bring photo ID and arrive 10 minutes early." : t.id === "speed_to_lead" ? "e.g. Thank them for the enquiry, ask what the job is and book a free site visit." : "e.g. Be brief and friendly. Offer the earliest consultation."} onChange={(e) => setRule(t.id, { script: e.target.value })} /></label>
            </div>}
          </div>; })}
          {!a.outboundEnabled && <p className="cv-banner">Outbound calls are switched off for this account. Turn on “AI makes outbound calls” (Voice & calls) or the “Calls out” switch on the client card.</p>}
        </div>}

        {tab === "calls" && <CallLog clientId={clientId} />}

        {err && <p className="cv-error" role="alert">{err}</p>}{msg && <p className="cv-ok" role="status">{msg}</p>}
        <footer><button type="button" className="secondary-button" onClick={() => void close()}>Close</button>{tab !== "calls" && tab !== "number" && <button type="button" className="primary-button" disabled={busy || !dirty} onClick={() => void save()}>{busy ? "Saving…" : "Save"}</button>}</footer>
      </>}
    </div>
  </div>;
}

function TestCall({ clientId }: { clientId: string }) {
  const [phone, setPhone] = useState(""); const [state, setState] = useState(""); const [busy, setBusy] = useState(false);
  const go = async () => { setBusy(true); setState(""); try { const r = await api<{ message: string }>({ action: "test-call", clientId, phone }); setState(r.message); } catch (e) { setState(e instanceof Error ? e.message : "Couldn't ring you."); } finally { setBusy(false); } };
  return <div className="va-test"><h3><PhoneIcon /> Try it</h3><p className="cv-hint">Save first, then the agent rings you so you can hear it and test a booking.</p>
    <div className="va-inline"><input value={phone} placeholder="Your mobile, e.g. +353851234567" onChange={(e) => setPhone(e.target.value)} inputMode="tel" /><button type="button" className="primary-button" disabled={busy || phone.replace(/\D/g, "").length < 8} onClick={() => void go()}>{busy ? "Ringing…" : "Ring me"}</button></div>{state && <small role="status">{state}</small>}</div>;
}

function NumberTab({ clientId, current, onLinked }: { clientId: string; current: string; onLinked: (n: string) => void }) {
  const [country, setCountry] = useState("IE"); const [type, setType] = useState<"Local" | "Mobile">("Local"); const [contains, setContains] = useState("");
  const [results, setResults] = useState<Array<{ number: string; friendly: string; locality: string; sms: boolean; addressRequired: string }> | null>(null);
  const [owned, setOwned] = useState<Array<{ number: string; friendly: string; voiceUrl: string }> | null>(null);
  const [addressSid, setAddressSid] = useState(""); const [bundleSid, setBundleSid] = useState("");
  const [busy, setBusy] = useState(""); const [err, setErr] = useState("");
  const search = async () => { setBusy("search"); setErr(""); try { setResults((await api<{ numbers: NonNullable<typeof results> }>({ action: "search-numbers", clientId, country, type, contains })).numbers); } catch (e) { setErr(e instanceof Error ? e.message : "Search failed."); } finally { setBusy(""); } };
  const buy = async (n: string) => { if (!(await appConfirm(`Buy ${n} on your Twilio account? Twilio bills the monthly number fee.`))) return; setBusy(n); setErr(""); try { const r = await api<{ number: string }>({ action: "buy-number", clientId, number: n, addressSid, bundleSid }); onLinked(r.number); setResults(null); } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't buy that number."); } finally { setBusy(""); } };
  const assign = async (n: string) => { setBusy(n); setErr(""); try { const r = await api<{ number: string }>({ action: "assign-number", clientId, number: n }); onLinked(r.number); } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't use that number."); } finally { setBusy(""); } };
  const loadOwned = async () => { setBusy("owned"); setErr(""); try { setOwned((await api<{ numbers: NonNullable<typeof owned> }>(undefined, "?view=owned-numbers")).numbers); } catch (e) { setErr(e instanceof Error ? e.message : "Couldn't load your numbers."); } finally { setBusy(""); } };
  return <div className="va-body">
    <div className="va-current">{current ? <><PhoneIcon /> <b>{current}</b><span>answers for this account. Texts to it also land in Conversations.</span></> : <span>No number yet. Buy one below, or use one you already have in Twilio. The client can forward their existing line to it.</span>}</div>
    <h3>Buy a new number</h3>
    <div className="va-inline va-search"><select value={country} onChange={(e) => setCountry(e.target.value)}>{[["IE", "Ireland"], ["GB", "United Kingdom"], ["US", "United States"], ["CA", "Canada"], ["AU", "Australia"]].map(([c, l]) => <option key={c} value={c}>{l}</option>)}</select>
      <select value={type} onChange={(e) => setType(e.target.value as "Local" | "Mobile")}><option value="Local">Landline (local)</option><option value="Mobile">Mobile</option></select>
      <input value={contains} placeholder="Area code, e.g. 91 for Galway" onChange={(e) => setContains(e.target.value.replace(/[^\d*]/g, ""))} inputMode="numeric" />
      <button type="button" className="primary-button" disabled={busy === "search"} onClick={() => void search()}>{busy === "search" ? "Searching…" : "Search"}</button></div>
    {results && (results.length ? <ul className="va-numbers">{results.map((n) => <li key={n.number}><span><b>{n.friendly}</b><small>{n.locality || "—"}{n.sms ? " · SMS" : ""}{n.addressRequired !== "none" ? ` · needs a ${n.addressRequired} address` : ""}</small></span><button type="button" className="secondary-button" disabled={!!busy} onClick={() => void buy(n.number)}>{busy === n.number ? "Buying…" : "Buy"}</button></li>)}</ul> : <p className="cv-hint">No numbers found. Try another area code or Mobile.</p>)}
    <details className="va-reg"><summary>Irish / UK numbers need regulatory details?</summary><p className="cv-hint">Twilio asks for a business address (and for some numbers a regulatory bundle). Create them once in Twilio (Phone Numbers → Regulatory Compliance) and paste the IDs here.</p>
      <div className="cv-2"><label>Address SID<input value={addressSid} placeholder="ADxxxxxxxx…" onChange={(e) => setAddressSid(e.target.value.trim())} spellCheck={false} /></label><label>Bundle SID<input value={bundleSid} placeholder="BUxxxxxxxx…" onChange={(e) => setBundleSid(e.target.value.trim())} spellCheck={false} /></label></div></details>
    <h3>Use a number you already have</h3>
    {owned === null ? <button type="button" className="secondary-button" disabled={busy === "owned"} onClick={() => void loadOwned()}>{busy === "owned" ? "Loading…" : "Show my Twilio numbers"}</button>
      : <ul className="va-numbers">{owned.map((n) => <li key={n.number}><span><b>{n.number}</b><small>{n.friendly}{/voice\/incoming/.test(n.voiceUrl) ? " · AI agent" : ""}</small></span>{n.number === current ? <i className="va-tag">In use here</i> : <button type="button" className="secondary-button" disabled={!!busy} onClick={() => void assign(n.number)}>{busy === n.number ? "Linking…" : "Use for this account"}</button>}</li>)}{!owned.length && <li>No numbers in your Twilio account yet.</li>}</ul>}
    {err && <p className="cv-error" role="alert">{err}</p>}
  </div>;
}

function CallLog({ clientId }: { clientId: string }) {
  const [calls, setCalls] = useState<CallRow[] | null>(null); const [open, setOpen] = useState("");
  useEffect(() => { api<{ calls: CallRow[] }>(undefined, `?view=calls&clientId=${encodeURIComponent(clientId)}`).then((r) => setCalls(r.calls)).catch(() => setCalls([])); }, [clientId]);
  if (!calls) return <p>Loading…</p>;
  if (!calls.length) return <p className="cv-hint">No AI calls yet.</p>;
  return <ul className="va-log">{calls.map((c) => <li key={c.id}><button type="button" onClick={() => setOpen(open === c.id ? "" : c.id)}><span className={`va-dir ${c.direction}`}>{c.direction === "inbound" ? "↙" : "↗"}</span><span><b>{c.contact_name || c.contact_number}</b><small>{new Date(c.created_at).toLocaleString("en-IE", { dateStyle: "medium", timeStyle: "short" })} · {mmss(c.duration_sec)}{c.channel === "whatsapp" ? " · WhatsApp" : ""}</small></span>{c.outcome && <i className={`va-tag ${c.outcome}`}>{OUTCOME[c.outcome] || c.outcome}</i>}</button>{open === c.id && <VoiceNote callId={c.id} />}</li>)}</ul>;
}

/** The voice-note player + timestamped transcript (used in Conversations and the call log). */
export function VoiceNote({ callId, compact }: { callId: string; compact?: boolean }) {
  const [data, setData] = useState<{ call: { hasRecording: boolean; summary: string; durationSec: number; outcome: string; error: string }; transcript: Array<{ t: number; who: string; text: string }> } | null>(null);
  const [err, setErr] = useState(""); const [show, setShow] = useState(!compact);
  const [audio, setAudio] = useState<HTMLAudioElement | null>(null);
  useEffect(() => { fetch(`/api/voice-agent?view=call&id=${encodeURIComponent(callId)}`, { cache: "no-store" }).then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error || "Couldn't load the call."); setData(j); }).catch((e) => setErr(e.message)); }, [callId]);
  if (err) return <small className="va-note">{err}</small>;
  if (!data) return <small className="va-note">Loading call…</small>;
  const seek = (ms: number) => { if (audio) { audio.currentTime = ms / 1000; void audio.play().catch(() => undefined); } };
  return <div className="va-voicenote">
    {data.call.hasRecording ? <audio controls preload="none" src={`/api/voice-agent?view=recording&id=${encodeURIComponent(callId)}`} ref={setAudio} /> : <small className="va-note">{data.call.error || "No recording for this call."}</small>}
    {data.transcript.length > 0 && <><button type="button" className="text-button" onClick={() => setShow(!show)}>{show ? "Hide transcript" : `Transcript (${data.transcript.length} lines)`}</button>
      {show && <ol className="va-transcript">{data.transcript.map((l, i) => <li key={i} className={l.who}><button type="button" className="va-ts" title="Play from here" onClick={() => seek(l.t)} disabled={!data.call.hasRecording}>{mmss(l.t / 1000)}</button><b>{l.who === "ai" ? "AI" : "Caller"}</b><span>{l.text}</span></li>)}</ol>}</>}
  </div>;
}

/** "AI call" button for a contact or conversation. */
export function AiCallButton({ clientId, phone, name, contactId, channel, className }: { clientId: string; phone: string; name?: string; contactId?: string; channel?: "phone" | "whatsapp"; className?: string }) {
  const [state, setState] = useState(""); const [busy, setBusy] = useState(false);
  const go = async () => {
    const purpose = await appPrompt(`What should the AI call ${name || phone} about? Leave empty to use the account's default script.`, "");
    if (purpose === null) return;
    setBusy(true); setState("");
    try { const r = await api<{ message: string }>({ action: "call-contact", clientId, phone, name, contactId, purpose, channel }); setState(r.message); } catch (e) { setState(e instanceof Error ? e.message : "Couldn't start the call."); } finally { setBusy(false); }
  };
  return <span className="va-callbtn-wrap"><button type="button" className={className || "secondary-button va-callbtn"} disabled={busy || !phone} onClick={() => void go()} title="The AI agent rings this person and saves the call here as a voice note"><AiEyesIcon /> {busy ? "Calling…" : "AI call"}</button>{state && <small className="va-note" role="status">{state}</small>}</span>;
}
