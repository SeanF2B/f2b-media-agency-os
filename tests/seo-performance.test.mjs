import assert from "node:assert/strict";
import test from "node:test";
import { compareSearchConsoleQueryPositions, customMarketingDateWindow, googleAnalyticsDateWindow, normalizeAnalyticsPagePath, searchConsoleDateWindow, summarizeGoogleAnalyticsRows, summarizeOrganicSearchRows, summarizeLandingPageAnalytics, summarizeLandingPageAttribution, summarizeLandingPageSignals, summarizeSearchConsoleRows } from "../lib/seo-performance.ts";

test("Search Console periods are equal length, adjacent, and leave a three-day data lag", () => {
  const window = searchConsoleDateWindow("last_7d", new Date("2026-10-26T15:00:00.000Z"));
  assert.deepEqual(window.current, { start: "2026-10-17", end: "2026-10-23" });
  assert.deepEqual(window.previous, { start: "2026-10-10", end: "2026-10-16" });
  assert.equal(window.length, 7);
});

test("Search Console averages position by impressions and groups page and query rows", () => {
  const summary = summarizeSearchConsoleRows([
    { date: "2026-10-22", query: "roof repair", page: "https://example.com/roof/", clicks: 2, impressions: 10, position: 2 },
    { date: "2026-10-21", query: "roof repair", page: "https://example.com/roof/", clicks: 1, impressions: 30, position: 6 },
    { date: "2026-10-22", query: "roofing company", page: "https://example.com/", clicks: 0, impressions: 10, position: 10 },
  ]);
  assert.equal(summary.totals.clicks, 3);
  assert.equal(summary.totals.impressions, 50);
  assert.equal(summary.totals.averagePosition, 6);
  assert.equal(summary.totals.ctr, 0.06);
  assert.equal(summary.topQueries[0].name, "roof repair");
  assert.equal(summary.topQueries[0].averagePosition, 5);
  assert.equal(summary.daily.length, 2);
  assert.equal(summary.mayBeLimited, false);
});

test("Search Console query history marks improved, declined, and new queries accurately", () => {
  const current = [
    { name: "roof repair", clicks: 4, impressions: 80, averagePosition: 3.5 },
    { name: "roofer near me", clicks: 1, impressions: 20, averagePosition: 5 },
    { name: "roof replacement", clicks: 0, impressions: 10, averagePosition: null },
  ];
  const previous = [
    { name: "roof repair", clicks: 2, impressions: 60, averagePosition: 6 },
    { name: "roofer near me", clicks: 1, impressions: 25, averagePosition: 3 },
  ];
  const rows = compareSearchConsoleQueryPositions(current, previous);
  assert.equal(rows[0].positionChange, 2.5);
  assert.equal(rows[0].changeKind, "improved");
  assert.equal(rows[1].positionChange, -2);
  assert.equal(rows[1].changeKind, "declined");
  assert.equal(rows[2].positionChange, null);
  assert.equal(rows[2].changeKind, "new");
});

test("GA4 uses adjacent equal-length complete Dublin days for comparisons", () => {
  const window = googleAnalyticsDateWindow("last_7d", new Date("2026-10-26T15:00:00.000Z"));
  assert.deepEqual(window.current, { start: "2026-10-19", end: "2026-10-25" });
  assert.deepEqual(window.previous, { start: "2026-10-12", end: "2026-10-18" });
  assert.equal(window.length, 7);
  assert.equal(googleAnalyticsDateWindow("all_time"), null);
});

test("custom marketing date ranges are validated and compare to the immediately prior equal-length period", () => {
  const custom = customMarketingDateWindow("2026-10-01", "2026-10-14");
  assert.deepEqual(custom, { length: 14, current: { start: "2026-10-01", end: "2026-10-14" }, previous: { start: "2026-09-17", end: "2026-09-30" } });
  assert.deepEqual(googleAnalyticsDateWindow("custom", new Date("2026-10-27T12:00:00Z"), { start: "2026-10-01", end: "2026-10-14" }), custom);
  assert.deepEqual(searchConsoleDateWindow("custom", new Date("2026-10-27T12:00:00Z"), { start: "2026-10-01", end: "2026-10-14" }), custom);
  assert.equal(customMarketingDateWindow("2026-02-30", "2026-03-01"), null);
  assert.equal(customMarketingDateWindow("2026-10-15", "2026-10-14"), null);
  assert.equal(customMarketingDateWindow("2025-10-01", "2026-10-02"), null);
  assert.equal(googleAnalyticsDateWindow("custom"), null);
});

