import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";
import { getTeamPermissions } from "@/lib/access-permissions";
import { googleAnalyticsDateWindow, normalizeAnalyticsPagePath, summarizeGoogleAnalyticsRows, summarizeOrganicSearchRows, summarizeLandingPageAnalytics, summarizeLandingPageAttribution, summarizeLandingPageSignals, type SearchConsoleRow } from "@/lib/seo-performance";
import { listDailyMarketingSnapshots, loadCachedMarketingData, saveDailyMarketingSnapshot } from "@/lib/marketing-data-history";
import { hasGoogleAnalyticsDirectConnection, listGoogleAnalyticsProperties, readGoogleAnalyticsReport } from "@/lib/google-analytics-direct";
import { googleAnalyticsFieldNames, googleAnalyticsQueryFields } from "@/lib/google-analytics-direct.mjs";

export const dynamic = "force-dynamic";
const ga4FieldNames: Record<string, string> = googleAnalyticsFieldNames;

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in to view this client’s analytics." }, { status: 401 });
  if (!env.DB) return Response.json({ status: "missing_connection", message: "The workspace database is unavailable." });
  const url = new URL(request.url);
  const clientId = url.searchParams.get("clientId") || "";
  const row = await env.DB.prepare("SELECT data FROM workspace_documents WHERE id = ?1").bind("f2b-agency").first<{ data: string }>();
  if (!row?.data) return Response.json({ error: "The workspace is unavailable." }, { status: 503 });
  const workspace = JSON.parse(row.data);
  const owner = workspace.ownerId === user.userId;
  const profile = (workspace.staff || []).find((item: any) => !item.isBot && (item.id === user.userId || item.email?.toLowerCase() === user.email.toLowerCase()));
  const admin = owner || ["Owner", "Admin"].includes(profile?.role || "");
  const permissions = owner ? { clients: true } : getTeamPermissions(profile?.role || "Viewer", profile?.permissions);
  const client = (workspace.clients || []).find((item: any) => item.id === clientId);
  if (!client) return Response.json({ error: "Choose a client in this workspace." }, { status: 404 });
  if (!admin && (!permissions.clients || (Array.isArray(profile?.clientAccessIds) && !profile.clientAccessIds.includes(clientId)))) {
    return Response.json({ error: "You do not have access to this client’s analytics." }, { status: 403 });
  }
  const cacheScope = { ownerId: String(workspace.ownerId || user.userId), clientId };
  const directConnected = await hasGoogleAnalyticsDirectConnection(cacheScope.ownerId);
  if (url.searchParams.get("properties") === "1") {
    if (!admin) return Response.json({ error: "Only an owner or admin can choose a Google Analytics property." }, { status: 403 });
    try {
      if (directConnected) {
        const properties = await listGoogleAnalyticsProperties(cacheScope.ownerId);
        return Response.json({ status: "connected", source: "Google Analytics", properties: properties.map((item) => ({ id: item.id, name: `${item.accountName} · ${item.name}`, status: "active" })) }, { headers: { "Cache-Control": "no-store" } });
      }
      if (!env.WINDSOR_API_KEY) return Response.json({ status: "missing_connection", message: "Connect Google Analytics directly or configure Windsor.", properties: [] }, { headers: { "Cache-Control": "no-store" } });
      const params = new URLSearchParams({ datasource: "googleanalytics4", api_key: env.WINDSOR_API_KEY });
      const response = await fetch(`https://onboard.windsor.ai/api/common/ds-accounts?${params}`, { signal: AbortSignal.timeout(15_000) });
      if (!response.ok) return Response.json({ status: "unavailable", message: `Windsor could not list connected GA4 properties (HTTP ${response.status}).`, properties: [] }, { headers: { "Cache-Control": "no-store" } });
      const payload = await response.json() as Array<Record<string, unknown>> | { data?: Array<Record<string, unknown>> };
      const accounts = Array.isArray(payload) ? payload : Array.isArray(payload.data) ? payload.data : [];
      const properties = accounts.filter((item) => !item.datasource || String(item.datasource).toLowerCase() === "googleanalytics4").map((item) => ({ id: String(item.account_id || "").trim(), name: String(item.account_name || item.account_id || "").trim(), status: String(item.status || "active") })).filter((item) => item.id && item.status.toLowerCase() !== "inactive");
      return Response.json({ status: "connected", properties }, { headers: { "Cache-Control": "no-store" } });
    } catch {
      return Response.json({ status: "unavailable", message: "Could not reach Windsor to list connected GA4 properties.", properties: [] }, { headers: { "Cache-Control": "no-store" } });
    }
  }
  const accountId = String(client.googleAnalyticsAccountId || "").trim();
  if (!accountId) return Response.json({ status: "not_mapped", message: "Add this client’s Google Analytics 4 account ID in the client record." });
  if (!directConnected && !env.WINDSOR_API_KEY) return Response.json({ status: "missing_connection", message: "Connect Google Analytics directly or configure Windsor before loading this property." }, { headers: { "Cache-Control": "no-store" } });
  if (url.searchParams.get("landingPage") === "1") {
    const pageUrlInput = url.searchParams.get("pageUrl") || "";
    let pagePath = "";
    try {
      const site = new URL(String(client.wordpressSiteUrl || ""));
      const page = new URL(pageUrlInput, site);
      const normalizeHost = (host: string) => host.toLowerCase().replace(/^www\./, "");
      if (site.protocol !== "https:" || page.protocol !== "https:" || normalizeHost(site.hostname) !== normalizeHost(page.hostname) || page.username || page.password) throw new Error();
      pagePath = normalizeAnalyticsPagePath(page.pathname);
    } catch {
      return Response.json({ error: "Choose a published HTTPS page on this client’s own website." }, { status: 422 });
    }
    const pageRange = url.searchParams.get("range") || "last_30d";
    if (!["last_7d", "last_30d", "last_90d", "custom"].includes(pageRange)) return Response.json({ error: "Choose 7, 30, 90 days or custom dates for this page report." }, { status: 400 });
    const pageWindow = pageRange === "custom"
      ? googleAnalyticsDateWindow("custom", new Date(), { start: url.searchParams.get("from") || "", end: url.searchParams.get("to") || "" })
      : googleAnalyticsDateWindow(pageRange as "last_7d" | "last_30d" | "last_90d");
    if (!pageWindow) return Response.json({ error: "Choose a supported page reporting period." }, { status: 400 });
    const readPageRows = async (fields: string, dimension: string, start: string, end: string) => {
      const key = JSON.stringify({ source: directConnected ? "Google Analytics" : "Windsor", accountId, fields, dimension, pagePath, start, end });
      const load = async () => {
        if (directConnected) {
          const { requested, dimensions, metrics } = googleAnalyticsQueryFields(fields);
          const rows = await readGoogleAnalyticsReport(cacheScope.ownerId, accountId, start, end, dimensions, metrics, { dimension: ga4FieldNames[dimension], value: pagePath });
          return rows.map((row) => Object.fromEntries(requested.map((field) => [field, row[ga4FieldNames[field]] ?? null])));
        }
        const params = new URLSearchParams({
          api_key: env.WINDSOR_API_KEY!, fields, select_accounts: accountId, _max_rows: "100",
          _renderer: "json", date_from: start, date_to: end,
          filter: JSON.stringify([[dimension, "eq", pagePath]]),
        });
        const response = await fetch(`https://connectors.windsor.ai/googleanalytics4?${params}`, { signal: AbortSignal.timeout(15_000) });
        if (!response.ok) {
          const detail = (await response.text().catch(() => "")).slice(0, 300);
          console.error("Windsor GA4 landing page report failed", response.status, detail.replaceAll(env.WINDSOR_API_KEY!, "[redacted]"));
          throw new Error("Windsor could not retrieve GA4 data for this page. Check the mapped property and available GA4 access.");
        }
        const payload = await response.json() as { data?: SearchConsoleRow[] };
        if (!Array.isArray(payload.data)) throw new Error("Windsor returned an unexpected GA4 page response.");
        return payload.data;
      };
      return (await loadCachedMarketingData({ db: env.DB!, ...cacheScope, service: "GA4", key }, load)).data;
    };
    const loadPagePeriod = async (start: string, end: string) => {
      const [pageRows, landingRows, eventRows, attributionRows] = await Promise.all([
        readPageRows("page_path,screen_page_views", "page_path", start, end),
        readPageRows("landing_page,sessions,active_users,engaged_sessions", "landing_page", start, end),
        readPageRows("page_path,event_name,event_count,conversions,link_url", "page_path", start, end),
        readPageRows("landing_page,session_google_ads_campaign_name,session_manual_campaign_name,session_source_medium,sessions,conversions", "landing_page", start, end),
      ]);
      return { ...summarizeLandingPageAnalytics(pageRows, landingRows, eventRows), ...summarizeLandingPageSignals(eventRows), campaignAttribution: summarizeLandingPageAttribution(attributionRows) };
    };
    try {
      const [totals, previousTotals] = await Promise.all([
        loadPagePeriod(pageWindow.current.start, pageWindow.current.end),
        loadPagePeriod(pageWindow.previous.start, pageWindow.previous.end),
      ]);
      const hasRows = totals.pageViewRows + totals.landingRows + totals.eventRows > 0;
      return Response.json({ status: hasRows ? "connected" : "no_data", source: directConnected ? "Google Analytics" : "Windsor", accountId, pageUrl: new URL(pagePath, client.wordpressSiteUrl).toString(), range: pageRange, dateWindow: pageWindow, totals, previousTotals, updatedAt: new Date().toISOString(), dataNote: "GA4 page views are for this page. Sessions are sessions that started on this page. Campaign and source attribution follows GA4 session attribution and available UTM/Google Ads tagging. Key events are events configured in GA4; they are not independently verified leads or form submissions." }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      return Response.json({ status: "unavailable", message: error instanceof Error ? error.message : "Could not retrieve GA4 data for this page." }, { headers: { "Cache-Control": "no-store" } });
    }
  }
  const range = url.searchParams.get("range") || "last_30d";
  if (!["last_7d", "last_30d", "last_90d", "all_time", "custom"].includes(range)) return Response.json({ error: "Choose a supported Analytics date range." }, { status: 400 });
  const window = googleAnalyticsDateWindow(range, new Date(), { start: url.searchParams.get("from") || "", end: url.searchParams.get("to") || "" });
  if (range === "custom" && !window) return Response.json({ error: "Choose valid start and end dates within a maximum 366-day range." }, { status: 400 });
    const query = async (start: string, end: string) => {
    const key = JSON.stringify({ source: directConnected ? "Google Analytics" : "Windsor", accountId, fields: "account_id,account_name,sessions,active_users,engaged_sessions,conversions,totalrevenue", start, end });
    const load = async () => {
        if (directConnected) {
          const rows = await readGoogleAnalyticsReport(cacheScope.ownerId, accountId, start, end, [], ["sessions", "activeUsers", "engagedSessions", "keyEvents", "totalRevenue"]);
          return rows.map((row) => ({ account_id: accountId, account_name: client.name, sessions: row.sessions, active_users: row.activeUsers, engaged_sessions: row.engagedSessions, conversions: row.keyEvents, totalrevenue: row.totalRevenue }));
        }
      const params = new URLSearchParams({
        api_key: env.WINDSOR_API_KEY!,
        fields: "account_id,account_name,sessions,active_users,engaged_sessions,conversions,totalrevenue",
        select_accounts: accountId,
        _max_rows: "100",
        _renderer: "json",
        date_from: start,
        date_to: end,
      });
      const response = await fetch(`https://connectors.windsor.ai/googleanalytics4?${params}`, { signal: AbortSignal.timeout(15000) });
      if (!response.ok) {
        const detail = (await response.text().catch(() => "")).slice(0, 300);
        console.error("Windsor GA4 overview failed", response.status, detail.replaceAll(env.WINDSOR_API_KEY!, "[redacted]"));
        throw new Error("Windsor could not retrieve this GA4 property. Check its access and mapped account ID.");
      }
      const payload = await response.json() as { data?: SearchConsoleRow[] };
      if (!Array.isArray(payload.data)) throw new Error("Windsor returned an unexpected Google Analytics response.");
      return payload.data;
    };
    return (await loadCachedMarketingData({ db: env.DB!, ...cacheScope, service: "GA4", key }, load)).data;
  };
  const queryOrganic = async (start: string, end: string) => {
    const fields = "session_default_channel_group,sessions,conversions";
    const key = JSON.stringify({ source: directConnected ? "Google Analytics" : "Windsor", accountId, fields, start, end });
    const load = async () => {
      if (directConnected) {
        const rows = await readGoogleAnalyticsReport(cacheScope.ownerId, accountId, start, end, ["sessionDefaultChannelGroup"], ["sessions", "keyEvents"]);
        return rows.map((row) => ({ session_default_channel_group: row.sessionDefaultChannelGroup, sessions: row.sessions, conversions: row.keyEvents }));
      }
      const params = new URLSearchParams({ api_key: env.WINDSOR_API_KEY!, fields, select_accounts: accountId, _max_rows: "100", _renderer: "json", date_from: start, date_to: end });
      const response = await fetch(`https://connectors.windsor.ai/googleanalytics4?${params}`, { signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new Error(`Windsor could not retrieve GA4 channel data (HTTP ${response.status}).`);
      const payload = await response.json() as { data?: SearchConsoleRow[] };
      if (!Array.isArray(payload.data)) throw new Error("Windsor returned an unexpected GA4 channel response.");
      return payload.data;
    };
    return (await loadCachedMarketingData({ db: env.DB!, ...cacheScope, service: "GA4", key }, load)).data;
  };
  try {
    const today = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Dublin", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date());
    const currentWindow = window?.current || { start: "2000-01-01", end: today };
    const [currentRows, previousRows, currentOrganicResult, previousOrganicResult] = await Promise.all([
      query(currentWindow.start, currentWindow.end),
      window ? query(window.previous.start, window.previous.end) : Promise.resolve(null),
      queryOrganic(currentWindow.start, currentWindow.end).then((rows) => ({ rows, error: "" })).catch((error) => ({ rows: null, error: error instanceof Error ? error.message : "Organic Search data could not be loaded." })),
      window ? queryOrganic(window.previous.start, window.previous.end).then((rows) => ({ rows, error: "" })).catch((error) => ({ rows: null, error: error instanceof Error ? error.message : "Previous Organic Search data could not be loaded." })) : Promise.resolve({ rows: null, error: "" }),
    ]);
    const totals = summarizeGoogleAnalyticsRows(currentRows);
    const previousTotals = previousRows ? summarizeGoogleAnalyticsRows(previousRows) : null;
    const organicTotals = currentOrganicResult.rows ? summarizeOrganicSearchRows(currentOrganicResult.rows) : null;
    const previousOrganicTotals = previousOrganicResult.rows ? summarizeOrganicSearchRows(previousOrganicResult.rows) : null;
    const status = currentRows.length ? "connected" : "no_data";
    const fetchedAt = new Date();
    if (range === "last_30d") await saveDailyMarketingSnapshot({ db: env.DB, ...cacheScope, service: "GA4", accountId, status, payload: { totals, organicTotals }, fetchedAt }).catch(() => null);
    const snapshots = await listDailyMarketingSnapshots({ db: env.DB, ...cacheScope, service: "GA4", accountId, limit: 30 }).catch(() => []);
    return Response.json({
      status,
      accountId,
      accountName: String(currentRows[0]?.account_name || client.name),
      range: range === "all_time" ? "All time (available property history)" : range === "custom" ? `${window?.current.start} to ${window?.current.end}` : range === "last_7d" ? "Last 7 days" : range === "last_90d" ? "Last 90 days" : "Last 30 days",
      dateWindow: window,
      totals,
      previousTotals,
      organicTotals,
      previousOrganicTotals,
      snapshots,
      source: directConnected ? "Google Analytics" : "Windsor",
      updatedAt: fetchedAt.toISOString(),
      message: currentRows.length ? undefined : "The property responded but returned no rows for this range. No metrics are shown as zero because no rows were supplied.",
      dataNote: `${window ? "Date ranges use complete Dublin calendar days. The comparison is the immediately preceding period of equal length." : "All available property history; no previous-period comparison is available for this range."} Organic Search uses GA4’s session default channel group. Key events are configured GA4 events, not independently verified leads. Daily history tracks a consistent rolling 30-day window and updates automatically in the background.${currentOrganicResult.error ? ` Organic Search breakdown unavailable: ${currentOrganicResult.error}` : ""}`,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not reach Windsor to retrieve this Google Analytics property.";
    console.error("Windsor GA4 overview request failed", message);
    return Response.json({ status: "unavailable", message });
  }
}
