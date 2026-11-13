import { env } from "cloudflare:workers";
import { dataForSeoCredentials, DATAFORSEO_SETUP_MESSAGE } from "@/lib/dataforseo-credentials";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { getTeamPermissions, type TeamPermissions } from "@/lib/access-permissions";
import { extractSites, wordpressMcpCall } from "@/lib/wordpress-mcp";
import { countMappedWordPressClients } from "@/lib/integration-site-mapping";
import { summarizeDataForSeoUsage, type DataForSeoUsageBucket } from "@/lib/dataforseo-usage";
import { integrationReadiness } from "@/lib/integration-readiness.mjs";
import { checkPublicMarketingAccess } from "@/lib/public-marketing-access";

export const dynamic = "force-dynamic";
const respond = (body: Record<string, unknown>, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
type Workspace = {
  ownerId?: string;
  staff?: Array<{ id?: string; email?: string; role?: string; isBot?: boolean; permissions?: Partial<TeamPermissions> }>;
  clients?: Array<{ id?: string; name?: string; googleAdsAccountId?: string; metaAdsAccountId?: string; googleSearchConsoleAccountId?: string; googleAnalyticsAccountId?: string; googleBusinessProfileLocationId?: string; wordpressSiteUrl?: string }>;
};

type SyncStateRow = { client_id: string; service: string; last_attempt_at: string; status: string; detail: string | null };
type SuccessfulSnapshotRow = { service: string; last_successful_at: string };
type WordPressConnectionRow = { client_id: string; site_url: string };

function summarizeSync(rows: SyncStateRow[], successfulSnapshots: SuccessfulSnapshotRow[], service: string, clientNames: Map<string, string>) {
  const matching = rows.filter((row) => row.service === service).sort((a, b) => b.last_attempt_at.localeCompare(a.last_attempt_at));
  const latest = matching[0];
  const lastSuccessfulAt = successfulSnapshots.find((row) => row.service === service)?.last_successful_at;
  if (!latest && !lastSuccessfulAt) return undefined;
  const failures = matching.filter((row) => row.status === "unavailable");
  return {
    lastAttemptAt: latest?.last_attempt_at || null,
    lastSuccessfulAt: lastSuccessfulAt || null,
    status: latest?.status || "never",
    detail: latest?.status === "unavailable" ? latest.detail : null,
    failedClients: failures.slice(0, 4).map((row) => clientNames.get(row.client_id) || "A client account"),
    failedAccounts: failures.slice(0, 4).map((row) => ({ clientId: row.client_id, clientName: clientNames.get(row.client_id) || "A client account", service: row.service })),
    failedCount: failures.length,
  };
}

async function countRows(sql: string, ownerId: string) {
  try {
    const result = await env.DB!.prepare(sql).bind(ownerId).first<{ count: number }>();
    return Number(result?.count || 0);
  } catch { return 0; }
}

async function dataForSeoUsage(db: D1Database, ownerId: string) {
  const periodStart = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const load = async (table: "seo_keyword_research_runs" | "seo_local_maps_rank_runs" | "seo_backlink_snapshots"): Promise<DataForSeoUsageBucket> => {
    const result = await db.prepare(`SELECT COUNT(*) AS request_count, SUM(provider_cost_usd) AS known_cost_usd, SUM(CASE WHEN provider_cost_usd IS NULL THEN 1 ELSE 0 END) AS unknown_cost_count FROM ${table} WHERE owner_id = ?1 AND created_at >= ?2`)
      .bind(ownerId, periodStart)
      .first<{ request_count: number; known_cost_usd: number | null; unknown_cost_count: number }>();
    return { requestCount: Number(result?.request_count || 0), knownCostUsd: typeof result?.known_cost_usd === "number" ? result.known_cost_usd : null, unknownCostCount: Number(result?.unknown_cost_count || 0) };
  };
  const competitorResearch = db.prepare("SELECT COALESCE(SUM(request_count), 0) AS request_count, SUM(provider_cost_usd) AS known_cost_usd, SUM(CASE WHEN provider_cost_usd IS NULL THEN request_count ELSE 0 END) AS unknown_cost_count FROM seo_competitor_keyword_research_runs WHERE owner_id = ?1 AND created_at >= ?2")
    .bind(ownerId, periodStart).first<{ request_count: number; known_cost_usd: number | null; unknown_cost_count: number }>()
    .then((result) => ({ requestCount: Number(result?.request_count || 0), knownCostUsd: typeof result?.known_cost_usd === "number" ? result.known_cost_usd : null, unknownCostCount: Number(result?.unknown_cost_count || 0) }));
  const results = await Promise.allSettled([load("seo_keyword_research_runs"), competitorResearch, load("seo_local_maps_rank_runs"), load("seo_backlink_snapshots")]);
  if (results.some((result) => result.status === "rejected")) return { status: "unavailable" as const };
  const [keywordResearch, competitorResearchBucket, localMaps, backlinks] = results.map((result) => (result as PromiseFulfilledResult<DataForSeoUsageBucket>).value);
  return { status: "available" as const, ...summarizeDataForSeoUsage({ periodStart, keywordResearch, competitorResearch: competitorResearchBucket, localMaps, backlinks }) };
}

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return respond({ status: "unauthorized", message: "Sign in to view integration status." }, 401);
  if (!env.DB) return respond({ status: "unavailable", message: "The workspace database is unavailable." }, 503);
  const row = await env.DB.prepare("SELECT data FROM workspace_documents WHERE id = ?1").bind("f2b-agency").first<{ data: string }>();
  if (!row?.data) return respond({ status: "unavailable", message: "The workspace could not be loaded." }, 503);
  let workspace: Workspace;
  try { workspace = JSON.parse(row.data) as Workspace; }
  catch { return respond({ status: "unavailable", message: "The workspace data could not be read." }, 503); }
  const ownerId = String(workspace.ownerId || user.userId);
  const dataForSeoReady = Boolean(await dataForSeoCredentials(env.DB, ownerId));
  const profile = (workspace.staff || []).find((member) => !member.isBot && (member.id === user.userId || member.email?.toLowerCase() === user.email.toLowerCase()));
  const isAdmin = workspace.ownerId === user.userId || ["Owner", "Admin"].includes(profile?.role || "");
  const permissions = getTeamPermissions(profile?.role || "Viewer", profile?.permissions);
  if (!isAdmin || !permissions.team) return respond({ status: "forbidden", message: "Only the workspace owner or an admin can view integration setup." }, 403);

  const clients = workspace.clients || [];
  const [googleOAuth, searchConsoleOAuth, analyticsOAuth, metaOAuth, wordpressMcp, wordpressConnections, ghlClientLinks, ghlAgency, syncRows, successfulSnapshots, dataForSeoUsageSummary, publicMarketingAccess] = await Promise.all([
    countRows("SELECT COUNT(*) AS count FROM google_ads_connections WHERE owner_id = ?1", ownerId),
    countRows("SELECT COUNT(*) AS count FROM google_search_console_connections WHERE owner_id = ?1", ownerId),
    countRows("SELECT COUNT(*) AS count FROM google_search_console_connections WHERE owner_id = ?1 AND granted_scopes LIKE '%https://www.googleapis.com/auth/analytics.readonly%'", ownerId),
    countRows("SELECT COUNT(*) AS count FROM meta_ads_connections WHERE owner_id = ?1", ownerId),
    countRows("SELECT COUNT(*) AS count FROM wordpress_mcp_connections WHERE owner_id = ?1", user.userId),
    env.DB.prepare("SELECT client_id, site_url FROM wordpress_connections WHERE owner_id = ?1").bind(ownerId).all<WordPressConnectionRow>().then((result) => result.results || []).catch(() => [] as WordPressConnectionRow[]),
    countRows("SELECT COUNT(*) AS count FROM gohighlevel_location_links WHERE owner_id = ?1", ownerId),
    countRows("SELECT COUNT(*) AS count FROM gohighlevel_agency_connections WHERE owner_id = ?1", ownerId),
    env.DB.prepare("SELECT client_id, service, last_attempt_at, status, detail FROM marketing_sync_state WHERE owner_id = ?1 ORDER BY last_attempt_at DESC").bind(ownerId).all<SyncStateRow>().then((result) => result.results || []).catch(() => [] as SyncStateRow[]),
    env.DB.prepare("SELECT service, MAX(fetched_at) AS last_successful_at FROM marketing_metric_snapshots WHERE owner_id = ?1 AND status IN ('connected', 'no_data') GROUP BY service").bind(ownerId).all<SuccessfulSnapshotRow>().then((result) => result.results || []).catch(() => [] as SuccessfulSnapshotRow[]),
    dataForSeoUsage(env.DB, ownerId).catch(() => ({ status: "unavailable" as const })),
    checkPublicMarketingAccess(env.TASK_APP_URL || (import.meta.env.DEV ? request.url : "https://f2b-media-agency-os.f2b-media.workers.dev/")).catch(() => ({ status: "needs_setup" as const, checkedAt: new Date().toISOString(), pageRoute: "unverified" as const, apiRoute: "unverified" as const, detail: "Could not verify the public page routes. Configure only /f/* and /api/marketing-public* as public Access paths, then check both in a private browser window." })),
  ]);
  let sharedWordPressSites: Array<{ id: string; name: string; url: string }> = [];
  let sharedWordPressUnavailable = false;
  if (wordpressMcp) {
    try { sharedWordPressSites = extractSites(await wordpressMcpCall(user.userId, "wpcom-user-sites", {})); }
    catch { sharedWordPressUnavailable = true; }
  }
  const wordpressMappedClients = countMappedWordPressClients(clients, wordpressConnections, sharedWordPressSites);
  const clientNames = new Map(clients.filter((client) => client.id).map((client) => [client.id!, client.name || "Client"]));
  const sync = (service: string) => summarizeSync(syncRows, successfulSnapshots, service, clientNames);
  const mappedGoogleAdsClients = clients.filter((client) => client.googleAdsAccountId).length;
  const mappedMetaAdsClients = clients.filter((client) => client.metaAdsAccountId).length;
  const mappedSearchConsoleClients = clients.filter((client) => client.googleSearchConsoleAccountId).length;
  const mappedAnalyticsClients = clients.filter((client) => client.googleAnalyticsAccountId).length;
  const mappedBusinessProfileClients = clients.filter((client) => client.googleBusinessProfileLocationId).length;
  const googleAdsDirectReady = Boolean(googleOAuth && env.GOOGLE_ADS_CLIENT_ID && env.GOOGLE_ADS_CLIENT_SECRET && env.GOOGLE_ADS_TOKEN_ENCRYPTION_KEY);
  const metaDirectReady = Boolean(metaOAuth && env.META_APP_ID && env.META_APP_SECRET && env.META_TOKEN_ENCRYPTION_KEY && env.META_MARKETING_API_VERSION);
  const integrations = [
    { id: "google-ads", name: "Google Ads", group: "Advertising", status: integrationReadiness({ sourceConfigured: Boolean(env.WINDSOR_API_KEY), directConfigured: googleAdsDirectReady, readOnlyFallback: true }), detail: `${googleOAuth ? "Google login connected." : "No direct Google Ads login connected."} Direct API access is authorized through the connected Google Cloud project. Windsor reporting ${env.WINDSOR_API_KEY ? "is available for read-only reports" : "is not configured"}.`, mappedClients: mappedGoogleAdsClients, mappingUnit: "client account", sync: sync("Google Ads"), actionLabel: "Open Google Ads", actionPage: "Google Ads", connectHref: env.GOOGLE_ADS_CLIENT_ID && env.GOOGLE_ADS_CLIENT_SECRET && env.GOOGLE_ADS_TOKEN_ENCRYPTION_KEY ? "/api/google-ads/connect" : undefined },
    { id: "meta-ads", name: "Meta Ads", group: "Advertising", status: integrationReadiness({ sourceConfigured: Boolean(env.WINDSOR_API_KEY), directConfigured: metaDirectReady, readOnlyFallback: true }), detail: `${metaOAuth ? "Direct Meta login connected." : "No direct Meta login connected."} ${metaDirectReady ? "Direct reporting is configured. Campaign pause, resume and daily-budget changes require ads_management permission, which Meta may require you to approve for the app." : "Direct access needs the Meta app ID, app secret, token encryption key and API version. Windsor can provide read-only reports when configured."}`, mappedClients: mappedMetaAdsClients, mappingUnit: "client account", sync: sync("Meta Ads"), actionLabel: "Open Meta Ads", actionPage: "Meta Ads", connectHref: env.META_APP_ID && env.META_APP_SECRET && env.META_TOKEN_ENCRYPTION_KEY && env.META_MARKETING_API_VERSION ? "/api/meta-ads/connect" : undefined },
    { id: "search-console", name: "Google Search Console", group: "Google data", status: integrationReadiness({ sourceConfigured: Boolean(env.WINDSOR_API_KEY || searchConsoleOAuth), directConfigured: Boolean(searchConsoleOAuth), mappedCount: mappedSearchConsoleClients }), detail: searchConsoleOAuth ? `Direct Google Search Console read access is connected. ${mappedSearchConsoleClients} client properties are mapped; map each exact property to show its data.` : env.WINDSOR_API_KEY ? "Windsor can provide read-only reports. Connect a Google account with Search Console access to list and map the properties directly." : "Connect a Google account with Search Console access to list properties and load read-only reports. Windsor can also provide reports when configured.", mappedClients: mappedSearchConsoleClients, mappingUnit: "client property", sync: sync("Search Console"), actionLabel: "Open SEO", actionPage: "SEO", connectHref: env.GOOGLE_ADS_CLIENT_ID && env.GOOGLE_ADS_CLIENT_SECRET && env.GOOGLE_ADS_TOKEN_ENCRYPTION_KEY ? "/api/search-console/connect" : undefined },
    { id: "ga4", name: "Google Analytics 4", group: "Google data", status: integrationReadiness({ sourceConfigured: Boolean(env.WINDSOR_API_KEY || analyticsOAuth), directConfigured: Boolean(analyticsOAuth), mappedCount: mappedAnalyticsClients }), detail: analyticsOAuth ? `${mappedAnalyticsClients ? `${mappedAnalyticsClients} client GA4 propert${mappedAnalyticsClients === 1 ? "y is" : "ies are"} mapped.` : "No client GA4 properties are mapped yet."} Google confirmed Analytics read permission for the connected account.${env.WINDSOR_API_KEY ? " Windsor is also configured for read-only reporting." : ""}` : env.WINDSOR_API_KEY ? mappedAnalyticsClients ? "Windsor is available for read-only reporting. Map each client's exact GA4 property ID to show its data. Connect Google directly to use the Google Analytics API." : "Windsor is available for read-only reporting, but no client GA4 property is linked yet. Map each exact property ID on the client's record or connect Google directly." : "Connect Google Analytics directly or configure Windsor, then map each client's exact GA4 property ID.", mappedClients: mappedAnalyticsClients, mappingUnit: "client property", sync: sync("GA4"), actionLabel: "Open SEO", actionPage: "SEO", connectHref: env.GOOGLE_ADS_CLIENT_ID && env.GOOGLE_ADS_CLIENT_SECRET && env.GOOGLE_ADS_TOKEN_ENCRYPTION_KEY && !analyticsOAuth ? "/api/search-console/connect" : undefined },
    { id: "business-profile", name: "Google Business Profile", group: "Google data", status: integrationReadiness({ sourceConfigured: Boolean(env.WINDSOR_API_KEY), mappedCount: mappedBusinessProfileClients }), detail: !env.WINDSOR_API_KEY ? "Connect Windsor and set its server-side API key to load location reporting." : mappedBusinessProfileClients ? "Windsor is available for read-only location reporting. Map each client's exact Business Profile location ID." : "Windsor is available, but no client Business Profile location is linked yet. Map the exact location ID on each client's record to show its data.", mappedClients: mappedBusinessProfileClients, mappingUnit: "client location", sync: sync("Google Business Profile"), actionLabel: "Open SEO", actionPage: "SEO" },
    { id: "dataforseo", name: "DataForSEO", group: "SEO research", status: dataForSeoReady ? "ready" : "needs_setup", detail: dataForSeoReady ? "Keyword, Maps and backlink lookups are available; each lookup requires in-app cost consent." : DATAFORSEO_SETUP_MESSAGE, mappedClients: 0, actionLabel: "Open SEO", actionPage: "SEO", usage: dataForSeoUsageSummary },
    { id: "pagespeed", name: "PageSpeed Insights", group: "SEO research", status: "optional", detail: env.GOOGLE_PAGESPEED_API_KEY ? "API key configured." : "The public endpoint can be used without a key, with a lower shared quota. Add GOOGLE_PAGESPEED_API_KEY for a dedicated quota.", mappedClients: clients.filter((client) => client.wordpressSiteUrl).length, mappingUnit: "client site", actionLabel: "Open Sites", actionPage: "Sites" },
    { id: "wordpress", name: "WordPress", group: "Websites", status: wordpressMappedClients ? "ready" : wordpressMcp || wordpressConnections.length ? "partial" : "needs_setup", detail: `${wordpressMcp ? "Shared WordPress account connected" : "No shared WordPress account connected"}; ${wordpressConnections.length} direct client connection${wordpressConnections.length === 1 ? "" : "s"}; ${sharedWordPressSites.length} shared site${sharedWordPressSites.length === 1 ? "" : "s"} checked. ${sharedWordPressUnavailable ? "The shared account could not be checked just now. " : ""}${wordpressMappedClients ? `${wordpressMappedClients} client website${wordpressMappedClients === 1 ? "" : "s"} matched an actual connected site.` : "No client website matches a connected site yet. Add the client’s exact website to the connected WordPress account or connect that client site in Sites."} Elementor template duplication and publishing are not enabled in this connection overview.`, mappedClients: wordpressMappedClients, mappingUnit: "client site", actionLabel: "Open Sites", actionPage: "Sites" },
    { id: "marketing-public", name: "Public Marketing Studio pages", group: "Websites", status: publicMarketingAccess.status, detail: publicMarketingAccess.detail, mappedClients: 0, actionLabel: "Open Sites", actionPage: "Sites", publicAccessSetupConfigured: Boolean(env.F2B_CF_ACCOUNT_ID && env.F2B_CF_ACCESS_APP_ID && env.F2B_CF_ACCESS_POLICY_ID && env.CLOUDFLARE_ACCESS_API_TOKEN) },
    { id: "gohighlevel", name: "GoHighLevel", group: "CRM", status: env.GHL_CLIENT_ID && env.GHL_CLIENT_SECRET && ghlAgency && ghlClientLinks > 0 ? "ready" : "needs_setup", detail: `${ghlAgency ? "Agency OAuth is connected." : "Agency OAuth is not connected."} ${ghlClientLinks} client location link${ghlClientLinks === 1 ? "" : "s"}. ${ghlClientLinks ? "Only linked locations can use this connection." : "Link a GoHighLevel location to a client before using it in that client's workspace."}`, mappedClients: ghlClientLinks, mappingUnit: "client location", actionLabel: "Open Clients", actionPage: "Clients" },
    { id: "landing-hosting", name: "Landing page domains & hosting", group: "Websites", status: "not_available", detail: "Client subdomain provisioning is not connected. This app currently runs on workers.dev; it cannot create DNS records or host client pages on go.clientdomain.ie yet.", mappedClients: 0, actionLabel: "Review Sites", actionPage: "Sites" },
  ];
  return respond({ status: "connected", checkedAt: new Date().toISOString(), integrations });
}
