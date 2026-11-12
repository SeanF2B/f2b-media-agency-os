import test from "node:test";
import assert from "node:assert/strict";
import { googleAnalyticsFieldNames, googleAnalyticsQueryFields, hasGoogleAnalyticsReadScope, normalizeGoogleAnalyticsReport } from "../lib/google-analytics-direct.mjs";

test("direct GA4 is enabled only when Google granted the Analytics read-only scope", () => {
  assert.equal(hasGoogleAnalyticsReadScope("https://www.googleapis.com/auth/webmasters.readonly https://www.googleapis.com/auth/analytics.readonly"), true);
  assert.equal(hasGoogleAnalyticsReadScope("https://www.googleapis.com/auth/webmasters.readonly"), false);
  assert.equal(hasGoogleAnalyticsReadScope("https://www.googleapis.com/auth/analytics.readonly.extra"), false);
  assert.equal(hasGoogleAnalyticsReadScope(""), false);
});

test("maps workspace GA4 field names to official Data API names", () => {
  assert.deepEqual(googleAnalyticsQueryFields("landing_page,sessions,active_users,conversions"), {
    requested: ["landing_page", "sessions", "active_users", "conversions"],
    dimensions: ["landingPage"],
    metrics: ["sessions", "activeUsers", "keyEvents"],
  });
  assert.deepEqual(googleAnalyticsQueryFields("session_default_channel_group,sessions,conversions"), {
    requested: ["session_default_channel_group", "sessions", "conversions"],
    dimensions: ["sessionDefaultChannelGroup"],
    metrics: ["sessions", "keyEvents"],
  });
});

test("normalizes direct GA4 rows while retaining dimension and metric values", () => {
  const report = {
    dimensions: ["landingPage", "sessionSourceMedium"],
    metrics: ["sessions", "keyEvents"],
    rows: [{ dimensionValues: [{ value: "/roof-repairs/" }, { value: "google / cpc" }], metricValues: [{ value: "18" }, { value: "2" }] }],
  };
  assert.deepEqual(normalizeGoogleAnalyticsReport(report, "landing_page,session_source_medium,sessions,conversions"), [
    { landing_page: "/roof-repairs/", session_source_medium: "google / cpc", sessions: "18", conversions: "2" },
  ]);
  assert.equal(googleAnalyticsFieldNames.conversions, "keyEvents");
});

test("rejects unknown GA4 fields instead of silently requesting a partial report", () => {
  assert.throws(() => googleAnalyticsQueryFields("sessions,secret_metric"), /Unsupported GA4 report field/);
});
