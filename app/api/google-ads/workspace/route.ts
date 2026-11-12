import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { getTeamPermissions } from "@/lib/access-permissions";
import { compareGoogleAdsTotals, googleAdsPerformanceWindow, summarizeGoogleAdsBreakdown, summarizeGoogleAdsRows, type GoogleAdsBreakdown, type GoogleAdsMetricRow, type GoogleAdsRange } from "@/lib/google-ads-performance";
import { listDailyMarketingSnapshots, loadCachedMarketingData, saveDailyMarketingSnapshot } from "@/lib/marketing-data-history";
import { getGoogleAdsAdGroupPerformance, getGoogleAdsCampaignMetrics, getGoogleAdsKeywordPerformance, getGoogleAdsSearchTerms, listGoogleAdsCampaignAssets, listGoogleAdsCampaigns, listGoogleAdsResponsiveSearchAds } from "@/lib/google-ads-direct";

export const dynamic = "force-dynamic";
const respond = (error: string, status = 400) => Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

function previousWindow(current: { start: string; end: string }) {
  const start = new Date(`${current.start}T00:00:00Z`);
  const end = new Date(`${current.end}T00:00:00Z`);
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  const previousEnd = new Date(start);
  previousEnd.setUTCDate(previousEnd.getUTCDate() - 1);
  const previousStart = new Date(previousEnd);
  previousStart.setUTCDate(previousStart.getUTCDate() - days + 1);
  return { start: previousStart.toISOString().slice(0, 10), end: previousEnd.toISOString().slice(0, 10) };
}

const breakdownFields: Record<GoogleAdsBreakdown, string> = {
  ad_groups: "account_id,campaign,campaign_id,campaign_status,ad_group_name,ad_group_id,ad_group_status,spend,impressions,clicks,conversions,conversion_value",
  keywords: "account_id,campaign,campaign_id,ad_group_name,ad_group_id,keyword_text,keyword_status,match_type,spend,impressions,clicks,conversions,conversion_value,ctr,average_cpc,cost_per_conversion",
  search_terms: "account_id,campaign,campaign_id,search_term_view_ad_group,search_term_view_ad_group_id,search_term,search_term_match_type,spend,impressions,clicks,conversions,conversion_value,ctr,average_cpc,cost_per_conversion",
};
type GoogleAdsWorkspaceSection = GoogleAdsBreakdown | "ads" | "assets";

async function readRows(accountId: string, window: { start: string; end: string }, section?: GoogleAdsBreakdown, campaignId?: string, cacheScope?: { ownerId: string; clientId: string }) {
  if (!env.WINDSOR_API_KEY) throw new Error("The Windsor API key is not configured on the app server.");
  const key = JSON.stringify({ accountId, window, section: section || "campaigns", campaignId: campaignId || "" });
  const load = async () => {
    const params = new URLSearchParams({
      api_key: env.WINDSOR_API_KEY!,
      fields: section ? breakdownFields[section] : "account_id,date,campaign,campaign_id,campaign_status,spend,impressions,clicks,conversions,conversion_value",
      date_from: window.start,
      date_to: window.end,
      select_accounts: accountId,
      _max_rows: "1000",
      _renderer: "json",
    });
    if (campaignId && /^\d+$/.test(campaignId)) params.set("filter", JSON.stringify([["campaign_id", "eq", campaignId]]));
    const response = await fetch(`https://connectors.windsor.ai/google_ads?${params}`, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 500);
      throw new Error(`Windsor could not read Google Ads data (HTTP ${response.status}). ${detail}`);
    }
    const payload = await response.json() as { data?: GoogleAdsMetricRow[] };
    if (!Array.isArray(payload.data)) throw new Error("Windsor returned an unexpected Google Ads response.");
    return payload.data;
  };
  if (!cacheScope || !env.DB) return load();
  return (await loadCachedMarketingData({ db: env.DB, ...cacheScope, service: "Google Ads", key }, load)).data;
}

