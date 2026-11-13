"use client";
import { AiEyesIcon } from "./ai-eyes-icon";

import { useCallback, useEffect, useRef, useState } from "react";

type Thread = { id: string; client_id: string; channel: "sms" | "whatsapp" | "email"; our_number: string; contact: string; contact_name: string; bot_on: number; status: "open" | "handoff" | "closed"; unread: number; last_at: string; last_preview: string };
type Msg = { id: string; direction: "in" | "out"; sender: "customer" | "bot" | "staff"; body: string; error?: string; created_at: string };
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

export function ConversationsView({ scopeClientId, clients }: { scopeClientId: string; clients: ClientLite[] }) {
  const [threads, setThreads] = useState<Thread[]>([]);
  const [configured, setConfigured] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"all" | "unread" | "handoff">("all");
  const [activeId, setActiveId] = useState("");
  const [active, setActive] = useState<Thread | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const clientName = (id: string) => clients.find((c) => c.id === id)?.name || "";

  const loadThreads = useCallback(async () => {
    try { const r = await call<{ threads: Thread[]; configured: boolean }>(`/api/conversations?view=threads&clientId=${encodeURIComponent(scopeClientId || "agency")}`); setThreads(r.threads); setConfigured(r.configured); setError(""); }
    catch (e) { setError(e instanceof Error ? e.message : "Could not load conversations."); } finally { setLoading(false); }
  }, [scopeClientId]);
  const loadThread = useCallback(async (id: string) => {
    try { const r = await call<{ thread: Thread; messages: Msg[] }>(`/api/conversations?view=thread&id=${encodeURIComponent(id)}`); setActive(r.thread); setMessages(r.messages); } catch (e) { setError(e instanceof Error ? e.message : "Could not open that conversation."); }
  }, []);
  useEffect(() => { setLoading(true); setActiveId(""); setActive(null); void loadThreads(); }, [loadThreads]);
  useEffect(() => { const t = setInterval(() => { if (document.visibilityState === "visible") { void loadThreads(); if (activeId) void loadThread(activeId); } }, 7000); return () => clearInterval(t); }, [loadThreads, loadThread, activeId]);
  useEffect(() => { if (activeId) void loadThread(activeId); }, [activeId, loadThread]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [messages.length, activeId]);

  const act = async (body: Record<string, unknown>) => { setBusy(true); setError(""); try { await call("/api/conversations", body); await loadThreads(); if (activeId) await loadThread(activeId); } catch (e) { setError(e instanceof Error ? e.message : "Something went wrong."); } finally { setBusy(false); } };
  const send = async () => { const body = text.trim(); if (!body || !active) return; setText(""); await act({ action: "send", id: active.id, body }); };
  const draft = async () => { if (!active) return; setBusy(true); setError(""); try { const r = await call<{ draft: string }>("/api/conversations", { action: "draft", id: active.id }); setText(r.draft); } catch (e) { setError(e instanceof Error ? e.message : "No draft."); } finally { setBusy(false); } };

  const shown = threads.filter((t) => filter === "all" ? t.status !== "closed" : filter === "unread" ? t.unread > 0 : t.status === "handoff");
  const needs = threads.filter((t) => t.status === "handoff").length, unread = threads.reduce((n, t) => n + (t.unread > 0 ? 1 : 0), 0);

  return <section className="cv" aria-label="Conversations">
    <header className="cv-head"><div><p className="eyebrow">💬 CONVERSATIONS{scopeClientId ? ` · ${clientName(scopeClientId).toUpperCase()}` : ""}</p><h1>Customer conversations</h1><p>SMS, WhatsApp and every email the system sends, in one inbox.</p></div>
      <button type="button" className="secondary-button" onClick={() => setSettingsOpen(true)}>⚙️ Conversation settings</button></header>
    {error && <div className="cv-error" role="alert">{error}</div>}
    {loading ? <div className="empty-state" role="status">Loading conversations…</div> : <>{!configured && <div className="cv-banner">💬 Emails the system sends show here already. To also text and WhatsApp customers, <button type="button" className="text-button" onClick={() => setSettingsOpen(true)}>connect Twilio</button>.</div>}
    <div className="cv-grid">
      <aside className="cv-list" aria-label="Conversation list">
        <div className="cv-filters" role="tablist">{([["all", "Open"], ["unread", `Unread${unread ? ` (${unread})` : ""}`], ["handoff", `Needs you${needs ? ` (${needs})` : ""}`]] as const).map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={filter === k} className={filter === k ? "on" : ""} onClick={() => setFilter(k)}>{l}</button>)}</div>
        <div className="cv-rows">{shown.length === 0 ? <p className="cv-none">{threads.length === 0 ? "Nothing yet. Emails the system sends, and customer texts, show up here." : "Nothing here."}</p> : shown.map((t) => <button type="button" key={t.id} className={`cv-row ${activeId === t.id ? "on" : ""} ${t.unread ? "unread" : ""}`} onClick={() => setActiveId(t.id)}>
          <span className={`cv-avatar ${t.channel}`}>{t.channel === "whatsapp" ? "WA" : t.channel === "email" ? "✉" : "SMS"}</span>
          <span className="cv-row-main"><b>{title(t)}</b><small>{t.last_preview || "…"}</small>{!scopeClientId && t.client_id && <em>{clientName(t.client_id)}</em>}</span>
          <span className="cv-row-side"><small>{ago(t.last_at)}</small>{t.status === "handoff" ? <i className="cv-pill hand">Needs you</i> : t.unread ? <i className="cv-pill">{t.unread}</i> : t.bot_on ? <i className="cv-bot" title="AI bot is replying"><AiEyesIcon /></i> : null}</span></button>)}</div>
      </aside>
      <div className="cv-chat">{!active ? <div className="cv-pick"><span>💬</span><p>Choose a conversation</p></div> : <>
        <div className="cv-chat-head"><div><b>{title(active)}</b><small>{active.channel === "whatsapp" ? "WhatsApp" : active.channel === "email" ? "Email sent by the system" : "SMS"} · {active.contact}{active.client_id ? ` · ${clientName(active.client_id)}` : ""}</small></div>
          {active.channel !== "email" && <div className="cv-chat-actions">
            <label className={`cv-switch ${active.bot_on ? "on" : ""}`} title="When on, the AI bot answers new messages"><input type="checkbox" checked={!!active.bot_on} disabled={busy} onChange={(e) => void act({ action: "toggle-bot", id: active.id, on: e.target.checked })} /><span><AiEyesIcon /> Bot {active.bot_on ? "on" : "off"}</span></label>
            {active.status !== "closed" ? <button type="button" className="secondary-button" disabled={busy} onClick={() => void act({ action: "status", id: active.id, status: "closed" })}>✓ Close</button> : <button type="button" className="secondary-button" disabled={busy} onClick={() => void act({ action: "status", id: active.id, status: "open" })}>Reopen</button>}</div>}</div>
        {active.status === "handoff" && <div className="cv-banner">🙋 The bot handed this one to you. Reply below, or switch the bot back on.</div>}
        <div className="cv-msgs">{messages.map((m) => <div key={m.id} className={`cv-msg ${m.direction === "in" ? "in" : "out"} ${m.sender}`}><div className="cv-bubble">{m.body}{m.error && <small className="cv-fail">Not delivered: {m.error}</small>}</div><small>{m.sender === "bot" && active.channel === "email" ? "Sent automatically" : m.sender === "bot" ? <><AiEyesIcon /> AI bot</> : m.sender === "staff" ? "You" : title(active)} · {new Date(m.created_at).toLocaleString("en-GB", { hour: "2-digit", minute: "2-digit", day: "numeric", month: "short" })}</small></div>)}<div ref={endRef} /></div>
{active.channel === "email" ? <p className="cv-note">This is a copy of an email the system sent automatically. Replies go to the sender\u2019s inbox, not here.</p> : <>        <form className="cv-compose" onSubmit={(e) => { e.preventDefault(); void send(); }}>
          <textarea value={text} rows={2} maxLength={1500} placeholder="Write a reply… (Enter to send, Shift+Enter for a new line)" onChange={(e) => setText(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void send(); } }} />
          <div><button type="button" className="secondary-button" disabled={busy} onClick={() => void draft()}>✨ Draft with AI</button><button type="submit" className="primary-button" disabled={busy || !text.trim()}>Send</button></div>
        </form>
        <p className="cv-note">Sending a reply turns the bot off for this customer so you don’t talk over each other.</p></>}</>}
      </div>
    </div></>}
    {settingsOpen && <ConversationSettings clients={clients} onClose={() => { setSettingsOpen(false); void loadThreads(); }} />}
  </section>;
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
    <div className="cv-steps"><h3>Set up in 3 steps</h3><ol><li>In Twilio, copy your <b>Account SID</b> and <b>Auth Token</b> (Console home) and paste them below.</li><li>Add each phone number or WhatsApp number below. Use the international format, like +353851234567. Choose which client it belongs to.</li><li>In Twilio, open the number (or WhatsApp sender) and set <b>“A message comes in”</b> to this address, with method <b>HTTP POST</b>:
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
