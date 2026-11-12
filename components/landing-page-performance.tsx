"use client";

import { useEffect, useState } from "react";

type PageTotals = {
  pageViews: number | null;
  landingSessions: number | null;
  activeUsers: number | null;
  engagedSessions: number | null;
  conversions: number | null;
  events: Array<{ eventName: string; eventCount: number | null; conversions: number | null }>;
  campaignAttribution: Array<{ campaignName: string; sourceMedium: string; sessions: number | null; conversions: number | null }>;
  formEvents: Array<{ eventName: string; eventCount: number | null; conversions: number | null }>;
  phoneClicks: number | null;
  pageViewRows: number;
  landingRows: number;
  eventRows: number;
};
type PageReport = { status: "connected" | "no_data" | "unavailable" | "not_mapped" | "missing_connection"; message?: string; pageUrl?: string; range?: string; dateWindow?: { current: { start: string; end: string }; previous: { start: string; end: string } }; totals?: PageTotals; previousTotals?: PageTotals | null; dataNote?: string };

const dateRanges = [{ value: "last_7d", label: "7 days" }, { value: "last_30d", label: "30 days" }, { value: "last_90d", label: "90 days" }, { value: "custom", label: "Custom dates" }];
const formatCount = (value: number | null | undefined) => value == null ? "—" : new Intl.NumberFormat("en-IE", { maximumFractionDigits: 0 }).format(value);
function changeText(current: number | null | undefined, previous: number | null | undefined) {
  if (current == null || previous == null || previous === 0) return "No comparable prior data";
  const change = ((current - previous) / previous) * 100;
  return `${change > 0 ? "+" : ""}${change.toFixed(0)}% vs previous period`;
}

