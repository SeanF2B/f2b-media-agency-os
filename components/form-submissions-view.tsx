"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Client = { id: string; name: string };
type Submission = { id: string; submittedAt: string; clientId: string; clientName: string; source: string; formKey: string; formName: string; pageUrl: string; pagePath: string; name: string; email: string; phone: string; message: string; contactId: string };
type Payload = { error?: string; total: number; previousTotal: number; rows: Submission[]; byForm: Array<{ key: string; name: string; clientName: string; count: number }>; byPage: Array<{ path: string; url: string; count: number }>; byClient: Array<{ clientId: string; name: string; count: number }>; daily: Array<{ day: string; count: number }> };

const PRESETS = [
  ["today", "Today"], ["yesterday", "Yesterday"], ["7d", "Last 7 days"], ["30d", "Last 30 days"], ["thisMonth", "This month"],
  ["lastMonth", "Last month"], ["90d", "Last 90 days"], ["thisYear", "This year"], ["12m", "Last 12 months"], ["custom", "Custom range"],
] as const;
type Preset = (typeof PRESETS)[number][0];

const dayStart = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const addDays = (date: Date, days: number) => new Date(date.getFullYear(), date.getMonth(), date.getDate() + days);
const inputDate = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const parseInput = (value: string) => { const [y, m, d] = value.split("-").map(Number); return y && m && d ? new Date(y, m - 1, d) : null; };

/** Local-time [start, end) for a preset; custom uses the two inclusive date pickers. */
function rangeFor(preset: Preset, customFrom: string, customTo: string): { start: Date; end: Date } {
  const today = dayStart(new Date()), tomorrow = addDays(today, 1);
  switch (preset) {
    case "today": return { start: today, end: tomorrow };
    case "yesterday": return { start: addDays(today, -1), end: today };
    case "7d": return { start: addDays(today, -6), end: tomorrow };
    case "30d": return { start: addDays(today, -29), end: tomorrow };
    case "90d": return { start: addDays(today, -89), end: tomorrow };
    case "thisMonth": return { start: new Date(today.getFullYear(), today.getMonth(), 1), end: tomorrow };
    case "lastMonth": return { start: new Date(today.getFullYear(), today.getMonth() - 1, 1), end: new Date(today.getFullYear(), today.getMonth(), 1) };
    case "thisYear": return { start: new Date(today.getFullYear(), 0, 1), end: tomorrow };
    case "12m": return { start: new Date(today.getFullYear() - 1, today.getMonth(), today.getDate() + 1), end: tomorrow };
    default: {
      const from = parseInput(customFrom) || addDays(today, -29), to = parseInput(customTo) || today;
      return from <= to ? { start: from, end: addDays(to, 1) } : { start: to, end: addDays(from, 1) };
    }
  }
}

