"use client";
import { AiEyesIcon } from "./ai-eyes-icon";

import { lazy, Suspense, useCallback, useEffect, useRef, useState } from "react";
import { useSampleData } from "@/hooks/use-sample-data";
import { renderTemplate, windowState, type WaTemplate } from "@/lib/conversations/whatsapp";
const QuickBook = lazy(() => import("./scheduling-view").then((m) => ({ default: m.QuickBook })));
const VoiceNote = lazy(() => import("./ai-agent-panel").then((m) => ({ default: m.VoiceNote })));
const AiCallButton = lazy(() => import("./ai-agent-panel").then((m) => ({ default: m.AiCallButton })));
const VOICE_RE = /^\[\[voice:([A-Za-z0-9-]{8,64})\]\]\s?/;
const MEDIA_RE = /(https:\/\/\S+\.(?:jpe?g|png|webp|gif)(?:\?\S*)?|\/api\/marketing-public\/media\?f=\S+)/gi;
const photosIn = (body: string) => [...body.matchAll(MEDIA_RE)].map((m) => m[1]);

type Thread = { id: string; client_id: string; channel: "sms" | "whatsapp" | "email"; our_number: string; contact: string; contact_name: string; bot_on: number; status: "open" | "handoff" | "closed"; unread: number; last_at: string; last_preview: string; last_in_at?: string };
type Msg = { id: string; direction: "in" | "out"; sender: "customer" | "bot" | "staff"; body: string; error?: string; status?: string; created_at: string };
type WaNumber = { number: string; clientId: string; label: string };
type NumberCfg = { number: string; channel: "sms" | "whatsapp"; clientId: string; label: string; info: string };
type Settings = { accountSid: string; tokenLast4: string; hasToken: boolean; numbers: NumberCfg[]; botEnabled: boolean; botName: string; businessInfo: string; botRules: string; handoffMessage: string };
type ClientLite = { id: string; name: string };

async function call<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
  const json = await res.json().catch(() => ({})) as T & { error?: string };
  if (!res.ok) throw new Error(json.error || "Something went wrong.");
  return json;
}
const ago = (iso: string) => { const s = Math.max(1, (Date.now() - new Date(iso).getTime()) / 1000); return s < 60 ? "now" : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : new Date(iso).toLocaleDateString("en-GB", { day: "numeric", month: "short" }); };
const title = (t: Thread) => t.contact_name || t.contact;

