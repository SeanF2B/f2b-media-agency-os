"use client";

import { useCallback, useEffect, useState } from "react";
import { ArrowLeft, Mail, RefreshCw, Search, X } from "lucide-react";
import { EmailFrame } from "@/components/email-frame";

// Every email the OS sends by itself: chess invites, team invites, invoices, booking confirmations,
// task notifications, campaign sends. Two views:
//  · Inbox — every email that went out, opened like you received it (links work and open in a new tab).
//  · Templates — the current design of each kind of system email (its latest send).
type SystemEmail = { id: string; clientName: string; kind: string; to: string; toName: string; subject: string; body?: string; hasHtml?: boolean; createdAt: string };
type TemplateRow = { kind: string; email: SystemEmail | null };
const KINDS = ["All", "Team invites", "Chess", "Scheduling", "Invoices", "Tasks", "Leads & forms", "Campaigns", "Reports", "Notifications", "Tests"];
const KIND_HINT: Record<string, string> = {
  "Team invites": "Sent when you invite staff or a client to sign in.",
  Chess: "Sent when someone is challenged to a game.",
  Scheduling: "Booking confirmations, reminders and changes.",
  Invoices: "Invoices, receipts and payment emails.",
  Tasks: "Task assignments, approvals and reminders.",
  "Leads & forms": "The lead email a business gets when its website form is filled in.",
  Campaigns: "Emails sent by your email campaigns.",
  Reports: "Client reports and audits sent by email.",
  Notifications: "Other alerts the OS sends.",
  Tests: "Test sends from the email builder.",
};
const htmlSrc = (id: string) => `/api/system-emails?html=1&id=${encodeURIComponent(id)}`;
const when = (iso: string) => new Date(iso).toLocaleString("en-IE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** The email opened as the recipient sees it: header (subject, from, to, when) and the real email underneath. */
function Reader({ email, onClose }: { email: SystemEmail; onClose?: () => void }) {
  return <div className="sysmail-reader">
    <header>
      {onClose && <button type="button" className="sysmail-back" onClick={onClose} aria-label="Back to the list"><ArrowLeft size={16} /></button>}
      <div><h3>{email.subject || "(no subject)"}</h3><p><b>To:</b> {email.toName ? `${email.toName} <${email.to}>` : email.to}{email.clientName ? ` · ${email.clientName}` : ""} · {when(email.createdAt)}</p></div>
      <span className="sysmail-kind">{email.kind}</span>
    </header>
    <EmailFrame key={email.id} src={htmlSrc(email.id)} title={email.subject} />
    <small className="sysmail-tip">This is the exact email that was sent. Click any button or link to see where it takes the recipient (opens in a new tab).</small>
  </div>;
}

export function SystemEmailsView() {
  const [view, setView] = useState<"inbox" | "templates">("inbox");
  return <div className="sysmail">
    <div className="ops-toolbar sysmail-top">
      <span className="ops-seg" role="tablist" aria-label="System emails view">{([["inbox", "Inbox"], ["templates", "Templates"]] as const).map(([key, text]) => <button key={key} type="button" role="tab" aria-selected={view === key} className={view === key ? "active" : ""} onClick={() => setView(key)}>{text}</button>)}</span>
    </div>
    {view === "inbox" ? <Inbox /> : <Templates />}
  </div>;
}

function Inbox() {
  const [kind, setKind] = useState("All");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [emails, setEmails] = useState<SystemEmail[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [openId, setOpenId] = useState("");
  const [error, setError] = useState("");
  const load = useCallback(async (before = "") => {
    setError("");
    try {
      const params = new URLSearchParams({ ...(kind !== "All" ? { kind } : {}), ...(search ? { q: search } : {}), ...(before ? { before } : {}) });
      const response = await fetch(`/api/system-emails?${params}`, { cache: "no-store" });
      const json = await response.json().catch(() => ({})) as { emails?: SystemEmail[]; next?: string | null; error?: string };
      if (!response.ok) throw new Error(json.error || "System emails couldn’t load.");
      setEmails((current) => before ? [...(current || []), ...(json.emails || [])] : json.emails || []);
      setNext(json.next || null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "System emails couldn’t load."); setEmails((current) => current || []); }
  }, [kind, search]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { const t = window.setTimeout(() => setSearch(query.trim()), 350); return () => window.clearTimeout(t); }, [query]);
  const open = (emails || []).find((email) => email.id === openId) || null;
  // Desktop: open the newest email straight away so the reader is never empty.
  useEffect(() => { if (!openId && emails?.length && window.matchMedia("(min-width: 900px)").matches) setOpenId(emails[0].id); }, [emails, openId]);

  return <>
    <div className="ops-toolbar">
      <span className="sysmail-search"><Search size={15} aria-hidden="true" /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search subject or recipient…" aria-label="Search system emails" />{query && <button type="button" aria-label="Clear search" onClick={() => setQuery("")}><X size={14} /></button>}</span>
      <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Email type">{KINDS.map((k) => <option key={k}>{k}</option>)}</select>
      <button type="button" className="secondary-button" onClick={() => void load()}><RefreshCw size={15} /> Refresh</button>
    </div>
    {error && <p className="ops-empty" role="alert">{error}</p>}
    {emails === null ? <div className="page-loading" role="status" aria-label="Loading system emails…"><i /></div>
      : !emails.length ? <div className="em-empty-card"><Mail size={28} aria-hidden="true" /><p>{search || kind !== "All" ? "No system emails match." : "No system emails yet. Every email the OS sends by itself (chess invites, team invites, invoices, bookings, notifications) shows up here."}</p></div>
      : <div className={`sysmail-split${open ? " has-open" : ""}`}>
        <div className="sysmail-list" role="list">
          {emails.map((email) => <button key={email.id} type="button" role="listitem" className={`sysmail-item${openId === email.id ? " on" : ""}`} onClick={() => setOpenId(email.id)}>
            <span className="sysmail-item-top"><b>{email.toName || email.to}</b><time>{when(email.createdAt)}</time></span>
            <span className="sysmail-item-subject">{email.subject || "(no subject)"}</span>
            <span className="sysmail-item-meta"><span className="sysmail-kind">{email.kind}</span>{email.clientName && <small>{email.clientName}</small>}</span>
          </button>)}
          {next && <button type="button" className="secondary-button sysmail-more" onClick={() => void load(next)}>Load older</button>}
        </div>
        {open ? <Reader email={open} onClose={() => setOpenId("")} /> : <div className="sysmail-reader sysmail-reader-empty"><Mail size={28} aria-hidden="true" /><p>Pick an email to open it.</p></div>}
      </div>}
  </>;
}

function Templates() {
  const [rows, setRows] = useState<TemplateRow[] | null>(null);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<SystemEmail | null>(null);
  useEffect(() => {
    void fetch("/api/system-emails?templates=1", { cache: "no-store" }).then(async (response) => {
      const json = await response.json().catch(() => ({})) as { templates?: TemplateRow[]; error?: string };
      if (!response.ok) throw new Error(json.error || "Templates couldn’t load.");
      setRows(json.templates || []);
    }).catch((reason) => { setError(reason instanceof Error ? reason.message : "Templates couldn’t load."); setRows([]); });
  }, []);
  if (open) return <Reader email={open} onClose={() => setOpen(null)} />;
  return <>
    <p className="muted sysmail-intro">What each system email looks like right now — taken from the latest one sent. Open one to click through it like a recipient.</p>
    {error && <p className="ops-empty" role="alert">{error}</p>}
    {rows === null ? <div className="page-loading" role="status" aria-label="Loading templates…"><i /></div>
      : <div className="em-grid sysmail-templates">{rows.map(({ kind, email }) => email
        ? <button key={kind} type="button" className="em-tile" onClick={() => setOpen(email)}>
          <span className="em-thumb" aria-hidden="true"><iframe title="" tabIndex={-1} src={htmlSrc(email.id)} sandbox="" loading="lazy" /></span>
          <b>{kind}</b><span>{email.subject}</span><small>{KIND_HINT[kind] || ""} Last sent {when(email.createdAt)}</small>
        </button>
        : <div key={kind} className="em-tile is-empty"><span className="em-thumb em-thumb-empty" aria-hidden="true"><Mail size={22} /></span><b>{kind}</b><span>Not sent yet</span><small>{KIND_HINT[kind] || ""} It shows here after the first one goes out.</small></div>)}</div>}
  </>;
}
