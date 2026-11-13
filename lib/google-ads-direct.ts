import { env } from "cloudflare:workers";
import { googleAdsCampaignMetricsQuery, normalizeGoogleAdsCampaignMetricBatches, type GoogleAdsCampaignMetricBatch } from "@/lib/google-ads-report";
import { googleAdsSearchTermsQuery } from "@/lib/google-ads-search-terms.mjs";
import { googleAdsAssetQueries, normalizeGoogleAdsAssetRows } from "@/lib/google-ads-assets.mjs";

const GOOGLE_ADS_SCOPE = "https://www.googleapis.com/auth/adwords";
const GOOGLE_ADS_API_VERSION = "v26";
// A scheduled task makes several Google Ads reads in one Worker invocation.
// Reusing the short-lived access token avoids refreshing it once per report,
// which otherwise creates a burst of OAuth and D1 requests for the same run.
const googleAdsAccessTokens = new Map<string, { token: string; expiresAt: number }>();

function googleAdsHeaders(accessToken: string) {
  // Google retired developer tokens as the API access gate in September 2026.
  // Access level is now determined by the Google Cloud project behind OAuth.
  const headers: Record<string, string> = { Authorization: `Bearer ${accessToken}`, "Content-Type": "application/json" };
  if (env.GOOGLE_ADS_LOGIN_CUSTOMER_ID) headers["login-customer-id"] = env.GOOGLE_ADS_LOGIN_CUSTOMER_ID.replace(/\D/g, "");
  return headers;
}

function asB64(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

function fromB64(value: string) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "="));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function encryptionKey() {
  const encoded = env.GOOGLE_ADS_TOKEN_ENCRYPTION_KEY;
  if (!encoded) throw new Error("Google Ads token encryption is not configured.");
  const bytes = fromB64(encoded);
  if (bytes.byteLength !== 32) throw new Error("Google Ads token encryption key must be 32 bytes.");
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

export async function encryptRefreshToken(token: string) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await encryptionKey(), new TextEncoder().encode(token));
  return { iv: asB64(iv), ciphertext: asB64(new Uint8Array(ciphertext)) };
}

async function decryptRefreshToken(iv: string, ciphertext: string) {
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv: fromB64(iv) }, await encryptionKey(), fromB64(ciphertext));
  return new TextDecoder().decode(plain);
}

export const decryptGoogleAdsRefreshToken = decryptRefreshToken;

export async function googleAdsConnectionReady(ownerId: string) {
  if (!env.DB || !env.GOOGLE_ADS_CLIENT_ID || !env.GOOGLE_ADS_CLIENT_SECRET || !env.GOOGLE_ADS_TOKEN_ENCRYPTION_KEY) return false;
  return Boolean(await env.DB.prepare("SELECT owner_id FROM google_ads_connections WHERE owner_id = ?1").bind(ownerId).first());
}

export async function getGoogleAdsAccessToken(ownerId: string) {
  const cached = googleAdsAccessTokens.get(ownerId);
  if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
  if (!env.DB || !env.GOOGLE_ADS_CLIENT_ID || !env.GOOGLE_ADS_CLIENT_SECRET) throw new Error("Google Ads API credentials are not configured on the server.");
  const saved = await env.DB.prepare("SELECT encrypted_refresh_token, token_iv FROM google_ads_connections WHERE owner_id = ?1").bind(ownerId).first<{ encrypted_refresh_token: string; token_iv: string }>();
  if (!saved) throw new Error("Google Ads is not connected yet. Connect your Google Ads account first.");
  const refreshToken = await decryptRefreshToken(saved.token_iv, saved.encrypted_refresh_token);
  const response = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: env.GOOGLE_ADS_CLIENT_ID, client_secret: env.GOOGLE_ADS_CLIENT_SECRET, refresh_token: refreshToken, grant_type: "refresh_token" }), signal: AbortSignal.timeout(15000) });
  const result = await response.json() as { access_token?: string; expires_in?: number; error?: string };
  if (!response.ok || !result.access_token) throw new Error(result.error === "invalid_grant" ? "Google revoked or expired the saved authorization. Reconnect Google Ads." : "Google Ads could not refresh its authorization. Reconnect Google Ads if this continues.");
  const expiresIn = Math.max(60, Number(result.expires_in) || 3600);
  googleAdsAccessTokens.set(ownerId, { token: result.access_token, expiresAt: Date.now() + expiresIn * 1000 });
  if (googleAdsAccessTokens.size > 50) {
    const firstKey = googleAdsAccessTokens.keys().next().value;
    if (firstKey) googleAdsAccessTokens.delete(firstKey);
  }
  await env.DB.prepare("UPDATE google_ads_connections SET last_token_refresh_at = ?2 WHERE owner_id = ?1").bind(ownerId, new Date().toISOString()).run();
  return result.access_token;
}

export async function keepGoogleAdsTokensFresh(db: D1Database) {
  const now = new Date();
  const nowIso = now.toISOString();
  const staleBefore = new Date(now.getTime() - 24 * 60 * 60_000).toISOString();
  const claimUntil = new Date(now.getTime() + 15 * 60_000).toISOString();
  const retryAfterFailure = new Date(now.getTime() + 60 * 60_000).toISOString();
  const connections = await db.prepare("SELECT owner_id FROM google_ads_connections WHERE last_token_refresh_at IS NULL OR last_token_refresh_at < ?1").bind(staleBefore).all<{ owner_id: string }>();
  for (const connection of connections.results || []) {
    const claim = await db.prepare("UPDATE google_ads_connections SET refresh_claim_until = ?2 WHERE owner_id = ?1 AND (last_token_refresh_at IS NULL OR last_token_refresh_at < ?3) AND (refresh_claim_until IS NULL OR refresh_claim_until < ?4)")
      .bind(connection.owner_id, claimUntil, staleBefore, nowIso).run();
    if (!claim.meta.changes) continue;
    try {
      await getGoogleAdsAccessToken(connection.owner_id);
      await db.prepare("UPDATE google_ads_connections SET refresh_claim_until = NULL WHERE owner_id = ?1").bind(connection.owner_id).run();
    } catch (error) {
      await db.prepare("UPDATE google_ads_connections SET refresh_claim_until = ?2 WHERE owner_id = ?1").bind(connection.owner_id, retryAfterFailure).run();
      console.error("Google Ads connection keepalive failed", { ownerId: connection.owner_id, reason: error instanceof Error ? error.message : "unknown error" });
    }
  }
}

