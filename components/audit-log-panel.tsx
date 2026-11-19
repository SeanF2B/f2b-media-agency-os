"use client";
import { Fragment, useEffect, useMemo, useState } from "react";

// Settings → Audit log (agency owner/admins): sign-ins, active time and calls.
type Data = {
  period: { start: string; end: string }; staff: Array<{ name: string; email: string; role: string }>;
  logins: Array<{ email: string; name: string; at: string; ip: string; place: string; device: string }>;
  active: Array<{ email: string; name: string; day: string; seconds: number; firstAt: string; lastAt: string; pages: Record<string, number> }>;
  calls: Array<{ id: string; client: string; direction: string; channel: string; trigger: string; number: string; contact: string; purpose: string; status: string; outcome: string; state: string; summary: string; durationSec: number; startedAt: string; endedAt: string; error: string; hasRecording: boolean }>;
  callSummary: { total: number; answered: number; unanswered: number; dropped: number; failed: number; talkSeconds: number; inbound: number; outbound: number };
};
const iso = (d: Date) => d.toISOString().slice(0, 10);
const PERIODS: Array<[string, string, number]> = [["1", "Today", 0], ["7", "Last 7 days", 6], ["30", "Last 30 days", 29], ["90", "Last 90 days", 89]];
const hm = (s: number) => { const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return h ? `${h}h ${m}m` : `${m}m`; };
const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
const when = (s: string) => s ? new Date(s).toLocaleString("en-IE", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
const time = (s: string) => s ? new Date(s).toLocaleTimeString("en-IE", { hour: "2-digit", minute: "2-digit" }) : "—";
const STATE: Record<string, string> = { answered: "Answered", unanswered: "Unanswered", dropped: "Dropped", failed: "Failed", cancelled: "Cancelled", "in progress": "In progress" };

export function AuditLogPanel() {
  const [period, setPeriod] = useState("7");
  const [email, setEmail] = useState("");
  const [tab, setTab] = useState<"logins" | "active" | "calls">("logins");
  const [callFilter, setCallFilter] = useState("");
  const [open, setOpen] = useState("");
  const [data, setData] = useState<Data | null>(null);
  const [err, setErr] = useState("");
  useEffect(() => {
    let live = true; setErr("");
    const back = PERIODS.find((p) => p[0] === period)![2], end = new Date();
    fetch(`/api/activity-log?${new URLSearchParams({ start: iso(new Date(end.getTime() - back * 86_400_000)), end: iso(end), ...(email ? { email } : {}) })}`, { cache: "no-store" })
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error || "Couldn’t load the audit log."); return j as Data; })
      .then((j) => { if (live) setData(j); }).catch((e) => { if (live) setErr(e instanceof Error ? e.message : "Couldn’t load the audit log."); });
    return () => { live = false; };
  }, [period, email]);

  const perPerson = useMemo(() => { const m = new Map<string, { name: string; seconds: number; days: number }>(); for (const a of data?.active || []) { const g = m.get(a.email) || { name: a.name, seconds: 0, days: 0 }; g.seconds += a.seconds; g.days++; m.set(a.email, g); } return [...m.entries()].sort((a, b) => b[1].seconds - a[1].seconds); }, [data]);
  const calls = (data?.calls || []).filter((c) => !callFilter || c.state === callFilter || c.direction === callFilter);
  const cs = data?.callSummary;

  return <section className="panel alp">
    <style>{CSS}</style>
    <div><p className="eyebrow">AGENCY ONLY</p><h2>Audit log</h2><p className="alp-sub">Who signed in and when, how long each person was actively working (mouse, keyboard or touch use while the OS is open), and every phone call with talk time, unanswered and dropped calls.</p></div>
    <div className="alp-bar">
      <div className="alp-seg">{PERIODS.map(([k, l]) => <button key={k} type="button" className={period === k ? "on" : ""} onClick={() => setPeriod(k)}>{l}</button>)}</div>
      <select value={email} onChange={(e) => setEmail(e.target.value)} aria-label="Team member"><option value="">Everyone</option>{(data?.staff || []).map((s) => <option key={s.email} value={s.email}>{s.name}</option>)}</select>
    </div>
    <div className="alp-tabs" role="tablist">{([["logins", "Sign-ins"], ["active", "Active time"], ["calls", "Calls"]] as const).map(([k, l]) => <button key={k} type="button" role="tab" aria-selected={tab === k} className={tab === k ? "on" : ""} onClick={() => setTab(k)}>{l}</button>)}</div>
    {err && <p className="alp-muted">{err}</p>}
    {!data && !err && <p className="alp-muted">Loading…</p>}

    {data && tab === "logins" && <div className="alp-wrap"><table className="alp-table"><thead><tr><th>When</th><th>Who</th><th>Where</th><th>Device</th><th>IP</th></tr></thead><tbody>
      {data.logins.map((l, i) => <tr key={i}><td>{when(l.at)}</td><td><b>{l.name}</b><small>{l.email}</small></td><td>{l.place || "—"}</td><td>{l.device}</td><td><small>{l.ip}</small></td></tr>)}
      {!data.logins.length && <tr><td colSpan={5} className="alp-muted">No sign-ins recorded in this period. Sign-ins are recorded from today.</td></tr>}
    </tbody></table></div>}

    {data && tab === "active" && <>
      {perPerson.length > 0 && <div className="alp-kpis">{perPerson.map(([em, p]) => <div key={em}><small>{p.name}</small><b>{hm(p.seconds)}</b><em>{p.days} day{p.days === 1 ? "" : "s"} · avg {hm(Math.round(p.seconds / Math.max(1, p.days)))}/day</em></div>)}</div>}
      <div className="alp-wrap"><table className="alp-table"><thead><tr><th>Day</th><th>Who</th><th>Active</th><th>First</th><th>Last</th><th>Where the time went</th></tr></thead><tbody>
        {data.active.map((a, i) => <tr key={i}><td>{new Date(`${a.day}T12:00:00Z`).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short" })}</td><td><b>{a.name}</b></td><td><b>{hm(a.seconds)}</b></td><td>{time(a.firstAt)}</td><td>{time(a.lastAt)}</td><td><small>{Object.entries(a.pages).sort((x, y) => y[1] - x[1]).slice(0, 5).map(([p, s]) => `${p || "Other"} ${hm(s)}`).join(" · ")}</small></td></tr>)}
        {!data.active.length && <tr><td colSpan={6} className="alp-muted">No active time recorded in this period. Active time is recorded from today.</td></tr>}
      </tbody></table></div>
    </>}

    {data && tab === "calls" && cs && <>
      <div className="alp-kpis">
        <div><small>Calls</small><b>{cs.total}</b><em>{cs.inbound} in · {cs.outbound} out</em></div>
        <div><small>Time on calls</small><b>{hm(cs.talkSeconds)}</b><em>avg {cs.answered ? mmss(Math.round(cs.talkSeconds / Math.max(1, cs.answered + cs.dropped))) : "—"}</em></div>
        <div className="good"><small>Answered</small><b>{cs.answered}</b></div>
        <div className="warn"><small>Unanswered</small><b>{cs.unanswered}</b><em>no answer, busy, voicemail</em></div>
        <div className="bad"><small>Dropped</small><b>{cs.dropped}</b><em>ended under 15s</em></div>
        <div className="bad"><small>Failed</small><b>{cs.failed}</b></div>
      </div>
      <div className="alp-seg">{[["", "All"], ["answered", "Answered"], ["unanswered", "Unanswered"], ["dropped", "Dropped"], ["failed", "Failed"], ["inbound", "Inbound"], ["outbound", "Outbound"]].map(([k, l]) => <button key={k} type="button" className={callFilter === k ? "on" : ""} onClick={() => setCallFilter(k)}>{l}</button>)}</div>
      <div className="alp-wrap"><table className="alp-table"><thead><tr><th>When</th><th>Direction</th><th>Contact</th><th>Client</th><th>Result</th><th>Length</th></tr></thead><tbody>
        {calls.map((c) => <Fragment key={c.id}><tr className="alp-click" onClick={() => setOpen(open === c.id ? "" : c.id)}><td>{when(c.startedAt)}</td><td>{c.direction === "inbound" ? "↙ In" : "↗ Out"}{c.channel !== "phone" ? ` · ${c.channel}` : ""}</td><td><b>{c.contact || c.number || "Unknown"}</b>{c.contact && <small>{c.number}</small>}</td><td>{c.client || "—"}</td><td><span className={`alp-state ${c.state.replace(" ", "-")}`}>{STATE[c.state] || c.state}</span>{c.outcome && <small>{c.outcome.replace(/_/g, " ")}</small>}</td><td>{c.durationSec ? mmss(c.durationSec) : "—"}</td></tr>
          {open === c.id && <tr className="alp-detail"><td colSpan={6}><div><span>Started <b>{when(c.startedAt)}</b></span><span>Ended <b>{when(c.endedAt)}</b></span><span>Status <b>{c.status}</b></span>{c.trigger && <span>Trigger <b>{c.trigger}</b></span>}{c.purpose && <span>Purpose <b>{c.purpose}</b></span>}{c.hasRecording && <span>Recording saved in Conversations</span>}</div>{c.summary && <p>{c.summary}</p>}{c.error && <p className="bad">{c.error}</p>}</td></tr>}</Fragment>)}
        {!calls.length && <tr><td colSpan={6} className="alp-muted">No calls in this period.</td></tr>}
      </tbody></table></div>
    </>}
  </section>;
}

const CSS = `
.alp{display:flex;flex-direction:column;gap:12px}
.alp .alp-sub{margin:4px 0 0;font-size:13px;opacity:.7;max-width:760px}.alp .alp-muted{font-size:12.5px;opacity:.65}
.alp .alp-bar{display:flex;gap:10px;flex-wrap:wrap;align-items:center}
.alp .alp-bar select{padding:7px 10px;border-radius:10px;border:1px solid rgba(127,127,127,.28);background:transparent;color:inherit;font:inherit}
.alp .alp-seg,.alp .alp-tabs{display:inline-flex;flex-wrap:wrap;gap:3px;padding:3px;border-radius:11px;background:color-mix(in srgb,currentColor 6%,transparent);align-self:flex-start}
.alp .alp-seg button,.alp .alp-tabs button{border:0;background:transparent;color:inherit;font:inherit;font-size:13px;font-weight:700;padding:6px 12px;border-radius:8px;cursor:pointer}
.alp .alp-seg button.on,.alp .alp-tabs button.on{background:var(--brand-primary,#101828);color:#fff}
.alp .alp-kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px}
.alp .alp-kpis>div{border-radius:12px;padding:9px 12px;background:color-mix(in srgb,currentColor 3%,transparent);display:flex;flex-direction:column}
.alp .alp-kpis small{font-size:12px;opacity:.7}.alp .alp-kpis b{font-size:20px}.alp .alp-kpis em{font-style:normal;font-size:11.5px;opacity:.6}
.alp .alp-kpis .good{background:#effaf3}.alp .alp-kpis .good b{color:#157a43}.alp .alp-kpis .warn{background:#fff7e6}.alp .alp-kpis .warn b{color:#b45309}.alp .alp-kpis .bad{background:#fdf0f0}.alp .alp-kpis .bad b{color:#b42318}
.alp .alp-wrap{overflow-x:auto}
.alp .alp-table{width:100%;border-collapse:collapse;font-size:13px}
.alp .alp-table th{text-align:left;font-size:11px;text-transform:uppercase;letter-spacing:.04em;opacity:.6;padding:6px 8px;border-bottom:1px solid rgba(127,127,127,.18);position:sticky;top:0;background:var(--f2b-white,#fff)}
.alp .alp-table td{padding:7px 8px;border-bottom:1px solid rgba(127,127,127,.08);vertical-align:top}
.alp .alp-table td small{display:block;opacity:.65}
.alp .alp-click{cursor:pointer}.alp .alp-click:hover{background:rgba(127,127,127,.05)}
.alp .alp-detail td{background:rgba(127,127,127,.04)}.alp .alp-detail div{display:flex;flex-wrap:wrap;gap:6px 16px;font-size:12.5px}.alp .alp-detail p{margin:6px 0 0;font-size:13px}
.alp .alp-state{display:inline-block;font-size:11px;font-weight:800;padding:2px 8px;border-radius:999px;background:#f1f5f9;color:#475569}
.alp .alp-state.answered{background:#dcfce7;color:#166534}.alp .alp-state.unanswered{background:#fef3c7;color:#92400e}.alp .alp-state.dropped,.alp .alp-state.failed{background:#fee2e2;color:#991b1b}
.alp .bad{color:#b42318}
`;