test("GA4 sums supplied metrics and leaves missing metrics unavailable", () => {
  const summary = summarizeGoogleAnalyticsRows([
    { sessions: "20", active_users: 15, engaged_sessions: 12, conversions: 2, totalrevenue: "30" },
    { sessions: 10, active_users: 8, engaged_sessions: 6, conversions: null, totalrevenue: "" },
  ]);
  assert.equal(summary.sessions, 30);
  assert.equal(summary.active_users, 23);
  assert.equal(summary.engaged_sessions, 18);
  assert.equal(summary.engagement_rate, 0.6);
  assert.equal(summary.conversions, 2);
  assert.equal(summary.totalrevenue, 30);
  assert.equal(summary.sourceRows, 2);
  assert.equal(summarizeGoogleAnalyticsRows([]).sessions, null);
});

test("GA4 Organic Search totals include only Organic Search channel rows", () => {
  const summary = summarizeOrganicSearchRows([
    { session_default_channel_group: "Organic Search", sessions: "21", conversions: "3" },
    { session_default_channel_group: "Paid Search", sessions: "70", conversions: "8" },
    { session_default_channel_group: " organic search ", sessions: 4, conversions: null },
  ]);
  assert.deepEqual(summary, { sessions: 25, conversions: 3, sourceRows: 2 });
  assert.deepEqual(summarizeOrganicSearchRows([{ session_default_channel_group: "Paid Search", sessions: 3 }]), { sessions: null, conversions: null, sourceRows: 0 });
});

test("GA4 landing-page totals separate page views, landing sessions and page events", () => {
  const summary = summarizeLandingPageAnalytics(
    [{ screen_page_views: "40" }, { screen_page_views: 5 }],
    [{ sessions: 20, active_users: 18, engaged_sessions: 15 }],
    [{ event_name: "form_start", event_count: "4", conversions: 0 }, { event_name: "generate_lead", event_count: 2, conversions: "2" }],
  );
  assert.equal(summary.pageViews, 45);
  assert.equal(summary.landingSessions, 20);
  assert.equal(summary.activeUsers, 18);
  assert.equal(summary.engagedSessions, 15);
  assert.equal(summary.conversions, 2);
  assert.equal(summary.events[0].eventName, "form_start");
  assert.equal(summary.pageViewRows, 2);
});

test("GA4 landing-page summaries keep missing data unavailable and normalize paths", () => {
  const summary = summarizeLandingPageAnalytics([], [], []);
  assert.equal(summary.pageViews, null);
  assert.equal(summary.landingSessions, null);
  assert.equal(summary.conversions, null);
  assert.deepEqual(summary.events, []);
  assert.equal(normalizeAnalyticsPagePath("https://example.com/landing/roof?utm_source=ads#quote"), "/landing/roof/");
  assert.equal(normalizeAnalyticsPagePath("/landing//roof"), "/landing/roof/");
});


test("landing-page attribution groups GA4 sessions by campaign and source without inventing missing metrics", () => {
  const rows = summarizeLandingPageAttribution([
    { session_google_ads_campaign_name: "Roof Search", session_source_medium: "google / cpc", sessions: 12, conversions: 2 },
    { session_google_ads_campaign_name: "Roof Search", session_source_medium: "google / cpc", sessions: 3, conversions: null },
    { session_manual_campaign_name: "Spring Meta", session_source_medium: "facebook / paid_social", sessions: 4, conversions: 1 },
    { sessions: null, conversions: null },
  ]);
  assert.deepEqual(rows[0], { campaignName: "Roof Search", sourceMedium: "google / cpc", sessions: 15, conversions: 2 });
  assert.equal(rows[1].campaignName, "Spring Meta");
  assert.equal(rows[1].sessions, 4);
  assert.equal(rows[2].campaignName, "Campaign not supplied");
  assert.equal(rows[2].sessions, null);
  assert.equal(rows[2].conversions, null);
});


test("landing-page GA4 signals identify phone links and keep lead events separate", () => {
  const result = summarizeLandingPageSignals([
    { event_name: "click", link_url: "tel:+3531234567", event_count: 4, conversions: 1 },
    { event_name: "form_submit", event_count: 3, conversions: 2 },
    { event_name: "generate_lead", event_count: 2, conversions: 2 },
    { event_name: "page_view", link_url: "https://example.com/", event_count: 20 },
  ]);
  assert.equal(result.phoneClicks, 4);
  assert.deepEqual(result.formEvents.map((item) => item.eventName), ["form_submit", "generate_lead"]);
  assert.deepEqual(result.formEvents.map((item) => item.eventCount), [3, 2]);
  assert.equal(summarizeLandingPageSignals([]).phoneClicks, null);
  assert.equal(summarizeLandingPageSignals([{ event_name: "page_view", event_count: 4 }]).phoneClicks, 0);
});
