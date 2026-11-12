export type GoogleAdsRange = "last_7d" | "last_30d" | "last_90d" | "custom";
export type GoogleAdsWindow = { start: string; end: string };
export type GoogleAdsMetricRow = Record<string, unknown>;
export type GoogleAdsBreakdown = "ad_groups" | "keywords" | "search_terms";

function isoDate(date: Date) { return date.toISOString().slice(0, 10); }
function validDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && isoDate(date) === value;
}

export function googleAdsPerformanceWindow(range: GoogleAdsRange, from?: string, to?: string, now = new Date()): GoogleAdsWindow {
  if (range === "custom") {
    if (!from || !to || !validDate(from) || !validDate(to) || from > to) throw new Error("Choose valid start and end dates for the Google Ads report.");
    return { start: from, end: to };
  }
  const count = range === "last_7d" ? 7 : range === "last_90d" ? 90 : 30;
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - count + 1);
  return { start: isoDate(start), end: isoDate(end) };
}

function numeric(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

type MetricTotals = { spend: number; impressions: number; clicks: number; conversions: number; conversionValue: number };
type CampaignMetrics = MetricTotals & { id: string; name: string; status: string };
const emptyTotals = (): MetricTotals => ({ spend: 0, impressions: 0, clicks: 0, conversions: 0, conversionValue: 0 });

function addRow(target: MetricTotals, row: GoogleAdsMetricRow) {
  target.spend += numeric(row.spend);
  target.impressions += numeric(row.impressions);
  target.clicks += numeric(row.clicks);
  target.conversions += numeric(row.conversions);
  target.conversionValue += numeric(row.conversion_value ?? row.conversionValue);
}

function finish(metrics: MetricTotals) {
  return {
    ...metrics,
    ctr: metrics.impressions ? metrics.clicks / metrics.impressions : null,
    averageCpc: metrics.clicks ? metrics.spend / metrics.clicks : null,
    costPerConversion: metrics.conversions ? metrics.spend / metrics.conversions : null,
    conversionRate: metrics.clicks ? metrics.conversions / metrics.clicks : null,
    returnOnAdSpend: metrics.spend ? metrics.conversionValue / metrics.spend : null,
  };
}

export function summarizeGoogleAdsRows(rows: GoogleAdsMetricRow[]) {
  const totals = emptyTotals();
  const campaigns = new Map<string, CampaignMetrics>();
  const days = new Map<string, MetricTotals>();
  const campaignDays = new Map<string, MetricTotals>();
  for (const row of rows) {
    addRow(totals, row);
    const id = String(row.campaign_id ?? row.campaignId ?? "").trim();
    const name = String(row.campaign ?? row.campaign_name ?? "Unassigned campaign").trim();
    const key = id || name;
    const campaign = campaigns.get(key) || { id, name, status: String(row.campaign_status ?? row.status ?? "Unknown"), ...emptyTotals() };
    addRow(campaign, row);
    campaigns.set(key, campaign);
    const date = String(row.date ?? "").slice(0, 10);
    if (date) {
      const day = days.get(date) || emptyTotals();
      addRow(day, row);
      days.set(date, day);
      const campaignDayKey = `${key}::${date}`;
      const campaignDay = campaignDays.get(campaignDayKey) || emptyTotals();
      addRow(campaignDay, row);
      campaignDays.set(campaignDayKey, campaignDay);
    }
  }
  return {
    totals: finish(totals),
    campaigns: [...campaigns.values()].map((campaign) => ({ ...campaign, ...finish(campaign) })).sort((a, b) => b.spend - a.spend),
    daily: [...days.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, values]) => ({ date, ...finish(values) })),
    campaignDaily: [...campaignDays.entries()].map(([key, values]) => { const split = key.lastIndexOf("::"); return { campaignId: key.slice(0, split), date: key.slice(split + 2), ...finish(values) }; }).sort((a, b) => a.date.localeCompare(b.date)),
    sourceRows: rows.length,
    mayBeLimited: rows.length >= 1000,
  };
}

export function compareGoogleAdsTotals(current: ReturnType<typeof finish>, previous: ReturnType<typeof finish>) {
  const percent = (value: number, before: number) => before ? (value - before) / Math.abs(before) : null;
  return {
    spend: percent(current.spend, previous.spend),
    clicks: percent(current.clicks, previous.clicks),
    conversions: percent(current.conversions, previous.conversions),
    costPerConversion: current.costPerConversion == null || previous.costPerConversion == null ? null : percent(current.costPerConversion, previous.costPerConversion),
  };
}

export function summarizeGoogleAdsBreakdown(rows: GoogleAdsMetricRow[], section: GoogleAdsBreakdown) {
  const items = new Map<string, Record<string, unknown> & MetricTotals>();
  for (const row of rows) {
    const campaignId = String(row.campaign_id ?? "").trim();
    const campaignName = String(row.campaign ?? "Unassigned campaign").trim();
    const adGroupId = String(row.ad_group_id ?? row.search_term_view_ad_group_id ?? "").trim();
    const adGroupName = String(row.ad_group_name ?? row.search_term_view_ad_group ?? "").trim();
    const keyword = String(row.keyword_text ?? "").trim();
    const matchType = String(row.match_type ?? row.search_term_match_type ?? "").trim();
    const searchTerm = String(row.search_term ?? row.search_term_view_search_term ?? "").trim();
    const name = section === "ad_groups" ? adGroupName : section === "keywords" ? keyword : searchTerm;
    if (!name) continue;
    const key = section === "ad_groups" ? `${campaignId}::${adGroupId || adGroupName}` : section === "keywords" ? `${campaignId}::${adGroupId}::${keyword}::${matchType}` : `${campaignId}::${adGroupId}::${searchTerm}::${matchType}::${row.match_source || ""}::${row.device || ""}::${row.network || ""}::${row.keyword_text || ""}`;
    const item = items.get(key) || {
      kind: section === "ad_groups" ? "Ad group" : section === "keywords" ? "Keyword" : "Search term",
      id: section === "ad_groups" ? adGroupId : "",
      name,
      campaignId,
      campaignName,
      adGroupId,
      adGroupName,
      matchType,
      matchSource: String(row.match_source || ""),
      targetingStatus: String(row.search_term_targeting_status || ""),
      triggeringKeyword: String(row.keyword_text || ""),
      triggeringKeywordMatchType: String(row.keyword_match_type || ""),
      device: String(row.device || ""),
      network: String(row.network || ""),
      status: String(section === "ad_groups" ? row.ad_group_status || "Unknown" : row.keyword_status || row.search_term_targeting_status || "Unknown"),
      qualityScore: row.quality_score ?? null,
      adRelevance: String(row.ad_relevance || ""),
      landingPageExperience: String(row.landing_page_experience || ""),
      expectedCtr: String(row.expected_ctr || ""),
      ...emptyTotals(),
    };
    addRow(item, row);
    items.set(key, item);
  }
  return [...items.values()].map((item) => ({ ...item, ...finish(item) })).sort((a, b) => b.spend - a.spend);
}
