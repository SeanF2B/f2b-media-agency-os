"use client";

import { useEffect, useMemo, useState } from "react";
import { CalendarDays, ClipboardCheck, ExternalLink, FileBarChart2, KeyRound, Search } from "lucide-react";

// Client workroom → Reports folder: every saved report, audit and keyword research for this client in
// one place, filterable by month and day. Reports are saved here automatically when generated.
type SavedReport = { id: string; type: "ads" | "seo" | "audit" | "audit-ads" | "audit-website" | "keywords"; periodStart: string; periodEnd: string; kind: string; createdAt: string; summary?: { leads?: number | null; wonRevenue?: number | null; groups?: string[]; keywords?: number | null } };
export type FolderSection = "reports" | "audits" | "keywords";
const AUDIT_LABEL: Record<string, string> = { audit: "Marketing audit", "audit-ads": "Google Ads audit", "audit-website": "Website audit" };
const isAudit = (type: string) => type.startsWith("audit");
const kwName = (r: SavedReport) => r.summary?.groups?.length ? r.summary.groups.join(", ") : "Keyword research";
type AuditRun = { id: string; clientId: string; service: string; createdAt: string; period: string; status: string; summary: string; findings?: Array<{ id: string; title: string; priority: string; recommendation: string }> };
type Keyword = { id: string; keyword: string; location: string; groupId: string; avgMonthlySearches: number | null; createdAt: string };
type Group = { id: string; name: string };

const day = (iso: string) => (iso || "").slice(0, 10);
const month = (iso: string) => (iso || "").slice(0, 7);
const fmtDay = (iso: string) => iso ? new Date(iso.length === 10 ? `${iso}T00:00:00` : iso).toLocaleDateString("en-IE", { weekday: "short", day: "numeric", month: "short", year: "numeric" }) : "";
const fmtMonth = (ym: string) => new Date(`${ym}-01T00:00:00`).toLocaleDateString("en-IE", { month: "long", year: "numeric" });

