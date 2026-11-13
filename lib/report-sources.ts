// Shared read-only data readers for client reporting (Report Studio and the visual SEO / Google Ads reports).
// Moved unchanged from app/api/studio/route.ts: direct Google API first, Windsor fallback.
import { env } from "cloudflare:workers";
import { googleAdsReportCampaignFilter } from "./google-ads-report";
import { getGoogleAdsCampaignMetrics, googleAdsConnectionReady } from "./google-ads-direct";
import { hasGoogleSearchConsoleConnection, readGoogleSearchConsoleRows } from "./google-search-console-direct";

export async function googleAds(accountId: string, window: { start: string; end: string }, ownerId: string, campaignId?: string) {
  if (await googleAdsConnectionReady(ownerId)) {
    try { return { rows: (await getGoogleAdsCampaignMetrics(ownerId, accountId, window, campaignId)).rows, source: "Google Ads API · direct read-only report" }; }
    catch (error) {
      if (!env.WINDSOR_API_KEY) throw error;
      console.warn("Report Studio direct Google Ads read failed; trying Windsor", { reason: error instanceof Error ? error.message : "unknown error" });
    }
  }
  if (!env.WINDSOR_API_KEY) throw new Error("Google Ads direct access is not ready and Windsor is not connected, so this client has no live report data yet.");
  const params = new URLSearchParams({ api_key: env.WINDSOR_API_KEY, fields: "account_id,date,campaign,campaign_id,campaign_status,spend,impressions,clicks,conversions,conversion_value", date_from: window.start, date_to: window.end, select_accounts: accountId, _max_rows: "1000", _renderer: "json" });
  const filter = googleAdsReportCampaignFilter(campaignId);
  if (filter) params.set("filter", filter);
  const response = await fetch(`https://connectors.windsor.ai/google_ads?${params}`, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Windsor could not read Google Ads data (HTTP ${response.status}).`);
  const payload = await response.json() as { data?: Array<Record<string, unknown>> };
  if (!Array.isArray(payload.data)) throw new Error("Windsor returned an unexpected Google Ads response.");
  return { rows: payload.data, source: "Windsor.ai Google Ads connector · read-only" };
}

export async function searchConsole(siteId: string, window: { start: string; end: string }, ownerId: string) {
  if (await hasGoogleSearchConsoleConnection(ownerId)) {
    try { return { rows: await readGoogleSearchConsoleRows(ownerId, siteId, window.start, window.end), source: "Google Search Console API · direct read-only report" }; }
    catch (error) {
      if (!env.WINDSOR_API_KEY) throw error;
      console.warn("Report Studio direct Search Console read failed; trying Windsor", { reason: error instanceof Error ? error.message : "unknown error" });
    }
  }
  if (!env.WINDSOR_API_KEY) throw new Error("Connect Google Search Console directly or configure Windsor before loading this property.");
  const params = new URLSearchParams({ api_key: env.WINDSOR_API_KEY, fields: "account_id,site,date,query,page,clicks,impressions,ctr,position", date_from: window.start, date_to: window.end, select_accounts: siteId, _max_rows: "1000", _renderer: "json" });
  const response = await fetch(`https://connectors.windsor.ai/searchconsole?${params}`, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) {
    const detail = (await response.text().catch(() => "")).slice(0, 800);
    if (/no .* accounts? (are )?configured|no accounts? selected|not connected/i.test(detail)) throw new Error("Windsor Search Console is not connected. Connect it, select a property, and finish the Windsor setup.");
    throw new Error(`Windsor could not read Search Console data (HTTP ${response.status}). Check the property authorization and saved site ID.`);
  }
  const payload = await response.json() as { data?: Array<Record<string, unknown>> };
  if (!Array.isArray(payload.data)) throw new Error("Windsor returned an unexpected Search Console response.");
  return { rows: payload.data, source: "Windsor.ai Google Search Console connector · read-only" };
}

export function summarizeGoogleAds(rows: Array<Record<string, unknown>>, accountId: string, source = "Windsor.ai Google Ads connector · read-only") {
  const n = (value: unknown) => { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; };
  const totals = { spend: 0, impressions: 0, clicks: 0, conversions: 0, conversionValue: 0 };
  const campaigns = new Map<string, typeof totals & { id: string; name: string; status: string }>();
  for (const row of rows) {
    const name = String(row.campaign || "Unassigned campaign");
    const id = String(row.campaign_id || "");
    const spend = n(row.spend), impressions = n(row.impressions), clicks = n(row.clicks), conversions = n(row.conversions), conversionValue = n(row.conversion_value);
    totals.spend += spend; totals.impressions += impressions; totals.clicks += clicks; totals.conversions += conversions; totals.conversionValue += conversionValue;
    const campaignKey = id || name;
    const campaign = campaigns.get(campaignKey) || { id, name, status: String(row.campaign_status || "Unknown"), spend: 0, impressions: 0, clicks: 0, conversions: 0, conversionValue: 0 };
    campaign.spend += spend; campaign.impressions += impressions; campaign.clicks += clicks; campaign.conversions += conversions; campaign.conversionValue += conversionValue;
    campaigns.set(campaignKey, campaign);
  }
  const metrics = (value: typeof totals) => ({ ...value, ctrPercent: value.impressions ? value.clicks / value.impressions * 100 : 0, averageCpc: value.clicks ? value.spend / value.clicks : null, costPerConversion: value.conversions ? value.spend / value.conversions : null });
  return { source, accountId, sourceRows: rows.length, totals: metrics(totals), campaigns: [...campaigns.values()].map((campaign) => ({ ...campaign, ...metrics(campaign) })).slice(0, 80) };
}

export function summarizeSearchConsole(rows: Array<Record<string, unknown>>, siteId: string, source = "Windsor.ai Google Search Console · read-only") {
  const n = (value: unknown) => { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; };
  const totals = rows.reduce<{ clicks: number; impressions: number; weightedPosition: number }>((sum, row) => ({ clicks: sum.clicks + n(row.clicks), impressions: sum.impressions + n(row.impressions), weightedPosition: sum.weightedPosition + n(row.position) * n(row.impressions) }), { clicks: 0, impressions: 0, weightedPosition: 0 });
  const group = (field: "query" | "page") => {
    const values = new Map<string, { name: string; clicks: number; impressions: number; weightedPosition: number }>();
    for (const row of rows) {
      const name = String(row[field] || "(not provided)");
      const value = values.get(name) || { name, clicks: 0, impressions: 0, weightedPosition: 0 };
      value.clicks += n(row.clicks); value.impressions += n(row.impressions); value.weightedPosition += n(row.position) * n(row.impressions); values.set(name, value);
    }
    return [...values.values()].sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions).slice(0, 30).map((value) => ({ ...value, averagePosition: value.impressions ? value.weightedPosition / value.impressions : null, ctrPercent: value.impressions ? value.clicks / value.impressions * 100 : 0 }));
  };
  return { source, siteId, sourceRows: rows.length, totals: { clicks: totals.clicks, impressions: totals.impressions, ctrPercent: totals.impressions ? totals.clicks / totals.impressions * 100 : 0, averagePosition: totals.impressions ? totals.weightedPosition / totals.impressions : null }, topQueries: group("query"), topPages: group("page") };
}

