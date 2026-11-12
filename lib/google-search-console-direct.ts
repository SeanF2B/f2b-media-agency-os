import { env } from "cloudflare:workers";
import { decryptGoogleAdsRefreshToken } from "@/lib/google-ads-direct";
import { normalizeSearchConsoleProperties, normalizeSearchConsoleRows } from "@/lib/google-search-console-normalize.mjs";
export { normalizeSearchConsoleProperties, normalizeSearchConsoleRows };

export type GoogleSearchConsoleProperty = { id: string; name: string; permissionLevel: string };
export type GoogleSearchConsoleRow = { date: string; query: string; page: string; clicks: number; impressions: number; ctr: number; position: number };

async function googleSearchConsoleAccessToken(ownerId: string) {
  if (!env.DB || !env.GOOGLE_ADS_CLIENT_ID || !env.GOOGLE_ADS_CLIENT_SECRET) throw new Error("Direct Search Console access is not configured on the app server.");
  const saved = await env.DB.prepare("SELECT encrypted_refresh_token, token_iv FROM google_search_console_connections WHERE owner_id = ?1").bind(ownerId).first<{ encrypted_refresh_token: string; token_iv: string }>();
  if (!saved) throw new Error("Google Search Console is not connected yet.");
  const refreshToken = await decryptGoogleAdsRefreshToken(saved.token_iv, saved.encrypted_refresh_token);
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: env.GOOGLE_ADS_CLIENT_ID, client_secret: env.GOOGLE_ADS_CLIENT_SECRET, refresh_token: refreshToken, grant_type: "refresh_token" }), signal: AbortSignal.timeout(15000) });
  const result = await response.json() as { access_token?: string; error?: string };
  if (!response.ok || !result.access_token) throw new Error(result.error === "invalid_grant" ? "Google revoked or expired the Search Console authorization. Reconnect Search Console." : "Google could not refresh Search Console access.");
  return result.access_token;
}

async function googleApi<T>(url: string, accessToken: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { Authorization: `Bearer ${accessToken}`, ...(init?.headers || {}) }, signal: AbortSignal.timeout(20000) });
  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    console.error("Google Search Console API request failed", { status: response.status, detail: detail.slice(0, 240) });
    if (response.status === 403) throw new Error("This Google login does not have Search Console access to the selected property. Connect the Google account that owns or can view it.");
    throw new Error(`Google Search Console could not complete the request (HTTP ${response.status}).`);
  }
  return response.json() as Promise<T>;
}

export async function hasGoogleSearchConsoleConnection(ownerId: string) {
  if (!env.DB) return false;
  try { return Boolean(await env.DB.prepare("SELECT owner_id FROM google_search_console_connections WHERE owner_id = ?1").bind(ownerId).first<{ owner_id: string }>()); }
  catch { return false; }
}

export async function listGoogleSearchConsoleProperties(ownerId: string) {
  const token = await googleSearchConsoleAccessToken(ownerId);
  const payload = await googleApi<unknown>("https://searchconsole.googleapis.com/webmasters/v3/sites", token);
  return normalizeSearchConsoleProperties(payload);
}

export async function readGoogleSearchConsoleRows(ownerId: string, propertyId: string, startDate: string, endDate: string) {
  if (!propertyId.trim()) throw new Error("Choose a Search Console property first.");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate) || startDate > endDate) throw new Error("The Search Console date range is not valid.");
  const token = await googleSearchConsoleAccessToken(ownerId);
  const endpoint = `https://searchconsole.googleapis.com/webmasters/v3/sites/${encodeURIComponent(propertyId)}/searchAnalytics/query`;
  const rows: GoogleSearchConsoleRow[] = [];
  const pageSize = 25000;
  for (let startRow = 0; startRow < 50000; startRow += pageSize) {
    const page = await googleApi<unknown>(endpoint, token, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ startDate, endDate, dimensions: ["date", "query", "page"], rowLimit: pageSize, startRow }) });
    const batch = normalizeSearchConsoleRows(page, propertyId);
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }
  return rows;
}
