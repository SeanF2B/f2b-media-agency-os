"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ReportGeneratingAnimation } from "./report-generating-animation";

type ReportType = "ads" | "seo";
type Saved = { id: string; type: ReportType; periodStart: string; periodEnd: string; kind: string; createdAt: string; summary?: { leads?: number | null; wonRevenue?: number | null; missing?: string[] } };
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
};
const AUTO_REFRESH_MS = 15 * 60_000;

function TypeMark({ type }: { type: ReportType }) {
  return type === "ads"
    ? <span className="crv-mark ads"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><path d="M3 10v4h3l7 5V5L6 10z" /><path d="M17 9a4 4 0 0 1 0 6" /></svg></span>
    : <span className="crv-mark seo"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4M8 12l2-2 2 2 3-3" /></svg></span>;
}

/** Operations → Audits & reports → Reports: branded SEO and Google Ads reports with live preview and PDF download. */
export function ClientReportsView({ clientId, clientName }: { clientId: string; clientName: string }) {
  const [type, setType] = useState<ReportType>("ads");
  const [preset, setPreset] = useState<Preset>("lastMonth");
  const [from, setFrom] = useState(""); const [to, setTo] = useState("");
  const [html, setHtml] = useState(""); const [loadedAt, setLoadedAt] = useState(""); const [busy, setBusy] = useState(false); const [saving, setSaving] = useState(false);
  const [error, setError] = useState(""); const [notice, setNotice] = useState(""); const [live, setLive] = useState(true);
  const [history, setHistory] = useState<Saved[]>([]);
  const frame = useRef<HTMLIFrameElement>(null);
  const range = useMemo(() => rangeFor(preset, from, to), [preset, from, to]);
  const query = useMemo(() => new URLSearchParams({ clientId, type, start: range.start, end: range.end }).toString(), [clientId, type, range]);

  const loadHistory = useCallback(async () => {
    try { const response = await fetch(`/api/client-reports?clientId=${encodeURIComponent(clientId)}&history=1`, { cache: "no-store" }); const payload = await response.json() as { reports?: Saved[] }; if (response.ok) setHistory(payload.reports || []); } catch { /* history is optional */ }
  }, [clientId]);
  useEffect(() => { void loadHistory(); setHtml(""); setError(""); setNotice(""); }, [loadHistory]);

  const generate = useCallback(async (quiet = false) => {
    if (!quiet) { setBusy(true); setError(""); setNotice(""); }
    try {
      const response = await fetch(`/api/client-reports?${query}&format=html`, { cache: "no-store" });
      if (!response.ok) { const payload = await response.json().catch(() => ({})) as { error?: string }; throw new Error(payload.error || "The report could not be generated."); }
      setHtml(await response.text()); setLoadedAt(new Date().toISOString());
    } catch (reason) { if (!quiet) setError(reason instanceof Error ? reason.message : "The report could not be generated."); }
    finally { if (!quiet) setBusy(false); }
  }, [query]);
  // Live dashboard: re-read (cached) data every 15 minutes while the preview is open and visible.
  useEffect(() => {
    if (!html || !live) return;
    const timer = window.setInterval(() => { if (document.visibilityState === "visible") void generate(true); }, AUTO_REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [html, live, generate]);

  const download = () => { const win = frame.current?.contentWindow; if (!win) return; win.focus(); win.print(); };
  const openTab = (content = html) => { const win = window.open("", "_blank"); if (!win) { setError("Allow pop-ups for this site to open the report."); return; } win.document.open(); win.document.write(content.replace("</body>", `<button onclick="print()" style="position:fixed;top:14px;right:14px;padding:10px 16px;border:0;border-radius:10px;background:#1f6feb;color:#fff;font:600 14px system-ui;cursor:pointer;z-index:9" class="no-print">Download PDF</button><style>@media print{.no-print{display:none}}</style></body>`)); win.document.close(); };
  const save = async () => {
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/client-reports", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId, type, start: range.start, end: range.end }) });
      const payload = await response.json() as { error?: string; reports?: Saved[] };
      if (!response.ok) throw new Error(payload.error || "The report could not be saved.");
      setHistory(payload.reports || []); setNotice("Saved to this client's report history.");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "The report could not be saved."); }
    finally { setSaving(false); }
  };
  const openSaved = async (item: Saved) => {
    try { const response = await fetch(`/api/client-reports?clientId=${encodeURIComponent(clientId)}&archiveId=${encodeURIComponent(item.id)}`, { cache: "no-store" }); if (!response.ok) throw new Error("That saved report could not be opened."); openTab(await response.text()); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "That saved report could not be opened."); }
  };
  const fmtDate = (value: string) => new Date(value.length === 10 ? `${value}T00:00:00` : value).toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric" });

  return (
    <section className="crv" aria-label="Client performance reports">
      <header className="crv-head">
        <div><h2>Performance reports</h2><p>Branded SEO and Google Ads reports for <b>{clientName}</b>, built from connected data and real CRM leads. Missing sources are shown as unavailable, never as zero.</p></div>
      </header>
      <div className="crv-types" role="radiogroup" aria-label="Report type">
        {(["ads", "seo"] as const).map((value) => <button key={value} type="button" role="radio" aria-checked={type === value} className={`crv-type ${type === value ? "on" : ""}`} onClick={() => { setType(value); setHtml(""); }}><TypeMark type={value} /><span><b>{value === "ads" ? "Google Ads report" : "SEO report"}</b><small>{value === "ads" ? "Spend, leads, cost per lead, pipeline, won revenue, ROAS" : "Organic leads, rankings, traffic, backlinks, Google Business, AI visibility"}</small></span></button>)}
      </div>
      <div className="crv-controls">
        <label className="crv-field"><span>Period</span><select value={preset} onChange={(event) => { setPreset(event.target.value as Preset); setHtml(""); }}>{PRESETS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
        {preset === "custom" && <><label className="crv-field"><span>From</span><input type="date" value={from} max={to || undefined} onChange={(event) => { setFrom(event.target.value); setHtml(""); }} /></label><label className="crv-field"><span>To</span><input type="date" value={to} min={from || undefined} onChange={(event) => { setTo(event.target.value); setHtml(""); }} /></label></>}
        <span className="crv-range">{fmtDate(range.start)} – {fmtDate(range.end)} · compared with the period before</span>
        <button type="button" className="primary-button crv-go" disabled={busy || (preset === "custom" && (!from || !to))} onClick={() => void generate()}>{busy ? "Generating…" : html ? "Regenerate" : "Generate preview"}</button>
      </div>
      {error && <p className="error-text" role="alert">{error}</p>}
      {notice && <p className="crv-notice" role="status">{notice}</p>}
      {busy && <ReportGeneratingAnimation steps={STEPS[type]} title={`Generating ${clientName}'s ${type === "ads" ? "Google Ads" : "SEO"} report`} />}
      {html && !busy && <div className="crv-preview">
        <div className="crv-bar">
          <span className="crv-live"><i className={live ? "on" : ""} />{live ? "Live · refreshes every 15 min" : "Auto-refresh off"} · last updated {new Date(loadedAt).toLocaleTimeString("en-IE", { hour: "2-digit", minute: "2-digit" })}</span>
          <label className="crv-toggle"><input type="checkbox" checked={live} onChange={(event) => setLive(event.target.checked)} /> Auto-refresh</label>
          <span className="crv-spacer" />
          <button type="button" className="secondary-button" onClick={() => void generate()}>Refresh now</button>
          <button type="button" className="secondary-button" onClick={() => openTab()}>Open full screen</button>
          <button type="button" className="secondary-button" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save to history"}</button>
          <button type="button" className="primary-button" onClick={download}>Download PDF</button>
        </div>
        <iframe ref={frame} className="crv-frame" title={`${clientName} ${type === "ads" ? "Google Ads" : "SEO"} report preview`} srcDoc={html} sandbox="allow-same-origin allow-modals allow-popups" />
        <p className="crv-hint">Download PDF opens your browser&apos;s print window: choose <b>Save as PDF</b>. The layout is fitted to A4.</p>
      </div>}
      <div className="crv-history">
        <h3>Saved reports</h3>
        <p className="crv-sub">Monthly reports are saved automatically on the 1st of each month for clients with Google Ads or SEO services.</p>
        {history.length ? <ul>{history.map((item) => <li key={item.id}><TypeMark type={item.type} /><span><b>{item.type === "ads" ? "Google Ads" : "SEO"} · {fmtDate(item.periodStart)} – {fmtDate(item.periodEnd)}</b><small>{item.kind === "monthly" ? "Monthly (automatic)" : "Saved manually"} · {fmtDate(item.createdAt)}{item.summary?.missing?.length ? ` · missing: ${item.summary.missing.join(", ")}` : ""}</small></span><button type="button" className="secondary-button" onClick={() => void openSaved(item)}>Open</button></li>)}</ul> : <p className="muted">No saved reports for {clientName} yet.</p>}
      </div>
    </section>
  );
}