export async function updateGoogleAdsCampaign(ownerId: string, customerId: string, campaignId: string, status?: "PAUSED" | "ENABLED") {
  const accessToken = await getGoogleAdsAccessToken(ownerId);
  const cleanCustomerId = customerId.replace(/\D/g, "");
  const cleanCampaignId = campaignId.replace(/\D/g, "");
  if (!/^\d{6,20}$/.test(cleanCustomerId) || !/^\d{3,20}$/.test(cleanCampaignId)) throw new Error("The Google Ads customer or campaign ID is not valid.");
  const headers = googleAdsHeaders(accessToken);
  const response = await fetch(`https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${cleanCustomerId}/campaigns:mutate`, { method: "POST", headers, body: JSON.stringify({ operations: [{ update: { resourceName: `customers/${cleanCustomerId}/campaigns/${cleanCampaignId}`, status }, updateMask: "status" }] }), signal: AbortSignal.timeout(20000) });
  const result = await response.json() as { results?: Array<{ resourceName?: string }>; error?: { message?: string } };
  if (!response.ok) {
    console.error("Google Ads campaign change failed", { status: response.status, message: String(result.error?.message || "").slice(0, 300) });
    throw new Error("Google Ads rejected the change. Check API access level, account access and campaign status, then reconnect or review the Google Ads API setup.");
  }
  return result.results?.[0]?.resourceName || `customers/${cleanCustomerId}/campaigns/${cleanCampaignId}`;
}

export async function readGoogleAdsCampaign(ownerId: string, customerId: string, campaignId: string) {
  const accessToken = await getGoogleAdsAccessToken(ownerId);
  const cleanCustomerId = customerId.replace(/\D/g, "");
  const cleanCampaignId = campaignId.replace(/\D/g, "");
  if (!/^\d{6,20}$/.test(cleanCustomerId) || !/^\d{3,20}$/.test(cleanCampaignId)) throw new Error("The Google Ads customer or campaign ID is not valid.");
  const headers = googleAdsHeaders(accessToken);
  const response = await fetch(`https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${cleanCustomerId}/googleAds:searchStream`, { method: "POST", headers, body: JSON.stringify({ query: `SELECT customer.currency_code, campaign.id, campaign.name, campaign.status, campaign.campaign_budget, campaign_budget.id, campaign_budget.amount_micros FROM campaign WHERE campaign.id = ${cleanCampaignId}` }), signal: AbortSignal.timeout(20000) });
  const payload = await response.json() as Array<{ results?: Array<{ customer?: { currencyCode?: string }; campaign?: { id?: string; name?: string; status?: string; campaignBudget?: string }; campaignBudget?: { id?: string; amountMicros?: string } }> }>;
  if (!response.ok) {
    console.error("Google Ads campaign read failed", { status: response.status });
    throw new Error("Google Ads could not read this campaign. Check the connected user’s account access and API access level.");
  }
  const row = payload.flatMap((item) => item.results || []).find((item) => String(item.campaign?.id) === cleanCampaignId);
  if (!row?.campaign) throw new Error("That campaign ID was not found in this client’s connected Google Ads account.");
  return { customerId: cleanCustomerId, campaignId: cleanCampaignId, name: row.campaign.name || `Campaign ${cleanCampaignId}`, status: row.campaign.status || "UNKNOWN", currencyCode: row.customer?.currencyCode || "EUR", budgetResourceName: row.campaign.campaignBudget || "", budgetId: row.campaignBudget?.id || "", budgetMicros: Number(row.campaignBudget?.amountMicros || 0) };
}

export async function listGoogleAdsCampaigns(ownerId: string, customerId: string) {
  const cleanCustomerId = customerId.replace(/\D/g, "");
  if (!/^\d{6,20}$/.test(cleanCustomerId)) throw new Error("The Google Ads customer ID is not valid.");
  const { payload } = await googleAdsPost(ownerId, cleanCustomerId, "googleAds:searchStream", { query: "SELECT campaign.id, campaign.name, campaign.status, campaign.primary_status, campaign.primary_status_reasons, campaign.bidding_strategy_type, campaign.campaign_budget, campaign_budget.amount_micros, campaign_budget.status, metrics.impressions, metrics.clicks, metrics.ctr, metrics.cost_micros, metrics.conversions, metrics.conversions_value, metrics.cost_per_conversion FROM campaign WHERE segments.date DURING LAST_30_DAYS AND campaign.status != 'REMOVED' ORDER BY campaign.name" });
  return (payload as Array<{ results?: Array<{ campaign?: { id?: string; name?: string; status?: string; primaryStatus?: string; primaryStatusReasons?: string[]; biddingStrategyType?: string; campaignBudget?: string }; campaignBudget?: { amountMicros?: string; status?: string }; metrics?: { impressions?: string; clicks?: string; ctr?: string; costMicros?: string; conversions?: string; conversionsValue?: string; costPerConversion?: string } }> }>).flatMap((item) => item.results || []).flatMap((row) => row.campaign?.id ? [{
    id: String(row.campaign.id), name: row.campaign.name || `Campaign ${row.campaign.id}`, status: row.campaign.status || "UNKNOWN",
    primaryStatus: row.campaign.primaryStatus || "UNKNOWN", primaryStatusReasons: row.campaign.primaryStatusReasons || [], biddingStrategy: row.campaign.biddingStrategyType || "UNKNOWN",
    budgetResourceName: row.campaign.campaignBudget || "", budgetMicros: Number(row.campaignBudget?.amountMicros || 0), budgetStatus: row.campaignBudget?.status || "UNKNOWN",
    impressions: Number(row.metrics?.impressions || 0), clicks: Number(row.metrics?.clicks || 0), ctr: Number(row.metrics?.ctr || 0), spend: Number(row.metrics?.costMicros || 0) / 1_000_000,
    conversions: Number(row.metrics?.conversions || 0), conversionValue: Number(row.metrics?.conversionsValue || 0), costPerConversion: Number(row.metrics?.costPerConversion || 0) / 1_000_000,
  }] : []);
}

export async function getGoogleAdsConversionActions(ownerId: string, customerId: string) {
  const { payload } = await googleAdsPost(ownerId, customerId, "googleAds:searchStream", { query: "SELECT conversion_action.id, conversion_action.name, conversion_action.status, conversion_action.category, conversion_action.origin, conversion_action.include_in_conversions_metric, conversion_action.primary_for_goal FROM conversion_action WHERE conversion_action.status != 'REMOVED' ORDER BY conversion_action.name LIMIT 100" });
  const rows = (payload as Array<{ results?: Array<any> }>).flatMap((batch) => batch.results || []);
  return rows.map((row) => ({ id: String(row.conversionAction?.id || ""), name: String(row.conversionAction?.name || ""), status: String(row.conversionAction?.status || "UNKNOWN"), category: String(row.conversionAction?.category || "UNKNOWN"), origin: String(row.conversionAction?.origin || "UNKNOWN"), includedInConversions: Boolean(row.conversionAction?.includeInConversionsMetric), primaryForGoal: Boolean(row.conversionAction?.primaryForGoal) })).filter((item) => item.id);
}

