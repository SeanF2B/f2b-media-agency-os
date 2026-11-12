import test from "node:test";
import assert from "node:assert/strict";
import { auditPeriodsComparable, buildFullMarketingAudit, buildMarketingAudit, compareAuditMetrics } from "../lib/marketing-audit.ts";

const base = { id: "audit-1", clientId: "client-1", clientName: "Example Client", createdAt: "2026-10-26T12:00:00.000Z", period: "last 30 days" };

test("Google Ads audit uses supplied metrics and avoids overstating zero conversions", () => {
  const run = buildMarketingAudit({ ...base, service: "Google Ads", status: "connected", data: { current: { totals: { spend: 125.5, clicks: 24, conversions: 0, costPerConversion: null }, campaigns: [{ spend: 125.5, conversions: 0 }] } } });
  assert.equal(run.metrics.spend, 125.5);
  assert.match(run.findings[0].evidence, /24 clicks.*0 reported conversions/);
  assert.match(run.findings[0].recommendation, /actual enquiries/);
});

test("Meta audit distinguishes platform-reported leads from confirmed CRM leads", () => {
  const run = buildMarketingAudit({ ...base, service: "Meta Ads", status: "connected", data: { current: { totals: { spend: 40, clicks: 13, impressions: 900, leads: 0 }, campaigns: [] } } });
  assert.equal(run.findings[0].id, "no-platform-leads");
  assert.match(run.findings[0].recommendation, /not confirmed CRM leads/);
});

test("SEO relative opportunities require enough query evidence and GA4-only data does not imply missing queries", () => {
  const rows = [
    { name: "roof repair", impressions: 100, ctr: 0.02 },
    { name: "emergency roof repair", impressions: 80, ctr: 0.03 },
    { name: "roofing company", impressions: 20, ctr: 0.2 },
  ];
  const run = buildMarketingAudit({ ...base, service: "SEO", status: "connected", data: { search: { status: "not_mapped", current: { totals: { clicks: 3, impressions: 200, ctr: 0.015, averagePosition: 8 }, topQueries: [] } }, analytics: { status: "connected", totals: { sessions: 22 } } } });
  assert.equal(run.metrics.analyticsSessions, 22);
  assert.equal(run.findings.some((finding) => finding.id === "query-detail-unavailable"), false);
  const withQueries = buildMarketingAudit({ ...base, id: "audit-2", service: "SEO", status: "connected", data: { search: { status: "connected", current: { totals: { clicks: 3, impressions: 200, ctr: 0.015, averagePosition: 8 }, topQueries: rows } }, analytics: { status: "connected", totals: { sessions: 22 } } } });
  assert.equal(withQueries.findings.some((finding) => finding.id === "query-ctr-opportunity"), true);
});

test("no-data audit produces no performance recommendations", () => {
  const run = buildMarketingAudit({ ...base, service: "Google Ads", status: "no_data", data: { current: { totals: { spend: 0, clicks: 0, conversions: 0 }, campaigns: [] } } });
  assert.equal(run.findings.length, 0);
  assert.match(run.summary, /no performance conclusions/i);
});

test("audit compares current values with the previous saved run", () => {
  const previous = { id: "audit-0", metrics: { spend: 100, clicks: 10, conversions: 2 } };
  const run = buildMarketingAudit({ ...base, service: "Google Ads", status: "connected", previous, data: { current: { totals: { spend: 125, clicks: 15, conversions: 2, costPerConversion: 62.5 }, campaigns: [] } } });
  assert.equal(run.previousRunId, "audit-0");
  assert.equal(run.comparison.spend, 25);
  assert.equal(run.comparison.clicks, 5);
});

test("audit uses the provider's adjacent date window instead of overlapping saved rolling windows", () => {
  const run = buildMarketingAudit({
    ...base,
    service: "Google Ads",
    status: "connected",
    previous: { id: "rolling-snapshot", metrics: { spend: 10, clicks: 1 } },
    data: {
      dateWindow: { current: { start: "2026-10-01", end: "2026-10-30" }, previous: { start: "2026-09-01", end: "2026-09-30" } },
      current: { totals: { spend: 120, clicks: 30, conversions: 3, costPerConversion: 40 }, campaigns: [] },
      previous: { totals: { spend: 100, clicks: 20, conversions: 2, costPerConversion: 50 }, campaigns: [] },
    },
  });
  assert.equal(run.period, "2026-10-01 to 2026-10-30");
  assert.equal(run.comparisonPeriod, "2026-09-01 to 2026-09-30");
  assert.equal(run.comparison.spend, 20);
  assert.equal(run.comparison.clicks, 10);
  assert.equal(run.comparison.conversions, 1);
});

