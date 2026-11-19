"use client";
// WhatsApp setup, all inside the OS: 1) pick or buy a number · 2) link the client's Meta Business account · 3) name it and go live.
// Status is checked with Twilio until Meta approves; once live the number shows in Conversations for that client.
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { appConfirm } from "./app-dialog";

type ClientLite = { id: string; name: string };
type Sender = { sid: string; clientId: string; number: string; displayName: string; wabaId: string; status: string; detail: string; createdAt: string; updatedAt: string };
type Es = { ready: boolean; appId: string; configId: string; solutionId: string; version: string };
type Avail = { number: string; friendly: string; locality: string; addressRequired: string };
type FbSdk = { init: (o: Record<string, unknown>) => void; login: (cb: (r: { authResponse?: { code?: string } | null; status?: string }) => void, o: Record<string, unknown>) => void };

async function api<T>(body?: Record<string, unknown>, query = ""): Promise<T> {
  const res = await fetch(`/api/whatsapp-setup${query}`, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
  const json = await res.json().catch(() => ({})) as T & { error?: string };
  if (!res.ok) throw new Error(json.error || "Something went wrong.");
  return json;
}

const STATUS: Record<string, [string, string]> = {
  ONLINE: ["Live", "ok"], "ONLINE:UPDATING": ["Live · updating", "ok"], CREATING: ["Setting up…", "wait"], VERIFYING: ["Checking code…", "wait"],
  PENDING_VERIFICATION: ["Needs the code", "act"], TWILIO_REVIEW: ["Meta review", "wait"], DRAFT: ["Draft", "wait"], STUBBED: ["Setting up…", "wait"], OFFLINE: ["Offline", "bad"],
};
const statusOf = (s: string) => STATUS[s] || [s ? s.toLowerCase().replace(/_/g, " ") : "Unknown", "wait"];
const DIAL: Record<string, string> = { IE: "353", GB: "44", US: "1", CA: "1", AU: "61", ES: "34", NL: "31" };
/** "087 123 4567" + Ireland → +353871234567; already-international numbers are kept. */
const toE164 = (raw: string, country: string) => { const d = raw.replace(/[^\d+]/g, ""); if (!d) return ""; if (d.startsWith("+")) return d; if (d.startsWith("00")) return `+${d.slice(2)}`; if (d.startsWith("0")) return `+${DIAL[country] || "353"}${d.slice(1)}`; return `+${d}`; };
const COUNTRIES: Array<[string, string]> = [["IE", "🇮🇪 Ireland"], ["GB", "🇬🇧 United Kingdom"], ["US", "🇺🇸 United States"], ["CA", "🇨🇦 Canada"], ["AU", "🇦🇺 Australia"], ["ES", "🇪🇸 Spain"], ["NL", "🇳🇱 Netherlands"]];

function loadFbSdk(es: Es): Promise<FbSdk> {
  const w = window as unknown as { FB?: FbSdk; fbAsyncInit?: () => void };
  if (w.FB) return Promise.resolve(w.FB);
  return new Promise((resolve, reject) => {
    w.fbAsyncInit = () => { w.FB!.init({ appId: es.appId, autoLogAppEvents: true, xfbml: false, version: es.version }); resolve(w.FB!); };
    const s = document.createElement("script");
    s.src = "https://connect.facebook.net/en_US/sdk.js"; s.async = true; s.defer = true; s.crossOrigin = "anonymous";
    s.onerror = () => reject(new Error("Facebook couldn't load. Check an ad blocker isn't blocking it, or paste the account ID instead."));
    document.body.appendChild(s);
  });
}

export function WhatsAppSetup({ clients, initialClientId = "", onClose, onLive }: { clients: ClientLite[]; initialClientId?: string; onClose: () => void; onLive?: () => void }) {
  const [loaded, setLoaded] = useState(false);
  const [twilio, setTwilio] = useState(true);
  const [es, setEs] = useState<Es | null>(null);
  const [senders, setSenders] = useState<Sender[]>([]);
  const [wizard, setWizard] = useState(false);
  const [step, setStep] = useState<1 | 2 | 3>(1);
  const [clientId, setClientId] = useState(initialClientId);
  const [numberMode, setNumberMode] = useState<"buy" | "owned" | "existing">("buy");
  const [country, setCountry] = useState("GB");
  const [numType, setNumType] = useState<"Mobile" | "Local">("Mobile");
  const [contains, setContains] = useState("");
  const [results, setResults] = useState<Avail[] | null>(null);
  const [owned, setOwned] = useState<Array<{ number: string; friendly: string }> | null>(null);
  const [reg, setReg] = useState<{ addresses: Array<{ sid: string; label: string }>; bundles: Array<{ sid: string; label: string }> } | null>(null);
  const [addressSid, setAddressSid] = useState("");
  const [bundleSid, setBundleSid] = useState("");
  const [existing, setExisting] = useState("");
  // Coexistence: the client keeps using the WhatsApp Business app on the same number; chats sync into the OS.
  const [keepApp, setKeepApp] = useState(true);
  const [number, setNumber] = useState("");
  const [wabaId, setWabaId] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [codes, setCodes] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState("");
  const [err, setErr] = useState("");
  const [msg, setMsg] = useState("");
  const wasLive = useRef<Set<string>>(new Set());

  const clientName = (id: string) => clients.find((c) => c.id === id)?.name || (id ? "Client" : "Agency");
  const load = useCallback(async (quiet = false) => {
    try {
      const r = await api<{ twilioConnected: boolean; embeddedSignup: Es; senders: Sender[] }>(undefined, "");
      setTwilio(r.twilioConnected); setEs(r.embeddedSignup); setSenders(r.senders);
      const liveNow = r.senders.filter((s) => /^ONLINE/.test(s.status)).map((s) => s.sid);
      if (loaded && liveNow.some((sid) => !wasLive.current.has(sid))) { setMsg("WhatsApp is live 🎉 It's now in Conversations for that client."); onLive?.(); }
      wasLive.current = new Set(liveNow);
      if (!loaded && !r.senders.length) setWizard(true);
    } catch (e) { if (!quiet) setErr(e instanceof Error ? e.message : "Couldn't load WhatsApp setup."); }
    finally { setLoaded(true); }
  }, [loaded, onLive]);
  useEffect(() => { void load(); }, []); // eslint-disable-line react-hooks/exhaustive-deps
  // Keep checking while anything is still waiting on Meta / Twilio.
  useEffect(() => {
    if (!senders.some((s) => !/^ONLINE/.test(s.status) && s.status !== "OFFLINE")) return;
    const t = window.setInterval(() => void load(true), 8000);
    return () => window.clearInterval(t);
  }, [senders, load]);
  useEffect(() => { if (clientId && !displayName) setDisplayName(clientName(clientId)); }, [clientId]); // eslint-disable-line react-hooks/exhaustive-deps

  const run = async (key: string, fn: () => Promise<void>) => { setBusy(key); setErr(""); setMsg(""); try { await fn(); } catch (e) { setErr(e instanceof Error ? e.message : "That didn't work."); } finally { setBusy(""); } };
  const search = () => run("search", async () => { setResults((await api<{ numbers: Avail[] }>({ action: "search-numbers", country, type: numType, contains })).numbers); });
  const loadOwned = () => run("owned", async () => { setOwned((await api<{ numbers: Array<{ number: string; friendly: string }> }>(undefined, "?view=owned-numbers")).numbers); });
  const loadReg = () => run("reg", async () => { const r = await api<NonNullable<typeof reg>>(undefined, "?view=regulatory"); setReg(r); if (r.addresses[0]) setAddressSid(r.addresses[0].sid); if (r.bundles[0]) setBundleSid(r.bundles[0].sid); });
  const buy = (n: Avail) => run(n.number, async () => {
    if (!(await appConfirm(`Buy ${n.friendly} for ${clientName(clientId)}? Twilio bills the monthly number fee to your account.`))) return;
    const r = await api<{ number: string }>({ action: "buy-number", number: n.number, addressSid, bundleSid, label: `${clientName(clientId)} WhatsApp` });
    setNumber(r.number); setMsg(`${r.number} is yours.`); setStep(2);
  });
  const connectFacebook = () => run("fb", async () => {
    if (!es?.ready) throw new Error("One-click Facebook isn't switched on yet. Paste the account ID below instead.");
    const FB = await loadFbSdk(es);
    const waba = await new Promise<string>((resolve, reject) => {
      let got = "";
      const onMsg = (event: MessageEvent) => {
        if (!/(^|\.)facebook\.com$/.test(new URL(event.origin).hostname)) return;
        try { const d = typeof event.data === "string" ? JSON.parse(event.data) : event.data; if (d?.type === "WA_EMBEDDED_SIGNUP") { if (d.event === "CANCEL") { window.removeEventListener("message", onMsg); reject(new Error(d.data?.current_step ? `Facebook sign-up was closed at "${d.data.current_step}". Try again when ready.` : "Facebook sign-up was closed.")); } else if (d.data?.waba_id) { got = String(d.data.waba_id); } } } catch { /* not ours */ }
      };
      window.addEventListener("message", onMsg);
      FB.login((response) => {
        window.setTimeout(() => { window.removeEventListener("message", onMsg); if (got) resolve(got); else if (response.authResponse) reject(new Error("Facebook connected but didn't send the WhatsApp account back. Paste the account ID below.")); else reject(new Error("Facebook sign-up wasn't finished.")); }, 600);
      }, { config_id: es.configId, response_type: "code", override_default_response_type: true, extras: { setup: es.solutionId ? { solutionID: es.solutionId } : {}, featureType: coexist ? "whatsapp_business_app_onboarding" : "", sessionInfoVersion: "3" } });
    });
    setWabaId(waba); setMsg("Facebook connected ✓"); setStep(3);
  });
  const register = () => run("register", async () => {
    const r = await api<{ sender: { sid: string; status: string; ownsNumber: boolean } }>({ action: "register", clientId, number, wabaId, displayName, coexist });
    setMsg(r.sender.ownsNumber ? "Sent to Meta. Twilio numbers verify themselves; this usually goes live within minutes." : "Sent to Meta. A code is on its way to that number by text. Enter it below.");
    setWizard(false); setStep(1); setNumber(""); setWabaId(""); setResults(null); setOwned(null); setExisting("");
    await load(true);
  });
  const verify = (s: Sender) => run(`v-${s.sid}`, async () => { await api({ action: "verify", sid: s.sid, code: codes[s.sid] || "" }); setMsg("Code sent to Meta."); await load(true); });
  const remove = (s: Sender) => run(`r-${s.sid}`, async () => { if (!(await appConfirm(`Remove WhatsApp from ${s.number}? Customers won't be able to WhatsApp ${s.displayName} on this number any more.`))) return; await api({ action: "remove", sid: s.sid }); await load(true); });

  const coexist = numberMode === "existing" && keepApp;
  const canStep2 = Boolean(clientId !== "" || clients.length === 0) && /^\+\d{7,15}$/.test(number);
  // Rendered at the app-shell level so the side bar never sits on top of the window.
  const host = typeof document !== "undefined" ? (document.querySelector(".app-shell") || document.body) : null;
  const ui = <div className="cv-modal wa-modal" role="dialog" aria-label="WhatsApp setup" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}><div className="cv-dialog wa-setup">
    <header><h2><span className="wa-logo" aria-hidden="true"><svg viewBox="0 0 24 24" width="18" height="18"><path fill="currentColor" d="M12 2a10 10 0 0 0-8.6 15.1L2 22l5-1.3A10 10 0 1 0 12 2Zm0 18.2a8.2 8.2 0 0 1-4.2-1.2l-.3-.2-3 .8.8-2.9-.2-.3A8.2 8.2 0 1 1 12 20.2Zm4.5-6.1c-.2-.1-1.5-.7-1.7-.8-.2-.1-.4-.1-.6.1l-.8 1c-.1.2-.3.2-.5.1a6.7 6.7 0 0 1-3.3-2.9c-.2-.4.2-.4.7-1.3.1-.2 0-.3 0-.4l-.8-1.8c-.2-.5-.4-.4-.6-.4h-.5a1 1 0 0 0-.7.3 3 3 0 0 0-.9 2.2 5.2 5.2 0 0 0 1.1 2.7 11.8 11.8 0 0 0 4.5 4c1.7.7 2.3.8 3.2.6a2.7 2.7 0 0 0 1.8-1.2 2.2 2.2 0 0 0 .1-1.3c0-.1-.2-.2-.4-.3Z" /></svg></span>WhatsApp</h2><button type="button" className="cv-x" aria-label="Close" onClick={onClose}>✕</button></header>
    {!loaded ? <p>Loading…</p> : !twilio ? <div className="wa-empty"><b>Connect Twilio first</b><p>WhatsApp messages go through your Twilio account. Close this, open <b>⚙️ Conversation settings</b> and paste your Account SID and Auth Token. You only do that once for the whole agency.</p></div> : <>
      {senders.length > 0 && <section className="wa-list" aria-label="WhatsApp numbers">
        {senders.map((s) => { const [label, tone] = statusOf(s.status); return <article key={s.sid} className={`wa-row wa-${tone}`}>
          <div><b>{s.displayName}</b><small>{s.number} · {clientName(s.clientId)}</small>{s.detail && <small className="wa-detail">{s.detail}</small>}</div>
          <span className={`wa-badge wa-${tone}`}>{tone === "wait" && <i className="wa-dot" aria-hidden="true" />}{label}</span>
          {s.status === "PENDING_VERIFICATION" && <div className="wa-verify"><input inputMode="numeric" maxLength={8} placeholder="Code from the text" value={codes[s.sid] || ""} onChange={(e) => setCodes({ ...codes, [s.sid]: e.target.value.replace(/\D/g, "") })} /><button type="button" className="primary-button" disabled={busy === `v-${s.sid}` || (codes[s.sid] || "").length < 4} onClick={() => void verify(s)}>{busy === `v-${s.sid}` ? "Checking…" : "Verify"}</button></div>}
          <button type="button" className="wa-remove" title="Remove WhatsApp from this number" aria-label={`Remove WhatsApp from ${s.number}`} disabled={busy === `r-${s.sid}`} onClick={() => void remove(s)}>✕</button>
        </article>; })}
      </section>}
      {!wizard ? <button type="button" className="primary-button wa-add" onClick={() => { setWizard(true); setStep(1); }}>＋ Add WhatsApp for a client</button> : <section className="wa-wizard">
        <ol className="wa-steps">{(["Number", "Facebook", "Go live"] as const).map((l, i) => <li key={l} className={step === i + 1 ? "on" : step > i + 1 ? "done" : ""}><i>{step > i + 1 ? "✓" : i + 1}</i>{l}</li>)}</ol>

        {step === 1 && <div className="wa-pane">
          <label>Which client is this for?<select value={clientId} onChange={(e) => { setClientId(e.target.value); setDisplayName(clientName(e.target.value)); }}><option value="">Choose a client…</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select></label>
          <div className="wa-seg" role="radiogroup" aria-label="Number">{([["buy", "Buy a new number"], ["owned", "A number I already bought"], ["existing", "The client's own number"]] as const).map(([k, l]) => <button key={k} type="button" role="radio" aria-checked={numberMode === k} className={numberMode === k ? "on" : ""} onClick={() => { setNumberMode(k); setNumber(""); if (k === "existing") setCountry("IE"); if (k === "owned" && !owned) void loadOwned(); }}>{l}</button>)}</div>
          {numberMode === "buy" && <>
            <div className="cv-3"><label>Country<select value={country} onChange={(e) => setCountry(e.target.value)}>{COUNTRIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
              <label>Type<select value={numType} onChange={(e) => setNumType(e.target.value as "Mobile" | "Local")}><option value="Mobile">Mobile (best for WhatsApp)</option><option value="Local">Landline</option></select></label>
              <label>Contains (optional)<input inputMode="numeric" value={contains} placeholder="e.g. 87" onChange={(e) => setContains(e.target.value.replace(/\D/g, ""))} /></label></div>
            <button type="button" className="secondary-button" disabled={busy === "search"} onClick={() => void search()}>{busy === "search" ? "Searching…" : "Search numbers"}</button>
            {results && (results.length ? <ul className="va-numbers">{results.map((n) => <li key={n.number}><span><b>{n.friendly}</b><small>{n.locality || "—"}{n.addressRequired !== "none" ? ` · needs your ${n.addressRequired === "local" ? "local " : ""}business address` : ""}</small></span><button type="button" className="primary-button" disabled={!clientId || Boolean(busy)} title={!clientId ? "Choose the client first" : undefined} onClick={() => void buy(n)}>{busy === n.number ? "Buying…" : "Buy"}</button></li>)}</ul> : <p className="cv-hint">No numbers found. Try Landline, another area or clear "Contains".</p>)}
            {results?.some((n) => n.addressRequired !== "none") && <details className="wa-reg" onToggle={(e) => { if ((e.currentTarget as HTMLDetailsElement).open && !reg) void loadReg(); }}><summary>Business address &amp; ID for {country === "GB" ? "UK" : country === "IE" ? "Irish" : "these"} numbers</summary>
              {!reg ? <p className="cv-hint">Loading what's saved in Twilio…</p> : <div className="cv-2">
                <label>Business address<select value={addressSid} onChange={(e) => setAddressSid(e.target.value)}><option value="">None</option>{reg.addresses.map((a) => <option key={a.sid} value={a.sid}>{a.label}</option>)}</select></label>
                <label>Approved ID bundle<select value={bundleSid} onChange={(e) => setBundleSid(e.target.value)}><option value="">None</option>{reg.bundles.map((b) => <option key={b.sid} value={b.sid}>{b.label}</option>)}</select></label></div>}
              {reg && !reg.addresses.length && <p className="cv-hint">No business address saved yet. Telecom rules need one before Twilio sells {country === "IE" ? "Irish" : "these"} numbers; it's added once in Twilio under Phone Numbers → Regulatory Compliance, then shows here.</p>}
            </details>}
          </>}
          {numberMode === "owned" && (owned === null ? <p className="cv-hint">{busy === "owned" ? "Loading your numbers…" : ""}</p> : owned.length ? <ul className="va-numbers">{owned.map((n) => <li key={n.number} className={number === n.number ? "picked" : ""}><span><b>{n.number}</b><small>{n.friendly}</small></span><button type="button" className={number === n.number ? "primary-button" : "secondary-button"} onClick={() => setNumber(n.number)}>{number === n.number ? "✓ Chosen" : "Use this"}</button></li>)}</ul> : <p className="cv-hint">No numbers in your Twilio account yet. Buy one instead.</p>)}
          {numberMode === "existing" && <>
            <div className="cv-2"><label>Country<select value={country} onChange={(e) => { setCountry(e.target.value); setNumber(toE164(existing, e.target.value)); }}>{COUNTRIES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></label>
            <label>Client's phone number<input inputMode="tel" value={existing} placeholder="087 123 4567" onChange={(e) => { setExisting(e.target.value); setNumber(toE164(e.target.value, country)); }} /></label></div>
            {number && <p className="cv-hint">We'll register <b>{number}</b>.</p>}
            <label className="wa-check"><input type="checkbox" checked={keepApp} onChange={(e) => setKeepApp(e.target.checked)} /><span><b>They use the WhatsApp Business app on this number. Keep it</b><small>Recommended. Nothing changes on their phone: same number, same chats, replying from the app stays free and unlimited. Their WhatsApp chats also land in the OS. Needs Continue with Facebook in the next step, with their phone to hand to scan a code.</small></span></label>
            {!keepApp && <p className="cv-hint">Meta texts a code to this number to prove it's theirs; you'll type it in here. If the number is on the WhatsApp app, the client must delete that WhatsApp account on the phone first (chat history on the app is lost).</p>}
          </>}
          <footer><button type="button" className="secondary-button" onClick={() => senders.length ? setWizard(false) : onClose()}>Cancel</button><button type="button" className="primary-button" disabled={!canStep2} onClick={() => setStep(2)}>Next</button></footer>
        </div>}

        {step === 2 && <div className="wa-pane">
          <p className="wa-lead">{coexist ? <>Link <b>{clientName(clientId)}</b>'s WhatsApp Business app on <b>{number}</b>. In the Facebook pop-up, pick “Connect your existing WhatsApp Business app”, then scan the QR code it shows from the app on their phone (Settings → Linked devices isn't needed, the pop-up guides it).</> : <>Link <b>{clientName(clientId)}</b>'s Facebook business so WhatsApp knows who owns <b>{number}</b>.</>}</p>
          {es?.ready ? <button type="button" className="wa-fb" disabled={busy === "fb"} onClick={() => void connectFacebook()}><svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path fill="currentColor" d="M24 12a12 12 0 1 0-13.9 11.9v-8.4h-3V12h3V9.4c0-3 1.8-4.7 4.5-4.7 1.3 0 2.7.2 2.7.2v3h-1.5c-1.5 0-2 .9-2 1.9V12h3.4l-.5 3.5h-2.9v8.4A12 12 0 0 0 24 12Z" /></svg>{busy === "fb" ? "Waiting for Facebook…" : "Continue with Facebook"}</button>
            : coexist ? <p className="cv-error wa-note">Keeping the WhatsApp Business app only works through Continue with Facebook, and that isn't switched on yet: your Meta app needs WhatsApp sign-up set up once (settings <code>META_APP_ID</code> and <code>WHATSAPP_ES_CONFIG_ID</code>). Ask Claude to switch it on, then come back to this step.</p>
            : <p className="cv-hint wa-note">One-click Facebook needs your Meta app's WhatsApp sign-up switched on (setting <code>WHATSAPP_ES_CONFIG_ID</code>). Until then, paste the account ID below.</p>}
          {!coexist && <details className="wa-reg" open={!es?.ready}><summary>{es?.ready ? "Or paste the WhatsApp Business Account ID" : "Paste the WhatsApp Business Account ID"}</summary>
            <label>WhatsApp Business Account ID<input inputMode="numeric" value={wabaId} placeholder="e.g. 104996122399160" onChange={(e) => setWabaId(e.target.value.replace(/\D/g, ""))} /></label>
            <p className="cv-hint">Find it in Meta Business Suite → Settings → Accounts → WhatsApp accounts. The account must be shared with your Twilio account.</p>
          </details>}
          <footer><button type="button" className="secondary-button" onClick={() => setStep(1)}>Back</button><button type="button" className="primary-button" disabled={!/^\d{6,25}$/.test(wabaId)} onClick={() => setStep(3)}>Next</button></footer>
        </div>}

        {step === 3 && <div className="wa-pane">
          <label>Name customers see on WhatsApp<input value={displayName} maxLength={60} onChange={(e) => setDisplayName(e.target.value)} placeholder="e.g. Pro Roofers Galway" /></label>
          <p className="cv-hint">Use the real trading name. Meta checks it matches the business (no slogans or emojis).</p>
          <dl className="wa-summary"><div><dt>Client</dt><dd>{clientName(clientId)}</dd></div><div><dt>Number</dt><dd>{number}</dd></div><div><dt>Business account</dt><dd>{wabaId}</dd></div></dl>
          <footer><button type="button" className="secondary-button" onClick={() => setStep(2)}>Back</button><button type="button" className="primary-button" disabled={busy === "register" || displayName.trim().length < 3} onClick={() => void register()}>{busy === "register" ? "Sending to Meta…" : "Go live on WhatsApp"}</button></footer>
        </div>}
      </section>}
    </>}
    {err && <p className="cv-error" role="alert">{err}</p>}{msg && <p className="cv-ok" role="status">{msg}</p>}
  </div></div>;
  return host ? createPortal(ui, host) : ui;
}