export async function getGoogleAdsCampaignChangeEvents(ownerId: string, customerId: string, campaignId?: string) {
  const cleanCampaignId = campaignId?.replace(/\D/g, "");
  if (campaignId && !/^\d{3,20}$/.test(cleanCampaignId || "")) throw new Error("The Google Ads campaign ID is not valid.");
  const campaignFilter = cleanCampaignId ? ` AND change_event.campaign = 'customers/${customerId.replace(/\D/g, "")}/campaigns/${cleanCampaignId}'` : "";
  const query = `SELECT change_event.change_date_time, change_event.campaign, change_event.change_resource_type, change_event.resource_change_operation, change_event.changed_fields, change_event.user_email, change_event.client_type, change_event.change_resource_name FROM change_event WHERE change_event.change_date_time DURING LAST_30_DAYS${campaignFilter} ORDER BY change_event.change_date_time DESC LIMIT 1000`;
  const { payload } = await googleAdsPost(ownerId, customerId, "googleAds:searchStream", { query });
  const rows = (payload as Array<{ results?: Array<any> }>).flatMap((batch) => batch.results || []);
  return rows.slice(0, 200).map((row) => {
    const fields = row.changeEvent?.changedFields;
    const changedFields = Array.isArray(fields?.paths) ? fields.paths.join(", ") : String(fields || "");
    return { at: String(row.changeEvent?.changeDateTime || ""), campaign: String(row.changeEvent?.campaign || ""), resourceType: String(row.changeEvent?.changeResourceType || "UNKNOWN"), operation: String(row.changeEvent?.resourceChangeOperation || "UNKNOWN"), changedFields: changedFields.slice(0, 240), user: String(row.changeEvent?.userEmail || "").slice(0, 120), clientType: String(row.changeEvent?.clientType || "UNKNOWN"), resource: String(row.changeEvent?.changeResourceName || "").slice(0, 240) };
  });
}

export async function getGoogleAdsCampaignDailyPerformance(ownerId: string, customerId: string, campaignId: string) {
  const cleanCampaignId = campaignId.replace(/\D/g, "");
  if (!/^\d{3,20}$/.test(cleanCampaignId)) throw new Error("The Google Ads campaign ID is not valid.");
  const endDate = new Date(Date.now() - 24 * 60 * 60_000).toISOString().slice(0, 10);
  const startDate = new Date(Date.parse(`${endDate}T00:00:00Z`) - 89 * 24 * 60 * 60_000).toISOString().slice(0, 10);
  const query = `SELECT campaign.id, segments.date, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions FROM campaign WHERE campaign.id = ${cleanCampaignId} AND segments.date BETWEEN '${startDate}' AND '${endDate}'`;
  const { customerId: accountId, payload } = await googleAdsPost(ownerId, customerId, "googleAds:searchStream", { query });
  const rows = (payload as Array<{ results?: Array<any> }>).flatMap((batch) => batch.results || []);
  const reportedDays = rows.map((row) => ({ date: String(row.segments?.date || ""), impressions: Number(row.metrics?.impressions || 0), clicks: Number(row.metrics?.clicks || 0), spend: Number(row.metrics?.costMicros || 0) / 1_000_000, conversions: Number(row.metrics?.conversions || 0) }));
  const days = reportedDays;
  let budgetDiagnostics: { searchBudgetLostImpressionShare?: number; searchRankLostImpressionShare?: number } = {};
  let budgetDiagnosticsNote = "Budget and rank lost-impression-share diagnostics are unavailable for this campaign.";
  try {
    const diagnosticsQuery = `SELECT campaign.id, metrics.search_budget_lost_impression_share, metrics.search_rank_lost_impression_share FROM campaign WHERE campaign.id = ${cleanCampaignId}`;
    const diagnosticsResult = await googleAdsPost(ownerId, customerId, "googleAds:searchStream", { query: diagnosticsQuery });
    const diagnosticRows = (diagnosticsResult.payload as Array<{ results?: Array<any> }>).flatMap((batch) => batch.results || []);
    const metrics = diagnosticRows[0]?.metrics;
    if (metrics) {
      budgetDiagnostics = { searchBudgetLostImpressionShare: Number(metrics.searchBudgetLostImpressionShare || 0), searchRankLostImpressionShare: Number(metrics.searchRankLostImpressionShare || 0) };
      budgetDiagnosticsNote = "Campaign budget and rank lost-impression-share diagnostics were queried separately from daily metrics.";
    } else budgetDiagnosticsNote = "Google Ads returned no budget or rank lost-impression-share diagnostics for this campaign.";
  } catch (error) {
    budgetDiagnosticsNote = error instanceof Error ? error.message.slice(0, 240) : "Google Ads did not return budget or rank lost-impression-share diagnostics.";
  }
  return { source: "Google Ads API · campaign daily performance", accountId, campaignId: cleanCampaignId, range: `${startDate} to ${endDate}`, reportedDays: reportedDays.length, days, totals: days.reduce((total, day) => ({ impressions: total.impressions + day.impressions, clicks: total.clicks + day.clicks, spend: total.spend + day.spend, conversions: total.conversions + day.conversions }), { impressions: 0, clicks: 0, spend: 0, conversions: 0 }), budgetDiagnostics, budgetDiagnosticsNote };
}

export async function getGoogleAdsCampaignConversionGoals(ownerId: string, customerId: string, campaignId: string) {
  const cleanCampaignId = campaignId.replace(/\D/g, "");
  if (!/^\d{3,20}$/.test(cleanCampaignId)) throw new Error("The Google Ads campaign ID is not valid.");
  const query = `SELECT campaign_conversion_goal.campaign, campaign_conversion_goal.category, campaign_conversion_goal.origin, campaign_conversion_goal.biddable FROM campaign_conversion_goal WHERE campaign.id = ${cleanCampaignId} LIMIT 200`;
  const { customerId: accountId, payload } = await googleAdsPost(ownerId, customerId, "googleAds:searchStream", { query });
  const rows = (payload as Array<{ results?: Array<any> }>).flatMap((batch) => batch.results || []);
  return { source: "Google Ads API · campaign conversion goals", accountId, campaignId: cleanCampaignId, count: rows.length, goals: rows.map((row) => ({ campaign: String(row.campaignConversionGoal?.campaign || ""), category: String(row.campaignConversionGoal?.category || "UNKNOWN"), origin: String(row.campaignConversionGoal?.origin || "UNKNOWN"), biddable: Boolean(row.campaignConversionGoal?.biddable) })) };
}

export async function listGoogleAdsAccessibleCustomers(ownerId: string) {
  const accessToken = await getGoogleAdsAccessToken(ownerId);
  const response = await fetch(`https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers:listAccessibleCustomers`, {
    method: "GET", headers: googleAdsHeaders(accessToken), signal: AbortSignal.timeout(20000),
  });
  const payload = await response.json() as { resourceNames?: string[]; error?: { message?: string } };
  if (!response.ok) {
    const detail = String(payload.error?.message || "").slice(0, 400);
    console.error("Google Ads account list failed", { status: response.status, detail });
    throw new Error(`Google Ads could not list accounts (HTTP ${response.status}). ${detail || "Check Google Ads API access and account permissions."}`);
  }
  return [...new Set((payload.resourceNames || []).map((resource) => resource.match(/^customers\/(\d+)$/)?.[1]).filter((id): id is string => Boolean(id)))].sort();
}

