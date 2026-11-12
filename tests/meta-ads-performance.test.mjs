import test from "node:test";
import assert from "node:assert/strict";
import { compareMetaAdsTotals, metaAdsPerformanceWindow, normalizeDirectMetaAdsRow, summarizeMetaAdsCampaignDailyClicks, summarizeMetaAdsDailyClicks, summarizeMetaAdsRows, summarizeMetaAdsTotals } from "../lib/meta-ads-performance.ts";

test("Meta Ads ranges use complete days and validate custom dates", () => {
  const now = new Date("2026-10-26T12:00:00Z");
  assert.deepEqual(metaAdsPerformanceWindow("last_7d", undefined, undefined, now), { start: "2026-10-19", end: "2026-10-25" });
  assert.deepEqual(metaAdsPerformanceWindow("last_30d", undefined, undefined, now), { start: "2026-09-26", end: "2026-10-25" });
  assert.throws(() => metaAdsPerformanceWindow("custom", "2026-02-30", "2026-03-01", now), /valid start and end dates/);
});

test("Meta Ads reports aggregate campaign, ad set and ad rows and calculate reported cost per lead", () => {
  const rows = [
    { campaign_id: "1", campaign: "Roofing", campaign_status: "ACTIVE", adset_id: "10", adset_name: "Dublin", adset_status: "ACTIVE", ad_id: "100", ad_name: "Video", spend: "30", impressions: "1000", clicks: "60", inline_link_clicks: "30", actions_lead: "3" },
    { campaign_id: "1", campaign: "Roofing", campaign_status: "ACTIVE", adset_id: "10", adset_name: "Dublin", adset_status: "ACTIVE", ad_id: "100", ad_name: "Video", spend: "20", impressions: "500", clicks: "40", inline_link_clicks: "20", actions_lead: "2" },
  ];
  assert.deepEqual(summarizeMetaAdsTotals(rows), { spend: 50, impressions: 1500, clicks: 100, leads: 5 });
  const campaigns = summarizeMetaAdsRows(rows, "campaigns");
  assert.equal(campaigns[0].name, "Roofing");
  assert.equal(campaigns[0].costPerLead, 10);
  assert.equal(campaigns[0].linkClicks, 50);
  assert.equal(campaigns[0].linkCtr, 50 / 1500);
  assert.equal(campaigns[0].costPerClick, 0.5);
  assert.equal(campaigns[0].costPerThousandImpressions, 50 / 1500 * 1000);
  const adSets = summarizeMetaAdsRows(rows, "ad_sets");
  assert.equal(adSets[0].name, "Dublin");
  assert.equal(adSets[0].campaignName, "Roofing");
  const ads = summarizeMetaAdsRows(rows, "ads");
  assert.equal(ads[0].name, "Video");
  assert.equal(ads[0].clicks, 100);
});

test("Meta Ads audience and country breakdowns combine daily rows without losing spend or leads", () => {
  const rows = [
    { campaign_id: "1", campaign: "Roofing", age: "25-34", gender: "female", country: "IE", spend: "12", impressions: "120", clicks: "8", actions_lead: "1" },
    { campaign_id: "1", campaign: "Roofing", age: "25-34", gender: "female", country: "IE", spend: "8", impressions: "80", clicks: "4", actions_lead: "1" },
    { campaign_id: "1", campaign: "Roofing", age: "35-44", gender: "male", country: "GB", spend: "10", impressions: "90", clicks: "3", actions_lead: "0" },
  ];
  const audiences = summarizeMetaAdsRows(rows, "audiences");
  assert.deepEqual(audiences.map(({ name, spend, impressions, clicks, leads }) => ({ name, spend, impressions, clicks, leads })), [
    { name: "25-34 · female", spend: 20, impressions: 200, clicks: 12, leads: 2 },
    { name: "35-44 · male", spend: 10, impressions: 90, clicks: 3, leads: 0 },
  ]);
  const locations = summarizeMetaAdsRows(rows, "locations");
  assert.deepEqual(locations.map(({ name, spend }) => ({ name, spend })), [
    { name: "IE", spend: 20 },
    { name: "GB", spend: 10 },
  ]);
});

test("Meta Ads period comparison leaves zero baselines unavailable", () => {
  assert.deepEqual(compareMetaAdsTotals({ spend: 50, impressions: 0, clicks: 10, leads: 2 }, { spend: 25, impressions: 0, clicks: 0, leads: 1 }), { spend: 1, clicks: null, leads: 1 });
});

test("Meta Ads daily clicks stay correctly grouped by account and campaign", () => {
  const rows = [
    { campaign_id: "1", date: "2026-10-20", clicks: "4" },
    { campaign_id: "1", date: "2026-10-20", clicks: "3" },
    { campaign_id: "2", date: "2026-10-20", clicks: "9" },
    { campaign_id: "1", date: "2026-10-21", clicks: "2" },
  ];
  assert.deepEqual(summarizeMetaAdsDailyClicks(rows), [
    { date: "2026-10-20", clicks: 16 },
    { date: "2026-10-21", clicks: 2 },
  ]);
  assert.deepEqual(summarizeMetaAdsCampaignDailyClicks(rows).filter((item) => item.campaignId === "1"), [
    { campaignId: "1", date: "2026-10-20", clicks: 7 },
    { campaignId: "1", date: "2026-10-21", clicks: 2 },
  ]);
});

test("direct Meta Ads insights normalize rows and avoid double-counting lead action types", () => {
  const row = normalizeDirectMetaAdsRow({ date_start: "2026-10-25", campaign_id: "7", campaign_name: "Roof leads", inline_link_clicks: "4", spend: "12.50", actions: [
    { action_type: "lead", value: "2" },
    { action_type: "onsite_conversion.lead", value: "2" },
  ] });
  assert.equal(row.date, "2026-10-25");
  assert.equal(row.campaign, "Roof leads");
  assert.equal(row.link_clicks, "4");
  assert.equal(row.actions_lead, 2);
  assert.equal(summarizeMetaAdsRows([row], "campaigns")[0]?.leads, 2);
  assert.equal(summarizeMetaAdsRows([row], "campaigns")[0]?.linkClicks, 4);
});

test("Meta Ads does not invent link clicks when the report source omits them", () => {
  const [campaign] = summarizeMetaAdsRows([{ campaign_id: "7", campaign: "Roof leads", spend: 12.5, impressions: 1000, clicks: 20, actions_lead: 2 }], "campaigns");
  assert.equal(campaign.linkClicks, null);
  assert.equal(campaign.linkCtr, null);
  assert.equal(campaign.costPerClick, 0.625);
  assert.equal(campaign.costPerThousandImpressions, 12.5);
});