// Demo inbox for the "Sample data" switch: a few realistic chats for this account (nothing is sent or saved).
function sampleInbox(clientId: string, clientName: string, gallery: string[]): { threads: Thread[]; messages: Record<string, Msg[]> } {
  const tattoo = /tattoo|ink|poppy|piercing/i.test(clientName), roof = /roof/i.test(clientName);
  const pic = (i: number) => gallery.length ? gallery[i % gallery.length] : "";
  const at = (mins: number) => new Date(Date.now() - mins * 60_000).toISOString();
  const chats: Array<{ name: string; contact: string; channel: Thread["channel"]; lines: Array<[Msg["direction"], Msg["sender"], string, number]>; unread: number; status: Thread["status"] }> = tattoo ? [
    { name: "Aoife Brennan", contact: "+353871234567", channel: "whatsapp", unread: 2, status: "open", lines: [["in", "customer", "Hi! I'd love a fine line floral piece on my forearm, about palm size 🌸", 52], ["out", "bot", "Hi Aoife! That sounds lovely. Do you have a reference photo? And any day that suits best?", 51], ["in", "customer", `Here's the idea ${pic(0)}`.trim(), 14], ["in", "customer", `And this one for the shading ${pic(1)}`.trim(), 12]] },
    { name: "Ciarán Doyle", contact: "+353861112223", channel: "sms", unread: 0, status: "handoff", lines: [["in", "customer", "How much would a cover-up on my shoulder be? Old tribal piece", 300], ["out", "bot", "Cover-ups depend on size and the old ink. One of the artists will take a look and come back to you.", 299], ["in", "customer", "[[voice:sample-call-1]] 📞 Incoming AI call · 1:48 · Booked\nCiarán rang about the cover-up; the AI booked a free consultation for Thursday at 2pm.", 295], ["in", "customer", `Photo of it ${pic(2)}`.trim(), 290]] },
    { name: "Megan Walsh", contact: "+353879998887", channel: "whatsapp", unread: 0, status: "open", lines: [["in", "customer", "Can I book a piercing for Saturday afternoon?", 1500], ["out", "staff", "Yes! We have 2pm or 3:30pm free on Saturday.", 1490], ["in", "customer", "2pm please 🙌", 1480]] },
  ] : [
    { name: "Mary Burke", contact: "+353871234567", channel: "whatsapp", unread: 2, status: "open", lines: [["in", "customer", roof ? "Hi, we've a leak coming in over the kitchen after the storm" : "Hi, I'd like a quote please", 52], ["out", "bot", "Sorry to hear that Mary! Could you send a photo and your Eircode? We'll get someone out.", 51], ["in", "customer", `Here it is ${pic(0)}`.trim(), 14], ["in", "customer", "H91 X2Y3", 12]] },
    { name: "John Doyle", contact: "+353861112223", channel: "sms", unread: 0, status: "handoff", lines: [["in", "customer", roof ? "How much for gutter cleaning on a semi-d?" : "What are your prices?", 300], ["out", "bot", "It depends on the job. Someone from the team will come back to you shortly.", 299], ["in", "customer", "[[voice:sample-call-2]] 📞 Incoming AI call · 2:05 · Booked\nJohn rang about gutter cleaning on a semi-d; the AI booked a free quote visit for Thursday at 10am.", 280]] },
    { name: "Sinéad Kelly", contact: "+353879998887", channel: "whatsapp", unread: 0, status: "open", lines: [["in", "customer", "Are you free Thursday morning for a look?", 1500], ["out", "staff", "Thursday at 10 works, see you then!", 1490]] },
  ];
  const threads: Thread[] = []; const messages: Record<string, Msg[]> = {};
  chats.forEach((c, i) => { const id = `sample-thread-${i}`; const last = c.lines[c.lines.length - 1];
    const lastIn = [...c.lines].reverse().find((l) => l[0] === "in" && !VOICE_RE.test(l[2]));
    threads.push({ id, client_id: clientId, channel: c.channel, our_number: "", contact: c.contact, contact_name: c.name, bot_on: c.status === "handoff" ? 0 : 1, status: c.status, unread: c.unread, last_at: at(last[3]), last_preview: last[2].replace(MEDIA_RE, "📷 Photo").slice(0, 80), last_in_at: lastIn ? at(lastIn[3]) : "" });
    messages[id] = c.lines.map(([direction, sender, body, mins], j) => ({ id: `${id}-${j}`, direction, sender, body, status: direction === "out" ? "read" : "", created_at: at(mins) })); });
  return { threads, messages };
}