async function googleAdsPost(ownerId: string, customerId: string, method: string, body: unknown) {
  const accessToken = await getGoogleAdsAccessToken(ownerId);
  const cleanCustomerId = customerId.replace(/\D/g, "");
  if (!/^\d{6,20}$/.test(cleanCustomerId)) throw new Error("The Google Ads customer ID is not valid.");
  const headers = googleAdsHeaders(accessToken);
  const response = await fetch(`https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${cleanCustomerId}/${method}`, {
    method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(20000),
  });
  const responseText = await response.text();
  let payload: any;
  try { payload = responseText ? JSON.parse(responseText) : null; }
  catch { payload = null; }
  if (!response.ok) {
    // Google Ads searchStream can return an array containing an error envelope,
    // while other endpoints return the usual { error: ... } object.
    const apiError = payload?.error || (Array.isArray(payload) ? payload.find((item: any) => item?.error)?.error : undefined);
    const nestedMessages = Array.isArray(apiError?.details)
      ? apiError.details.flatMap((item: any) => Array.isArray(item?.errors) ? item.errors.map((entry: any) => entry?.message) : [])
      : [];
    const detail = String(apiError?.message || nestedMessages.find((message: unknown) => typeof message === "string") || "").slice(0, 700);
    console.error("Google Ads API request failed", { method, status: response.status, code: apiError?.status || apiError?.code || "", detail, bodyType: payload ? "json" : responseText ? "other" : "empty" });
    if (/PERMISSION_DENIED|CUSTOMER_NOT_ENABLED|USER_PERMISSION_DENIED/i.test(detail)) throw new Error("Google Ads rejected this request because the connected Google account or Google Cloud project is not approved for this feature. Check API access and the user's access to this Ads account.");
    throw new Error(`Google Ads ${method} failed (HTTP ${response.status}). ${detail || "Google Ads did not provide an error message. Check the saved account ID and API access."}`);
  }
  if (!payload) throw new Error("Google Ads returned an unreadable response. Retry the audit; no account changes were made.");
  return { customerId: cleanCustomerId, payload };
}

export async function getGoogleAdsCampaignMetrics(ownerId: string, customerId: string, window: { start: string; end: string }, campaignId?: string) {
  const query = googleAdsCampaignMetricsQuery(window, campaignId);
  const { customerId: cleanCustomerId, payload } = await googleAdsPost(ownerId, customerId, "googleAds:searchStream", { query });
  return { customerId: cleanCustomerId, rows: normalizeGoogleAdsCampaignMetricBatches(payload as GoogleAdsCampaignMetricBatch[]) };
}

export async function getGoogleAdsSearchTerms(ownerId: string, customerId: string, dateWindow?: { startDate: string; endDate: string; label: string }, campaignId?: string) {
  const query = googleAdsSearchTermsQuery(dateWindow, campaignId);
  const { customerId: cleanCustomerId, payload } = await googleAdsPost(ownerId, customerId, "googleAds:searchStream", { query });
  const rows = (payload as Array<{ results?: Array<any> }>).flatMap((batch) => batch.results || []);
  const terms = rows.map((row) => ({
    campaignId: String(row.campaign?.id || ""), campaign: row.campaign?.name || "",
    adGroupId: String(row.adGroup?.id || ""), adGroup: row.adGroup?.name || "",
    searchTerm: row.campaignSearchTermView?.searchTerm || "",
    matchType: String(row.segments?.searchTermMatchType || ""),
    matchSource: String(row.segments?.searchTermMatchSource || ""),
    targetingStatus: String(row.segments?.searchTermTargetingStatus || ""),
    keyword: String(row.segments?.keyword?.info?.text || ""),
    keywordMatchType: String(row.segments?.keyword?.info?.matchType || ""),
    device: String(row.segments?.device || ""),
    network: String(row.segments?.adNetworkType || ""),
    impressions: Number(row.metrics?.impressions || 0), clicks: Number(row.metrics?.clicks || 0),
    ctr: Number(row.metrics?.ctr || 0), averageCpc: Number(row.metrics?.averageCpc || 0) / 1_000_000,
    spend: Number(row.metrics?.costMicros || 0) / 1_000_000, conversions: Number(row.metrics?.conversions || 0),
    conversionValue: Number(row.metrics?.conversionsValue || 0),
    costPerConversion: Number(row.metrics?.costPerConversion || 0) / 1_000_000,
  }));
  return { source: "Google Ads API · Search terms", accountId: cleanCustomerId, range: dateWindow?.label || "Last 30 days", note: "Google's campaign search-term report includes Performance Max and standard campaigns, with match source, targeting status, device, and keyword context. Google may still omit low-volume or privacy-protected searches.", terms };
}

export async function getGoogleAdsKeywordPerformance(ownerId: string, customerId: string, campaignId?: string, dateWindow?: { startDate: string; endDate: string }) {
  const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  if (dateWindow && (!validDate(dateWindow.startDate) || !validDate(dateWindow.endDate) || dateWindow.startDate > dateWindow.endDate)) throw new Error("The requested Google Ads date range is invalid.");
  const cleanCampaignId = campaignId?.trim();
  if (cleanCampaignId && !/^\d{3,20}$/.test(cleanCampaignId)) throw new Error("The Google Ads campaign ID is not valid.");
  const scope = cleanCampaignId ? ` AND campaign.id = ${cleanCampaignId}` : "";
  const dateFilter = dateWindow ? `segments.date BETWEEN '${dateWindow.startDate}' AND '${dateWindow.endDate}'` : "segments.date DURING LAST_30_DAYS";
  const query = `SELECT campaign.id, campaign.name, ad_group.id, ad_group.name, ad_group_criterion.resource_name, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ad_group_criterion.status, metrics.impressions, metrics.clicks, metrics.ctr, metrics.average_cpc, metrics.cost_micros, metrics.conversions, metrics.conversions_value, metrics.cost_per_conversion, metrics.historical_quality_score, metrics.historical_creative_quality_score, metrics.historical_landing_page_quality_score, metrics.historical_search_predicted_ctr FROM keyword_view WHERE ${dateFilter} AND ad_group_criterion.status != 'REMOVED' AND metrics.impressions > 0${scope} ORDER BY metrics.cost_micros DESC LIMIT 500`;
  const { customerId: cleanCustomerId, payload } = await googleAdsPost(ownerId, customerId, "googleAds:searchStream", { query });
  const rows = (payload as Array<{ results?: Array<any> }>).flatMap((batch) => batch.results || []);
  return { source: "Google Ads API · keyword performance", accountId: cleanCustomerId, range: dateWindow ? `${dateWindow.startDate} to ${dateWindow.endDate}` : "Last 30 days", keywords: rows.map((row) => ({ campaignId: String(row.campaign?.id || ""), campaign: String(row.campaign?.name || ""), adGroupId: String(row.adGroup?.id || ""), adGroup: String(row.adGroup?.name || ""), criterionResourceName: String(row.adGroupCriterion?.resourceName || ""), keyword: String(row.adGroupCriterion?.keyword?.text || ""), matchType: String(row.adGroupCriterion?.keyword?.matchType || ""), status: String(row.adGroupCriterion?.status || ""), impressions: Number(row.metrics?.impressions || 0), clicks: Number(row.metrics?.clicks || 0), ctr: Number(row.metrics?.ctr || 0), averageCpc: Number(row.metrics?.averageCpc || 0) / 1_000_000, spend: Number(row.metrics?.costMicros || 0) / 1_000_000, conversions: Number(row.metrics?.conversions || 0), conversionValue: Number(row.metrics?.conversionsValue || 0), costPerConversion: Number(row.metrics?.costPerConversion || 0) / 1_000_000, qualityScore: row.metrics?.historicalQualityScore ?? null, adRelevance: row.metrics?.historicalCreativeQualityScore || "", landingPageExperience: row.metrics?.historicalLandingPageQualityScore || "", expectedCtr: row.metrics?.historicalSearchPredictedCtr || "" })) };
}

