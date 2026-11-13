import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";
import { getTeamPermissions } from "@/lib/access-permissions";
import { searchConsoleDateWindow, summarizeSearchConsoleRows, type SearchConsoleRow } from "@/lib/seo-performance";
import { generateGoogleAdsKeywordIdeas } from "@/lib/google-ads-direct";
import { listDailyMarketingSnapshots, loadCachedMarketingData, saveDailyMarketingSnapshot } from "@/lib/marketing-data-history";
import { hasGoogleSearchConsoleConnection, listGoogleSearchConsoleProperties, readGoogleSearchConsoleRows } from "@/lib/google-search-console-direct";

export const dynamic = "force-dynamic";
const respond = (error: string, status = 400) => Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
async function fetchRows(siteId: string, start: string, end: string, cacheScope?: { ownerId: string; clientId: string }) {
  if (!env.WINDSOR_API_KEY) throw new Error("Windsor API key is not configured on the app server.");
  const key = JSON.stringify({ siteId, start, end, fields: "account_id,site,date,query,page,clicks,impressions,ctr,position" });
  const load = async () => {
    const params = new URLSearchParams({ api_key: env.WINDSOR_API_KEY!, fields: "account_id,site,date,query,page,clicks,impressions,ctr,position", date_from: start, date_to: end, select_accounts: siteId, _max_rows: "1000", _renderer: "json" });
    const response = await fetch(`https://connectors.windsor.ai/searchconsole?${params}`, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 700);
      if (/no .* accounts? (are )?configured|no accounts? selected|not connected/i.test(detail)) throw new Error("Search Console is not connected in Windsor. Connect it, select the property, then retry.");
      throw new Error(`Windsor could not retrieve Search Console data (HTTP ${response.status}). Check the property access and saved site ID.`);
    }
    const payload = await response.json() as { data?: SearchConsoleRow[] };
    if (!Array.isArray(payload.data)) throw new Error("Windsor returned an unexpected Search Console response.");
    return payload.data;
  };
  if (!cacheScope || !env.DB) return load();
  return (await loadCachedMarketingData({ db: env.DB, ...cacheScope, service: "Search Console", key }, load)).data;
}
export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return respond("Sign in to view SEO data.", 401);
  if (!env.DB) return respond("The workspace database is unavailable.", 503);
  const url = new URL(request.url); const clientId = url.searchParams.get("clientId") || ""; const range = url.searchParams.get("range") || "last_30d";
  if (!["last_7d", "last_30d", "last_90d", "custom"].includes(range)) return respond("Choose a 7, 30, 90 day or custom range.");
  const workspaceRow = await env.DB.prepare("SELECT data FROM workspace_documents WHERE id = ?1").bind("f2b-agency").first<{ data: string }>();
  if (!workspaceRow?.data) return respond("The workspace is unavailable.", 503);
  const workspace = JSON.parse(workspaceRow.data);
  const owner = workspace.ownerId === user.userId;
  const profile = (workspace.staff || []).find((item: any) => !item.isBot && (item.id === user.userId || item.email?.toLowerCase() === user.email.toLowerCase()));
  const admin = owner || ["Owner", "Admin"].includes(profile?.role || "");
  const permissions = owner ? { clients: true } : getTeamPermissions(profile?.role || "Viewer", profile?.permissions);
  const client = (workspace.clients || []).find((item: any) => item.id === clientId);
  if (!client) return respond("Choose a client in this workspace.", 404);
  if (!admin && (!permissions.clients || (Array.isArray(profile?.clientAccessIds) && !profile.clientAccessIds.includes(clientId)))) return respond("You do not have access to this client’s SEO data.", 403);
  if (url.searchParams.get("properties") === "1") {
    if (!admin) return respond("Only an owner or admin can choose a Search Console property.", 403);
    const ownerId = String(workspace.ownerId || user.userId);
    if (await hasGoogleSearchConsoleConnection(ownerId)) {
      try {
        const properties = await listGoogleSearchConsoleProperties(ownerId);
        return Response.json({ status: "connected", source: "Google Search Console", properties: properties.map((item: { id: string; name: string; permissionLevel: string }) => ({ id: item.id, name: item.name, status: item.permissionLevel })) }, { headers: { "Cache-Control": "no-store" } });
      } catch (error) {
        return Response.json({ status: "unavailable", message: error instanceof Error ? error.message : "Could not list Search Console properties.", properties: [] }, { headers: { "Cache-Control": "no-store" } });
      }
    }
    if (!env.WINDSOR_API_KEY) return Response.json({ status: "missing_connection", message: "Windsor API key is not configured on the app server.", properties: [] }, { headers: { "Cache-Control": "no-store" } });
    try {
      const params = new URLSearchParams({ datasource: "searchconsole", api_key: env.WINDSOR_API_KEY });
      const response = await fetch(`https://onboard.windsor.ai/api/common/ds-accounts?${params}`, { signal: AbortSignal.timeout(15_000) });
      if (!response.ok) return Response.json({ status: "unavailable", message: `Windsor could not list connected Search Console properties (HTTP ${response.status}).`, properties: [] }, { headers: { "Cache-Control": "no-store" } });
      const payload = await response.json() as Array<Record<string, unknown>> | { data?: Array<Record<string, unknown>> };
      const accounts = Array.isArray(payload) ? payload : Array.isArray(payload.data) ? payload.data : [];
      const properties = accounts.filter((item) => !item.datasource || String(item.datasource).toLowerCase() === "searchconsole").map((item) => ({ id: String(item.account_id || "").trim(), name: String(item.account_name || item.account_id || "").trim(), status: String(item.status || "active") })).filter((item) => item.id && item.status.toLowerCase() !== "inactive");
      return Response.json({ status: "connected", properties }, { headers: { "Cache-Control": "no-store" } });
    } catch {
      return Response.json({ status: "unavailable", message: "Could not reach Windsor to list connected Search Console properties.", properties: [] }, { headers: { "Cache-Control": "no-store" } });
    }
  }
  const siteId = String(client.googleSearchConsoleAccountId || "").trim();
  if (!siteId) return Response.json({ status: "not_mapped", message: "Add this client’s exact Search Console property ID in the client record.", propertyId: "" }, { headers: { "Cache-Control": "no-store" } });
  try {
    const cacheScope = { ownerId: String(workspace.ownerId || user.userId), clientId };
    const window = searchConsoleDateWindow(range, new Date(), { start: url.searchParams.get("from") || "", end: url.searchParams.get("to") || "" });
    if (!window) return respond("Choose valid start and end dates within a maximum 366-day range.");
    const directConnected = await hasGoogleSearchConsoleConnection(cacheScope.ownerId);
    if (!directConnected && !env.WINDSOR_API_KEY) return Response.json({ status: "missing_connection", message: "Connect Google Search Console directly or configure Windsor before loading this property." }, { headers: { "Cache-Control": "no-store" } });
    const load = (start: string, end: string) => directConnected
      ? readGoogleSearchConsoleRows(cacheScope.ownerId, siteId, start, end)
      : fetchRows(siteId, start, end, cacheScope);
    const [currentRows, previousRows] = await Promise.all([load(window.current.start, window.current.end), load(window.previous.start, window.previous.end)]);
    const current = summarizeSearchConsoleRows(currentRows); const previous = summarizeSearchConsoleRows(previousRows);
    current.mayBeLimited = currentRows.length >= (directConnected ? 50000 : 1000);
    const status = currentRows.length ? "connected" : "no_data";
    const fetchedAt = new Date();
    if (range === "last_30d") await saveDailyMarketingSnapshot({ db: env.DB, ...cacheScope, service: "Search Console", accountId: siteId, status, payload: { current }, fetchedAt }).catch(() => null);
    const snapshots = await listDailyMarketingSnapshots({ db: env.DB, ...cacheScope, service: "Search Console", accountId: siteId, limit: 30 }).catch(() => []);
    return Response.json({ status, clientId, clientName: client.name, propertyId: siteId, range, dateWindow: window, current, previous, snapshots, updatedAt: fetchedAt.toISOString(), dataSource: directConnected ? "Google Search Console" : "Windsor", dataNote: `Search Console can omit rare queries, and the newest few days may be incomplete. Results reflect the rows returned by ${directConnected ? "Google Search Console" : "Windsor"}. Daily history tracks a consistent rolling 30-day window and updates automatically in the background.` }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not retrieve Search Console data.";
    console.error("Client SEO workspace request failed", message);
    return Response.json({ status: /not connected in Windsor/i.test(message) ? "source_not_connected" : "unavailable", message }, { headers: { "Cache-Control": "no-store" } });
  }
}

