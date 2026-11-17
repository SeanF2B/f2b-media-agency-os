"use client";

import { useEffect, useRef, useState } from "react";
import "./send-document-email.css";

// Pop-up used by Reports, Audits, Keyword reports and Proposals: edit the email, see exactly what the
// client will get (branded), CC the company email, then send. Nothing goes out until "Send email".
export type DocumentEmailTarget = { kind: "report"; clientId: string; archiveId: string; theme?: "dark" | "light" } | { kind: "proposal"; id: string };

type Draft = { to: string; toName: string; cc: string; subject: string; message: string; docTitle: string; brandName: string };

export function SendDocumentEmail({ target, onClose, onSent, prepare }: { target: DocumentEmailTarget | null; onClose: () => void; onSent?: (info: { sentTo: string[]; link: string }) => void; prepare?: () => Promise<DocumentEmailTarget | null> }) {
  const [resolved, setResolved] = useState<DocumentEmailTarget | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [to, setTo] = useState(""); const [cc, setCc] = useState(""); const [subject, setSubject] = useState(""); const [message, setMessage] = useState("");
  const [rememberCc, setRememberCc] = useState(false);
  const [preview, setPreview] = useState(""); const [previewBusy, setPreviewBusy] = useState(false);
  const [loading, setLoading] = useState(false); const [sending, setSending] = useState(false);
  const [error, setError] = useState(""); const [sent, setSent] = useState<{ to: string[]; cc: string[] } | null>(null);
  const [view, setView] = useState<"edit" | "preview">("edit");
  const open = Boolean(target);
  const originalCc = useRef("");
  const prepareRef = useRef(prepare); prepareRef.current = prepare;

  // Load the draft (the report may need saving first — `prepare` handles that and returns the saved target).
  useEffect(() => {
    if (!target) { setResolved(null); setDraft(null); setPreview(""); setSent(null); setError(""); setView("edit"); return; }
    let cancelled = false;
    setLoading(true); setError("");
    void (async () => {
      try {
        const ready = prepareRef.current ? await prepareRef.current() : target;
        if (!ready) throw new Error("Generate the report first.");
        const query = new URLSearchParams(ready.kind === "report" ? { kind: "report", clientId: ready.clientId, archiveId: ready.archiveId } : { kind: "proposal", id: ready.id });
        const response = await fetch(`/api/document-email?${query}`, { cache: "no-store" });
        const payload = await response.json() as Draft & { error?: string };
        if (!response.ok) throw new Error(payload.error || "Couldn't prepare the email.");
        if (cancelled) return;
        setResolved(ready); setDraft(payload);
        setTo(payload.to || ""); setCc(payload.cc || ""); originalCc.current = payload.cc || ""; setSubject(payload.subject); setMessage(payload.message);
      } catch (reason) { if (!cancelled) setError(reason instanceof Error ? reason.message : "Couldn't prepare the email."); }
      finally { if (!cancelled) setLoading(false); }
    })();
    return () => { cancelled = true; };
  }, [target]);

  // Live preview, debounced while typing.
  useEffect(() => {
    if (!resolved || !draft) return;
    const timer = window.setTimeout(async () => {
      setPreviewBusy(true);
      try {
        const response = await fetch("/api/document-email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...resolved, subject, message, mode: "preview" }) });
        const payload = await response.json() as { html?: string };
        if (response.ok && payload.html) setPreview(payload.html);
      } catch { /* keep the last preview */ }
      finally { setPreviewBusy(false); }
    }, 450);
    return () => window.clearTimeout(timer);
  }, [resolved, draft, subject, message]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape" && !sending) onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, sending, onClose]);

  if (!target) return null;
  const send = async () => {
    if (!resolved) return;
    setSending(true); setError("");
    try {
      const response = await fetch("/api/document-email", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...resolved, to, cc, subject, message, rememberCc: rememberCc || (!originalCc.current && Boolean(cc)), mode: "send" }) });
      const payload = await response.json() as { ok?: boolean; error?: string; sentTo?: string[]; cc?: string[]; link?: string };
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Couldn't send the email.");
      setSent({ to: payload.sentTo || [], cc: payload.cc || [] });
      onSent?.({ sentTo: payload.sentTo || [], link: payload.link || "" });
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Couldn't send the email."); }
    finally { setSending(false); }
  };
  const validTo = /\S+@\S+\.\S+/.test(to);

  return <div className="sde-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !sending) onClose(); }}>
    <div className="sde-modal" role="dialog" aria-modal="true" aria-label="Send by email">
      <header className="sde-head">
        <div><h3>Send by email</h3>{draft && <p>{draft.docTitle}</p>}</div>
        <button type="button" className="sde-x" aria-label="Close" onClick={onClose} disabled={sending}>✕</button>
      </header>
      {loading && <div className="sde-loading"><span className="sde-spin" aria-hidden="true" /> Preparing your email…</div>}
      {!loading && error && !draft && <p className="sde-error" role="alert">{error}</p>}
      {sent ? <div className="sde-sent">
        <div className="sde-tick" aria-hidden="true">✓</div>
        <h4>Email sent</h4>
        <p>Sent to <b>{sent.to.join(", ")}</b>{sent.cc.length ? <> · CC <b>{sent.cc.join(", ")}</b></> : null}. It&apos;s also logged in Conversations.</p>
        <button type="button" className="primary-button" onClick={onClose}>Done</button>
      </div> : draft && !loading && <>
        <div className="sde-switch" role="tablist" aria-label="Email view">
          <button type="button" role="tab" aria-selected={view === "edit"} className={view === "edit" ? "on" : ""} onClick={() => setView("edit")}>Edit</button>
          <button type="button" role="tab" aria-selected={view === "preview"} className={view === "preview" ? "on" : ""} onClick={() => setView("preview")}>Preview</button>
        </div>
        <div className={`sde-body show-${view}`}>
          <div className="sde-form">
            <label><span>To</span><input type="email" value={to} onChange={(event) => setTo(event.target.value)} placeholder="client@business.ie" autoComplete="off" data-no-ai /></label>
            <label><span>CC</span><input type="text" value={cc} onChange={(event) => setCc(event.target.value)} placeholder="you@yourcompany.ie" autoComplete="off" data-no-ai /></label>
            {cc.trim() && cc.trim().toLowerCase() !== originalCc.current && <label className="sde-check"><input type="checkbox" checked={rememberCc} onChange={(event) => setRememberCc(event.target.checked)} /> Always CC this address</label>}
            <label><span>Subject</span><input type="text" value={subject} maxLength={200} onChange={(event) => setSubject(event.target.value)} data-no-ai /></label>
            <label className="sde-message"><span>Message</span><textarea value={message} rows={10} maxLength={6000} onChange={(event) => setMessage(event.target.value)} /></label>
            <small className="sde-note">A branded button linking to the {target.kind === "proposal" ? "proposal" : "report"} is added under your message. Replies go to your company email.</small>
          </div>
          <div className="sde-preview" aria-label="Email preview">
            <div className="sde-mail-meta">
              <div><span>From</span><b>{draft.brandName}</b></div>
              <div><span>To</span><b>{to || "—"}</b></div>
              {cc.trim() && <div><span>CC</span><b>{cc}</b></div>}
              <div><span>Subject</span><b>{subject}</b></div>
              {previewBusy && <i className="sde-spin small" aria-label="Updating preview" />}
            </div>
            {preview ? <iframe title="Email preview" srcDoc={preview} sandbox="" /> : <div className="sde-loading"><span className="sde-spin" aria-hidden="true" /> Building preview…</div>}
          </div>
        </div>
        {error && <p className="sde-error" role="alert">{error}</p>}
        <footer className="sde-foot">
          <button type="button" className="secondary-button" onClick={onClose} disabled={sending}>Cancel</button>
          <button type="button" className="primary-button" onClick={() => void send()} disabled={sending || !validTo || !subject.trim() || !message.trim()}>{sending ? "Sending…" : "Send email"}</button>
        </footer>
      </>}
    </div>
  </div>;
}

export function MailIcon({ size = 16 }: { size?: number }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2" /><path d="m3.5 6.5 8.5 6 8.5-6" /></svg>;
}