export async function getGoogleAdsAdGroupPerformance(ownerId: string, customerId: string, dateWindow: { startDate: string; endDate: string }, campaignId?: string) {
  const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && !Number.isNaN(Date.parse(`${value}T00:00:00Z`)) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  if (!validDate(dateWindow.startDate) || !validDate(dateWindow.endDate) || dateWindow.startDate > dateWindow.endDate) throw new Error("The requested Google Ads date range is invalid.");
  const cleanCampaignId = campaignId?.trim();
  if (cleanCampaignId && !/^\d{3,20}$/.test(cleanCampaignId)) throw new Error("The Google Ads campaign ID is not valid.");
  const campaignFilter = cleanCampaignId ? ` AND campaign.id = ${cleanCampaignId}` : "";
  const query = `SELECT segments.date, campaign.id, campaign.name, campaign.status, ad_group.id, ad_group.name, ad_group.status, metrics.impressions, metrics.clicks, metrics.cost_micros, metrics.conversions, metrics.conversions_value FROM ad_group WHERE segments.date BETWEEN '${dateWindow.startDate}' AND '${dateWindow.endDate}' AND campaign.status != 'REMOVED' AND ad_group.status != 'REMOVED' AND metrics.impressions > 0${campaignFilter} ORDER BY metrics.cost_micros DESC LIMIT 10000`;
  const { customerId: cleanCustomerId, payload } = await googleAdsPost(ownerId, customerId, "googleAds:searchStream", { query });
  const rows = (payload as Array<{ results?: Array<any> }>).flatMap((batch) => batch.results || []);
  return { customerId: cleanCustomerId, rows: rows.map((row) => ({
    date: String(row.segments?.date || ""), campaign_id: String(row.campaign?.id || ""), campaign: String(row.campaign?.name || ""), campaign_status: String(row.campaign?.status || "UNKNOWN"),
    ad_group_id: String(row.adGroup?.id || ""), ad_group_name: String(row.adGroup?.name || ""), ad_group_status: String(row.adGroup?.status || "UNKNOWN"),
    impressions: Number(row.metrics?.impressions || 0), clicks: Number(row.metrics?.clicks || 0), spend: Number(row.metrics?.costMicros || 0) / 1_000_000, conversions: Number(row.metrics?.conversions || 0), conversion_value: Number(row.metrics?.conversionsValue || 0),
  })) };
}

export async function getGoogleAdsAdPerformance(ownerId: string, customerId: string, campaignId?: string) {
  const scope = campaignId ? ` AND campaign.id = ${campaignId.replace(/\D/g, "")}` : "";
  if (campaignId && !/^\d{3,20}$/.test(campaignId.replace(/\D/g, ""))) throw new Error("The Google Ads campaign ID is not valid.");
  const query = `SELECT campaign.id, campaign.name, ad_group.id, ad_group.name, ad_group_ad.ad.id, ad_group_ad.status, metrics.impressions, metrics.clicks, metrics.ctr, metrics.average_cpc, metrics.cost_micros, metrics.conversions FROM ad_group_ad WHERE segments.date DURING LAST_30_DAYS AND ad_group_ad.status != 'REMOVED' AND metrics.impressions > 0${scope} ORDER BY metrics.cost_micros DESC LIMIT 500`;
  const { customerId: cleanCustomerId, payload } = await googleAdsPost(ownerId, customerId, "googleAds:searchStream", { query });
  const rows = (payload as Array<{ results?: Array<any> }>).flatMap((batch) => batch.results || []);
  return { source: "Google Ads API · ad performance", accountId: cleanCustomerId, range: "Last 30 days", ads: rows.map((row) => ({ campaignId: String(row.campaign?.id || ""), campaign: String(row.campaign?.name || ""), adGroupId: String(row.adGroup?.id || ""), adGroup: String(row.adGroup?.name || ""), adId: String(row.adGroupAd?.ad?.id || ""), status: String(row.adGroupAd?.status || ""), impressions: Number(row.metrics?.impressions || 0), clicks: Number(row.metrics?.clicks || 0), ctr: Number(row.metrics?.ctr || 0), averageCpc: Number(row.metrics?.averageCpc || 0) / 1_000_000, spend: Number(row.metrics?.costMicros || 0) / 1_000_000, conversions: Number(row.metrics?.conversions || 0) })) };
}

export async function getGoogleAdsNegativeKeywords(ownerId: string, customerId: string, campaignId?: string) {
  const scope = campaignId ? ` AND campaign.id = ${campaignId.replace(/\D/g, "")}` : "";
  if (campaignId && !/^\d{3,20}$/.test(campaignId.replace(/\D/g, ""))) throw new Error("The Google Ads campaign ID is not valid.");
  const query = `SELECT campaign.id, campaign.name, ad_group.id, ad_group.name, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type, ad_group_criterion.status FROM ad_group_criterion WHERE ad_group_criterion.type = KEYWORD AND ad_group_criterion.negative = TRUE AND ad_group_criterion.status != 'REMOVED'${scope} ORDER BY campaign.name, ad_group.name LIMIT 10000`;
  const { customerId: cleanCustomerId, payload } = await googleAdsPost(ownerId, customerId, "googleAds:searchStream", { query });
  const rows = (payload as Array<{ results?: Array<any> }>).flatMap((batch) => batch.results || []);
  return { source: "Google Ads API · live negative keywords", accountId: cleanCustomerId, count: rows.length, negatives: rows.map((row) => ({ campaignId: String(row.campaign?.id || ""), campaign: String(row.campaign?.name || ""), adGroupId: String(row.adGroup?.id || ""), adGroup: String(row.adGroup?.name || ""), keyword: String(row.adGroupCriterion?.keyword?.text || ""), matchType: String(row.adGroupCriterion?.keyword?.matchType || ""), status: String(row.adGroupCriterion?.status || "") })) };
}