// Keyword Planner suggestions are read-only. Google Ads uses POST for this
// report endpoint, but this handler never mutates an Ads account.
export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return respond("Sign in to research keyword ideas.", 401);
  if (!env.DB) return respond("The workspace database is unavailable.", 503);
  const workspaceRow = await env.DB.prepare("SELECT data FROM workspace_documents WHERE id = ?1").bind("f2b-agency").first<{ data: string }>();
  if (!workspaceRow?.data) return respond("The workspace is unavailable.", 503);
  const workspace = JSON.parse(workspaceRow.data);
  const profile = (workspace.staff || []).find((item: any) => !item.isBot && (item.id === user.userId || item.email?.toLowerCase() === user.email.toLowerCase()));
  const admin = workspace.ownerId === user.userId || ["Owner", "Admin"].includes(profile?.role || "");
  if (!admin) return respond("Only an owner or admin can run Google Ads Keyword Planner research.", 403);
  let body: { clientId?: string; seeds?: string[]; url?: string; geo?: string; locationName?: string };
  try { body = await request.json() as typeof body; } catch { return respond("The keyword research request is not valid."); }
  const clientId = String(body.clientId || "");
  const client = (workspace.clients || []).find((item: any) => item.id === clientId && item.googleAdsAccountId);
  if (!client) return respond("Map this client to a Google Ads customer ID in Clients first.", 404);
  const seeds = Array.isArray(body.seeds) ? body.seeds.map((item) => String(item).trim()).filter(Boolean).slice(0, 10) : [];
  try {
    const ideas = await generateGoogleAdsKeywordIdeas(workspace.ownerId, String(client.googleAdsAccountId), {
      keywords: seeds,
      url: String(body.url || "").trim(),
      geoTargetConstant: String(body.geo || "2372"),
      locationName: String(body.locationName || "").slice(0, 120) || undefined,
    });
    return Response.json({ ...ideas, clientId, clientName: client.name, updatedAt: new Date().toISOString(), dataNote: "Google Ads Keyword Planner estimates for the selected location and English language. Search volumes and bid ranges are estimates, not rankings or guaranteed traffic. Keyword difficulty is not provided by this source." }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Google Ads Keyword Planner could not return keyword ideas.";
    console.error("Keyword Planner request failed", message);
    return respond(message, 502);
  }
}
