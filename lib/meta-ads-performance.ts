export type MetaAdsRange = "last_7d" | "last_30d" | "last_90d" | "custom";
export type MetaAdsWindow = { start: string; end: string };
export type MetaAdsRow = Record<string, unknown>;
export type MetaAdsSection = "campaigns" | "ad_sets" | "ads" | "audiences" | "locations";
export type MetaAdsTotals = { spend: number; impressions: number; clicks: number; leads: number };
export type MetaAdsSummary = MetaAdsTotals & { id: string; name: string; status: string; kind: string; campaignId: string; campaignName: string; ctr: number | null; costPerLead: number | null; linkClicks: number | null; linkCtr: number | null; costPerClick: number | null; costPerThousandImpressions: number | null };

export function normalizeDirectMetaAdsRow(row: Record<string, unknown>): MetaAdsRow {
  const actions = Array.isArray(row.actions) ? row.actions as Array<{ action_type?: string; value?: string | number }> : [];
  const leadAction = actions.find((action) => action.action_type === "lead") || actions.find((action) => action.action_type === "onsite_conversion.lead") || actions.find((action) => action.action_type === "offsite_conversion.fb_pixel_lead");
  return { ...row, date: row.date_start, campaign: row.campaign_name, campaign_status: row.campaign_effective_status || "Unknown", adset_status: row.adset_effective_status || "Unknown", ad_status: row.ad_effective_status || "Unknown", link_clicks: row.inline_link_clicks, actions_lead: Number(leadAction?.value) || 0 };
}

const iso = (date: Date) => date.toISOString().slice(0, 10);
const valid = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && iso(new Date(`${value}T00:00:00Z`)) === value;

export function metaAdsPerformanceWindow(range: MetaAdsRange, from?: string, to?: string, now = new Date()): MetaAdsWindow {
  if (range === "custom") {
    if (!from || !to || !valid(from) || !valid(to) || from > to) throw new Error("Choose valid start and end dates for the Meta Ads report.");
    return { start: from, end: to };
  }
  const days = range === "last_7d" ? 7 : range === "last_90d" ? 90 : 30;
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() - 1));
  const start = new Date(end); start.setUTCDate(start.getUTCDate() - days + 1);
  return { start: iso(start), end: iso(end) };
}

function number(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : 0;
  const parsed = Number(String(value ?? "").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}
function metric(row: MetaAdsRow, name: string) { return number(row[name]); }
function optionalMetric(row: MetaAdsRow, ...names: string[]) {
  for (const name of names) {
    const value = row[name];
    if (value === null || value === undefined || value === "") continue;
    const parsed = Number(String(value).replace(/,/g, ""));
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}
function identity(row: MetaAdsRow, section: MetaAdsSection) {
  if (section === "campaigns") return { id: String(row.campaign_id ?? ""), name: String(row.campaign ?? "Unassigned campaign"), status: String(row.campaign_status ?? "Unknown"), kind: "Campaign" };
  if (section === "ad_sets") return { id: String(row.adset_id ?? ""), name: String(row.adset_name ?? "Unnamed ad set"), status: String(row.adset_status ?? row.adset_effective_status ?? "Unknown"), kind: "Ad set" };
  if (section === "ads") return { id: String(row.ad_id ?? ""), name: String(row.ad_name ?? "Unnamed ad"), status: String(row.ad_status ?? row.ad_effective_status ?? "Unknown"), kind: "Ad" };
  if (section === "audiences") {
    const age = String(row.age ?? "Unknown age");
    const gender = String(row.gender ?? "Unknown gender");
    return { id: `${age}|${gender}`, name: `${age} · ${gender}`, status: "Breakdown", kind: "Audience" };
  }
  const country = String(row.country ?? "Unknown country");
  return { id: country, name: country, status: "Breakdown", kind: "Location" };
}

export function summarizeMetaAdsRows(rows: MetaAdsRow[], section: MetaAdsSection = "campaigns") {
  const groups = new Map<string, MetaAdsSummary>();
  for (const row of rows) {
    const item = identity(row, section);
    const key = item.id || item.name;
    const campaignId = String(row.campaign_id ?? (section === "campaigns" ? item.id : ""));
    const campaignName = String(row.campaign ?? (section === "campaigns" ? item.name : "All campaigns"));
    const current = groups.get(key) || { ...item, campaignId, campaignName, spend: 0, impressions: 0, clicks: 0, leads: 0, ctr: null, costPerLead: null, linkClicks: null, linkCtr: null, costPerClick: null, costPerThousandImpressions: null };
    current.spend += metric(row, "spend");
    current.impressions += metric(row, "impressions");
    current.clicks += metric(row, "clicks");
    current.leads += metric(row, "actions_lead");
    current.ctr = current.impressions ? current.clicks / current.impressions : null;
    current.costPerLead = current.leads ? current.spend / current.leads : null;
    const linkClicks = optionalMetric(row, "link_clicks", "inline_link_clicks");
    if (linkClicks !== null) current.linkClicks = (current.linkClicks || 0) + linkClicks;
    current.linkCtr = current.linkClicks !== null && current.impressions ? current.linkClicks / current.impressions : null;
    current.costPerClick = current.clicks ? current.spend / current.clicks : null;
    current.costPerThousandImpressions = current.impressions ? current.spend * 1000 / current.impressions : null;
    groups.set(key, current);
  }
  return [...groups.values()].sort((a, b) => b.spend - a.spend);
}

export function compareMetaAdsTotals(current: MetaAdsTotals, previous: MetaAdsTotals) {
  const change = (key: keyof MetaAdsTotals) => previous[key] ? (current[key] - previous[key]) / Math.abs(previous[key]) : null;
  return { spend: change("spend"), clicks: change("clicks"), leads: change("leads") };
}

export function summarizeMetaAdsTotals(rows: MetaAdsRow[]) {
  return rows.reduce<MetaAdsTotals>((sum, row) => ({ spend: sum.spend + metric(row, "spend"), impressions: sum.impressions + metric(row, "impressions"), clicks: sum.clicks + metric(row, "clicks"), leads: sum.leads + metric(row, "actions_lead") }), { spend: 0, impressions: 0, clicks: 0, leads: 0 });
}

export function summarizeMetaAdsDailyClicks(rows: MetaAdsRow[]) {
  const daily = new Map<string, number>();
  for (const row of rows) {
    const date = String(row.date || "").slice(0, 10);
    if (date) daily.set(date, (daily.get(date) || 0) + metric(row, "clicks"));
  }
  return [...daily.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, clicks]) => ({ date, clicks }));
}

export function summarizeMetaAdsCampaignDailyClicks(rows: MetaAdsRow[]) {
  const daily = new Map<string, { campaignId: string; date: string; clicks: number }>();
  for (const row of rows) {
    const campaignId = String(row.campaign_id || "");
    const date = String(row.date || "").slice(0, 10);
    if (!date) continue;
    const key = `${campaignId}|${date}`;
    const item = daily.get(key) || { campaignId, date, clicks: 0 };
    item.clicks += metric(row, "clicks");
    daily.set(key, item);
  }
  return [...daily.values()].sort((a, b) => a.date.localeCompare(b.date));
}