export async function listGoogleAdsAdGroups(ownerId: string, customerId: string, campaignId?: string) {
  const where = campaignId ? `campaign.id = ${campaignId.replace(/\D/g, "")}` : "campaign.status != 'REMOVED'";
  if (campaignId && !/^\d{3,20}$/.test(campaignId.replace(/\D/g, ""))) throw new Error("The Google Ads campaign ID is not valid.");
  const query = `SELECT campaign.id, campaign.name, ad_group.id, ad_group.name, ad_group.status FROM ad_group WHERE ${where} AND ad_group.status != 'REMOVED' ORDER BY campaign.name, ad_group.name LIMIT 500`;
  const { customerId: cleanCustomerId, payload } = await googleAdsPost(ownerId, customerId, "googleAds:searchStream", { query });
  const rows = (payload as Array<{ results?: Array<any> }>).flatMap((batch) => batch.results || []);
  return rows.map((row) => ({ campaignId: String(row.campaign?.id || ""), campaign: row.campaign?.name || "", id: String(row.adGroup?.id || ""), name: row.adGroup?.name || "", status: row.adGroup?.status || "UNKNOWN" })).filter((row) => row.id).slice(0, 200);
}

export type GoogleAdsResponsiveSearchAd = {
  customerId: string;
  campaignId: string;
  campaignName: string;
  adGroupId: string;
  adGroupName: string;
  adId: string;
  status: string;
  finalUrls: string[];
  headlines: Array<{ text: string; pinnedField?: string }>;
  descriptions: Array<{ text: string; pinnedField?: string }>;
};

export async function listGoogleAdsResponsiveSearchAds(ownerId: string, customerId: string, campaignId?: string) {
  const cleanCampaignId = campaignId?.replace(/\D/g, "");
  if (campaignId && !/^\d{3,20}$/.test(cleanCampaignId || "")) throw new Error("The Google Ads campaign ID is not valid.");
  const where = cleanCampaignId ? `campaign.id = ${cleanCampaignId}` : "campaign.status != 'REMOVED'";
  const query = `SELECT campaign.id, campaign.name, ad_group.id, ad_group.name, ad_group_ad.status, ad_group_ad.ad.id, ad_group_ad.ad.final_urls, ad_group_ad.ad.responsive_search_ad.headlines, ad_group_ad.ad.responsive_search_ad.descriptions FROM ad_group_ad WHERE ${where} AND ad_group_ad.ad.type = RESPONSIVE_SEARCH_AD AND ad_group_ad.status != 'REMOVED' ORDER BY campaign.name, ad_group.name LIMIT 500`;
  const { customerId: cleanCustomerId, payload } = await googleAdsPost(ownerId, customerId, "googleAds:searchStream", { query });
  const rows = (payload as Array<{ results?: Array<any> }>).flatMap((batch) => batch.results || []);
  return rows.flatMap((row): GoogleAdsResponsiveSearchAd[] => {
    const ad = row.adGroupAd?.ad;
    const adId = String(ad?.id || "");
    if (!adId) return [];
    return [{
      customerId: cleanCustomerId,
      campaignId: String(row.campaign?.id || ""),
      campaignName: String(row.campaign?.name || ""),
      adGroupId: String(row.adGroup?.id || ""),
      adGroupName: String(row.adGroup?.name || ""),
      adId,
      status: String(row.adGroupAd?.status || "UNKNOWN"),
      finalUrls: Array.isArray(ad.finalUrls) ? ad.finalUrls.map(String) : [],
      headlines: (ad.responsiveSearchAd?.headlines || []).map((item: any) => ({ text: String(item.text || ""), ...(item.pinnedField ? { pinnedField: String(item.pinnedField) } : {}) })),
      descriptions: (ad.responsiveSearchAd?.descriptions || []).map((item: any) => ({ text: String(item.text || ""), ...(item.pinnedField ? { pinnedField: String(item.pinnedField) } : {}) })),
    }];
  });
}

export async function listGoogleAdsCampaignAssets(ownerId: string, customerId: string, campaignId?: string, dateWindow?: { start: string; end: string }) {
  const queries = googleAdsAssetQueries(campaignId, dateWindow);
  const [campaignResult, adGroupResult, customerResult, assetGroupResult] = await Promise.all([
    googleAdsPost(ownerId, customerId, "googleAds:searchStream", { query: queries.campaign }),
    googleAdsPost(ownerId, customerId, "googleAds:searchStream", { query: queries.adGroup }),
    googleAdsPost(ownerId, customerId, "googleAds:searchStream", { query: queries.customer }),
    googleAdsPost(ownerId, customerId, "googleAds:searchStream", { query: queries.assetGroup }),
  ]);
  const rows = (result: { payload: unknown }) => (result.payload as Array<{ results?: any[] }>).flatMap((batch) => batch.results || []);
  return [
    ...normalizeGoogleAdsAssetRows(rows(customerResult), "Account"),
    ...normalizeGoogleAdsAssetRows(rows(campaignResult), "Campaign"),
    ...normalizeGoogleAdsAssetRows(rows(adGroupResult), "Ad group"),
    ...normalizeGoogleAdsAssetRows(rows(assetGroupResult), "Performance Max asset group"),
  ];
}

// Single-query campaign-level asset read for scheduled audits. The full
// inventory helper above makes four requests; keeping the runner to one query
// avoids exhausting a Worker invocation while still providing real evidence.
export async function listGoogleAdsCampaignLevelAssets(ownerId: string, customerId: string, campaignId?: string) {
  const query = googleAdsAssetQueries(campaignId).campaign.replace(/LIMIT 10000\s*$/i, "LIMIT 200");
  const { payload } = await googleAdsPost(ownerId, customerId, "googleAds:searchStream", { query });
  const batches = payload as Array<{ results?: Array<any> }>;
  return normalizeGoogleAdsAssetRows(batches.flatMap((batch) => batch.results || []), "Campaign").slice(0, 200);
}

export type GoogleAdsCampaignAssetDraft =
  | { type: "SITELINK"; linkText: string; description1?: string; description2?: string; finalUrl: string }
  | { type: "CALLOUT"; calloutText: string }
  | { type: "STRUCTURED_SNIPPET"; header: string; values: string[] };

