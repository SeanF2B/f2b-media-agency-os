import test from "node:test";
import assert from "node:assert/strict";
import { marketingAnalyticsChange, summarizeMarketingAnalytics } from "../lib/marketing-analytics.ts";

test("marketing analytics compares matching periods and handles zero or unavailable baselines", () => {
  assert.equal(marketingAnalyticsChange(120, 100), "+20 (+20.0%) vs previous");
  assert.equal(marketingAnalyticsChange(1, 0), "+1 (was 0) vs previous");
  assert.equal(marketingAnalyticsChange(0, 0), "No change vs previous");
  assert.equal(marketingAnalyticsChange(null, 0), "No comparison data");
  assert.equal(marketingAnalyticsChange(0.12, 0.1, true), "+2.0 pp (+20.0%) vs previous");
});

test("marketing analytics summarizes bounded daily counts and submission rate", () => {
  const result = summarizeMarketingAnalytics([
    { metricDate: "2026-10-27", pageLoads: 10, submissions: 2 },
    { metricDate: "2026-10-26", pageLoads: 5, submissions: 1 },
  ]);
  assert.deepEqual(result, {
    pageLoads: 15,
    submissions: 3,
    submissionRate: 0.2,
    byCampaign: [],
    byDay: [
      { date: "2026-10-26", pageLoads: 5, submissions: 1 },
      { date: "2026-10-27", pageLoads: 10, submissions: 2 },
    ],
  });
});

test("marketing analytics leaves rates undefined with zero views and ignores negative counts", () => {
  const result = summarizeMarketingAnalytics([{ pageLoads: 0, submissions: -4 }]);
  assert.equal(result.submissionRate, null);
  assert.equal(result.pageLoads, 0);
  assert.equal(result.submissions, 0);
});

test("marketing analytics summarizes UTM source, medium and campaign without exposing submission data", () => {
  const result = summarizeMarketingAnalytics([], [
    { source: "google", medium: "cpc", campaign: "roofing-galway", submissions: 4 },
    { source: "Not tagged", medium: "", campaign: "", submissions: 2 },
    { source: "meta", medium: "paid-social", campaign: "winter", submissions: -1 },
  ]);
  assert.deepEqual(result.byCampaign, [
    { source: "google", medium: "cpc", campaign: "roofing-galway", submissions: 4 },
    { source: "Not tagged", medium: "", campaign: "", submissions: 2 },
    { source: "meta", medium: "paid-social", campaign: "winter", submissions: 0 },
  ]);
  assert.equal("values" in result.byCampaign[0], false);
});