export function LandingPagePerformance({ clientId, pageUrl, active, campaignName, onCreateTask }: { clientId: string; pageUrl: string; active: boolean; campaignName?: string; onCreateTask: (clientId: string, title: string, notes: string, checklist: string) => void }) {
  const [range, setRange] = useState("last_30d");
  const [customFrom, setCustomFrom] = useState("");
  const [customTo, setCustomTo] = useState("");
  const customDatesReady = Boolean(customFrom && customTo && customFrom <= customTo);
  const [report, setReport] = useState<PageReport | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!active || !clientId || !pageUrl) return;
    const controller = new AbortController();
    setReport(null);
    if (range === "custom" && !customDatesReady) { setLoading(false); return () => controller.abort(); }
    setLoading(true);
    const query = new URLSearchParams({ clientId, landingPage: "1", pageUrl, range });
    if (range === "custom") { query.set("from", customFrom); query.set("to", customTo); }
    void fetch(`/api/analytics?${query}`, { cache: "no-store", signal: controller.signal }).then(async (response) => {
      const payload = await response.json() as PageReport & { error?: string };
      if (!response.ok) throw new Error(payload.error || payload.message || "GA4 could not load this page's activity.");
      if (!controller.signal.aborted) setReport(payload);
    }).catch((error) => {
      if (!controller.signal.aborted) setReport({ status: "unavailable", message: error instanceof Error ? error.message : "GA4 could not load this page's activity." });
    }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [active, clientId, pageUrl, range, customFrom, customTo, customDatesReady]);

  const current = report?.totals;
  const previous = report?.previousTotals;
  const metrics = [
    { label: "Page views", value: current?.pageViews, previous: previous?.pageViews, help: "Views of this exact page" },
    { label: "Sessions started here", value: current?.landingSessions, previous: previous?.landingSessions, help: "Sessions whose first page was this page" },
    { label: "Active users", value: current?.activeUsers, previous: previous?.activeUsers, help: "Active users in those sessions" },
    { label: "Key events on page", value: current?.conversions, previous: previous?.conversions, help: "GA4 configured events; not verified leads" },
    { label: "Phone link clicks", value: current?.phoneClicks, previous: previous?.phoneClicks, help: "GA4 tel-link or named phone-click events; only if tracked" },
  ];

  return <section className="landing-page-performance" aria-label="Landing page activity">
    <header className="landing-page-performance-head"><div><span className="eyebrow">📈 GA4 · PAGE ACTIVITY</span><h2>Landing page performance</h2><p>Read-only results for this page. Campaign attribution depends on the tags and tracking configured in GA4.</p></div><div className="landing-page-performance-period"><label><span>Period</span><select value={range} onChange={(event) => setRange(event.target.value)} disabled={loading}>{dateRanges.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label>{range === "custom" && <><label><span>From</span><input type="date" aria-label="Landing page start date" value={customFrom} max={customTo || undefined} onChange={(event) => setCustomFrom(event.target.value)} /></label><label><span>To</span><input type="date" aria-label="Landing page end date" value={customTo} min={customFrom || undefined} onChange={(event) => setCustomTo(event.target.value)} /></label></>}</div></header>
    {range === "custom" && !customDatesReady && <p className="landing-page-performance-state" role="status">Choose a start and end date. Custom ranges can cover up to 366 days.</p>}
    {loading && <p className="landing-page-performance-state" role="status">Loading GA4 page data…</p>}
    {!loading && report?.status === "no_data" && <p className="landing-page-performance-state">GA4 connected, but returned no rows for this page and period. No activity is assumed to be zero.</p>}
    {!loading && report && !["connected", "no_data"].includes(report.status) && <p className="landing-page-performance-state is-error" role="alert">{report.message || "Connect and map this client's GA4 property to view page activity."}</p>}
    {!loading && report?.status === "connected" && current && <>
      <p className="landing-page-performance-url" title={report.pageUrl}>{report.pageUrl}</p>
      <div className="landing-page-performance-metrics">{metrics.map((metric) => <article key={metric.label}><span>{metric.label}</span><b>{formatCount(metric.value)}</b><small>{changeText(metric.value, metric.previous)}</small><small>{metric.help}</small></article>)}</div>
      {current.formEvents?.length > 0 && <p className="landing-page-performance-state">GA4 form / lead events: {current.formEvents.map((item) => `${item.eventName}: ${formatCount(item.eventCount)}`).join(" · ")}. If both event names are configured, they may describe the same submission, so they are shown separately and not added together.</p>}
      {current.events.length > 0 && <details className="landing-page-performance-events"><summary>Events recorded on this page · {current.events.length}</summary><div className="landing-page-performance-table"><table><thead><tr><th>GA4 event</th><th>Count</th><th>Key events</th></tr></thead><tbody>{current.events.map((event) => <tr key={event.eventName}><td>{event.eventName}</td><td>{formatCount(event.eventCount)}</td><td>{formatCount(event.conversions)}</td></tr>)}</tbody></table></div></details>}
      {current.campaignAttribution?.length > 0 && <details className="landing-page-performance-events" open><summary>Campaign attribution · {current.campaignAttribution.length}</summary><p className="muted">GA4 session attribution for visitors who landed on this page. Key events are GA4 configured events, not verified sales leads.</p><div className="landing-page-performance-table"><table><thead><tr><th>Campaign</th><th>Source / medium</th><th>Sessions</th><th>Key events</th></tr></thead><tbody>{current.campaignAttribution.map((item, index) => <tr key={item.campaignName + "-" + item.sourceMedium + "-" + index}><td>{item.campaignName}</td><td>{item.sourceMedium}</td><td>{formatCount(item.sessions)}</td><td>{formatCount(item.conversions)}</td></tr>)}</tbody></table></div></details>}
      {current.pageViews != null && current.pageViews > 0 && <button type="button" className="secondary-button landing-page-performance-task" onClick={() => {
        const period = report.dateWindow?.current;
        const taskNotes = [
          `Landing page: ${report.pageUrl || pageUrl}`,
          campaignName ? `Linked campaign: ${campaignName}` : "Linked campaign: none",
          `GA4 date range: ${period?.start || "unknown"} to ${period?.end || "unknown"}`,
          `Page views: ${formatCount(current.pageViews)} (previous period: ${formatCount(previous?.pageViews)})`,
          `Sessions started on page: ${formatCount(current.landingSessions)} (previous period: ${formatCount(previous?.landingSessions)})`,
          `Active users: ${formatCount(current.activeUsers)} (previous period: ${formatCount(previous?.activeUsers)})`,
          `GA4 key events: ${formatCount(current.conversions)} (these are not independently verified leads)`,
          `Phone link clicks: ${formatCount(current.phoneClicks)} (only when the GA4 event/link URL is tracked)`,
          `Form/lead event names: ${current.formEvents?.map((item) => `${item.eventName} ${formatCount(item.eventCount)}`).join("; ") || "none returned"} (separate event names are not added together)`,
          `Events: ${current.events.map((event) => `${event.eventName}: ${formatCount(event.eventCount)} total, ${formatCount(event.conversions)} key events`).join("; ") || "No event rows returned"}`,
          "",
          "Use only the supplied GA4 evidence. Check whether the volume is sufficient before suggesting conversion changes. Do not claim event counts are verified leads. Do not publish website or advertising changes without approval.",
        ].join("\n");
        onCreateTask(clientId, `CRO review: ${campaignName || "landing page"}`, taskNotes, "Check whether the supplied data is sufficient for a useful review\nReview the page and its campaign context\nIdentify specific improvements and support each with evidence\nPrepare suggested changes for approval; do not publish them\nState what data or access is still missing");
      }}>＋ Create CRO review task</button>}
      <small className="landing-page-performance-note">{report.dataNote} The selected Dublin dates are {report.dateWindow?.current.start} to {report.dateWindow?.current.end}; the latest date may be incomplete. Results compare against the immediately prior {range === "custom" ? "equal-length period" : dateRanges.find((item) => item.value === range)?.label}.</small>
    </>}
  </section>;
}
