export type GoogleAdsCampaignMetricBatch = {
  results?: Array<{
    segments?: { date?: string };
    campaign?: { id?: string | number; name?: string; status?: string };
    metrics?: { costMicros?: string | number; impressions?: string | number; clicks?: string | number; conversions?: string | number; conversionsValue?: string | number };
  }>;
};

export function googleAdsReportCampaignFilter(campaignId?: string) {
  const id = campaignId?.trim();
  if (!id) return undefined;
  if (!/^\d{3,20}$/.test(id)) throw new Error("The selected Google Ads campaign ID is not valid.");
  return JSON.stringify([["campaign_id", "eq", id]]);
}

export function googleAdsCampaignMetricsQuery(window: { start: string; end: string }, campaignId?: string) {
  const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  if (!validDate(window.start) || !validDate(window.end) || window.start > window.end) throw new Error("Choose a valid Google Ads reporting date range.");
  const cleanCampaignId = campaignId?.trim();
  if (cleanCampaignId && !/^\d{3,20}$/.test(cleanCampaignId)) throw new Error("The Google Ads campaign ID is not valid.");
  return `SELECT segments.date, campaign.id, campaign.name, campaign.status, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value FROM campaign WHERE segments.date BETWEEN '${window.start}' AND '${window.end}' AND campaign.status != 'REMOVED'${cleanCampaignId ? ` AND campaign.id = ${cleanCampaignId}` : ""} ORDER BY segments.date, campaign.id LIMIT 10000`;
}

export function normalizeGoogleAdsCampaignMetricBatches(batches: GoogleAdsCampaignMetricBatch[]) {
  return batches.flatMap((batch) => batch.results || []).flatMap((row) => {
    const id = String(row.campaign?.id || "");
    const date = String(row.segments?.date || "");
    if (!/^\d{3,20}$/.test(id) || !/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
    const metrics = row.metrics || {};
    const micros = Number(metrics.costMicros || 0);
    return [{
      date,
      campaign_id: id,
      campaign: String(row.campaign?.name || `Campaign ${id}`),
      campaign_status: String(row.campaign?.status || "UNKNOWN"),
      impressions: Number(metrics.impressions || 0),
      clicks: Number(metrics.clicks || 0),
      spend: Number.isFinite(micros) ? micros / 1_000_000 : 0,
      conversions: Number(metrics.conversions || 0),
      conversion_value: Number(metrics.conversionsValue || 0),
    }];
  });
}
