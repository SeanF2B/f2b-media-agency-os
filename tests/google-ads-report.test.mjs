import test from "node:test";
import assert from "node:assert/strict";
import { googleAdsCampaignMetricsQuery, googleAdsReportCampaignFilter, normalizeGoogleAdsCampaignMetricBatches } from "../lib/google-ads-report.ts";

test("Windsor report filter scopes to one exact campaign ID", () => {
  assert.equal(googleAdsReportCampaignFilter("24371335375"), JSON.stringify([["campaign_id", "eq", "24371335375"]]));
  assert.equal(googleAdsReportCampaignFilter(undefined), undefined);
  assert.throws(() => googleAdsReportCampaignFilter("campaign"), /campaign ID is not valid/);
});

test("direct Google Ads campaign metrics query uses the requested date range and excludes removed campaigns", () => {
  assert.equal(
    googleAdsCampaignMetricsQuery({ start: "2026-10-01", end: "2026-10-26" }, "123456"),
    "SELECT segments.date, campaign.id, campaign.name, campaign.status, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value FROM campaign WHERE segments.date BETWEEN '2026-10-01' AND '2026-10-26' AND campaign.status != 'REMOVED' AND campaign.id = 123456 ORDER BY segments.date, campaign.id LIMIT 10000",
  );
});

test("direct Google Ads campaign metrics validate dates and optional campaign IDs", () => {
  assert.throws(() => googleAdsCampaignMetricsQuery({ start: "2026-02-30", end: "2026-03-01" }), /valid Google Ads reporting date range/);
  assert.throws(() => googleAdsCampaignMetricsQuery({ start: "2026-03-01", end: "2026-03-02" }, "1 OR 1=1"), /campaign ID is not valid/);
});

test("direct Google Ads report rows normalize micros and skip malformed rows", () => {
  const rows = normalizeGoogleAdsCampaignMetricBatches([{ results: [
    { segments: { date: "2026-10-26" }, campaign: { id: "123", name: "Roofing", status: "ENABLED" }, metrics: { costMicros: "1250000", impressions: "100", clicks: "5", conversions: "2", conversionsValue: "40" } },
    { segments: { date: "bad" }, campaign: { id: "124" }, metrics: { costMicros: "1" } },
  ] }]);
  assert.deepEqual(rows, [{ date: "2026-10-26", campaign_id: "123", campaign: "Roofing", campaign_status: "ENABLED", impressions: 100, clicks: 5, spend: 1.25, conversions: 2, conversion_value: 40 }]);
});