test("full audits compare each connected service with its own adjacent provider period", () => {
  const run = buildFullMarketingAudit({ ...base, sources: [
    { service: "Google Ads", status: "connected", data: {
      dateWindow: { current: { start: "2026-10-01", end: "2026-10-30" }, previous: { start: "2026-09-01", end: "2026-09-30" } },
      current: { totals: { spend: 120, clicks: 30, conversions: 3 }, campaigns: [] },
      previous: { totals: { spend: 100, clicks: 20, conversions: 2 }, campaigns: [] },
    } },
  ] });
  assert.equal(run.period, "2026-10-01 to 2026-10-30");
  assert.equal(run.comparisonPeriod, "2026-09-01 to 2026-09-30");
  assert.equal(run.comparison["google-ads.spend"], 20);
  assert.equal(run.comparison["google-ads.clicks"], 10);
});

test("audit comparison returns readable labels and only metrics present in both runs", () => {
  const previous = { id: "audit-before", clientId: "client-1", service: "Google Ads", period: "Last 30 days", metrics: { spend: 100, clicks: 20, conversions: null } };
  const current = { id: "audit-after", clientId: "client-1", service: "Google Ads", period: "last 30 days", previousRunId: "audit-before", metrics: { spend: 125.5, clicks: 25, conversions: 3, costPerConversion: null } };
  assert.deepEqual(compareAuditMetrics(current, previous), [
    { key: "spend", label: "Spend", previous: 100, current: 125.5, change: 25.5 },
    { key: "clicks", label: "Clicks", previous: 20, current: 25, change: 5 },
  ]);
  assert.deepEqual(compareAuditMetrics(current, { ...previous, clientId: "another-client" }), []);
  assert.deepEqual(compareAuditMetrics(current, { ...previous, service: "Meta Ads" }), []);
});

test("audit comparisons require reporting periods with matching lengths", () => {
  assert.equal(auditPeriodsComparable("2026-09-01 to 2026-09-30", "2026-10-01 to 2026-10-30"), true);
  assert.equal(auditPeriodsComparable("2026-10-01 to 2026-10-31", "2026-09-01 to 2026-09-30"), false);
  assert.equal(auditPeriodsComparable("Last 7 days", "Last 30 days"), false);
  assert.equal(auditPeriodsComparable("custom period", "custom period"), true);
});

test("full audit includes only connected services, keeps findings labelled and compares saved runs", () => {
  const previous = { id: "full-0", metrics: { "google-ads.spend": 100 } };
  const run = buildFullMarketingAudit({ ...base, previous, sources: [
    { service: "Google Ads", status: "connected", data: { current: { totals: { spend: 125, clicks: 20, conversions: 0 }, campaigns: [] } } },
    { service: "Meta Ads", status: "unavailable", message: "Not linked" },
    { service: "SEO", status: "no_data", message: "No rows" },
  ] });
  assert.equal(run.status, "connected");
  assert.equal(run.metrics["google-ads.spend"], 125);
  assert.equal(run.comparison["google-ads.spend"], 25);
  assert.match(run.findings[0].title, /^Google Ads:/);
  assert.equal(run.sources?.length, 3);
  assert.equal(run.findings.some((finding) => finding.title.startsWith("Meta Ads:")), false);
});

test("full audit keeps GA4 separate from Search Console and saves its own connected metrics", () => {
  const run = buildFullMarketingAudit({ ...base, sources: [
    { service: "SEO", status: "unavailable", message: "Search Console is not mapped." },
    { service: "Google Analytics", status: "connected", data: { status: "connected", totals: { sessions: 120, activeUsers: 88, engagedSessions: 71, conversions: 9, revenue: 42 } } },
  ] });
  assert.equal(run.status, "connected");
  assert.equal(run.sources?.find((source) => source.service === "SEO")?.status, "unavailable");
  assert.equal(run.sources?.find((source) => source.service === "Google Analytics")?.status, "connected");
  assert.equal(run.metrics["google-analytics.sessions"], 120);
  assert.equal(run.metrics["google-analytics.configuredConversions"], 9);
  assert.equal(run.sources?.length, 2);
});

test("full audit records Business Profile activity separately from website traffic and lead claims", () => {
  const run = buildFullMarketingAudit({ ...base, sources: [
    { service: "Google Business Profile", status: "connected", data: { current: { impressions: 410, calls: 12, directions: 8, websiteClicks: 19 }, reviews: { total: 27, averageRating: 4.8 } } },
  ] });
  assert.equal(run.metrics["google-business-profile.calls"], 12);
  assert.equal(run.metrics["google-business-profile.reviewCount"], 27);
  assert.equal(run.metrics["google-business-profile.averageRating"], 4.8);
  assert.equal(run.findings.length, 0);
  assert.equal(run.sources?.[0]?.service, "Google Business Profile");
});

test("full audit with no available data reports connection status without inventing findings", () => {
  const run = buildFullMarketingAudit({ ...base, sources: [{ service: "Google Ads", status: "unavailable", message: "Not linked" }, { service: "Meta Ads", status: "no_data" }, { service: "SEO", status: "unavailable" }] });
  assert.equal(run.findings.length, 0);
  assert.equal(run.status, "no_data");
  assert.match(run.summary, /No performance conclusions/i);
});