export function ClientFolder({ clientId, clientName, auditRuns, initialSection = "reports" }: { clientId: string; clientName: string; auditRuns: AuditRun[]; initialSection?: FolderSection }) {
  const [section, setSection] = useState<FolderSection>(initialSection);
  useEffect(() => { setSection(initialSection); }, [initialSection]);
  const [reports, setReports] = useState<SavedReport[] | null>(null);
  const [kw, setKw] = useState<{ keywords: Keyword[]; groups: Group[] } | null>(null);
  const [monthFilter, setMonthFilter] = useState("");
  const [dayFilter, setDayFilter] = useState("");
  const [openAudit, setOpenAudit] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    setReports(null); setKw(null); setError("");
    void fetch(`/api/client-reports?clientId=${encodeURIComponent(clientId)}&history=1`, { cache: "no-store" }).then((r) => r.json()).then((j: { reports?: SavedReport[] }) => setReports(j.reports || [])).catch(() => setReports([]));
    void fetch(`/api/seo/saved-keywords?clientId=${encodeURIComponent(clientId)}`, { cache: "no-store" }).then((r) => r.json()).then((j: { keywords?: Keyword[]; groups?: Group[] }) => setKw({ keywords: j.keywords || [], groups: j.groups || [] })).catch(() => setKw({ keywords: [], groups: [] }));
  }, [clientId]);

  const audits = useMemo(() => auditRuns.filter((run) => run.clientId === clientId), [auditRuns, clientId]);
  // Keyword research is grouped by the day it was saved (one "research session" per day and group).
  const sessions = useMemo(() => {
    const map = new Map<string, { key: string; date: string; group: string; keywords: Keyword[] }>();
    for (const item of kw?.keywords || []) {
      const group = kw?.groups.find((g) => g.id === item.groupId)?.name || "Ungrouped";
      const key = `${day(item.createdAt)}|${group}`;
      const entry = map.get(key) || { key, date: item.createdAt, group, keywords: [] };
      entry.keywords.push(item); map.set(key, entry);
    }
    return [...map.values()].sort((a, b) => b.date.localeCompare(a.date));
  }, [kw]);

  const perf = (reports || []).filter((r) => r.type === "ads" || r.type === "seo");
  const savedAudits = (reports || []).filter((r) => isAudit(r.type));
  const savedKw = (reports || []).filter((r) => r.type === "keywords");
  const dates = section === "reports" ? perf.map((r) => r.createdAt) : section === "audits" ? [...audits.map((a) => a.createdAt), ...savedAudits.map((r) => r.createdAt)] : [...sessions.map((s) => s.date), ...savedKw.map((r) => r.createdAt)];
  const months = [...new Set(dates.map(month).filter(Boolean))].sort().reverse();
  const keep = (iso: string) => (!monthFilter || month(iso) === monthFilter) && (!dayFilter || day(iso) === dayFilter);

  const openReport = async (item: SavedReport) => {
    try {
      const response = await fetch(`/api/client-reports?clientId=${encodeURIComponent(clientId)}&archiveId=${encodeURIComponent(item.id)}`, { cache: "no-store" });
      if (!response.ok) throw new Error("That report could not be opened.");
      const html = await response.text(); const win = window.open("", "_blank"); if (!win) throw new Error("Allow pop-ups to open the report.");
      win.document.open(); win.document.write(html); win.document.close();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "That report could not be opened."); }
  };

  const savedRow = (r: SavedReport, label: string, badge: string) => <button key={r.id} type="button" className="cfolder-row" onClick={() => void openReport(r)}><span className={`cfolder-badge ${badge}`}>{label}</span><span className="cfolder-main"><b>{r.type === "keywords" ? kwName(r) : `${label} · ${fmtDay(r.periodStart)} – ${fmtDay(r.periodEnd)}`}</b><small>{r.type === "keywords" ? `${r.summary?.keywords != null ? `${r.summary.keywords} keywords · ` : ""}` : ""}Saved {fmtDay(r.createdAt)}</small></span><ExternalLink size={15} aria-hidden="true" /></button>;
  const counts = { reports: perf.length, audits: audits.length + savedAudits.length, keywords: sessions.length + savedKw.length };
  return <section className="cfolder" aria-label={`${clientName} reports folder`}>
    <div className="workroom-head"><div><h3>🗂 Reports folder</h3><p>Every report, audit and keyword research for {clientName}, saved automatically.</p></div></div>
    <div className="cfolder-bar">
      <span className="cfolder-tabs" role="tablist" aria-label="Folder sections">
        {([["reports", "Reports", FileBarChart2], ["audits", "Audits", ClipboardCheck], ["keywords", "Keyword research", KeyRound]] as const).map(([key, label, Icon]) => <button key={key} type="button" role="tab" aria-selected={section === key} className={section === key ? "on" : ""} onClick={() => { setSection(key); setMonthFilter(""); setDayFilter(""); }}><Icon size={14} aria-hidden="true" />{label}<i>{counts[key]}</i></button>)}
      </span>
      <span className="cfolder-filters">
        <label><CalendarDays size={14} aria-hidden="true" /><select value={monthFilter} onChange={(e) => { setMonthFilter(e.target.value); setDayFilter(""); }} aria-label="Month"><option value="">All months</option>{months.map((m) => <option key={m} value={m}>{fmtMonth(m)}</option>)}</select></label>
        <label><Search size={14} aria-hidden="true" /><input type="date" value={dayFilter} onChange={(e) => { setDayFilter(e.target.value); if (e.target.value) setMonthFilter(month(e.target.value)); }} aria-label="Day" /></label>
        {(monthFilter || dayFilter) && <button type="button" className="text-button" onClick={() => { setMonthFilter(""); setDayFilter(""); }}>Clear</button>}
      </span>
    </div>
    {error && <p className="form-error">{error}</p>}

    {section === "reports" && (reports === null ? <div className="page-loading" role="status" aria-label="Loading reports…"><i /></div> : (() => { const list = perf.filter((r) => keep(r.createdAt)); return list.length ? <div className="cfolder-list">{list.map((r) => <button key={r.id} type="button" className="cfolder-row" onClick={() => void openReport(r)}>
      <span className={`cfolder-badge ${r.type}`}>{r.type === "ads" ? "Google Ads" : "SEO"}</span>
      <span className="cfolder-main"><b>{r.type === "ads" ? "Google Ads report" : "SEO report"} · {fmtDay(r.periodStart)} – {fmtDay(r.periodEnd)}</b><small>Saved {fmtDay(r.createdAt)}{r.kind === "monthly" ? " · monthly (automatic)" : ""}{r.summary?.leads != null ? ` · ${r.summary.leads} leads` : ""}</small></span>
      <ExternalLink size={15} aria-hidden="true" />
    </button>)}</div> : <p className="empty-note">{perf.length ? "No reports on that date." : "No reports yet. Reports you generate in Operations → Reports are saved here automatically."}</p>; })())}

    {section === "audits" && (() => { const list = audits.filter((a) => keep(a.createdAt)); const saved = savedAudits.filter((r) => keep(r.createdAt)); return list.length || saved.length ? <div className="cfolder-list">{saved.map((r) => savedRow(r, AUDIT_LABEL[r.type] || "Audit", "audit"))}{list.map((a) => <div key={a.id} className="cfolder-item">
      <button type="button" className="cfolder-row" onClick={() => setOpenAudit(openAudit === a.id ? "" : a.id)}>
        <span className="cfolder-badge audit">{a.service === "Full Marketing" ? "Full audit" : a.service}</span>
        <span className="cfolder-main"><b>{a.service} audit · {a.period}</b><small>{fmtDay(a.createdAt)} · {(a.findings || []).length} findings</small></span>
        <span aria-hidden="true">{openAudit === a.id ? "▾" : "▸"}</span>
      </button>
      {openAudit === a.id && <div className="cfolder-detail"><p>{a.summary}</p>{(a.findings || []).length > 0 && <ul>{(a.findings || []).map((f) => <li key={f.id}><b className={`cfolder-pri ${f.priority}`}>{f.priority}</b> {f.title}<small>{f.recommendation}</small></li>)}</ul>}</div>}
    </div>)}</div> : <p className="empty-note">{audits.length || savedAudits.length ? "No audits on that date." : "No audits yet. Audits run in Operations → Reports → Audits appear here."}</p>; })()}

    {section === "keywords" && (kw === null ? <div className="page-loading" role="status" aria-label="Loading keyword research…"><i /></div> : (() => { const list = sessions.filter((s) => keep(s.date)); const saved = savedKw.filter((r) => keep(r.createdAt)); return list.length || saved.length ? <div className="cfolder-list">{saved.map((r) => savedRow(r, "Keyword report", "kw"))}{list.map((s) => <details key={s.key} className="cfolder-item">
      <summary className="cfolder-row"><span className="cfolder-badge kw">{s.group}</span><span className="cfolder-main"><b>{s.keywords.length} keyword{s.keywords.length === 1 ? "" : "s"} · {s.group}</b><small>{fmtDay(s.date)}{s.keywords[0]?.location ? ` · ${s.keywords[0].location}` : ""}</small></span><span aria-hidden="true">▸</span></summary>
      <div className="cfolder-detail"><table className="cfolder-kw"><thead><tr><th>Keyword</th><th>Monthly searches</th></tr></thead><tbody>{s.keywords.map((k) => <tr key={k.id}><td>{k.keyword}</td><td>{k.avgMonthlySearches == null ? "—" : k.avgMonthlySearches.toLocaleString("en-IE")}</td></tr>)}</tbody></table></div>
    </details>)}</div> : <p className="empty-note">{sessions.length || savedKw.length ? "No keyword research on that date." : "No keyword research saved yet. Keywords saved in Operations → SEO & AI → Keywords appear here."}</p>; })())}
  </section>;
}