async function readDirectBreakdown(ownerId: string, accountId: string, window: { start: string; end: string }, section: GoogleAdsBreakdown, campaignId?: string) {
  const dateWindow = { startDate: window.start, endDate: window.end };
  if (section === "ad_groups") return (await getGoogleAdsAdGroupPerformance(ownerId, accountId, dateWindow, campaignId)).rows;
  if (section === "keywords") {
    const result = await getGoogleAdsKeywordPerformance(ownerId, accountId, campaignId, dateWindow);
    return result.keywords.map((item) => ({ campaign_id: item.campaignId, campaign: item.campaign, ad_group_id: item.adGroupId, ad_group_name: item.adGroup, keyword_text: item.keyword, keyword_status: item.status, match_type: item.matchType, spend: item.spend, impressions: item.impressions, clicks: item.clicks, ctr: item.ctr, average_cpc: item.averageCpc, conversions: item.conversions, conversion_value: item.conversionValue, cost_per_conversion: item.costPerConversion, quality_score: item.qualityScore, ad_relevance: item.adRelevance, landing_page_experience: item.landingPageExperience, expected_ctr: item.expectedCtr, criterion_resource_name: item.criterionResourceName }));
  }
  const result = await getGoogleAdsSearchTerms(ownerId, accountId, { ...dateWindow, label: `${window.start} to ${window.end}` }, campaignId);
  return result.terms.map((item) => ({ campaign_id: item.campaignId, campaign: item.campaign, search_term_view_ad_group_id: item.adGroupId, search_term_view_ad_group: item.adGroup, search_term: item.searchTerm, search_term_match_type: item.matchType, match_source: item.matchSource, search_term_targeting_status: item.targetingStatus, keyword_text: item.keyword, keyword_match_type: item.keywordMatchType, device: item.device, network: item.network, impressions: item.impressions, clicks: item.clicks, ctr: item.ctr, average_cpc: item.averageCpc, spend: item.spend, conversions: item.conversions, conversion_value: item.conversionValue, cost_per_conversion: item.costPerConversion }));
}

