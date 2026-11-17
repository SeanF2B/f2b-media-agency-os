"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ReportGeneratingAnimation } from "./report-generating-animation";
import { KeywordReportBuilder, type KeywordPrepare } from "./keyword-report-builder";
import { MailIcon, SendDocumentEmail, type DocumentEmailTarget } from "./send-document-email";

type ReportType = "ads" | "seo" | "audit" | "audit-ads" | "audit-website" | "keywords";
export type ReportsMode = "reports" | "audits" | "keywords";
type Saved = { id: string; type: ReportType; periodStart: string; periodEnd: string; kind: string; createdAt: string; summary?: { leads?: number | null; wonRevenue?: number | null; missing?: string[]; groups?: string[]; groupIds?: string[]; keywords?: number | null } };
const PRESETS = [["lastMonth", "Last month"], ["thisMonth", "This month to date"], ["30d", "Last 30 days"], ["90d", "Last 90 days"], ["custom", "Custom range"]] as const;
type Preset = (typeof PRESETS)[number][0];
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
function rangeFor(preset: Preset, from: string, to: string) {
  const now = new Date(), y = now.getFullYear(), m = now.getMonth(), d = now.getDate();
  switch (preset) {
    case "lastMonth": return { start: iso(new Date(y, m - 1, 1)), end: iso(new Date(y, m, 0)) };
    case "thisMonth": return { start: iso(new Date(y, m, 1)), end: iso(new Date(y, m, d)) };
    case "30d": return { start: iso(new Date(y, m, d - 29)), end: iso(new Date(y, m, d)) };
    case "90d": return { start: iso(new Date(y, m, d - 89)), end: iso(new Date(y, m, d)) };
    default: return from && to && from <= to ? { start: from, end: to } : { start: iso(new Date(y, m - 1, 1)), end: iso(new Date(y, m, 0)) };
  }
}
const STEPS: Record<ReportType, string[]> = {
  ads: ["Gathering details…", "Reading Google Ads spend, clicks and conversions…", "Matching Google Ads leads in the CRM…", "Working out pipeline value and won revenue…", "Calculating cost per lead and ROAS…", "Drawing charts…", "Finalising your report…"],
  seo: ["Gathering details…", "Reading organic traffic from Google…", "Checking keyword rankings…", "Loading backlinks, competitors and Google Business…", "Checking ChatGPT and Claude visibility tests…", "Matching SEO leads and won revenue in the CRM…", "Finalising your report…"],
  audit: ["Gathering details…", "Checking Google Ads spend, clicks and conversions…", "Reading organic traffic and rankings…", "Checking Google Business, backlinks and AI visibility…", "Matching leads and sources in the CRM…", "Writing findings and an action plan…", "Finalising your audit…"],
  "audit-ads": ["Gathering details…", "Reading Google Ads campaigns, spend and conversions…", "Checking cost per conversion and click-through rate…", "Matching Google Ads leads in the CRM…", "Checking lead tracking…", "Writing findings and an action plan…", "Finalising your audit…"],
  "audit-website": ["Gathering details…", "Opening the live website…", "Checking pages, links and sitemap…", "Running Google PageSpeed on mobile…", "Reading organic traffic and rankings…", "Writing findings and an action plan…", "Finalising your audit…"],
  keywords: ["Saving your keyword groups…", "Pulling search volumes…", "Sorting keywords into groups…", "Checking competition and bids…", "Checking current Google rankings…", "Spotting quick wins…", "Building your keyword plan…"],
};
const META: Record<ReportType, { name: string; short: string; desc: string }> = {
  ads: { name: "Google Ads report", short: "Google Ads", desc: "Spend, leads, cost per lead, pipeline, won revenue, ROAS" },
  seo: { name: "SEO report", short: "SEO", desc: "Organic leads, rankings, traffic, backlinks, Google Business, AI visibility" },
  audit: { name: "Full marketing audit", short: "Marketing audit", desc: "Everything: Google Ads, SEO, Google Business and tracking with a 30-day plan" },
  "audit-ads": { name: "Google Ads audit", short: "Google Ads audit", desc: "Campaigns, wasted spend, conversions, cost per lead and lead quality" },
  "audit-website": { name: "Website audit", short: "Website audit", desc: "Live speed test, broken links, technical SEO, rankings and local visibility" },
  keywords: { name: "Keyword research report", short: "Keyword research", desc: "Saved keyword groups with search volume, competition, bids and current rankings" },
};
const MODE: Record<ReportsMode, { types: ReportType[]; title: string; intro: string; savedTitle: string; savedSub: string; empty: string }> = {
  reports: { types: ["ads", "seo"], title: "Performance reports", intro: "Branded SEO and Google Ads reports for", savedTitle: "Saved reports", savedSub: "Monthly reports are saved automatically on the 1st of each month for clients with Google Ads or SEO services.", empty: "No saved reports" },
  audits: { types: ["audit-website", "audit-ads", "audit"], title: "Marketing audits", intro: "Pick an audit — website, Google Ads or the full marketing audit — branded for", savedTitle: "Saved audits", savedSub: "Every audit you generate is filed in this client's Reports folder automatically.", empty: "No saved audits" },
  keywords: { types: ["keywords"], title: "Keyword research", intro: "Find keywords, group them, and turn the groups into a branded report for", savedTitle: "Saved keyword reports", savedSub: "Every keyword report you generate is filed in this client's Reports folder automatically.", empty: "No saved keyword reports" },
};
const AUTO_REFRESH_MS = 15 * 60_000;

