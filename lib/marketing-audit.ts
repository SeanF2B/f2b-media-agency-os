export type MarketingAuditFinding = { id: string; title: string; priority: "high" | "medium" | "info"; evidence: string; recommendation: string };
export type MarketingService = "Google Ads" | "Meta Ads" | "SEO" | "Google Analytics" | "Google Business Profile";
export type MarketingAuditRun = { id: string; clientId: string; clientName: string; service: MarketingService | "Full Marketing"; createdAt: string; period: string; status: "connected" | "no_data" | "unavailable"; summary: string; metrics: Record<string, number | null>; findings: MarketingAuditFinding[]; sources?: Array<{ service: MarketingService; status: "connected" | "no_data" | "unavailable"; message?: string }>; previousRunId?: string; comparison?: Record<string, number | null>; comparisonPeriod?: string };

const auditMetricLabels: Record<string, string> = {
  spend: "Spend", clicks: "Clicks", impressions: "Impressions", conversions: "Conversions", costPerConversion: "Cost per conversion", platformLeads: "Platform-reported leads", ctr: "Click-through rate", averagePosition: "Average position", analyticsSessions: "GA4 sessions", sessions: "GA4 sessions", activeUsers: "Active users", engagedSessions: "Engaged sessions", configuredConversions: "Configured GA4 events", revenue: "GA4 revenue", calls: "Profile calls", directions: "Direction requests", websiteClicks: "Profile website clicks", reviewCount: "Review count", averageRating: "Average rating",
};

function auditPeriodDays(period: string) {
  const dates = /^(\d{4}-\d{2}-\d{2})\s+to\s+(\d{4}-\d{2}-\d{2})$/i.exec(period.trim());
  if (dates) {
    const start = Date.parse(`${dates[1]}T00:00:00Z`); const end = Date.parse(`${dates[2]}T00:00:00Z`);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) return null;
    return Math.floor((end - start) / 86_400_000) + 1;
  }
  const days = /^(?:last\s+|last_)(\d+)\s*(?:days?|d)$/i.exec(period.trim());
  return days ? Number(days[1]) : null;
}

export function auditPeriodsComparable(current: string, previous: string) {
  const currentDays = auditPeriodDays(current); const previousDays = auditPeriodDays(previous);
  return currentDays != null && previousDays != null ? currentDays === previousDays : current.trim().toLowerCase() === previous.trim().toLowerCase();
}

export function compareAuditMetrics(current: MarketingAuditRun, previous?: MarketingAuditRun) {
  if (!previous || current.previousRunId !== previous.id || current.clientId !== previous.clientId || current.service !== previous.service) return [];
  if (!auditPeriodsComparable(current.period, previous.period)) return [];
  return Object.entries(current.metrics).flatMap(([key, value]) => {
    const previousValue = previous.metrics[key];
    if (value == null || previousValue == null) return [];
    const delta = value - previousValue;
    return [{ key, label: auditMetricLabels[key.split(".").at(-1) || key] || key.split(".").at(-1)?.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (letter) => letter.toUpperCase()) || key, previous: previousValue, current: value, change: delta }];
  });
}

type AuditRecord = Record<string, unknown>;
type AuditInput = { id: string; clientId: string; clientName: string; service: MarketingService; createdAt: string; period: string; status: MarketingAuditRun["status"]; data: unknown; previous?: MarketingAuditRun; compareApiPrevious?: boolean };
const number = (value: unknown): number | null => typeof value === "number" && Number.isFinite(value) ? value : null;
const fmt = (value: number | null, digits = 1) => value == null ? "not available" : value.toLocaleString("en-IE", { maximumFractionDigits: digits });
const record = (value: unknown): AuditRecord => value && typeof value === "object" && !Array.isArray(value) ? value as AuditRecord : {};
const records = (value: unknown): AuditRecord[] => Array.isArray(value) ? value.map(record) : [];

function dateWindowPeriod(data: unknown, part: "current" | "previous") {
  const root = record(data);
  const window = Object.keys(record(root.dateWindow)).length ? record(root.dateWindow) : record(record(root.search).dateWindow);
  const selected = part === "current" && window.start && window.end ? window : record(window[part]);
  return typeof selected.start === "string" && typeof selected.end === "string" ? `${selected.start} to ${selected.end}` : null;
}

function previousPeriodData(service: MarketingService, data: unknown) {
  const root = record(data);
  if (service === "Google Ads" || service === "Meta Ads" || service === "Google Business Profile") {
    if (!root.previous || typeof root.previous !== "object") return null;
    return service === "Google Business Profile" ? { current: root.previous } : { current: root.previous };
  }
  if (service === "Google Analytics") return root.previousTotals && typeof root.previousTotals === "object" ? { totals: root.previousTotals } : null;
  const search = record(root.search);
  if (search.previous && typeof search.previous === "object") return { ...root, search: { ...search, current: search.previous } };
  return root.previous && typeof root.previous === "object" ? { ...root, current: root.previous } : null;
}