export function ConversationsView({ scopeClientId, clients }: { scopeClientId: string; clients: ClientLite[] }) {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [configured, setConfigured] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"all" | "unread" | "handoff" | "notifications">("all");
  const [activeId, setActiveId] = useState("");
  const [active, setActive] = useState<Thread | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [emailFrom, setEmailFrom] = useState("");
  const [waNumbers, setWaNumbers] = useState<WaNumber[]>([]);
  const [newChat, setNewChat] = useState(false);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [booking, setBooking] = useState<null | { name: string; phone: string; email: string; images: string[]; notes: string }>(null);
  const [zoom, setZoom] = useState("");
  const [sample] = useSampleData();
  const [demo, setDemo] = useState<{ threads: Thread[]; messages: Record<string, Msg[]> } | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  // Fit the inbox to the window so the reply box is always visible without scrolling the page.
  const gridRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const fit = () => { const el = gridRef.current; if (!el) return; const top = el.getBoundingClientRect().top + window.scrollY; const footer = document.querySelector(".f2b-mobile-tabs, .tn-mobile-footer") as HTMLElement | null; const room = window.innerHeight - (top - window.scrollY) - 16 - (footer && footer.offsetHeight && getComputedStyle(footer).display !== "none" ? footer.offsetHeight : 0); el.style.height = `${Math.max(380, room)}px`; };
    fit(); const t = window.setTimeout(fit, 300);
    window.addEventListener("resize", fit);
    return () => { window.clearTimeout(t); window.removeEventListener("resize", fit); };
  });
  const clientName = (id: string) => clients.find((c) => c.id === id)?.name || "";
  useEffect(() => {
    if (!sample) { setDemo(null); return; }
    let live = true; const name = clientName(scopeClientId) || clients[0]?.name || "";
    const build = (gallery: string[]) => { if (live) setDemo(sampleInbox(scopeClientId, name, gallery)); };
    build([]);
    if (scopeClientId) fetch(`/api/scheduling?clientId=${encodeURIComponent(scopeClientId)}&view=site`).then((r) => r.ok ? r.json() : {}).then((v: { gallery?: string[]; work?: Record<string, string[]> }) => build([...(Object.values(v.work || {}).flat()), ...(v.gallery || [])].slice(0, 12))).catch(() => undefined);
    return () => { live = false; };
  }, [sample, scopeClientId]); // eslint-disable-line react-hooks/exhaustive-deps

  const loadThreads = useCallback(async () => {
    try { const r = await call<{ threads: Thread[]; configured: boolean; emailFrom?: string; waNumbers?: WaNumber[] }>(`/api/conversations?view=threads&clientId=${encodeURIComponent(scopeClientId || "agency")}`); setThreads(r.threads); setConfigured(r.configured); setEmailFrom(r.emailFrom || ""); setWaNumbers(r.waNumbers || []); setError(""); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not load conversations."); } finally { setLoading(false); }
  }, [scopeClientId]);
  const loadThread = useCallback(async (id: string) => {
    if (id.startsWith("sample-thread-")) return;
    try { const r = await call<{ thread: Thread; messages: Msg[] }>(`/api/conversations?view=thread&id=${encodeURIComponent(id)}`); setActive(r.thread); setMessages(r.messages); } catch (e) { setError(e instanceof Error ? e.message : "Could not open that conversation."); }
  }, []);
  useEffect(() => { setLoading(true); setActiveId(""); setActive(null); void loadThreads(); }, [loadThreads]);
  useEffect(() => { const t = setInterval(() => { if (document.visibilityState === "visible") { void loadThreads(); if (activeId) void loadThread(activeId); } }, 7000); return () => clearInterval(t); }, [loadThreads, loadThread, activeId]);
  useEffect(() => { if (activeId) void loadThread(activeId); }, [activeId, loadThread]);
  useEffect(() => { if (demo && activeId.startsWith("sample-thread-")) { setActive(demo.threads.find((t) => t.id === activeId) || null); setMessages(demo.messages[activeId] || []); } }, [activeId, demo]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [messages.length, activeId]);

  const act = async (body: Record<string, unknown>) => { if (activeId.startsWith("sample-thread-")) { if (body.action === "send") setMessages((m) => [...m, { id: `local-${Date.now()}`, direction: "out", sender: "staff", body: String(body.body || ""), created_at: new Date().toISOString() }]); return; } setBusy(true); setError(""); try { await call("/api/conversations", body); await loadThreads(); if (activeId) await loadThread(activeId); } catch (e) { setError(e instanceof Error ? e.message : "Something went wrong."); } finally { setBusy(false); } };
  const [subject, setSubject] = useState("");
  const send = async () => { const body = text.trim(); if (!body || !active) return; setText(""); if (active.channel === "email") { const last = [...messages].reverse().find((m) => /^Subject: /m.test(m.body)); const prev = last ? ((last.body.match(/^Subject: (.*)$/m) || [])[1] || "") : ""; await act({ action: "send", id: active.id, body, subject: subject.trim() || (prev ? (prev.startsWith("Re:") ? prev : `Re: ${prev}`) : "") }); setSubject(""); return; } await act({ action: "send", id: active.id, body }); };
  const draft = async () => { if (!active) return; setBusy(true); setError(""); try { const r = await call<{ draft: string }>("/api/conversations", { action: "draft", id: active.id }); setText(r.draft); } catch (e) { setError(e instanceof Error ? e.message : "No draft."); } finally { setBusy(false); } };

  // Emails the system sends (lead alerts, invoices, task emails…) live under Notifications, not mixed into live chats.
  const allThreads = demo ? [...demo.threads, ...threads] : threads;
  const shown = allThreads.filter((t) => filter === "notifications" ? t.channel === "email" : filter === "all" ? t.status !== "closed" && t.channel !== "email" : filter === "unread" ? t.unread > 0 : t.status === "handoff");
  const notes = allThreads.filter((t) => t.channel === "email").length;
  const unread = allThreads.reduce((n, t) => n + (t.unread > 0 ? 1 : 0), 0);

  return <section className="cv" aria-label="Conversations">
    <header className="cv-head"><div><p className="eyebrow">💬 CONVERSATIONS{scopeClientId ? ` · ${clientName(scopeClientId).toUpperCase()}` : ""}</p><h1>Customer conversations</h1><p>SMS, WhatsApp and every email the system sends, in one inbox.</p></div>
      <div className="cv-head-actions">{waNumbers.length > 0 && <button type="button" className="primary-button" onClick={() => setNewChat(true)}>＋ New WhatsApp chat</button>}<button type="button" className="secondary-button" onClick={() => setSettingsOpen(true)}>⚙️ Conversation settings</button></div></header>
    {error && <div className="cv-error" role="alert">{error}</div>}
    {loading ? <div className="empty-state" role="status">Loading conversations…</div> : <>{!configured && <div className="cv-banner">💬 Emails the system sends show here already. To also text and WhatsApp customers, <button type="button" className="text-button" onClick={() => setSettingsOpen(true)}>connect Twilio</button>.</div>}
    <div className={`cv-grid ${active ? "has-thread" : ""}`} ref={gridRef}>
      <aside className="cv-list" aria-label="Conversation list">
        <div className="cv-filters" role="tablist">{([["all", "Open"], ["unread", `Unread${unread ? ` (${unread})` : ""}`]] as const).map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={filter === k} className={filter === k ? "on" : ""} onClick={() => setFilter(k)}>{l}</button>)}<button type="button" role="tab" aria-selected={filter === "notifications"} className={`cv-bell ${filter === "notifications" ? "on" : ""}`} onClick={() => setFilter("notifications")} aria-label={`Notifications${notes ? ` (${notes})` : ""}`} title="Notifications"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9" /><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0" /></svg>{notes ? <b>{notes > 99 ? "99+" : notes}</b> : null}</button></div>
        <div className="cv-rows">{shown.length === 0 ? <p className="cv-none">{threads.length === 0 ? "Nothing yet. Emails the system sends, and customer texts, show up here." : filter === "notifications" ? "No notifications yet. Lead alerts and other emails the system sends will show here." : "Nothing here."}</p> : shown.map((t) => <button type="button" key={t.id} className={`cv-row ${activeId === t.id ? "on" : ""} ${t.unread ? "unread" : ""}`} onClick={() => setActiveId(t.id)}>
          <span className={`cv-avatar ${t.channel}`}>{t.channel === "whatsapp" ? "WA" : t.channel === "email" ? "✉" : "SMS"}</span>
          <span className="cv-row-main"><b>{title(t)}</b><small>{(t.last_preview || "…").replace(VOICE_RE, "")}</small>{!scopeClientId && t.client_id && <em>{clientName(t.client_id)}</em>}</span>
          <span className="cv-row-side"><small>{ago(t.last_at)}</small>{t.status === "handoff" ? <i className="cv-pill hand">Needs you</i> : t.unread ? <i className="cv-pill">{t.unread}</i> : t.bot_on ? <i className="cv-bot" title="AI bot is replying"><AiEyesIcon /></i> : null}</span></button>)}</div>
      </aside>
      <div className="cv-chat">{!active ? <div className="cv-pick"><span>💬</span><p>Choose a conversation</p></div> : <>
        <div className="cv-chat-head"><button type="button" className="cv-back" aria-label="Back to conversations" onClick={() => setActive(null)}>‹</button><div><b>{title(active)}</b><small>{active.channel === "whatsapp" ? "WhatsApp" : active.channel === "email" ? "Email sent by the system" : "SMS"} · {active.contact}{active.client_id ? ` · ${clientName(active.client_id)}` : ""}</small>{active.channel === "whatsapp" && (() => { const w = windowState(active.last_in_at); return <span className={`cv-window ${w.open ? "open" : "closed"}`} title="WhatsApp lets you reply freely for 24 hours after the customer's last message. After that, send an approved template.">{w.open ? `● Free replies · ${w.label}` : "○ 24-hour window closed · template needed"}</span>; })()}</div>
          {active.channel !== "email" && <div className="cv-chat-actions">
            <button type="button" className="primary-button cv-book" onClick={() => { const pics = messages.filter((m) => m.direction === "in").flatMap((m) => photosIn(m.body)).reverse().slice(0, 3); const lastAsk = [...messages].reverse().find((m) => m.direction === "in" && m.body.replace(MEDIA_RE, "").trim().length > 8); setBooking({ name: active.contact_name || "", phone: active.contact, email: "", images: pics, notes: lastAsk ? `From ${active.channel === "whatsapp" ? "WhatsApp" : "SMS"}: “${lastAsk.body.replace(MEDIA_RE, "").trim().slice(0, 300)}”` : "" }); }}>📅 Book</button>
            {!active.id.startsWith("sample-") && <Suspense fallback={null}><AiCallButton clientId={active.client_id || ""} phone={active.contact} name={active.contact_name} channel={active.channel === "whatsapp" ? "whatsapp" : undefined} /></Suspense>}<label className={`cv-switch ${active.bot_on ? "on" : ""}`} title="When on, the AI bot answers new messages"><input type="checkbox" checked={!!active.bot_on} disabled={busy} onChange={(e) => void act({ action: "toggle-bot", id: active.id, on: e.target.checked })} /><span><AiEyesIcon /> Bot {active.bot_on ? "on" : "off"}</span></label>
            {active.status !== "closed" ? <button type="button" className="secondary-button" disabled={busy} onClick={() => void act({ action: "status", id: active.id, status: "closed" })}>✓ Close</button> : <button type="button" className="secondary-button" disabled={busy} onClick={() => void act({ action: "status", id: active.id, status: "open" })}>Reopen</button>}</div>}</div>
        {active.status === "handoff" && <div className="cv-banner">🙋 The bot handed this one to you. Reply below, or switch the bot back on.</div>}
        <div className="cv-msgs">{active.channel === "email" ? messages.map((m) => { const subject = (m.body.match(/^Subject: (.*)$/m) || [])[1] || "(no subject)"; const body = m.body.replace(/^Subject: .*\n\n?/, ""); return <article className="cv-email" key={m.id}><header><h3>{subject}</h3><dl><div><dt>From</dt><dd>{emailFrom || "System sender"}{m.sender === "staff" ? " · sent by you" : " · automatic"}</dd></div><div><dt>To</dt><dd>{active.contact_name ? `${active.contact_name} <${active.contact}>` : active.contact}</dd></div><div><dt>Sent</dt><dd>{new Date(m.created_at).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" })}</dd></div></dl></header><div className="cv-email-body">{body}</div>{m.error && <small className="cv-fail">Not delivered: {m.error}</small>}</article>; }) : messages.map((m) => <div key={m.id} className={`cv-msg ${m.direction === "in" ? "in" : "out"} ${m.sender}`}><div className={`cv-bubble${VOICE_RE.test(m.body) ? " cv-voice" : ""}`}>{m.body.replace(VOICE_RE, "").replace(MEDIA_RE, "").replace(/📷\s*$/gm, "").trim()}{photosIn(m.body).length > 0 && <span className="cv-photos">{photosIn(m.body).map((u) => <button key={u} type="button" className="cv-photo" onClick={() => setZoom(u)} aria-label="Open photo"><img src={u} alt="" loading="lazy" /></button>)}</span>}{VOICE_RE.test(m.body) && !m.id.startsWith("sample-") && <Suspense fallback={null}><VoiceNote callId={(m.body.match(VOICE_RE) || [])[1]} compact /></Suspense>}{m.error && <small className="cv-fail">Not delivered: {m.error}</small>}</div><small>{m.direction === "out" && m.status && <Ticks status={m.status} />}{VOICE_RE.test(m.body) ? <><AiEyesIcon /> AI phone agent</> : m.sender === "bot" && active.channel === "email" ? "Sent automatically" : m.sender === "bot" ? <><AiEyesIcon /> AI bot</> : m.sender === "staff" ? "You" : title(active)} · {new Date(m.created_at).toLocaleString("en-GB", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" })}</small></div>)}<div ref={endRef} /></div>
{active.channel === "email" ? <form className="cv-compose cv-email-compose" onSubmit={(e) => { e.preventDefault(); void send(); }}><input value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Subject (leave empty to reply to the last email)" maxLength={200} /><textarea value={text} rows={4} maxLength={10000} placeholder={`Write an email to ${active.contact}…`} onChange={(e) => setText(e.target.value)} /><div><small className="cv-note">Sends from {emailFrom || "your system address"} to {active.contact}.</small><button type="submit" className="primary-button" disabled={busy || !text.trim()}>Send email</button></div></form> : active.channel === "whatsapp" && !windowState(active.last_in_at).open ? <TemplateComposer key={active.id} thread={active} clientName={clientName(active.client_id)} demo={active.id.startsWith("sample-")} onSent={async () => { await loadThreads(); await loadThread(active.id); }} /> : <>        <form className="cv-compose" onSubmit={(e) => { e.preventDefault(); void send(); }}>
          <textarea value={text} rows={2} maxLength={1500} placeholder="Write a reply… (Enter to send, Shift+Enter for a new line)" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }} />
          <div><button type="button" className="secondary-button" disabled={busy} onClick={() => void draft()}>✨ Draft with AI</button><button type="submit" className="primary-button" disabled={busy || !text.trim()}>Send</button></div>
        </form>
        <p className="cv-note">Sending a reply turns the bot off for this customer so you don’t talk over each other.</p></>}</>}
      </div>
    </div></>}
    {booking && <Suspense fallback={null}><QuickBook scopeClientId={active?.client_id || scopeClientId} prefill={booking} onClose={() => setBooking(null)} onBooked={() => setError("")} /></Suspense>}
    {zoom && <div className="cv-zoom" role="dialog" aria-modal="true" onMouseDown={(e) => { if (e.target === e.currentTarget) setZoom(""); }}><button type="button" aria-label="Close" onClick={() => setZoom("")}>×</button><img src={zoom} alt="" /></div>}
    {newChat && <NewChat numbers={waNumbers} clients={clients} scopeClientId={scopeClientId} onClose={() => setNewChat(false)} onStarted={async (id) => { setNewChat(false); setFilter("all"); await loadThreads(); setActiveId(id); }} />}
    {settingsOpen && <ConversationSettings clients={clients} onClose={() => { setSettingsOpen(false); void loadThreads(); }} />}
  </section>;
}

