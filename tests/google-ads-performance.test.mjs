import test from "node:test";
import assert from "node:assert/strict";
import { compareGoogleAdsTotals, googleAdsPerformanceWindow, summarizeGoogleAdsBreakdown, summarizeGoogleAdsRows } from "../lib/google-ads-performance.ts";

test("Google Ads date windows are recent, complete-day ranges with explicit custom dates", () => {
  const now = new Date("2026-10-26T12:00:00Z");
  assert.deepEqual(googleAdsPerformanceWindow("last_7d", undefined, undefined, now), { start: "2026-10-19", end: "2026-10-25" });
  assert.deepEqual(googleAdsPerformanceWindow("last_30d", undefined, undefined, now), { start: "2026-09-26", end: "2026-10-25" });
  assert.deepEqual(googleAdsPerformanceWindow("custom", "2026-01-01", "2026-01-31", now), { start: "2026-01-01", end: "2026-01-31" });
  assert.throws(() => googleAdsPerformanceWindow("custom", "2026-02-30", "2026-03-01", now), /valid start and end dates/);
});

test("Google Ads metrics aggregate campaign and daily evidence without inventing missing values", () => {
  const summary = summarizeGoogleAdsRows([
    { date: "2026-10-24", campaign_id: "11", campaign: "Roof repairs", campaign_status: "ENABLED", spend: "12.50", impressions: "1000", clicks: "50", conversions: "4", conversion_value: "200" },
    { date: "2026-10-25", campaign_id: "11", campaign: "Roof repairs", campaign_status: "ENABLED", spend: 7.5, impressions: 500, clicks: 20, conversions: 2, conversion_value: 60 },
    { date: "2026-10-25", campaign_id: "12", campaign: "Emergency", campaign_status: "PAUSED", spend: 5, impressions: 250, clicks: 10, conversions: 0, conversion_value: 0 },
  ]);
  assert.equal(summary.totals.spend, 25);
  assert.equal(summary.totals.clicks, 80);
  assert.equal(summary.totals.conversions, 6);
  assert.equal(summary.totals.costPerConversion, 25 / 6);
  assert.equal(summary.campaigns.length, 2);
  assert.equal(summary.campaigns[0].id, "11");
  assert.equal(summary.daily.length, 2);
  assert.equal(summary.daily[1].clicks, 30);
  assert.equal(summary.mayBeLimited, false);
});

test("period comparison keeps zero baselines and unavailable CPA clearly unavailable", () => {
  const now = summarizeGoogleAdsRows([{ spend: 10, clicks: 5, conversions: 0 }]).totals;
  const before = summarizeGoogleAdsRows([]).totals;
  assert.deepEqual(compareGoogleAdsTotals(now, before), { spend: null, clicks: null, conversions: null, costPerConversion: null });
});

test("campaign-scoped period comparison uses the selected campaign in both periods", () => {
  const current = summarizeGoogleAdsRows([
    { campaign_id: "11", campaign: "Roof repairs", spend: 20, clicks: 10, impressions: 100, conversions: 2, conversion_value: 80 },
    { campaign_id: "12", campaign: "Emergency", spend: 100, clicks: 40, impressions: 500, conversions: 4, conversion_value: 300 },
  ]);
  const previous = summarizeGoogleAdsRows([
    { campaign_id: "11", campaign: "Roof repairs", spend: 10, clicks: 5, impressions: 50, conversions: 1, conversion_value: 40 },
    { campaign_id: "12", campaign: "Emergency", spend: 200, clicks: 80, impressions: 1000, conversions: 8, conversion_value: 600 },
  ]);
  const selectedNow = current.campaigns.find((campaign) => campaign.id === "11");
  const selectedBefore = previous.campaigns.find((campaign) => campaign.id === "11");
  assert.deepEqual(compareGoogleAdsTotals(selectedNow, selectedBefore), {
    spend: 1,
    clicks: 1,
    conversions: 1,
    costPerConversion: 0,
  });
  assert.equal(compareGoogleAdsTotals(current.totals, previous.totals).spend, -90 / 210);
});

test("Google Ads detail tabs group matching entities and retain campaign and ad group context", () => {
  const terms = summarizeGoogleAdsBreakdown([
    { campaign_id: "11", campaign: "Roof repairs", search_term_view_ad_group_id: "101", search_term_view_ad_group: "Emergency", search_term: "roof leak repair", search_term_match_type: "EXACT", spend: "4.20", impressions: 20, clicks: 3, conversions: 1, conversion_value: 75 },
    { campaign_id: "11", campaign: "Roof repairs", search_term_view_ad_group_id: "101", search_term_view_ad_group: "Emergency", search_term: "roof leak repair", search_term_match_type: "EXACT", spend: "1.80", impressions: 10, clicks: 2, conversions: 0, conversion_value: 0 },
  ], "search_terms");
  assert.equal(terms.length, 1);
  assert.equal(terms[0].name, "roof leak repair");
  assert.equal(terms[0].campaignId, "11");
  assert.equal(terms[0].adGroupName, "Emergency");
  assert.equal(terms[0].spend, 6);
  assert.equal(terms[0].clicks, 5);
  assert.equal(terms[0].costPerConversion, 6);
});