export function buildMarketingAudit(input: AuditInput): MarketingAuditRun {
  const metrics: Record<string, number | null> = {};
  const findings: MarketingAuditFinding[] = [];
  const add = (id: string, title: string, priority: MarketingAuditFinding["priority"], evidence: string, recommendation: string) => findings.push({ id, title, priority, evidence, recommendation });
  const data = record(input.data);

  if (input.service === "Google Ads") {
    const current = record(data.current); const totals = record(current.totals);
    metrics.spend = number(totals.spend); metrics.clicks = number(totals.clicks); metrics.conversions = number(totals.conversions); metrics.costPerConversion = number(totals.costPerConversion);
    if (input.status === "connected" && (metrics.clicks || 0) > 0 && metrics.conversions === 0) add("no-reported-conversions", "No conversions were reported", "medium", `${fmt(metrics.clicks, 0)} clicks and ${fmt(metrics.spend, 2)} spend, with 0 reported conversions in this period.`, "Check the Ads conversion actions and compare them with actual enquiries before deciding whether tracking or campaign performance needs a change.");
    const campaigns = records(current.campaigns);
    const untracked = campaigns.filter((campaign) => Number(campaign.spend) > 0 && Number(campaign.conversions) === 0);
    if (input.status === "connected" && untracked.length) add("spend-without-conversions", "Review spend with no reported conversions", "info", `${untracked.length} campaign${untracked.length === 1 ? "" : "s"} had spend and no reported conversions.`, "Review the campaign search terms, landing page and verified lead records before making any account change.");
  } else if (input.service === "Meta Ads") {
    const current = record(data.current); const totals = record(current.totals);
    metrics.spend = number(totals.spend); metrics.clicks = number(totals.clicks); metrics.impressions = number(totals.impressions); metrics.platformLeads = number(totals.leads);
    if (input.status === "connected" && (metrics.spend || 0) > 0 && metrics.platformLeads === 0) add("no-platform-leads", "No Meta leads were reported", "medium", `${fmt(metrics.spend, 2)} spend and ${fmt(metrics.clicks, 0)} clicks, with 0 platform-reported leads in this period.`, "Check Meta lead-event setup and compare the result with the client’s verified CRM enquiries. Platform leads are not confirmed CRM leads.");
    const campaigns = records(current.campaigns);
    const noLeads = campaigns.filter((campaign) => Number(campaign.spend) > 0 && Number(campaign.leads) === 0);
    if (input.status === "connected" && noLeads.length) add("campaigns-no-leads", "Review campaigns with spend and no reported leads", "info", `${noLeads.length} campaign${noLeads.length === 1 ? "" : "s"} had spend and no platform-reported leads.`, "Compare each campaign’s audience, creative, landing page and verified enquiries before changing it.");
  } else if (input.service === "Google Analytics") {
    const current = record(data.current); const totals = record(data.totals ?? current.totals);
    metrics.sessions = number(totals.sessions);
    metrics.activeUsers = number(totals.activeUsers ?? totals.active_users);
    metrics.engagedSessions = number(totals.engagedSessions ?? totals.engaged_sessions);
    metrics.configuredConversions = number(totals.conversions);
    metrics.revenue = number(totals.revenue ?? totals.totalrevenue);
  } else if (input.service === "Google Business Profile") {
    const current = record(data.current);
    const reviews = record(data.reviews);
    metrics.impressions = number(current.impressions);
    metrics.calls = number(current.calls);
    metrics.directions = number(current.directions);
    metrics.websiteClicks = number(current.websiteClicks);
    metrics.reviewCount = number(reviews.total);
    metrics.averageRating = number(reviews.averageRating);
  } else {
    const search = record(data.search); const current = record(search.current ?? data.current);
    const totals = record(current.totals);
    metrics.clicks = number(totals.clicks); metrics.impressions = number(totals.impressions); metrics.ctr = number(totals.ctr); metrics.averagePosition = number(totals.averagePosition);
    const analytics = record(data.analytics); const analyticsTotals = record(analytics.totals);
    metrics.analyticsSessions = number(analyticsTotals.sessions);
    const queries = records(current.topQueries);
    const impressionMedian = [...queries].map((row) => Number(row.impressions) || 0).sort((a, b) => a - b)[Math.floor(queries.length / 2)] || 0;
    const ctrs = queries.map((row) => number(row.ctr)).filter((value): value is number => value != null).sort((a, b) => a - b);
    const medianCtr = ctrs[Math.floor(ctrs.length / 2)];
    const opportunities = medianCtr == null ? [] : queries.filter((row) => Number(row.impressions) > impressionMedian && number(row.ctr) != null && Number(row.ctr) < medianCtr).slice(0, 5);
    if (input.status === "connected" && opportunities.length) add("query-ctr-opportunity", "Some visible searches have below-median click-through rate", "info", opportunities.map((row) => `“${String(row.name)}”: ${fmt(number(row.impressions), 0)} impressions, ${fmt(number(row.ctr) == null ? null : Number(row.ctr) * 100, 2)}% CTR`).join("; "), "Review the matching page title, description and search intent. This is a relative opportunity from this report, not an industry benchmark.");
    if (search.status === "connected" && !queries.length) add("query-detail-unavailable", "Search query detail was not supplied", "info", `${fmt(metrics.clicks, 0)} clicks and ${fmt(metrics.impressions, 0)} impressions were available, but no query rows were supplied.`, "Load Search Console query details before drawing keyword-level conclusions.");
    if (analytics.status !== "connected") add("analytics-unavailable", "GA4 data is unavailable for this audit", "info", String(analytics.message || "No connected GA4 data was supplied."), "Connect and map the client’s GA4 property to include site sessions and key events.");
  }

  const summary = input.status === "connected"
    ? findings.length ? `${findings.length} evidence-based finding${findings.length === 1 ? "" : "s"} from connected ${input.service} data.` : `No audit flags were found in the supplied ${input.service} data for this period.`
    : input.status === "no_data" ? `The connected ${input.service} source returned no rows for this period. No performance conclusions were drawn.` : `${input.service} data was unavailable, so no performance conclusions were drawn.`;
  const comparison: Record<string, number | null> = {};
  let comparisonPeriod: string | undefined;
  const priorPeriodData = input.compareApiPrevious === false ? null : previousPeriodData(input.service, input.data);
  const priorPeriod = dateWindowPeriod(input.data, "previous");
  if (priorPeriodData && priorPeriod) {
    const priorRun = buildMarketingAudit({ ...input, id: `${input.id}-provider-previous`, period: priorPeriod, data: priorPeriodData, previous: undefined, compareApiPrevious: false });
    for (const [key, value] of Object.entries(metrics)) {
      const prior = priorRun.metrics[key];
      comparison[key] = value != null && prior != null ? value - prior : null;
    }
    comparisonPeriod = priorPeriod;
  } else if (input.previous) {
    for (const [key, value] of Object.entries(metrics)) {
      const prior = input.previous.metrics[key];
      comparison[key] = value != null && prior != null ? value - prior : null;
    }
  }
  return { id: input.id, clientId: input.clientId, clientName: input.clientName, service: input.service, createdAt: input.createdAt, period: dateWindowPeriod(input.data, "current") || input.period, status: input.status, summary, metrics, findings, ...(input.previous ? { previousRunId: input.previous.id } : {}), ...(Object.keys(comparison).length ? { comparison } : {}), ...(comparisonPeriod ? { comparisonPeriod } : {}) };
}