/** WhatsApp-style delivery ticks: ✓ sent, ✓✓ delivered, blue ✓✓ read, ! failed. */
function Ticks({ status }: { status: string }) {
  const s = status.toLowerCase();
  if (s === "failed" || s === "undelivered") return <span className="cv-ticks failed" title="Not delivered">!</span>;
  if (s === "read") return <span className="cv-ticks read" title="Read">✓✓</span>;
  if (s === "delivered") return <span className="cv-ticks" title="Delivered">✓✓</span>;
  if (s === "sent") return <span className="cv-ticks" title="Sent">✓</span>;
  return <span className="cv-ticks pending" title="Sending">🕓</span>;
}

/** Outside the 24-hour window WhatsApp only accepts approved templates: pick one, fill its blanks, preview, send. */
function TemplateComposer({ thread, clientName, demo, onSent }: { thread: Thread; clientName: string; demo: boolean; onSent: () => Promise<void> }) {
  const [list, setList] = useState<WaTemplate[] | null>(null);
  const [pick, setPick] = useState("");
  const [vals, setVals] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  useEffect(() => {
    if (demo) { setList([{ sid: "HX00000000000000000000000000000000", name: "follow_up", language: "en", category: "utility", body: "Hi {{1}}, just following up on your enquiry with {{2}}. Reply here and we'll pick it up.", variables: ["1", "2"], defaults: {} }]); return; }
    call<{ templates: WaTemplate[] }>("/api/conversations", { action: "templates" }).then((r) => setList(r.templates)).catch((e) => { setList([]); setErr(e instanceof Error ? e.message : "Couldn't load templates."); });
  }, [demo]);
  const t = list?.find((x) => x.sid === pick) || null;
  const choose = (sid: string) => {
    setPick(sid); setErr("");
    const next = list?.find((x) => x.sid === sid); if (!next) return;
    // Pre-fill the usual blanks: {{1}} = customer's first name, {{2}} = business name.
    const first = (thread.contact_name || "").split(/\s+/)[0] || "";
    const v: Record<string, string> = {};
    next.variables.forEach((k, i) => { v[k] = i === 0 && first ? first : i === 1 && clientName ? clientName : ""; });
    setVals(v);
  };
  const send = async () => {
    if (!t) return; setBusy(true); setErr("");
    try { if (!demo) await call("/api/conversations", { action: "send-template", id: thread.id, contentSid: t.sid, variables: vals, name: t.name, body: t.body }); await onSent(); setPick(""); }
    catch (e) { setErr(e instanceof Error ? e.message : "Couldn't send."); } finally { setBusy(false); }
  };
  const missing = t ? t.variables.filter((k) => !String(vals[k] || "").trim()) : [];
  return <div className="cv-compose cv-template">
    <p className="cv-note"><b>The 24-hour window has closed.</b> WhatsApp only lets you restart this chat with an approved template. Once {thread.contact_name || "the customer"} replies, you can type freely again.</p>
    {list === null ? <p className="cv-note">Loading your templates…</p> : list.length === 0 ? <p className="cv-note">{err || "No approved templates yet. Create one in Twilio → Messaging → Content Template Builder (a simple utility follow-up gets approved fastest), then it shows here."}</p> : <>
      <label>Template<select value={pick} onChange={(e) => choose(e.target.value)}><option value="">Choose a template…</option>{list.map((x) => <option key={x.sid} value={x.sid}>{x.name}{x.category ? ` · ${x.category}` : ""}{x.language ? ` · ${x.language}` : ""}</option>)}</select></label>
      {t && <>{t.variables.length > 0 && <div className="cv-template-vars">{t.variables.map((k) => <label key={k}>{`{{${k}}}`}<input value={vals[k] || ""} maxLength={500} onChange={(e) => setVals({ ...vals, [k]: e.target.value })} /></label>)}</div>}
        <div className="cv-template-preview" aria-label="Preview">{renderTemplate(t.body, vals)}</div>
        <div><small className="cv-note">{t.category === "marketing" ? "Marketing templates cost more and need the customer's opt-in." : "Charged by Meta per template sent."}</small><button type="button" className="primary-button" disabled={busy || missing.length > 0} onClick={() => void send()}>{busy ? "Sending…" : "Send template"}</button></div></>}
      {err && <p className="cv-error" role="alert">{err}</p>}</>}
  </div>;
}

