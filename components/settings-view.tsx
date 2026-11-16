"use client";

import { appConfirm } from "./app-dialog";
import { useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { KeyRound, Plus, Search, X, ArrowLeft, Lock } from "lucide-react";

// Settings → APIs: the AI provider (OpenRouter) plus any other service keys, in one tidy column.
// Adding a key opens a pop-up with common services to pick from (or a custom one).

type ApiKeyState = { connected: boolean; fingerprint: string; updatedAt: string | null; secureStorageReady: boolean };
type SavedKey = { id: string; label: string; note: string; fingerprint: string; updatedAt: string };
type KeysPayload = { keys?: SavedKey[]; secureStorageReady?: boolean; error?: string };
type Preset = { name: string; domain: string; use: string; hint: string };

const PRESETS: Preset[] = [
  { name: "Resend", domain: "resend.com", use: "Sending system and client emails", hint: "re_…" },
  { name: "DataForSEO", domain: "dataforseo.com", use: "Keyword, rank and SEO data", hint: "API password" },
  { name: "Google Ads developer token", domain: "ads.google.com", use: "Google Ads API access", hint: "Developer token" },
  { name: "Meta", domain: "developers.facebook.com", use: "Meta Ads and Facebook pages", hint: "Access token" },
  { name: "Stripe", domain: "stripe.com", use: "Payments and invoicing", hint: "sk_live_…" },
  { name: "Cloudflare", domain: "cloudflare.com", use: "Domains, DNS and hosting", hint: "API token" },
  { name: "Telegram bot", domain: "telegram.org", use: "Alerts to the F2B Telegram bot", hint: "123456789:AA…" },
  { name: "Twilio", domain: "twilio.com", use: "SMS and calls", hint: "Auth token" },
  { name: "Outscraper", domain: "outscraper.com", use: "Lead Factory business data", hint: "API key" },
  { name: "Hunter", domain: "hunter.io", use: "Email finding for Outreach", hint: "API key" },
  { name: "OpenAI", domain: "openai.com", use: "Direct OpenAI access", hint: "sk-…" },
  { name: "Anthropic", domain: "anthropic.com", use: "Direct Claude access", hint: "sk-ant-…" },
];

const favicon = (domain: string) => `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;
const presetFor = (label: string) => PRESETS.find((preset) => preset.name.toLowerCase() === label.trim().toLowerCase())
  || PRESETS.find((preset) => label.toLowerCase().includes(preset.name.split(" ")[0].toLowerCase()));
const when = (iso: string | null | undefined) => iso ? new Date(iso).toLocaleString("en-IE", { dateStyle: "medium", timeStyle: "short" }) : "";

function Logo({ domain, label }: { domain?: string; label: string }) {
  const [failed, setFailed] = useState(false);
  return <span className="apis-logo" aria-hidden="true">{domain && !failed
    ? <img src={favicon(domain)} alt="" width={22} height={22} referrerPolicy="no-referrer" loading="lazy" onError={() => setFailed(true)} />
    : <b>{label.trim().charAt(0).toUpperCase() || <KeyRound size={16} />}</b>}</span>;
}

function Popup({ title, onClose, children }: { title: ReactNode; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return createPortal(<div className="apis-scrim" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    <section className="apis-popup" role="dialog" aria-modal="true" aria-label={typeof title === "string" ? title : "Add API key"}>
      <header className="apis-popup-head"><h3>{title}</h3><button type="button" className="apis-icon-btn" aria-label="Close" onClick={onClose}><X size={18} /></button></header>
      {children}
    </section>
  </div>, document.body);
}

export function SettingsView() {
  // ---- AI provider (OpenRouter) ----
  const [ai, setAi] = useState<ApiKeyState | null>(null);
  const [aiKey, setAiKey] = useState("");
  const [aiReplacing, setAiReplacing] = useState(false);
  const [aiBusy, setAiBusy] = useState<"" | "save" | "remove">("");
  // ---- Other keys ----
  const [keys, setKeys] = useState<SavedKey[]>([]);
  const [keysReady, setKeysReady] = useState(true);
  const [loading, setLoading] = useState(true);
  // ---- Add / replace pop-up ----
  const [popup, setPopup] = useState<null | { step: "pick" | "form"; editing?: SavedKey }>(null);
  const [query, setQuery] = useState("");
  const [label, setLabel] = useState("");
  const [note, setNote] = useState("");
  const [secret, setSecret] = useState("");
  const [hint, setHint] = useState("");
  const [domain, setDomain] = useState("");
  const [saving, setSaving] = useState(false);
  const [popupError, setPopupError] = useState("");
  const secretRef = useRef<HTMLInputElement>(null);
  // ---- Status line ----
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);
  const say = (text: string, error = false) => { setMessage(text); setIsError(error); };

  useEffect(() => {
    (async () => {
      const [aiRes, keysRes] = await Promise.allSettled([
        fetch("/api/settings/api-keys", { cache: "no-store" }).then(async (r) => { const p = await r.json() as ApiKeyState & { error?: string }; if (!r.ok) throw new Error(p.error || "Could not load the AI provider."); return p; }),
        fetch("/api/settings/custom-api-keys", { cache: "no-store" }).then(async (r) => { const p = await r.json() as KeysPayload; if (!r.ok) throw new Error(p.error || "Could not load saved API keys."); return p; }),
      ]);
      if (aiRes.status === "fulfilled") setAi(aiRes.value); else say(aiRes.reason instanceof Error ? aiRes.reason.message : "Could not load the AI provider.", true);
      if (keysRes.status === "fulfilled") { setKeys(keysRes.value.keys || []); if (keysRes.value.secureStorageReady !== undefined) setKeysReady(keysRes.value.secureStorageReady); }
      else say(keysRes.reason instanceof Error ? keysRes.reason.message : "Could not load saved API keys.", true);
      setLoading(false);
    })();
  }, []);

  async function saveAi(event: FormEvent) {
    event.preventDefault();
    setAiBusy("save"); say("");
    try {
      const response = await fetch("/api/settings/api-keys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: "openrouter", apiKey: aiKey }) });
      const payload = await response.json() as ApiKeyState & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not save the OpenRouter key.");
      setAi(payload); setAiKey(""); setAiReplacing(false); say("OpenRouter connected. AI employees will use this key.");
    } catch (error) { say(error instanceof Error ? error.message : "Could not save the OpenRouter key.", true); }
    finally { setAiBusy(""); }
  }

  async function removeAi() {
    if (!(await appConfirm("Remove the OpenRouter key? AI work will stop until a key is connected again."))) return;
    setAiBusy("remove"); say("");
    try {
      const response = await fetch("/api/settings/api-keys", { method: "DELETE" });
      const payload = await response.json() as ApiKeyState & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not remove the OpenRouter key.");
      setAi(payload); setAiReplacing(false); say("OpenRouter key removed.");
    } catch (error) { say(error instanceof Error ? error.message : "Could not remove the OpenRouter key.", true); }
    finally { setAiBusy(""); }
  }

  function openAdd() { setQuery(""); setPopupError(""); setPopup({ step: "pick" }); }
  function pick(preset: Preset | null) {
    setLabel(preset?.name || ""); setNote(preset?.use || ""); setHint(preset?.hint || "Paste the key"); setDomain(preset?.domain || ""); setSecret(""); setPopupError("");
    setPopup({ step: "form" });
    setTimeout(() => secretRef.current?.focus(), 30);
  }
  function openReplace(key: SavedKey) {
    const preset = presetFor(key.label);
    setLabel(key.label); setNote(key.note); setHint(preset?.hint || "Paste the new key"); setDomain(preset?.domain || ""); setSecret(""); setPopupError("");
    setPopup({ step: "form", editing: key });
    setTimeout(() => secretRef.current?.focus(), 30);
  }

  async function saveKey(event: FormEvent) {
    event.preventDefault();
    const editing = popup?.editing;
    setSaving(true); setPopupError("");
    try {
      const response = await fetch("/api/settings/custom-api-keys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: editing?.id, label: label.trim(), note: note.trim(), apiKey: secret.trim() }) });
      const payload = await response.json() as KeysPayload;
      if (!response.ok) throw new Error(payload.error || "Could not save the key.");
      setKeys(payload.keys || []); setPopup(null); setSecret("");
      say(editing ? `${label.trim()} key replaced.` : `${label.trim()} key saved.`);
    } catch (error) { setPopupError(error instanceof Error ? error.message : "Could not save the key."); }
    finally { setSaving(false); }
  }

  async function removeKey(key: SavedKey) {
    if (!(await appConfirm(`Remove the ${key.label} key? Anything using it will stop working.`))) return;
    say("");
    try {
      const response = await fetch(`/api/settings/custom-api-keys?id=${encodeURIComponent(key.id)}`, { method: "DELETE" });
      const payload = await response.json() as KeysPayload;
      if (!response.ok) throw new Error(payload.error || "Could not remove the key.");
      setKeys(payload.keys || []); say(`${key.label} key removed.`);
    } catch (error) { say(error instanceof Error ? error.message : "Could not remove the key.", true); }
  }

  const savedNames = useMemo(() => new Set(keys.map((key) => key.label.trim().toLowerCase())), [keys]);
  const shown = PRESETS.filter((preset) => !query.trim() || `${preset.name} ${preset.use}`.toLowerCase().includes(query.trim().toLowerCase()));
  const total = (ai?.connected ? 1 : 0) + keys.length;
  const showAiEntry = !loading && (!ai?.connected || aiReplacing);

  return <main className="apis-page">
    <header className="apis-head">
      <div>
        <h1>APIs</h1>
        <p>Keys Agency OS uses to talk to other services. Every key is encrypted and only its last four characters are shown.</p>
      </div>
      <div className="apis-head-actions">
        <span className={`apis-pill ${total ? "on" : ""}`}><i />{loading ? "Checking…" : `${total} connected`}</span>
        <button type="button" className="primary-button apis-add" onClick={openAdd} disabled={!keysReady}><Plus size={16} /> Add API key</button>
      </div>
    </header>

    {message && <p className={`apis-status ${isError ? "error" : "ok"}`} role={isError ? "alert" : "status"}>{message}</p>}

    <section className="apis-card" aria-labelledby="apis-ai">
      <div className="apis-card-head"><h2 id="apis-ai">AI provider</h2><small>Powers Grok and Claude for every AI employee. Models are picked per employee in Team.</small></div>
      <div className="apis-row">
        <Logo domain="openrouter.ai" label="OpenRouter" />
        <span className="apis-row-text"><b>OpenRouter</b><small>{loading ? "Checking…" : ai?.connected ? <>Ending in <code>{ai.fingerprint}</code>{ai.updatedAt ? ` · Updated ${when(ai.updatedAt)}` : ""}</> : "Not connected — AI work is paused"}</small></span>
        {ai?.connected ? <span className="apis-pill on">Connected</span> : !loading && <span className="apis-pill">Not connected</span>}
        {ai?.connected && !aiReplacing && <span className="apis-row-actions">
          <button type="button" className="secondary-button" onClick={() => { setAiReplacing(true); setAiKey(""); }}>Replace</button>
          <button type="button" className="secondary-button apis-danger" disabled={aiBusy === "remove"} onClick={() => void removeAi()}>{aiBusy === "remove" ? "Removing…" : "Remove"}</button>
        </span>}
      </div>
      {showAiEntry && <form className="apis-inline-form" onSubmit={(event) => void saveAi(event)}>
        <input aria-label="OpenRouter API key" type="password" autoComplete="new-password" spellCheck={false} placeholder="sk-or-v1-…" value={aiKey} onChange={(event) => setAiKey(event.target.value)} minLength={40} maxLength={180} required autoFocus={aiReplacing} />
        <button type="submit" className="primary-button" disabled={aiBusy === "save" || !aiKey.trim() || ai?.secureStorageReady === false}>{aiBusy === "save" ? "Verifying…" : ai?.connected ? "Verify & replace" : "Verify & connect"}</button>
        {aiReplacing && <button type="button" className="secondary-button" onClick={() => { setAiReplacing(false); setAiKey(""); }}>Cancel</button>}
      </form>}
      {ai?.secureStorageReady === false && <p className="apis-status error" role="alert">Secure storage needs a one-time server setup before a key can be saved.</p>}
    </section>

    <section className="apis-card" aria-labelledby="apis-other">
      <div className="apis-card-head"><h2 id="apis-other">Other services</h2><small>{keys.length ? `${keys.length} saved` : "Email, SEO data, payments, alerts and more."}</small></div>
      {loading ? <p className="apis-empty">Loading…</p>
        : keys.length === 0 ? <button type="button" className="apis-empty-add" onClick={openAdd} disabled={!keysReady}><Plus size={18} /><span><b>Add your first service</b><small>Resend, DataForSEO, Stripe, Telegram and more.</small></span></button>
        : <ul className="apis-list">{keys.map((key) => { const preset = presetFor(key.label); return <li key={key.id} className="apis-row">
          <Logo domain={preset?.domain} label={key.label} />
          <span className="apis-row-text"><b>{key.label}</b><small>Ending in <code>{key.fingerprint}</code>{key.note ? ` · ${key.note}` : ""}{key.updatedAt ? ` · ${when(key.updatedAt)}` : ""}</small></span>
          <span className="apis-row-actions">
            <button type="button" className="secondary-button" onClick={() => openReplace(key)}>Replace</button>
            <button type="button" className="secondary-button apis-danger" onClick={() => void removeKey(key)}>Remove</button>
          </span>
        </li>; })}</ul>}
      {!keysReady && <p className="apis-status error" role="alert">Secure storage needs a one-time server setup before keys can be saved.</p>}
    </section>

    <p className="apis-foot"><Lock size={13} /> Keys are verified where possible, encrypted before storage and never shown again. Rotate any key you’ve pasted into a chat.</p>

    {popup?.step === "pick" && <Popup title="Add API key" onClose={() => setPopup(null)}>
      <label className="apis-search"><Search size={16} /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search services" aria-label="Search services" /></label>
      <div className="apis-grid">
        {shown.map((preset) => { const saved = savedNames.has(preset.name.toLowerCase()); return <button type="button" key={preset.name} className="apis-option" onClick={() => pick(preset)}>
          <Logo domain={preset.domain} label={preset.name} />
          <span><b>{preset.name}</b><small>{preset.use}</small></span>
          {saved && <em>Saved</em>}
        </button>; })}
        <button type="button" className="apis-option apis-option-custom" onClick={() => pick(query.trim() ? { name: query.trim(), domain: "", use: "", hint: "Paste the key" } : null)}>
          <span className="apis-logo"><Plus size={18} /></span>
          <span><b>{query.trim() ? `Add “${query.trim()}”` : "Custom service"}</b><small>Any other API</small></span>
        </button>
      </div>
    </Popup>}

    {popup?.step === "form" && <Popup title={<span className="apis-popup-title">{!popup.editing && <button type="button" className="apis-icon-btn" aria-label="Back to services" onClick={() => setPopup({ step: "pick" })}><ArrowLeft size={18} /></button>}<Logo domain={domain} label={label || "?"} />{popup.editing ? `Replace ${popup.editing.label} key` : label ? `Add ${label}` : "Add custom API key"}</span>} onClose={() => setPopup(null)}>
      <form className="apis-form" onSubmit={(event) => void saveKey(event)}>
        <label><span>Name</span><input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="e.g. Resend" maxLength={60} required autoFocus={!label} /></label>
        <label><span>{popup.editing ? "New API key" : "API key"}</span><input ref={secretRef} type="password" autoComplete="new-password" spellCheck={false} value={secret} onChange={(event) => setSecret(event.target.value)} placeholder={hint} required /></label>
        <label><span>Used for <em>(optional)</em></span><input value={note} onChange={(event) => setNote(event.target.value)} maxLength={200} placeholder="What it is used for" /></label>
        {popupError && <p className="apis-status error" role="alert">{popupError}</p>}
        <div className="apis-form-actions">
          <button type="button" className="secondary-button" onClick={() => setPopup(null)}>Cancel</button>
          <button type="submit" className="primary-button" disabled={saving || !label.trim() || !secret.trim()}>{saving ? "Saving…" : popup.editing ? "Replace key" : "Save key"}</button>
        </div>
      </form>
    </Popup>}
  </main>;
}