const sourceLabel: Record<string, string> = { "os-form": "OS form", "site-form": "Website form", "site-lead": "Website contact" };
const fmtDate = (value: string) => new Date(value).toLocaleString(undefined, { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join("") || "?";
const hue = (text: string) => [...text].reduce((total, char) => (total * 31 + char.charCodeAt(0)) % 360, 7);

function Icon({ d, size = 15 }: { d: string; size?: number }) {
  return <svg className="crm-ico" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={d} /></svg>;
}
const ICON = {
  mail: "M4 6h16v12H4z M4 7l8 6 8-6",
  phone: "M5 4h4l2 5-2.5 1.5a11 11 0 0 0 5 5L15 13l5 2v4a2 2 0 0 1-2 2A16 16 0 0 1 3 6a2 2 0 0 1 2-2",
  calendar: "M4 6h16v14H4z M4 10h16 M8 3v4 M16 3v4",
  download: "M12 4v11 M7 10l5 5 5-5 M5 20h14",
  refresh: "M20 11a8 8 0 1 0-2.3 5.7 M20 4v7h-7",
  search: "M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z M20 20l-4-4",
  page: "M6 3h9l4 4v14H6z M14 3v5h5",
  form: "M5 4h14v16H5z M8 8h8 M8 12h8 M8 16h5",
  up: "M7 14l5-5 5 5",
  down: "M7 10l5 5 5-5",
};

export function FormSubmissionsView({ scopeClientId, clients, active }: { scopeClientId: string; clients: Client[]; active: boolean }) {
  const [preset, setPreset] = useState<Preset>("30d");
  const today = useMemo(() => dayStart(new Date()), []);
  const [customFrom, setCustomFrom] = useState(inputDate(addDays(today, -29)));
  const [customTo, setCustomTo] = useState(inputDate(today));
  const [clientFilter, setClientFilter] = useState("all");
  const [formFilter, setFormFilter] = useState("");
  const [pageFilter, setPageFilter] = useState("");
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [pageSize, setPageSize] = useState(20);
  const [offset, setOffset] = useState(0);
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState<Submission | null>(null);

  const effectiveClient = scopeClientId || clientFilter;
  const range = useMemo(() => rangeFor(preset, customFrom, customTo), [preset, customFrom, customTo]);
  useEffect(() => { const timer = setTimeout(() => setDebounced(query.trim()), 300); return () => clearTimeout(timer); }, [query]);
  useEffect(() => { setOffset(0); }, [effectiveClient, formFilter, pageFilter, debounced, range.start.getTime(), range.end.getTime(), pageSize]);
  useEffect(() => { setFormFilter(""); setPageFilter(""); }, [scopeClientId]);

  const params = useMemo(() => {
    const search = new URLSearchParams({ start: range.start.toISOString(), end: range.end.toISOString(), clientId: effectiveClient || "all", limit: String(pageSize), offset: String(offset) });
    if (formFilter) search.set("form", formFilter);
    if (pageFilter) search.set("page", pageFilter);
    if (debounced) search.set("q", debounced);
    return search;
  }, [range, effectiveClient, pageSize, offset, formFilter, pageFilter, debounced]);

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      const response = await fetch(`/api/form-submissions?${params}`, { cache: "no-store" });
      const payload = await response.json() as Payload;
      if (!response.ok) throw new Error(payload.error || "Could not load form submissions.");
      setData(payload);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load form submissions."); }
    finally { setLoading(false); }
  }, [params]);
  useEffect(() => { if (active) void load(); }, [active, load]);

  const exportUrl = useMemo(() => { const search = new URLSearchParams(params); search.delete("limit"); search.delete("offset"); search.set("format", "csv"); return `/api/form-submissions?${search}`; }, [params]);
  const total = data?.total || 0;
  const change = data && data.previousTotal ? Math.round(((data.total - data.previousTotal) / data.previousTotal) * 100) : null;
  const maxForm = Math.max(1, ...(data?.byForm || []).map((item) => item.count));
  const maxPage = Math.max(1, ...(data?.byPage || []).map((item) => item.count));
  const maxDay = Math.max(1, ...(data?.daily || []).map((item) => item.count));
  const days = useMemo(() => {
    const counts = new Map((data?.daily || []).map((item) => [item.day, item.count]));
    const list: Array<{ day: string; count: number }> = [];
    const spanDays = Math.round((range.end.getTime() - range.start.getTime()) / 86_400_000);
    if (spanDays > 120) return [];
    for (let cursor = range.start; cursor < range.end; cursor = addDays(cursor, 1)) { const key = inputDate(cursor); list.push({ day: key, count: counts.get(key) || 0 }); }
    return list;
  }, [data, range]);
  const rangeText = `${range.start.toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })} – ${addDays(range.end, -1).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" })}`;
  const showClientCol = !scopeClientId && clientFilter === "all";

  return (
    <section className="crm-contacts-manager fsub" aria-label="Form submissions">
      <div className="fsub-head">
        <div>
          <h2>Form submissions</h2>
          <p>Every website and OS form lead, tracked by form, page{scopeClientId ? "" : " and client"}.</p>
        </div>
        <div className="fsub-dates">
          <label className="cm-tool fsub-preset"><Icon d={ICON.calendar} /><span className="sr-only">Date period</span>
            <select value={preset} onChange={(event) => setPreset(event.target.value as Preset)}>{PRESETS.map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select>
          </label>
          {preset === "custom" ? <>
            <label className="fsub-date"><span className="sr-only">From</span><input type="date" value={customFrom} max={customTo || undefined} onChange={(event) => setCustomFrom(event.target.value)} /></label>
            <span aria-hidden="true">→</span>
            <label className="fsub-date"><span className="sr-only">To</span><input type="date" value={customTo} min={customFrom || undefined} max={inputDate(today)} onChange={(event) => setCustomTo(event.target.value)} /></label>
          </> : <span className="fsub-range">{rangeText}</span>}
          <a className="cm-tool" href={exportUrl} download><Icon d={ICON.download} />Export</a>
          <button type="button" className="cm-tool" onClick={() => void load()} disabled={loading} aria-label="Refresh"><Icon d={ICON.refresh} /></button>
        </div>
      </div>

      <div className="fsub-stats">
        <div className="cm-card fsub-total">
          <span className="fsub-label">Total submissions</span>
          <b>{loading && !data ? "…" : total.toLocaleString()}</b>
          <small className={change === null ? "" : change >= 0 ? "up" : "down"}>{change === null ? (data?.previousTotal === 0 && total ? "New this period" : "No earlier data") : <><Icon d={change >= 0 ? ICON.up : ICON.down} size={13} />{Math.abs(change)}% vs previous period</>}</small>
          {days.length > 1 && <div className="fsub-spark" aria-label="Submissions per day">{days.map((item) => <i key={item.day} title={`${item.day}: ${item.count}`} style={{ height: `${Math.max(4, (item.count / maxDay) * 100)}%` }} className={item.count ? "on" : ""} />)}</div>}
        </div>
        {!scopeClientId && <div className="cm-card fsub-break">
          <span className="fsub-label">By client</span>
          <div className="fsub-bars">{(data?.byClient || []).length ? data!.byClient.map((item) => <button type="button" key={item.clientId} className={clientFilter === item.clientId ? "on" : ""} onClick={() => setClientFilter(clientFilter === item.clientId ? "all" : item.clientId)}><span>{item.name}</span><b>{item.count}</b></button>) : <p className="fsub-empty">No submissions in this period.</p>}</div>
        </div>}
        <div className="cm-card fsub-break">
          <span className="fsub-label"><Icon d={ICON.form} size={13} /> By form</span>
          <div className="fsub-bars">{(data?.byForm || []).length ? data!.byForm.map((item) => <button type="button" key={item.key} className={formFilter === item.key ? "on" : ""} onClick={() => setFormFilter(formFilter === item.key ? "" : item.key)}><span>{item.name}{showClientCol && <small> · {item.clientName}</small>}</span><b>{item.count}</b><i style={{ width: `${(item.count / maxForm) * 100}%` }} /></button>) : <p className="fsub-empty">No forms submitted yet.</p>}</div>
        </div>
        <div className="cm-card fsub-break">
          <span className="fsub-label"><Icon d={ICON.page} size={13} /> By page</span>
          <div className="fsub-bars">{(data?.byPage || []).length ? data!.byPage.map((item) => <button type="button" key={item.path || "unknown"} className={pageFilter === item.path ? "on" : ""} onClick={() => setPageFilter(pageFilter === item.path ? "" : item.path)} title={item.url}><span>{item.path || "Page not recorded"}</span><b>{item.count}</b><i style={{ width: `${(item.count / maxPage) * 100}%` }} /></button>) : <p className="fsub-empty">No pages recorded yet.</p>}</div>
        </div>
      </div>

      <div className="cm-card">
        <div className="cm-toolbar">
          {!scopeClientId && <label className="cm-tool cm-sort"><span className="sr-only">Client</span><select value={clientFilter} onChange={(event) => setClientFilter(event.target.value)}><option value="all">All clients</option><option value="agency">F2B Media (agency)</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label>}
          <label className="cm-tool cm-sort"><span className="sr-only">Form</span><select value={formFilter} onChange={(event) => setFormFilter(event.target.value)}><option value="">All forms</option>{(data?.byForm || []).map((item) => <option key={item.key} value={item.key}>{item.name}</option>)}</select></label>
          <label className="cm-tool cm-sort"><span className="sr-only">Page</span><select value={pageFilter} onChange={(event) => setPageFilter(event.target.value)}><option value="">All pages</option>{(data?.byPage || []).map((item) => <option key={item.path || "unknown"} value={item.path}>{item.path || "Page not recorded"}</option>)}</select></label>
          {(formFilter || pageFilter || (!scopeClientId && clientFilter !== "all")) && <button type="button" className="cm-tool" onClick={() => { setFormFilter(""); setPageFilter(""); setClientFilter("all"); }}>Clear filters</button>}
          <span className="cm-count">{total.toLocaleString()} submission{total === 1 ? "" : "s"}</span>
          <span className="cm-spacer" />
          <label className="cm-search"><Icon d={ICON.search} /><span className="sr-only">Search submissions</span><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search name, email, phone, message" /></label>
        </div>
        {error && <p className="error-text" role="alert">{error}</p>}
        <div className="cm-table-wrap">
          <table className="cm-table">
            <thead><tr><th>Submitted at</th><th>Contact</th>{showClientCol && <th>Client</th>}<th>Form</th><th>Page</th><th>Email</th><th>Phone</th><th>Message</th></tr></thead>
            <tbody>
              {(data?.rows || []).map((row) => (
                <tr key={row.id}>
                  <td className="cm-date">{fmtDate(row.submittedAt)}</td>
                  <td><button type="button" className="cm-name" onClick={() => setOpen(row)}><span className="cm-avatar" style={{ background: `hsl(${hue(row.name || row.email)} 70% 90%)`, color: `hsl(${hue(row.name || row.email)} 45% 32%)` }}>{initials(row.name)}</span><span className="cm-name-text">{row.name || "No name given"}</span></button></td>
                  {showClientCol && <td>{row.clientName}</td>}
                  <td><span className="cm-tag">{row.formName}</span></td>
                  <td title={row.pageUrl}>{row.pagePath ? (row.pageUrl ? <a className="cm-link" href={row.pageUrl} target="_blank" rel="noreferrer">{row.pagePath}</a> : row.pagePath) : <span className="fsub-muted">—</span>}</td>
                  <td>{row.email ? <a className="cm-link" href={`mailto:${row.email}`}><Icon d={ICON.mail} />{row.email}</a> : <span className="fsub-muted">—</span>}</td>
                  <td>{row.phone ? <a className="cm-link" href={`tel:${row.phone.replace(/[^+\d]/g, "")}`}><Icon d={ICON.phone} />{row.phone}</a> : <span className="fsub-muted">—</span>}</td>
                  <td title={row.message}>{row.message ? row.message.replace(/\s+/g, " ") : <span className="fsub-muted">—</span>}</td>
                </tr>
              ))}
              {!loading && !(data?.rows || []).length && <tr><td colSpan={showClientCol ? 8 : 7} className="fsub-none">No submissions match this period and filters.</td></tr>}
              {loading && !data && <tr><td colSpan={showClientCol ? 8 : 7} className="fsub-none">Loading submissions…</td></tr>}
            </tbody>
          </table>
        </div>
        <div className="fsub-pager">
          <label>Rows per page <select value={pageSize} onChange={(event) => setPageSize(Number(event.target.value))}>{[20, 50, 100].map((size) => <option key={size}>{size}</option>)}</select></label>
          <span>{total ? `${offset + 1}–${Math.min(offset + pageSize, total)} of ${total}` : "0 of 0"}</span>
          <button type="button" className="cm-tool" disabled={offset === 0 || loading} onClick={() => setOffset(Math.max(0, offset - pageSize))}>Previous</button>
          <button type="button" className="cm-tool" disabled={offset + pageSize >= total || loading} onClick={() => setOffset(offset + pageSize)}>Next</button>
        </div>
      </div>

      {open && <div className="fsub-overlay" role="presentation" onClick={() => setOpen(null)}>
        <aside className="fsub-drawer" role="dialog" aria-modal="true" aria-label={`Submission from ${open.name || "contact"}`} onClick={(event) => event.stopPropagation()}>
          <header><h3>{open.name || "No name given"}</h3><button type="button" className="cm-tool" onClick={() => setOpen(null)} aria-label="Close">✕</button></header>
          <dl>
            <div><dt>Submitted</dt><dd>{fmtDate(open.submittedAt)}</dd></div>
            <div><dt>Client</dt><dd>{open.clientName}</dd></div>
            <div><dt>Form</dt><dd>{open.formName} <small className="fsub-muted">({sourceLabel[open.source] || open.source})</small></dd></div>
            <div><dt>Page</dt><dd>{open.pageUrl ? <a className="cm-link" href={open.pageUrl} target="_blank" rel="noreferrer">{open.pageUrl}</a> : "Not recorded"}</dd></div>
            <div><dt>Email</dt><dd>{open.email ? <a className="cm-link" href={`mailto:${open.email}`}>{open.email}</a> : "—"}</dd></div>
            <div><dt>Phone</dt><dd>{open.phone ? <a className="cm-link" href={`tel:${open.phone.replace(/[^+\d]/g, "")}`}>{open.phone}</a> : "—"}</dd></div>
            <div><dt>Message &amp; answers</dt><dd className="fsub-message">{open.message || "—"}</dd></div>
          </dl>
        </aside>
      </div>}
    </section>
  );
}