/** Creates a text asset and links it to the selected campaign in one atomic Ads API request. */
export async function createGoogleAdsCampaignAsset(ownerId: string, customerId: string, campaignId: string, draft: GoogleAdsCampaignAssetDraft, assetName?: string) {
  const cleanCustomerId = customerId.replace(/\D/g, "");
  const cleanCampaignId = campaignId.replace(/\D/g, "");
  if (!/^\d{6,20}$/.test(cleanCustomerId) || !/^\d{3,20}$/.test(cleanCampaignId)) throw new Error("The Google Ads account or campaign ID is not valid.");
  const assetResourceName = `customers/${cleanCustomerId}/assets/-1`;
  const campaignResourceName = `customers/${cleanCustomerId}/campaigns/${cleanCampaignId}`;
  const asset: Record<string, unknown> = { resourceName: assetResourceName, name: (assetName || `Agency OS ${draft.type.toLowerCase()} ${crypto.randomUUID().slice(0, 8)}`).slice(0, 120) };
  if (draft.type === "SITELINK") {
    if (!draft.linkText.trim() || draft.linkText.length > 25 || !/^https:\/\//i.test(draft.finalUrl)) throw new Error("Sitelinks need link text up to 25 characters and a secure destination URL.");
    if ((draft.description1 || "").length > 35 || (draft.description2 || "").length > 35) throw new Error("Each sitelink description must be 35 characters or fewer.");
    asset.sitelinkAsset = { linkText: draft.linkText.trim(), ...(draft.description1?.trim() ? { description1: draft.description1.trim() } : {}), ...(draft.description2?.trim() ? { description2: draft.description2.trim() } : {}) };
    asset.finalUrls = [draft.finalUrl];
  } else if (draft.type === "CALLOUT") {
    if (!draft.calloutText.trim() || draft.calloutText.length > 25) throw new Error("Callout text must be 25 characters or fewer.");
    asset.calloutAsset = { calloutText: draft.calloutText.trim() };
  } else {
    if (!draft.header.trim() || draft.header.length > 25 || draft.values.length < 3 || draft.values.length > 10 || draft.values.some((value) => !value.trim() || value.length > 25)) throw new Error("A structured snippet needs a supported heading and 3–10 values, each up to 25 characters.");
    asset.structuredSnippetAsset = { header: draft.header.trim(), values: draft.values.map((value) => value.trim()) };
  }
  const fieldType = draft.type;
  const { payload } = await googleAdsPost(ownerId, cleanCustomerId, "googleAds:mutate", {
    mutateOperations: [
      { assetOperation: { create: asset } },
      { campaignAssetOperation: { create: { campaign: campaignResourceName, asset: assetResourceName, fieldType } } },
    ],
  });
  const responses = (payload.mutateOperationResponses || []) as Array<{ assetResult?: { resourceName?: string }; campaignAssetResult?: { resourceName?: string } }>;
  const createdAssetResourceName = String(responses[0]?.assetResult?.resourceName || "");
  const associationResourceName = String(responses[1]?.campaignAssetResult?.resourceName || "");
  if (!createdAssetResourceName || !associationResourceName) throw new Error("Google Ads accepted the asset request but did not return both saved resource names. Check the campaign before retrying.");
  return { customerId: cleanCustomerId, campaignId: cleanCampaignId, assetResourceName: createdAssetResourceName, associationResourceName, fieldType };
}

export async function removeGoogleAdsCampaignAsset(ownerId: string, customerId: string, associationResourceName: string) {
  const cleanCustomerId = customerId.replace(/\D/g, "");
  const expectedPrefix = `customers/${cleanCustomerId}/campaignAssets/`;
  if (!/^\d{6,20}$/.test(cleanCustomerId) || !associationResourceName.startsWith(expectedPrefix)) throw new Error("The saved campaign asset link does not match this Google Ads account.");
  await googleAdsPost(ownerId, cleanCustomerId, "campaignAssets:mutate", { operations: [{ remove: associationResourceName }] });
}

export async function updateGoogleAdsResponsiveSearchAd(ownerId: string, customerId: string, input: { adId: string; headlines: Array<{ text: string; pinnedField?: string }>; descriptions: Array<{ text: string; pinnedField?: string }> }) {
  const cleanCustomerId = customerId.replace(/\D/g, "");
  const adId = input.adId.replace(/\D/g, "");
  if (!/^\d{6,20}$/.test(cleanCustomerId) || !/^\d{3,20}$/.test(adId)) throw new Error("The Google Ads account or ad ID is invalid.");
  if (input.headlines.length < 3 || input.headlines.length > 15 || input.headlines.some((item) => !item.text.trim() || item.text.length > 30) || new Set(input.headlines.map((item) => item.text.trim().toLowerCase())).size !== input.headlines.length) throw new Error("Responsive Search Ads need 3–15 unique headlines, each 30 characters or fewer.");
  if (input.descriptions.length < 2 || input.descriptions.length > 4 || input.descriptions.some((item) => !item.text.trim() || item.text.length > 90) || new Set(input.descriptions.map((item) => item.text.trim().toLowerCase())).size !== input.descriptions.length) throw new Error("Responsive Search Ads need 2–4 unique descriptions, each 90 characters or fewer.");
  const { payload } = await googleAdsPost(ownerId, cleanCustomerId, "ads:mutate", { operations: [{ update: {
    resourceName: `customers/${cleanCustomerId}/ads/${adId}`,
    responsiveSearchAd: {
      headlines: input.headlines.map((item) => ({ text: item.text.trim(), ...(item.pinnedField ? { pinnedField: item.pinnedField } : {}) })),
      descriptions: input.descriptions.map((item) => ({ text: item.text.trim(), ...(item.pinnedField ? { pinnedField: item.pinnedField } : {}) })),
    },
  }, updateMask: "responsive_search_ad.headlines,responsive_search_ad.descriptions" }] });
  return String(payload.results?.[0]?.resourceName || `customers/${cleanCustomerId}/ads/${adId}`);
}

export async function getGoogleAdsKeywordCriterion(ownerId: string, customerId: string, input: { adGroupId: string; keyword: string; matchType: "EXACT" | "PHRASE" | "BROAD"; negative: boolean }) {
  const adGroupId = input.adGroupId.replace(/\D/g, "");
  if (!/^\d{3,20}$/.test(adGroupId) || !input.keyword.trim() || input.keyword.length > 80) throw new Error("The ad group or keyword is not valid.");
  const query = `SELECT ad_group_criterion.resource_name, ad_group_criterion.status, ad_group_criterion.negative, ad_group_criterion.keyword.text, ad_group_criterion.keyword.match_type FROM ad_group_criterion WHERE ad_group.id = ${adGroupId} AND ad_group_criterion.type = KEYWORD AND ad_group_criterion.status != 'REMOVED' LIMIT 10000`;
  const { payload } = await googleAdsPost(ownerId, customerId, "googleAds:searchStream", { query });
  const rows = (payload as Array<{ results?: Array<any> }>).flatMap((batch) => batch.results || []);
  const found = rows.find((row) => String(row.adGroupCriterion?.keyword?.text || "").toLocaleLowerCase() === input.keyword.trim().toLocaleLowerCase()
    && String(row.adGroupCriterion?.keyword?.matchType || "") === input.matchType
    && Boolean(row.adGroupCriterion?.negative) === input.negative);
  return found ? { resourceName: String(found.adGroupCriterion.resourceName), status: String(found.adGroupCriterion.status || "UNKNOWN") } : null;
}

export async function mutateGoogleAdsKeyword(ownerId: string, customerId: string, input: { adGroupId: string; keyword: string; matchType: "EXACT" | "PHRASE" | "BROAD"; negative: boolean; remove: boolean }) {
  const cleanCustomerId = customerId.replace(/\D/g, "");
  const adGroupId = input.adGroupId.replace(/\D/g, "");
  const keyword = input.keyword.trim();
  if (!/^\d{6,20}$/.test(cleanCustomerId) || !/^\d{3,20}$/.test(adGroupId) || !keyword || keyword.length > 80) throw new Error("The ad group or keyword is not valid.");
  const existing = await getGoogleAdsKeywordCriterion(ownerId, cleanCustomerId, { adGroupId, keyword, matchType: input.matchType, negative: input.negative });
  if (input.remove && !existing) throw new Error("That exact keyword was not found in the selected ad group; nothing changed.");
  if (!input.remove && existing) throw new Error("That exact keyword already exists in the selected ad group; nothing changed.");
  const operation = input.remove
    ? { remove: existing!.resourceName }
    : { create: { adGroup: `customers/${cleanCustomerId}/adGroups/${adGroupId}`, status: "ENABLED", negative: input.negative, keyword: { text: keyword, matchType: input.matchType } } };
  const { payload } = await googleAdsPost(ownerId, cleanCustomerId, "adGroupCriteria:mutate", { operations: [operation] });
  const resourceName = String(payload.results?.[0]?.resourceName || (input.remove ? existing!.resourceName : ""));
  return { customerId: cleanCustomerId, adGroupId, keyword, matchType: input.matchType, negative: input.negative, removed: input.remove, resourceName };
}

export async function generateGoogleAdsKeywordIdeas(ownerId: string, customerId: string, input: { keywords: string[]; url?: string; geoTargetConstant?: string }) {
  const keywords = input.keywords.map((value) => value.trim()).filter(Boolean).slice(0, 10);
  const url = (input.url || "").trim();
  if (!keywords.length && !url) throw new Error("Provide at least one seed phrase or a landing page URL.");
  if (keywords.some((value) => value.length > 80)) throw new Error("Each keyword seed must be 80 characters or fewer.");
  if (url) {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" || parsed.username || parsed.password) throw new Error("The landing page must be a public HTTPS URL.");
  }
  const seed = keywords.length && url ? { keywordAndUrlSeed: { keywords, url } }
    : keywords.length ? { keywordSeed: { keywords } } : { urlSeed: { url } };
  const geoId = String(input.geoTargetConstant || "2372").replace(/\D/g, "");
  if (!/^\d{1,12}$/.test(geoId)) throw new Error("Choose a valid Google Ads location before running Keyword Planner.");
  const { customerId: cleanCustomerId, payload } = await googleAdsPost(ownerId, customerId, ":generateKeywordIdeas", {
    ...seed,
    language: "languageConstants/1000",
    geoTargetConstants: [`geoTargetConstants/${geoId}`],
    keywordPlanNetwork: "GOOGLE_SEARCH",
    includeAdultKeywords: false,
  });
  const results = (payload.results || []).map((item: any) => {
    const metrics = item.keywordIdeaMetrics || {};
    return {
      keyword: String(item.text || ""), avgMonthlySearches: Number(metrics.avgMonthlySearches || 0),
      competition: metrics.competition || "UNSPECIFIED", competitionIndex: metrics.competitionIndex ?? null,
      lowTopOfPageBid: Number(metrics.lowTopOfPageBidMicros || 0) / 1_000_000,
      highTopOfPageBid: Number(metrics.highTopOfPageBidMicros || 0) / 1_000_000,
      monthlySearchVolumes: (metrics.monthlySearchVolumes || []).slice(-12).map((entry: any) => ({ year: entry.year, month: entry.month, searches: Number(entry.monthlySearches || 0) })),
    };
  }).sort((a: any, b: any) => b.avgMonthlySearches - a.avgMonthlySearches).slice(0, 100);
  const knownLocations: Record<string, string> = { "2372": "Ireland", "2826": "United Kingdom", "2840": "United States" };
  return { source: "Google Ads Keyword Planner API", customerId: cleanCustomerId, language: "English", location: knownLocations[geoId] || `Google Ads location ${geoId}`, geoTargetConstant: geoId, count: results.length, results };
}

export async function updateGoogleAdsCampaignBudget(ownerId: string, customerId: string, budgetResourceName: string, amountMicros: number) {
  if (!/^customers\/\d{6,20}\/campaignBudgets\/\d{3,20}$/.test(budgetResourceName) || !Number.isSafeInteger(amountMicros) || amountMicros < 1) throw new Error("The daily budget change is not valid.");
  const accessToken = await getGoogleAdsAccessToken(ownerId);
  const headers = googleAdsHeaders(accessToken);
  const customerIdClean = customerId.replace(/\D/g, "");
  const response = await fetch(`https://googleads.googleapis.com/${GOOGLE_ADS_API_VERSION}/customers/${customerIdClean}/campaignBudgets:mutate`, { method: "POST", headers, body: JSON.stringify({ operations: [{ update: { resourceName: budgetResourceName, amountMicros: String(amountMicros) }, updateMask: "amountMicros" }] }), signal: AbortSignal.timeout(20000) });
  const payload = await response.json() as { results?: Array<{ resourceName?: string }>; error?: { message?: string } };
  if (!response.ok) {
    console.error("Google Ads budget change failed", { status: response.status, message: String(payload.error?.message || "").slice(0, 300) });
    throw new Error("Google Ads rejected the budget change. Check the campaign’s budget settings and API access level.");
  }
  return payload.results?.[0]?.resourceName || budgetResourceName;
}

export const googleAdsScope = GOOGLE_ADS_SCOPE;

// Onboarding prefill: the account name and the website its ads point to (most common final URL host).
export async function getGoogleAdsAccountWebsite(ownerId: string, customerId: string) {
  const { payload } = await googleAdsPost(ownerId, customerId, "googleAds:search", { query: "SELECT customer.descriptive_name, ad_group_ad.ad.final_urls FROM ad_group_ad WHERE ad_group_ad.status != 'REMOVED' LIMIT 50" });
  const rows = (payload?.results || []) as Array<{ customer?: { descriptiveName?: string }; adGroupAd?: { ad?: { finalUrls?: string[] } } }>;
  const counts = new Map<string, number>();
  for (const row of rows) for (const url of row.adGroupAd?.ad?.finalUrls || []) { try { const host = new URL(url).hostname.replace(/^www\./, ""); counts.set(host, (counts.get(host) || 0) + 1); } catch { /* skip */ } }
  const host = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] || "";
  return { name: rows[0]?.customer?.descriptiveName || "", website: host ? `https://${host}` : "" };
}