export function buildFullMarketingAudit(input: Omit<AuditInput, "service" | "status" | "data"> & { sources: Array<{ service: MarketingService; status: MarketingAuditRun["status"]; message?: string; data?: unknown }> }): MarketingAuditRun {
  const available = input.sources.filter((source) => source.status === "connected");
  const runs = available.map((source) => buildMarketingAudit({ ...input, service: source.service, status: source.status, data: source.data, previous: undefined }));
  const metrics = Object.fromEntries(runs.flatMap((run) => Object.entries(run.metrics).map(([key, value]) => [`${run.service.toLowerCase().replaceAll(" ", "-")}.${key}`, value]))) as Record<string, number | null>;
  const findings = runs.flatMap((run) => run.findings.map((finding) => ({ ...finding, id: `${run.service.toLowerCase().replaceAll(" ", "-")}.${finding.id}`, title: `${run.service}: ${finding.title}` })));
  const status: MarketingAuditRun["status"] = available.length ? "connected" : input.sources.some((source) => source.status === "no_data") ? "no_data" : "unavailable";
  const summary = available.length
    ? `Reviewed ${available.length} connected service${available.length === 1 ? "" : "s"}; ${findings.length} evidence-based finding${findings.length === 1 ? "" : "s"}.`
    : input.sources.some((source) => source.status === "no_data")
      ? "Connected services returned no rows. No performance conclusions were drawn."
      : "No marketing service returned usable data. Connect or map a service before drawing conclusions.";
  const comparison: Record<string, number | null> = {};
  let comparisonPeriod: string | undefined;
  for (const run of runs) {
    const prefix = `${run.service.toLowerCase().replaceAll(" ", "-")}.`;
    for (const [key, value] of Object.entries(run.comparison || {})) comparison[`${prefix}${key}`] = value;
    if (!comparisonPeriod && run.comparisonPeriod) comparisonPeriod = run.comparisonPeriod;
  }
  if (!Object.keys(comparison).length && input.previous) for (const [key, value] of Object.entries(metrics)) {
    const prior = input.previous.metrics[key];
    comparison[key] = value != null && prior != null ? value - prior : null;
  }
  const currentPeriod = available.map((source) => dateWindowPeriod(source.data, "current")).find((value): value is string => Boolean(value)) || input.period;
  return { id: input.id, clientId: input.clientId, clientName: input.clientName, service: "Full Marketing", createdAt: input.createdAt, period: currentPeriod, status, summary, metrics, findings, sources: input.sources.map(({ service, status, message }) => ({ service, status, ...(message ? { message } : {}) })), ...(input.previous ? { previousRunId: input.previous.id } : {}), ...(Object.keys(comparison).length ? { comparison } : {}), ...(comparisonPeriod ? { comparisonPeriod } : {}) };
}
