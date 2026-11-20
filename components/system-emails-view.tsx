"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { Mail, RefreshCw, Search } from "lucide-react";
import { EmailFrame } from "@/components/email-frame";

// Every email the OS sends by itself: chess invites, team invites, invoices, booking confirmations,
// task notifications, campaign sends. Read-only log, newest first.
type SystemEmail = { id: string; clientName: string; kind: string; to: string; toName: string; subject: string; body: string; hasHtml?: boolean; createdAt: string };
const KINDS = ["All", "Team invites", "Chess", "Scheduling", "Invoices", "Tasks", "Leads & forms", "Campaigns", "Reports", "Notifications", "Tests"];

export function SystemEmailsView() {
  const [kind, setKind] = useState("All");
  const [query, setQuery] = useState("");
  const [search, setSearch] = useState("");
  const [emails, setEmails] = useState<SystemEmail[] | null>(null);
  const [next, setNext] = useState<string | null>(null);
  const [open, setOpen] = useState("");
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
  useEffect(() => { setEmails(null); void load(); }, [load]);
  useEffect(() => { const t = window.setTimeout(() => setSearch(query.trim()), 350); return () => window.clearTimeout(t); }, [query]);
  const when = (iso: string) => new Date(iso).toLocaleString("en-IE", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

  return <div className="sysmail">
    <div className="ops-toolbar">
      <span className="sysmail-search"><Search size={15} aria-hidden="true" /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search subject or recipient…" aria-label="Search system emails" /></span>
      <select value={kind} onChange={(e) => setKind(e.target.value)} aria-label="Email type">{KINDS.map((k) => <option key={k}>{k}</option>)}</select>
      <button type="button" className="secondary-button" onClick={() => { setEmails(null); void load(); }}><RefreshCw size={15} /> Refresh</button>
    </div>
    {error && <p className="ops-empty" role="alert">{error}</p>}
    {emails === null ? <div className="page-loading" role="status" aria-label="Loading system emails…"><i /></div>
      : !emails.length ? <div className="em-empty-card"><Mail size={28} aria-hidden="true" /><p>{search || kind !== "All" ? "No system emails match." : "No system emails yet. From now on every email the OS sends by itself (chess invites, team invites, invoices, bookings, notifications) shows up here."}</p></div>
      : <div className="ops-table-wrap"><table className="ops-table sysmail-table">
        <thead><tr><th>Sent</th><th>Type</th><th>To</th><th>Subject</th></tr></thead>
        <tbody>{emails.map((email) => <Fragment key={email.id}>
          <tr className={`em-click${open === email.id ? " open" : ""}`} onClick={() => setOpen(open === email.id ? "" : email.id)}>
            <td className="sysmail-when">{when(email.createdAt)}</td>
            <td><span className="sysmail-kind">{email.kind}</span></td>
            <td><b>{email.toName || email.to}</b>{email.toName && <small className="em-sub">{email.to}</small>}{email.clientName && <small className="em-sub">{email.clientName}</small>}</td>
            <td>{email.subject}</td>
          </tr>
          {open === email.id && <tr className="sysmail-body-row"><td colSpan={4}>{email.hasHtml ? <EmailFrame src={`/api/system-emails?html=1&id=${encodeURIComponent(email.id)}`} title={email.subject} /> : <pre className="sysmail-body">{email.body || "No text saved for this email."}</pre>}</td></tr>}
        </Fragment>)}</tbody>
      </table></div>}
    {next && <button type="button" className="secondary-button sysmail-more" onClick={() => void load(next)}>Load older</button>}
  </div>;
}
