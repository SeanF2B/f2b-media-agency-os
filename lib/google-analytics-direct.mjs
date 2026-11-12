export const googleAnalyticsFieldNames = Object.freeze({
  account_id: "accountId",
  account_name: "accountName",
  page_path: "pagePath",
  landing_page: "landingPage",
  session_default_channel_group: "sessionDefaultChannelGroup",
  event_name: "eventName",
  link_url: "linkUrl",
  session_google_ads_campaign_name: "sessionGoogleAdsCampaignName",
  session_manual_campaign_name: "sessionManualCampaignName",
  session_source_medium: "sessionSourceMedium",
  screen_page_views: "screenPageViews",
  sessions: "sessions",
  active_users: "activeUsers",
  engaged_sessions: "engagedSessions",
  event_count: "eventCount",
  conversions: "keyEvents",
  totalrevenue: "totalRevenue",
});

/** @param {string | null | undefined} value */
export function hasGoogleAnalyticsReadScope(value) {
  return String(value || "").split(/\s+/).includes("https://www.googleapis.com/auth/analytics.readonly");
}

const metricFields = new Set(["screen_page_views", "sessions", "active_users", "engaged_sessions", "event_count", "conversions", "totalrevenue"]);

/** @param {string} fields @returns {{requested: string[], dimensions: string[], metrics: string[]}} */
export function googleAnalyticsQueryFields(fields) {
  const requested = fields.split(",").map((field) => field.trim()).filter(Boolean);
  const unknown = requested.filter((field) => !(field in googleAnalyticsFieldNames));
  if (unknown.length) throw new Error(`Unsupported GA4 report field: ${unknown[0]}`);
  return {
    requested,
    dimensions: requested.filter((field) => !metricFields.has(field)).map((field) => googleAnalyticsFieldNames[field]),
    metrics: requested.filter((field) => metricFields.has(field)).map((field) => googleAnalyticsFieldNames[field]),
  };
}

export function normalizeGoogleAnalyticsReport(report, fields) {
  const { requested } = googleAnalyticsQueryFields(fields);
  return (report.rows || []).map((row) => Object.fromEntries(requested.map((field, index) => {
    const value = metricFields.has(field) ? row.metricValues?.[report.metrics?.indexOf(googleAnalyticsFieldNames[field]) ?? index]?.value : row.dimensionValues?.[report.dimensions?.indexOf(googleAnalyticsFieldNames[field]) ?? index]?.value;
    return [field, value ?? null];
  })));
}