async function readWorkspaceRows<T>(direct: boolean, readDirect: () => Promise<T>, readWindsor: () => Promise<T>, label: string) {
  if (!direct) return { rows: await readWindsor(), source: "Windsor.ai Google Ads connector · read-only" };
  try { return { rows: await readDirect(), source: "Google Ads API · read-only performance" }; }
  catch (error) {
    if (!env.WINDSOR_API_KEY) throw error;
    console.warn(`Google Ads ${label} direct read failed; trying Windsor`, { reason: error instanceof Error ? error.message : "unknown error" });
    return { rows: await readWindsor(), source: "Windsor.ai Google Ads connector · read-only" };
  }
}

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return respond("Sign in to view Google Ads results.", 401);
  if (!env.DB) return respond("The workspace database is unavailable.", 503);
  const row = await env.DB.prepare("SELECT data FROM workspace_documents WHERE id = ?1").bind("f2b-agency").first<{ data: string }>();
  if (!row?.data) return respond("The workspace is unavailable.", 503);
  const workspace = JSON.parse(row.data);
  const owner = workspace.ownerId === user.userId;
  const profile = (workspace.staff || []).find((member: any) => !member.isBot && (member.id === user.userId || member.email?.toLowerCase() === user.email.toLowerCase()));
  const admin = owner || ["Owner", "Admin"].includes(profile?.role || "");
  const permissions = owner ? { reports: true } : getTeamPermissions(profile?.role || "Viewer", profile?.permissions);
  if (!admin && !permissions.reports) return respond("You do not have permission to view Ads performance.", 403);

  const url = new URL(request.url);
  const clientId = url.searchParams.get("clientId") || "";
  const client = (workspace.clients || []).find((item: any) => item.id === clientId);
  if (!client) return respond("Choose a client in this workspace.", 404);
  if (!admin && Array.isArray(profile?.clientAccessIds) && !profile.clientAccessIds.includes(clientId)) return respond("You do not have access to this client’s Google Ads account.", 403);
  const accountId = String(client.googleAdsAccountId || "").replace(/\D/g, "");
  if (!accountId) return Response.json({ status: "not_mapped", clientId, message: "Add this client’s Google Ads account ID in the client record." }, { headers: { "Cache-Control": "no-store" } });
  const directConnection = await env.DB.prepare("SELECT owner_id FROM google_ads_connections WHERE owner_id = ?1").bind(String(workspace.ownerId || user.userId)).first<{ owner_id: string }>();
  const useDirectApi = Boolean(directConnection && env.GOOGLE_ADS_CLIENT_ID && env.GOOGLE_ADS_CLIENT_SECRET && env.GOOGLE_ADS_TOKEN_ENCRYPTION_KEY);
  if (!useDirectApi && !env.WINDSOR_API_KEY) return Response.json({ status: "missing_connection", clientId, message: directConnection ? "Direct Google Ads access is not configured. Check the connected Google login and Google Ads API access for its Cloud project." : "The Windsor API key is not configured and direct Google Ads API access is not ready." }, { headers: { "Cache-Control": "no-store" } });

  const requestedRange = (url.searchParams.get("range") || "last_30d") as GoogleAdsRange;
  if (!["last_7d", "last_30d", "last_90d", "custom"].includes(requestedRange)) return respond("Choose a 7, 30, 90 day or custom range.");
  let currentWindow: { start: string; end: string };
  try { currentWindow = googleAdsPerformanceWindow(requestedRange, url.searchParams.get("from") || undefined, url.searchParams.get("to") || undefined); }
  catch (error) { return respond(error instanceof Error ? error.message : "Choose valid report dates."); }
  const priorWindow = previousWindow(currentWindow);
  const cacheScope = { ownerId: String(workspace.ownerId || user.userId), clientId };

  try {
    const section = url.searchParams.get("section") as GoogleAdsWorkspaceSection | null;
    if (section && !["ad_groups", "keywords", "search_terms", "ads", "assets"].includes(section)) return respond("Choose ad groups, keywords, search terms, ads or assets.");
    if (section) {
      const campaignId = url.searchParams.get("campaignId") || undefined;
      if (section === "ads" || section === "assets") {
        if (!useDirectApi) return Response.json({ status: "missing_connection", section, message: "Ad copy and campaign assets need a connected Google login and Google Ads API access enabled for its Cloud project." }, { headers: { "Cache-Control": "no-store" } });
        if (campaignId && !/^\d{3,20}$/.test(campaignId)) return respond("Choose a valid campaign before loading its ads.");
        const [ads, assets] = await Promise.all([
          section === "ads" ? listGoogleAdsResponsiveSearchAds(cacheScope.ownerId, accountId, campaignId) : Promise.resolve([]),
          section === "assets" ? listGoogleAdsCampaignAssets(cacheScope.ownerId, accountId, campaignId, currentWindow) : Promise.resolve([]),
        ]);
        const count = section === "ads" ? ads.length : assets.length;
        return Response.json({ status: count ? "connected" : "no_data", source: `Google Ads API · ${section === "ads" ? "responsive search ads" : "linked Google Ads assets"} · read-only`, section, client: { id: client.id, name: client.name, logo: client.logo || "" }, accountId, ads, assets, sourceRows: count, mayBeLimited: count >= 10000, updatedAt: new Date().toISOString(), dataNote: section === "ads" ? "This view lists responsive search ad copy and final URLs. Some ads may use automated asset combinations that Google does not expose as a single preview." : "Lists linked account, campaign, ad group and Performance Max asset-group assets, including sitelinks, callouts, snippets, calls, images and supported additional asset details. Google may keep some system-generated assets outside editable association reports; edits must follow the asset type’s Google Ads API rules." }, { headers: { "Cache-Control": "no-store" } });
      }
      const breakdownSection = section as GoogleAdsBreakdown;
      const result = await readWorkspaceRows(useDirectApi, () => readDirectBreakdown(cacheScope.ownerId, accountId, currentWindow, breakdownSection, campaignId), () => readRows(accountId, currentWindow, breakdownSection, campaignId, cacheScope), breakdownSection);
      const breakdownRows = result.rows as GoogleAdsMetricRow[];
      const rows = summarizeGoogleAdsBreakdown(breakdownRows, section);
      return Response.json({
        status: rows.length ? "connected" : "no_data",
        source: result.source,
        section,
        client: { id: client.id, name: client.name, logo: client.logo || "" },
        accountId,
        currency: String(workspace.settings?.currency || "EUR"),
        dateWindow: { current: currentWindow },
        rows,
        sourceRows: breakdownRows.length,
        mayBeLimited: breakdownRows.length >= 1000,
        dataNote: `${result.source.startsWith("Google Ads API") ? "Rows come directly from the Google Ads API." : "Rows come from the connected account through Windsor."} Google may omit low-volume or privacy-protected search terms, and recent conversion data can change after the report is loaded.`,
        updatedAt: new Date().toISOString(),
      }, { headers: { "Cache-Control": "no-store" } });
    }
    const loadRows = async (window: { start: string; end: string }) => readWorkspaceRows(useDirectApi, async () => {
        const key = JSON.stringify({ accountId, window, source: "google-ads-api" });
        const load = () => getGoogleAdsCampaignMetrics(cacheScope.ownerId, accountId, window).then((result) => result.rows);
        return env.DB ? (await loadCachedMarketingData({ db: env.DB, ...cacheScope, service: "Google Ads", key }, load)).data : load();
      }, () => readRows(accountId, window, undefined, undefined, cacheScope), "campaign performance");
    const [currentRows, previousRows] = await Promise.all([loadRows(currentWindow), loadRows(priorWindow)]);
    const current = summarizeGoogleAdsRows(currentRows.rows);
    const previous = summarizeGoogleAdsRows(previousRows.rows);
    const source = currentRows.source === previousRows.source ? currentRows.source : "Google Ads API + Windsor fallback · read-only performance";
    const status = currentRows.rows.length ? "connected" : "no_data";
    let activityDiagnosis = "";
    if (!currentRows.rows.length && useDirectApi) {
      try {
        const campaigns = await listGoogleAdsCampaigns(cacheScope.ownerId, accountId);
        const paused = campaigns.filter((campaign) => campaign.status === "PAUSED");
        if (campaigns.length > 0 && paused.length === campaigns.length) {
          activityDiagnosis = ` All ${campaigns.length} campaigns in this account are paused, so no recent campaign activity is expected. Choose a longer reporting period to check earlier results.`;
        }
      } catch (diagnosisError) {
        console.warn("Google Ads empty-report diagnosis failed", diagnosisError instanceof Error ? diagnosisError.message : "unknown error");
      }
    }
    const fetchedAt = new Date();
    if (requestedRange === "last_30d") await saveDailyMarketingSnapshot({ db: env.DB, ...cacheScope, service: "Google Ads", accountId, status, payload: { current }, fetchedAt }).catch(() => null);
    const snapshots = await listDailyMarketingSnapshots({ db: env.DB, ...cacheScope, service: "Google Ads", accountId, limit: 30 }).catch(() => []);
    return Response.json({
      status,
      source,
      client: { id: client.id, name: client.name, logo: client.logo || "" },
      accountId,
      currency: String(workspace.settings?.currency || "EUR"),
      range: requestedRange,
      dateWindow: { current: currentWindow, previous: priorWindow },
      current,
      previous: { totals: previous.totals, campaigns: previous.campaigns },
      changes: compareGoogleAdsTotals(current.totals, previous.totals),
      snapshots,
      activityDiagnosis: activityDiagnosis.trim(),
      dataNote: `${source === "Google Ads API · read-only performance" ? "Metrics come directly from the connected Google Ads account." : source === "Windsor.ai Google Ads connector · read-only" ? "Metrics come from the connected Google Ads account through Windsor." : "Current and comparison periods came from different connected sources."} Google may revise recent conversion data after the report is loaded. Daily history tracks a consistent rolling 30-day window and updates automatically in the background.`,
      updatedAt: fetchedAt.toISOString(),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not retrieve Google Ads data.";
    console.error("Google Ads workspace request failed", message);
    return Response.json({ status: /not configured|key/i.test(message) ? "missing_connection" : "unavailable", message }, { headers: { "Cache-Control": "no-store" } });
  }
}
