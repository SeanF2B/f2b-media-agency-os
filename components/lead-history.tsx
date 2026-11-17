"use client";

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { History, X } from "lucide-react";
import type { LeadHistory, HistoryEvent } from "@/lib/lead-history";

// "History" button + pop-up: where a lead came from (website page, Google Ads campaign, Instagram, WhatsApp…) and every touch since.
// Always live records only, even with Sample data on.
const CHIP: Record<string, string> = { "Google Ads": "#1a73e8", "Google search": "#188038", "Bing search": "#188038", "Google Business": "#e37400", Instagram: "#c13584", Facebook: "#1877f2", TikTok: "#111", WhatsApp: "#1fa855", SMS: "#5f6b7a", Email: "#7c5cff", LinkedIn: "#0a66c2", Website: "#0b78b0", Pipeline: "#6b7280", "Online booking": "#b45309", Scheduling: "#b45309" };
const when = (iso: string) => { const d = new Date(iso); return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }); };
const pagePath = (u: string) => { try { const x = new URL(u); return `${x.hostname.replace(/^www\./, "")}${x.pathname === "/" ? "" : x.pathname}`; } catch { return u; } };

function Chip({ label }: { label: string }) {
  const c = CHIP[label] || "#64748b";
  return <span className="lh-chip" style={{ color: c, background: `color-mix(in srgb, ${c} 12%, transparent)`, borderColor: `color-mix(in srgb, ${c} 30%, transparent)` }}>{label}</span>;
}

function Row({ e }: { e: HistoryEvent }) {
  return <li className={`lh-row ${e.kind}`}>
    <i aria-hidden="true" />
    <div><div className="lh-row-top"><b>{e.title}</b><Chip label={e.channel} /></div>
      <small>{when(e.at)}</small>
      {(e.page || e.campaign || e.detail || e.referrer || e.clickId) && <dl>
        {e.page && <div><dt>Page</dt><dd><a href={e.page} target="_blank" rel="noreferrer noopener">{pagePath(e.page)}</a></dd></div>}
        {e.campaign && <div><dt>Campaign</dt><dd>{e.campaign}</dd></div>}
        {(e.source || e.medium) && <div><dt>Source</dt><dd>{[e.source, e.medium].filter(Boolean).join(" / ")}</dd></div>}
        {e.clickId && <div><dt>Ad click</dt><dd>Google Ads click ID recorded</dd></div>}
        {e.referrer && <div><dt>Came from</dt><dd>{pagePath(e.referrer)}</dd></div>}
        {e.detail && <div><dt>Details</dt><dd>{e.detail}</dd></div>}
      </dl>}
    </div>
  </li>;
}

export function LeadHistoryButton({ contactId, phone, email, name, className = "" }: { contactId?: string | null; phone?: string | null; email?: string | null; name?: string; className?: string }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<LeadHistory | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    if (!open) return;
    let live = true; setData(null); setError("");
    const q = new URLSearchParams({ history: "1" }); if (contactId) q.set("contactId", contactId); if (phone) q.set("phone", phone); if (email) q.set("email", email);
    fetch(`/api/crm?${q}`, { credentials: "same-origin", cache: "no-store" }).then(async (r) => { if (!r.ok) throw new Error((await r.json().catch(() => ({})) as { error?: string }).error || "History couldn't load."); return r.json() as Promise<LeadHistory>; })
      .then((d) => { if (live) setData(d); }).catch((e) => { if (live) setError(e instanceof Error ? e.message : "History couldn't load."); });
    return () => { live = false; };
  }, [open, contactId, phone, email]);
  useEffect(() => { if (!open) return; const k = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); }; window.addEventListener("keydown", k); return () => window.removeEventListener("keydown", k); }, [open]);
  const disabled = !contactId && !phone && !email;
  return <>
    <button type="button" className={`lh-button ${className}`} disabled={disabled} title={disabled ? "No contact details to look up" : "Where this lead came from"} onClick={() => setOpen(true)}><History size={15} aria-hidden="true" /> History</button>
    {open && typeof document !== "undefined" && createPortal(<div className="lh-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(false); }}>
      <div className="lh-panel" role="dialog" aria-modal="true" aria-label={`History for ${name || data?.contact?.name || "this lead"}`}>
        <header><div><p className="eyebrow">LEAD HISTORY</p><h2>{data?.contact?.name || name || "This lead"}</h2></div><button type="button" className="lh-x" aria-label="Close" onClick={() => setOpen(false)}><X size={18} /></button></header>
        {error ? <div className="iv-error" role="alert">{error}</div> : !data ? <p className="lh-muted">Loading live history…</p> : <>
          <section className="lh-first">
            <small>First came from</small>
            {data.firstTouch ? <><div className="lh-first-main"><Chip label={data.firstTouch.channel} /><b>{data.firstTouch.campaign ? `Campaign: ${data.firstTouch.campaign}` : data.firstTouch.page ? pagePath(data.firstTouch.page) : data.firstTouch.title}</b></div><span className="lh-muted">{when(data.firstTouch.at)}</span></> : <span className="lh-muted">No tracked source yet.</span>}
          </section>
          {data.events.length ? <ol className="lh-list">{data.events.map((e, i) => <Row key={`${e.kind}-${e.at}-${i}`} e={e} />)}</ol> : <p className="lh-muted">No records found for this contact yet. Website forms, WhatsApp/SMS messages, deals and bookings appear here as they happen.</p>}
          <p className="lh-foot">Live records only: website form tracking (page, UTM campaign, Google Ads click ID, referrer), conversations, deals and bookings.</p>
        </>}
      </div>
    </div>, document.body)}
  </>;
}