/** Start a WhatsApp chat with a new customer: each customer gets their own thread. The first message has to be a template. */
function NewChat({ numbers, clients, scopeClientId, onClose, onStarted }: { numbers: WaNumber[]; clients: ClientLite[]; scopeClientId: string; onClose: () => void; onStarted: (id: string) => void }) {
  const [from, setFrom] = useState(numbers[0]?.number || "");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState("");
  const cfg = numbers.find((n) => n.number === from) || numbers[0];
  const label = (n: WaNumber) => `${n.number} · ${clients.find((c) => c.id === n.clientId)?.name || n.label || "Agency"}`;
  const start = async () => {
    if (!cfg) return; setBusy(true); setErr("");
    try { const r = await call<{ id: string }>("/api/conversations", { action: "start", clientId: cfg.clientId || (scopeClientId && scopeClientId !== "agency" ? scopeClientId : ""), from: cfg.number, phone, name }); onStarted(r.id); }
    catch (e) { setErr(e instanceof Error ? e.message : "Couldn't start the chat."); } finally { setBusy(false); }
  };
  return <div className="cv-modal" role="dialog" aria-label="New WhatsApp chat" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><div className="cv-dialog cv-dialog-sm">
    <header><h2>New WhatsApp chat</h2><button type="button" className="cv-x" aria-label="Close" onClick={onClose}>✕</button></header>
    {numbers.length > 1 && <label>Send from<select value={from} onChange={(e) => setFrom(e.target.value)}>{numbers.map((n) => <option key={n.number + n.clientId} value={n.number}>{label(n)}</option>)}</select></label>}
    <label>Customer name<input value={name} maxLength={80} placeholder="e.g. Mary Burke" onChange={(e) => setName(e.target.value)} /></label>
    <label>WhatsApp number<input value={phone} inputMode="tel" placeholder="+353871234567" onChange={(e) => setPhone(e.target.value)} /></label>
    <p className="cv-hint">If this customer already has a chat, it opens that one. Your first message has to be an approved template; once they reply you can chat freely for 24 hours.</p>
    {err && <p className="cv-error" role="alert">{err}</p>}
    <footer><button type="button" className="secondary-button" onClick={onClose}>Cancel</button><button type="button" className="primary-button" disabled={busy || !phone.trim()} onClick={() => void start()}>{busy ? "Opening…" : "Open chat"}</button></footer>
  </div></div>;
}

