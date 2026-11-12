import { env } from "cloudflare:workers";
import { decryptGoogleAdsRefreshToken } from "@/lib/google-ads-direct";
import { hasGoogleAnalyticsReadScope } from "@/lib/google-analytics-direct.mjs";

export type GoogleAnalyticsReport = {
  dimensions: string[];
  metrics: string[];
  rows: Array<{ dimensionValues?: Array<{ value?: string }>; metricValues?: Array<{ value?: string }> }>;
};

function propertyId(value: string) {
  const match = String(value || "").trim().match(/^(?:properties\/)?(\d+)$/);
  if (!match) throw new Error("The saved GA4 property ID is not valid. Use the numeric property ID shown by Google Analytics.");
  return match[1];
}

async function accessToken(ownerId: string) {
  if (!env.DB || !env.GOOGLE_ADS_CLIENT_ID || !env.GOOGLE_ADS_CLIENT_SECRET) throw new Error("Direct Google Analytics access is not configured on the app server.");
  const saved = await env.DB.prepare("SELECT encrypted_refresh_token, token_iv FROM google_search_console_connections WHERE owner_id = ?1").bind(ownerId).first<{ encrypted_refresh_token: string; token_iv: string }>();
  if (!saved) throw new Error("Connect Google Search Console and Analytics before using direct GA4 access.");
  const refreshToken = await decryptGoogleAdsRefreshToken(saved.token_iv, saved.encrypted_refresh_token);
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: env.GOOGLE_ADS_CLIENT_ID, client_secret: env.GOOGLE_ADS_CLIENT_SECRET, refresh_token: refreshToken, grant_type: "refresh_token" }),
    signal: AbortSignal.timeout(15000),
  });
  const result = await response.json() as { access_token?: string; error?: string };
  if (!response.ok || !result.access_token) {
    if (result.error === "invalid_grant") throw new Error("Google authorization expired. Reconnect Google Search Console and Analytics.");
    throw new Error("Google could not refresh access. Reconnect Google Search Console and Analytics, then try again.");
  }
  return result.access_token;
}

async function googleRequest<T>(url: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, ...(init?.headers || {}) }, signal: AbortSignal.timeout(20000) });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({})) as { error?: { message?: string; status?: string } };
    if (response.status === 403) throw new Error("This Google login cannot access that GA4 property. Connect an account with Viewer access to the property and the Google Analytics Data API enabled.");
    if (response.status === 404) throw new Error("Google could not find that GA4 property. Check the saved property ID.");
    throw new Error(`Google Analytics could not complete the report (HTTP ${response.status}${detail.error?.status ? ` · ${detail.error.status}` : ""}).`);
  }
  return response.json() as Promise<T>;
}

export async function hasGoogleAnalyticsDirectConnection(ownerId: string) {
  if (!env.DB) return false;
  try {
    const saved = await env.DB.prepare("SELECT granted_scopes FROM google_search_console_connections WHERE owner_id = ?1").bind(ownerId).first<{ granted_scopes: string }>();
    return hasGoogleAnalyticsReadScope(saved?.granted_scopes);
  }
  catch { return false; }
}

export async function listGoogleAnalyticsProperties(ownerId: string) {
  const token = await accessToken(ownerId);
  const properties: Array<{ id: string; name: string; accountName: string }> = [];
  let pageToken = "";
  for (let page = 0; page < 10; page++) {
    const query = new URLSearchParams({ pageSize: "200" });
    if (pageToken) query.set("pageToken", pageToken);
    const payload = await googleRequest<{ accountSummaries?: Array<{ displayName?: string; propertySummaries?: Array<{ property?: string; displayName?: string }> }>; nextPageToken?: string }>(`https://analyticsadmin.googleapis.com/v1beta/accountSummaries?${query}`, token);
    for (const account of payload.accountSummaries || []) for (const item of account.propertySummaries || []) {
      const id = item.property?.match(/^properties\/(\d+)$/)?.[1] || "";
      if (id) properties.push({ id, name: item.displayName || `GA4 property ${id}`, accountName: account.displayName || "Google Analytics" });
    }
    pageToken = payload.nextPageToken || "";
    if (!pageToken) break;
  }
  return properties;
}

export async function readGoogleAnalyticsReport(ownerId: string, id: string, startDate: string, endDate: string, dimensions: string[], metrics: string[], filter?: { dimension: string; value: string }) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || startDate > endDate) throw new Error("The GA4 date range is not valid.");
  const token = await accessToken(ownerId);
  const query: Record<string, unknown> = {
    dateRanges: [{ startDate, endDate }],
    dimensions: dimensions.map((name) => ({ name })),
    metrics: metrics.map((name) => ({ name })),
    limit: "10000",
  };
  if (filter) query.dimensionFilter = { filter: { fieldName: filter.dimension, stringFilter: { matchType: "EXACT", value: filter.value } } };
  const payload = await googleRequest<GoogleAnalyticsReport>(`https://analyticsdata.googleapis.com/v1beta/properties/${propertyId(id)}:runReport`, token, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(query) });
  if (payload.rows != null && !Array.isArray(payload.rows)) throw new Error("Google Analytics returned an unexpected report response.");
  return (payload.rows || []).map((row) => Object.fromEntries([
    ...(payload.dimensions || []).map((name, index) => [name, row.dimensionValues?.[index]?.value ?? ""]),
    ...(payload.metrics || []).map((name, index) => [name, row.metricValues?.[index]?.value ?? null]),
  ]));
}