function TypeMark({ type }: { type: ReportType }) {
  if (type === "audit-website") return <span className="crv-mark seo"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="4" width="18" height="14" rx="2" /><path d="M3 8h18M8 21h8M12 18v3" /></svg></span>;
  if (type === "audit-ads") return <span className="crv-mark ads"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M3 10v4h3l7 5V5L6 10z" /><path d="M17 9a4 4 0 0 1 0 6" /></svg></span>;
  if (type === "audit") return <span className="crv-mark audit"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="5" y="4" width="14" height="17" rx="2" /><path d="M9 4h6v3H9zM9 12l2 2 4-4M9 17h6" /></svg></span>;
  if (type === "keywords") return <span className="crv-mark kw"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M3 12V4h8l10 10-8 8z" /><circle cx="7.5" cy="8.5" r="1.5" /></svg></span>;
  return type === "ads"
    ? <span className="crv-mark ads"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M3 10v4h3l7 5V5L6 10z" /><path d="M17 9a4 4 0 0 1 0 6" /></svg></span>
    : <span className="crv-mark seo"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4M8 12l2-2 2 2 3-3" /></svg></span>;
}

/** Operations → Audits & reports → Reports: branded SEO and Google Ads reports with live preview and PDF download. */
export function ClientReportsView({ clientId, clientName, mode = "reports" }: { clientId: string; clientName: string; mode?: ReportsMode }) {
  const cfg = MODE[mode];
  const [type, setType] = useState<ReportType>(cfg.types[0]);
  const [preset, setPreset] = useState<Preset>("lastMonth");
  const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const [html, setHtml] = useState(""); const [loadedAt, setLoadedAt] = useState(""); const [busy, setBusy] = useState(false); const [saving, setSaving] = useState(false);
  const [error, setError] = useState(""); const [notice, setNotice] = useState(""); const [live, setLive] = useState(true);
  const [history, setHistory] = useState<Saved[]>([]);
  const [groups, setGroups] = useState<string[]>([]);
  const [tickedCount, setTickedCount] = useState(0);
  // Dark or light report — remembered, applied instantly to the preview, full-screen view, PDF and saved reports.
  const [theme, setThemeState] = useState<"dark" | "light">(() => { try { return window.localStorage.getItem("f2b-report-theme") === "light" ? "light" : "dark"; } catch { return "dark"; } });
  const setTheme = (next: "dark" | "light") => { setThemeState(next); try { window.localStorage.setItem("f2b-report-theme", next); } catch { /* storage unavailable */ } };
  const themed = useCallback((content: string) => content.replace(/<body(?: class="[^"]*")?>/g, (tag: string, offset: number) => offset > content.indexOf("</head>") ? `<body class="${theme}">` : tag), [theme]);
  const prepareRef = useRef<KeywordPrepare | null>(null);
  const [emailTarget, setEmailTarget] = useState<DocumentEmailTarget | null>(null);
  useEffect(() => { setGroups([]); }, [clientId]);
  const frame = useRef<HTMLIFrameElement>(null);
  const range = useMemo(() => rangeFor(preset, from, to), [preset, from, to]);
  const query = useMemo(() => new URLSearchParams({ clientId, type, start: range.start, end: range.end, ...(mode === "keywords" && groups.length ? { groups: groups.join(",") } : {}) }).toString(), [clientId, type, range, mode, groups]);

  const loadHistory = useCallback(async () => {
    try { const response = await fetch(`/api/client-reports?clientId=${encodeURIComponent(clientId)}&history=1`, { cache: "no-store" }); const payload = await response.json() as { reports?: Saved[] }; if (response.ok) setHistory((payload.reports || []).filter((item) => cfg.types.includes(item.type))); } catch { /* history is optional */ }
  }, [clientId, cfg]);
  useEffect(() => { void loadHistory(); setHtml(""); setError(""); setNotice(""); }, [loadHistory]);

  const generate = useCallback(async (quiet = false) => {
    if (!quiet) { setBusy(true); setError(""); setNotice(""); }
    try {
      let q = query;
      // Keywords ticked but not grouped yet: save them into a group first so the report has something to show.
      if (!quiet && mode === "keywords" && prepareRef.current && tickedCount > 0) {
        const ids = await prepareRef.current();
        const params = new URLSearchParams(query); if (ids.length) params.set("groups", ids.join(",")); q = params.toString();
      }
      const response = await fetch(`/api/client-reports?${q}&format=html`, { cache: "no-store" });
      if (!response.ok) { const payload = await response.json().catch(() => ({})) as { error?: string }; throw new Error(payload.error || "The report could not be generated."); }
      setHtml(await response.text()); setLoadedAt(new Date().toISOString());
      // Every generated report is filed in the client's Reports folder automatically (once per type and period).
      if (!quiet) autoSaveRef.current?.();
    } catch (reason) { if (!quiet) setError(reason instanceof Error ? reason.message : "The report could not be generated."); }
    finally { if (!quiet) setBusy(false); }
  }, [query, mode, tickedCount]);
  // Live dashboard: re-read (cached) data every 15 minutes while the preview is open and visible.
  useEffect(() => {
    if (!html || !live) return;
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void generate(true); }, AUTO_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [html, live, generate]);

  const download = () => { const win = frame.current?.contentWindow; if (!win) return; win.focus(); win.print(); };
  const openTab = (raw = html) => { const content = themed(raw); const win = window.open("", "_blank"); if (!win) { setError("Allow pop-ups for this site to open the report."); return; } win.document.open(); win.document.write(content.replace("</body>", `<button onclick="print()" style="position:fixed;top:14px;right:14px;padding:10px 16px;border:0;border-radius:10px;background:#1f6feb;color:#fff;font:600 14px system-ui;cursor:pointer;z-index:9" class="no-print">Download PDF</button><style>@media print{.no-print{display:none}}</style></body>`)); win.document.close(); };
  const autoSaveRef = useRef<(() => void) | null>(null);
  autoSaveRef.current = () => { const picked = [...groups].sort().join(","); if (!history.some((item) => item.type === type && item.periodStart === range.start && item.periodEnd === range.end && (mode !== "keywords" || (item.summary?.groupIds || []).join(",") === picked))) void save(true); };
  const save = async (auto = false): Promise<string> => {
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/client-reports", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId, type, start: range.start, end: range.end, ...(mode === "keywords" ? { groups } : {}) }) });
      const payload = await response.json() as { error?: string; reports?: Saved[]; id?: string };
      if (!response.ok) throw new Error(payload.error || "The report could not be saved.");
      setHistory((payload.reports || []).filter((item) => cfg.types.includes(item.type))); setNotice(auto ? "Saved to this client's Reports folder." : "Saved to this client's report history.");
      return payload.id || "";
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The report could not be saved."); return ""; }
    finally { setSaving(false); }
  };
  // Email the report on screen: reuse its saved copy (same type, period and keyword groups) or save it first.
  const prepareEmail = async (): Promise<DocumentEmailTarget | null> => {
    const picked = [...groups].sort().join(",");
    const existing = history.find((item) => item.type === type && item.periodStart === range.start && item.periodEnd === range.end && (mode !== "keywords" || (item.summary?.groupIds || []).join(",") === picked));
    const id = existing?.id || await save(true);
    return id ? { kind: "report", clientId, archiveId: id, theme } : null;
  };
  const openSaved = async (item: Saved) => {
    try { const response = await fetch(`/api/client-reports?clientId=${encodeURIComponent(clientId)}&archiveId=${encodeURIComponent(item.id)}`, { cache: "no-store" }); if (!response.ok) throw new Error("That saved report could not be opened."); openTab(await response.text()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "That saved report could not be opened."); }
  };
  const fmtDate = (value: string) => new Date(value.length === 10 ? `${value}T00:00:00` : value).toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric" });

  return (
    <section className="crv" aria-label="Client performance reports">
      <header className="crv-head">
        <div><h2>{cfg.title}</h2><p>{cfg.intro} <b>{clientName}</b>, built from connected data and real CRM leads. Missing sources are shown as unavailable, never as zero.</p></div>
      </header>
      {mode === "keywords" && <KeywordReportBuilder key={clientId} clientId={clientId} clientName={clientName} picked={groups} onPicked={(ids) => { setGroups(ids); setHtml(""); }} prepareRef={prepareRef} onTicked={setTickedCount} />}
      {mode !== "keywords" && <div className={`crv-types ${cfg.types.length === 1 ? "single" : ""}`} role="radiogroup" aria-label="Report type">
        {cfg.types.map((value) => <button key={value} type="button" role="radio" aria-checked={type === value} className={`crv-type ${type === value ? "on" : ""}`} onClick={() => { setType(value); setHtml(""); }}><TypeMark type={value} /><span><b>{META[value].name}</b><small>{META[value].desc}</small></span></button>)}
      </div>}
      <div className="crv-controls">
{mode !== "keywords" && <>        <label className="crv-field"><span>Period</span><select value={preset} onChange={(event) => { setPreset(event.target.value as Preset); setHtml(""); }}>{PRESETS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        {preset === "custom" && <><label className="crv-field"><span>From</span><input type="date" value={from} max={to || undefined} onChange={(event) => { setFrom(event.target.value); setHtml(""); }} /></label><label className="crv-field"><span>To</span><input type="date" value={to} min={from || undefined} onChange={(event) => { setTo(event.target.value); setHtml(""); }} /></label></>}
        <span className="crv-range">{fmtDate(range.start)} – {fmtDate(range.end)} · compared with the period before</span></>}
        {mode === "keywords" && !groups.length && !tickedCount && <span className="crv-why">Tick some keywords above first</span>}
        <button type="button" className="primary-button crv-go" disabled={busy || (preset === "custom" && (!from || !to)) || (mode === "keywords" && !groups.length && !tickedCount)} onClick={() => void generate()}>{busy ? "Generating…" : html ? "Regenerate" : "Generate preview"}</button>
      </div>
      {error && <p className="error-text" role="alert">{error}</p>}
      {notice && <p className="crv-notice" role="status">{notice}</p>}
      {busy && <ReportGeneratingAnimation steps={STEPS[type]} variant={type === "keywords" ? "keywords" : "report"} title={`Generating ${clientName}'s ${META[type].name.toLowerCase()}`} />}
      {html && !busy && <div className="crv-preview">
        <div className="crv-bar">
          <span className="crv-live"><i className={live ? "on" : ""} />{live ? "Live · refreshes every 15 min" : "Auto-refresh off"} · last updated {new Date(loadedAt).toLocaleTimeString("en-IE", { hour: "2-digit", minute: "2-digit" })}</span>
          <label className="crv-toggle"><input type="checkbox" checked={live} onChange={(event) => setLive(event.target.checked)} /> Auto-refresh</label>
          <span className="crv-spacer" />
          <button type="button" className="secondary-button" onClick={() => void generate()}>Refresh now</button>
          <button type="button" className="secondary-button" onClick={() => openTab()}>Open full screen</button>
          <button type="button" className="secondary-button" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save to history"}</button>
          <span className="crv-theme" role="radiogroup" aria-label="Report colours">{(["dark", "light"] as const).map((value) => <button key={value} type="button" role="radio" aria-checked={theme === value} className={theme === value ? "on" : ""} onClick={() => setTheme(value)}>{value === "dark" ? "Dark" : "Light"}</button>)}</span>
          <button type="button" className="secondary-button crv-email" onClick={() => setEmailTarget({ kind: "report", clientId, archiveId: "", theme })}><MailIcon /> Email to client</button>
          <button type="button" className="primary-button" onClick={download}>Download PDF</button>
        </div>
        <iframe ref={frame} className="crv-frame" title={`${clientName} ${META[type].name} preview`} srcDoc={themed(html)} sandbox="allow-same-origin allow-modals allow-popups" />
        <p className="crv-hint">Download PDF opens your browser&apos;s print window: choose <b>Save as PDF</b>. The layout is fitted to A4.</p>
      </div>}
      <div className="crv-history">
        <h3>{cfg.savedTitle}</h3>
        <p className="crv-sub">{cfg.savedSub}</p>
        {history.length ? <ul>{history.map((item) => <li key={item.id}><TypeMark type={item.type} /><span><b>{item.type === "keywords" && item.summary?.groups?.length ? `${item.summary.groups.join(", ")}` : `${META[item.type]?.short || item.type} · ${fmtDate(item.periodStart)} – ${fmtDate(item.periodEnd)}`}</b><small>{item.kind === "monthly" ? "Monthly (automatic)" : "Saved manually"} · {fmtDate(item.createdAt)}{item.summary?.missing?.length ? ` · missing: ${item.summary.missing.join(", ")}` : ""}</small></span><button type="button" className="secondary-button crv-email" title="Email this to the client" aria-label="Email this to the client" onClick={() => setEmailTarget({ kind: "report", clientId, archiveId: item.id, theme })}><MailIcon /></button><button type="button" className="secondary-button" onClick={() => void openSaved(item)}>Open</button></li>)}</ul> : <p className="muted">{cfg.empty} for {clientName} yet.</p>}
      </div>
      <SendDocumentEmail target={emailTarget} prepare={emailTarget?.kind === "report" && !emailTarget.archiveId ? prepareEmail : undefined} onClose={() => setEmailTarget(null)} />
    </section>
  );
}