function ConversationSettings({ clients, onClose }: { clients: ClientLite[]; onClose: () => void }) {
  const [s, setS] = useState<Settings | null>(null);
  const [token, setToken] = useState("");
  const [webhook, setWebhook] = useState("");
  const [ready, setReady] = useState(true);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [err, setErr] = useState("");
  useEffect(() => { call<{ settings: Settings; webhookUrl: string; secureStorageReady: boolean }>("/api/conversations?view=settings").then((r) => { setS(r.settings); setWebhook(r.webhookUrl); setReady(r.secureStorageReady); }).catch((e) => setErr(e.message)); }, []);
  if (!s) return <div className="cv-modal"><div className="cv-dialog">{err ? <p className="cv-error">{err}</p> : <p>Loading…</p>}<button className="secondary-button" onClick={onClose}>Close</button></div></div>;
  const set = (patch: Partial<Settings>) => { setMsg(""); setS({ ...s, ...patch }); };
  const setNum = (i: number, patch: Partial<NumberCfg>) => set({ numbers: s.numbers.map((n, j) => j === i ? { ...n, ...patch } : n) });
  const save = async () => { setBusy(true); setErr(""); setMsg(""); try { const r = await call<{ settings: Settings }>("/api/conversations", { action: "save-settings", accountSid: s.accountSid, authToken: token || undefined, numbers: s.numbers, botEnabled: s.botEnabled, botName: s.botName, businessInfo: s.businessInfo, botRules: s.botRules, handoffMessage: s.handoffMessage }); setS(r.settings); setToken(""); setMsg("Saved."); } catch (e) { setErr(e instanceof Error ? e.message : "Could not save."); } finally { setBusy(false); } };
  return <div className="cv-modal" role="dialog" aria-label="Conversation settings" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><div className="cv-dialog">
    <header><h2>Conversation settings</h2><button type="button" className="cv-x" aria-label="Close" onClick={onClose}>✕</button></header>
    <div className="cv-steps"><h3>Set up in 3 steps</h3><ol><li>In Twilio, copy your <b>Account SID</b> and <b>Auth Token</b> (Console home) and paste them below.</li><li>Add each phone number or WhatsApp number below. Use the international format, like +353851234567. Choose which client it belongs to.</li><li>In Twilio, open the number (or WhatsApp sender) and set <b>“A message comes in”</b> to this address, with method <b>HTTP POST</b>. For WhatsApp, use your approved WhatsApp sender (Twilio → Messaging → Senders → WhatsApp senders); delivery ticks are set up automatically:
      <div className="cv-copy"><code>{webhook}</code><button type="button" className="secondary-button" onClick={() => void navigator.clipboard?.writeText(webhook).then(() => setMsg("Webhook address copied."))}>Copy</button></div></li></ol></div>
    {!ready && <p className="cv-error">Secure storage isn’t set up on the server yet, so the Auth Token can’t be saved. The owner needs to add the app’s credential-encryption key once.</p>}
    <h3>Twilio account</h3>
    <div className="cv-2"><label>Account SID<input value={s.accountSid} placeholder="ACxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx" onChange={(e) => set({ accountSid: e.target.value })} spellCheck={false} /></label>
      <label>Auth Token<input type="password" value={token} placeholder={s.hasToken ? `Saved (ends ${s.tokenLast4}). Paste a new one to replace it.` : "Paste your Auth Token"} onChange={(e) => setToken(e.target.value)} autoComplete="new-password" /></label></div>
    <h3>Numbers</h3>
    {s.numbers.map((n, i) => <div className="cv-num" key={i}>
      <div className="cv-3"><label>Number<input value={n.number} placeholder="+353851234567" onChange={(e) => setNum(i, { number: e.target.value })} /></label>
        <label>Type<select value={n.channel} onChange={(e) => setNum(i, { channel: e.target.value as "sms" | "whatsapp" })}><option value="sms">SMS</option><option value="whatsapp">WhatsApp</option></select></label>
        <label>Client<select value={n.clientId} onChange={(e) => setNum(i, { clientId: e.target.value })}><option value="">Agency (no client)</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label></div>
      <label>What the bot should know about this business (services, areas, hours, prices you’re happy to share)<textarea rows={3} value={n.info} onChange={(e) => setNum(i, { info: e.target.value })} /></label>
      <button type="button" className="cv-remove" onClick={() => set({ numbers: s.numbers.filter((_, j) => j !== i) })}>Remove this number</button></div>)}
    <button type="button" className="secondary-button" onClick={() => set({ numbers: [...s.numbers, { number: "", channel: "sms", clientId: "", label: "", info: "" }] })}>＋ Add a number</button>
    <h3>AI bot</h3>
    <label className="cv-check"><input type="checkbox" checked={s.botEnabled} onChange={(e) => set({ botEnabled: e.target.checked })} /> Let the AI bot reply to new customer messages</label>
    <div className="cv-2"><label>Bot name (optional)<input value={s.botName} maxLength={60} placeholder="e.g. Sam from Pro Roofers" onChange={(e) => set({ botName: e.target.value })} /></label>
      <label>Message when handing over to you<input value={s.handoffMessage} maxLength={400} placeholder="Thanks, I'm passing this to the team…" onChange={(e) => set({ handoffMessage: e.target.value })} /></label></div>
    <label>General rules for the bot (optional)<textarea rows={3} value={s.botRules} placeholder="e.g. Always offer a free quote. Never discuss prices." onChange={(e) => set({ botRules: e.target.value })} /></label>
    <p className="cv-hint">The bot only uses the information you give it, and hands over to you if a customer is upset, asks for a person, or it isn’t sure. It uses the AI key you already saved in Settings.</p>
    {err && <p className="cv-error" role="alert">{err}</p>}{msg && <p className="cv-ok" role="status">{msg}</p>}
    <footer><button type="button" className="secondary-button" onClick={onClose}>Close</button><button type="button" className="primary-button" disabled={busy} onClick={() => void save()}>{busy ? "Saving…" : "Save settings"}</button></footer>
  </div></div>;
}