async function openSavedReport(clientId: string, id: string) {
  const win = window.open("", "_blank");
  if (!win) throw new Error("Allow pop-ups to open the report.");
  const response = await fetch(`/api/client-reports?clientId=${encodeURIComponent(clientId)}&archiveId=${encodeURIComponent(id)}`, { cache: "no-store" });
  if (!response.ok) { win.close(); throw new Error("That report could not be opened."); }
  const html = await response.text();
  win.document.open(); win.document.write(html); win.document.close();
}

type RecentItem = { id: string; at: string; badge: string; badgeClass: string; title: string; detail: string; archiveId?: string; section: FolderSection };

// Client workroom → Recent reports: the latest reports, audits and keyword research generated in Operations,
// each with a live thumbnail of the saved report and its date period (or keyword group names).
export function ClientRecentReports({ clientId, clientName, auditRuns, onOpenFolder, onCount }: { clientId: string; clientName: string; auditRuns: AuditRun[]; onOpenFolder: (section: FolderSection) => void; onCount?: (count: number) => void }) {
  const [reports, setReports] = useState<SavedReport[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let live = true; setReports(null); setError("");
    void fetch(`/api/client-reports?clientId=${encodeURIComponent(clientId)}&history=1`, { cache: "no-store" }).then((r) => r.json()).then((j: { reports?: SavedReport[] }) => { if (live) setReports(j.reports || []); }).catch(() => { if (live) setReports([]); });
    return () => { live = false; };
  }, [clientId]);
  const items = useMemo<RecentItem[]>(() => {
    const period = (r: SavedReport) => `${fmtDay(r.periodStart)} – ${fmtDay(r.periodEnd)}`;
    const saved = (reports || []).map((r): RecentItem => r.type === "keywords"
      ? { id: r.id, at: r.createdAt, badge: "Keyword research", badgeClass: "kw", title: kwName(r), detail: `${r.summary?.keywords != null ? `${r.summary.keywords} keywords · ` : ""}${fmtDay(r.createdAt)}`, archiveId: r.id, section: "keywords" }
      : isAudit(r.type)
        ? { id: r.id, at: r.createdAt, badge: AUDIT_LABEL[r.type] || "Audit", badgeClass: "audit", title: AUDIT_LABEL[r.type] || "Audit", detail: period(r), archiveId: r.id, section: "audits" }
        : { id: r.id, at: r.createdAt, badge: r.type === "ads" ? "Google Ads" : "SEO", badgeClass: r.type, title: r.type === "ads" ? "Google Ads performance" : "SEO performance", detail: `${period(r)}${r.kind === "monthly" ? " · monthly" : ""}`, archiveId: r.id, section: "reports" });
    const runs = auditRuns.filter((a) => a.clientId === clientId).map((a): RecentItem => ({ id: a.id, at: a.createdAt, badge: a.service === "Full Marketing" ? "Full audit" : `${a.service} audit`, badgeClass: "audit", title: `${a.service} audit`, detail: `${a.period} · ${(a.findings || []).length} findings`, section: "audits" }));
    return [...saved, ...runs].sort((x, y) => (y.at || "").localeCompare(x.at || ""));
  }, [reports, auditRuns, clientId]);
  useEffect(() => { if (reports !== null) onCount?.(items.length); }, [items.length, reports, onCount]);
  const open = async (item: RecentItem) => {
    if (!item.archiveId) { onOpenFolder(item.section); return; }
    try { setError(""); await openSavedReport(clientId, item.archiveId); } catch (reason) { setError(reason instanceof Error ? reason.message : "That report could not be opened."); }
  };
  return <section className="client-report-shortcuts" aria-label={`${clientName} recent reports`}>
    <div className="client-report-shortcuts-head"><div><h3>📑 Recent reports</h3><p>Reports, audits and keyword research generated in Operations for this client.</p></div><button type="button" className="text-button" onClick={() => onOpenFolder("reports")}>View all client reports ↗</button></div>
    {error && <p className="form-error">{error}</p>}
    {reports === null ? <div className="page-loading" role="status" aria-label="Loading reports…"><i /></div> : items.length ? <div className="crecent-grid">{items.slice(0, 6).map((item) => <button key={item.id} type="button" className="crecent-card" onClick={() => void open(item)} title={`Open ${item.title}`}>
      <span className="crecent-thumb" aria-hidden="true">{item.archiveId
        ? <iframe src={`/api/client-reports?clientId=${encodeURIComponent(clientId)}&archiveId=${encodeURIComponent(item.archiveId)}`} loading="lazy" tabIndex={-1} sandbox="" title="" />
        : <span className="crecent-text"><ClipboardCheck size={22} /><b>{item.title}</b><small>{item.detail}</small></span>}
        <span className="crecent-period">{item.section === "keywords" ? item.title : item.detail.split(" · ")[0]}</span>
      </span>
      <span className="crecent-meta"><span className={`cfolder-badge ${item.badgeClass}`}>{item.badge}</span><b>{item.title}</b><small>{item.detail}</small></span>
    </button>)}</div> : <p className="client-report-shortcuts-empty">No reports yet. Reports, audits and keyword research generated in Operations → Reports are saved here automatically.</p>}
  </section>;
}
