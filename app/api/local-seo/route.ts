import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";
import { getTeamPermissions } from "@/lib/access-permissions";
import { googleAnalyticsDateWindow } from "@/lib/seo-performance";
import { summarizeBusinessProfileReviews, summarizeBusinessProfileRows, type BusinessProfileRow } from "@/lib/local-seo";
import { listDailyMarketingSnapshots } from "@/lib/marketing-data-history";

export const dynamic = "force-dynamic";
const respond = (body: Record<string, unknown>, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
type ConnectedAccount = { account_id: string; account_name: string; status: string; datasource?: string };

async function connectedAccounts(): Promise<ConnectedAccount[]> {
  const params = new URLSearchParams({ datasource: "google_my_business", api_key: env.WINDSOR_API_KEY! });
  const response = await fetch(`https://onboard.windsor.ai/api/common/ds-accounts?${params}`, { signal: AbortSignal.timeout(15_000) });
  if (!response.ok) throw new Error(`Windsor could not list connected Business Profile accounts (HTTP ${response.status}).`);
  const payload = await response.json() as ConnectedAccount[] | { data?: ConnectedAccount[] };
  const rows = Array.isArray(payload) ? payload : Array.isArray(payload.data) ? payload.data : [];
  return rows.filter((item) => (!item.datasource || String(item.datasource).toLowerCase() === "google_my_business") && item.account_id && String(item.status || "active").toLowerCase() !== "inactive");
}

async function fetchRows(accountId: string, fields: string, start?: string, end?: string, maxRows = "1000") {
  const params = new URLSearchParams({ api_key: env.WINDSOR_API_KEY!, fields, select_accounts: accountId, _max_rows: maxRows, _renderer: "json" });
  if (start && end) { params.set("date_from", start); params.set("date_to", end); }
  const response = await fetch(`https://connectors.windsor.ai/google_my_business?${params}`, { signal: AbortSignal.timeout(20_000) });
  if (!response.ok) throw new Error(`Windsor could not retrieve Google Business Profile data (HTTP ${response.status}). Check that the source is connected and this location is accessible.`);
  const payload = await response.json() as { data?: BusinessProfileRow[] };
  if (!Array.isArray(payload.data)) throw new Error("Windsor returned an unexpected Google Business Profile response.");
  return payload.data;
}

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return respond({ error: "Sign in to view local SEO data." }, 401);
  if (!env.DB || !env.WINDSOR_API_KEY) return respond({ status: "missing_connection", message: "The workspace or Windsor connection is unavailable." });
  const url = new URL(request.url); const clientId = url.searchParams.get("clientId") || "";
  const row = await env.DB.prepare("SELECT data FROM workspace_documents WHERE id = ?1").bind("f2b-agency").first<{ data: string }>();
  if (!row?.data) return respond({ error: "The workspace is unavailable." }, 503);
  const workspace = JSON.parse(row.data);
  const owner = workspace.ownerId === user.userId;
  const profile = (workspace.staff || []).find((item: any) => !item.isBot && (item.id === user.userId || item.email?.toLowerCase() === user.email.toLowerCase()));
  const admin = owner || ["Owner", "Admin"].includes(profile?.role || "");
  const permissions = owner ? { clients: true } : getTeamPermissions(profile?.role || "Viewer", profile?.permissions);
  const client = (workspace.clients || []).find((item: any) => item.id === clientId);
  if (!client) return respond({ error: "Choose a client in this workspace." }, 404);
  if (!admin && (!permissions.clients || (Array.isArray(profile?.clientAccessIds) && !profile.clientAccessIds.includes(clientId)))) return respond({ error: "You do not have access to this client’s local SEO data." }, 403);

  if (url.searchParams.get("accounts") === "1" || url.searchParams.get("locations") === "1") {
    if (!admin) return respond({ error: "Only an owner or admin can connect a Business Profile to a client." }, 403);
    try {
      const accounts = await connectedAccounts();
      if (url.searchParams.get("accounts") === "1") return respond({ status: "connected", accounts: accounts.map((item) => ({ id: String(item.account_id), name: String(item.account_name || item.account_id) })) });
      const accountId = url.searchParams.get("accountId") || "";
      if (!accounts.some((item) => String(item.account_id) === accountId)) return respond({ error: "Choose a connected Business Profile account." }, 400);
      const locations = await fetchRows(accountId, "account_id,account_name,location_id,location_title,location_website_uri", undefined, undefined, "1000");
      const unique = new Map<string, { id: string; name: string; website: string }>();
      for (const item of locations) {
        const id = String(item.location_id || "").trim();
        if (id) unique.set(id, { id, name: String(item.location_title || item.account_name || id), website: String(item.location_website_uri || "") });
      }
      return respond({ status: "connected", locations: [...unique.values()] });
    } catch (error) {
      return respond({ status: "unavailable", message: error instanceof Error ? error.message : "Could not list connected Business Profile locations.", accounts: [], locations: [] });
    }
  }

  const accountId = String(client.googleBusinessProfileAccountId || "").trim();
  const locationId = String(client.googleBusinessProfileLocationId || "").trim();
  if (!accountId || !locationId) return respond({ status: "not_mapped", message: "Connect this client to its Google Business Profile account and location." });
  const range = url.searchParams.get("range") || "last_30d";
  if (!["last_7d", "last_30d", "last_90d", "custom"].includes(range)) return respond({ error: "Choose a 7, 30, 90 day or custom range." }, 400);
  try {
    const window = googleAnalyticsDateWindow(range, new Date(), { start: url.searchParams.get("from") || "", end: url.searchParams.get("to") || "" });
    if (!window) return respond({ error: "Choose valid start and end dates within a maximum 366-day range." }, 400);
    const fields = "account_id,account_name,location_id,location_title,date,impressions,clicks,call_clicks,direction_requests,website_clicks";
    const [currentRows, previousRows, reviewRows] = await Promise.all([
      fetchRows(accountId, fields, window.current.start, window.current.end),
      fetchRows(accountId, fields, window.previous.start, window.previous.end),
      fetchRows(accountId, "account_id,account_name,location_id,review_id,review_reviewer,review_comment,review_star_rating,review_create_time,review_reply_comment,review_total_count,review_average_rating_total", undefined, undefined, "500").catch(() => null),
    ]);
    const current = summarizeBusinessProfileRows(currentRows, locationId);
    const previous = summarizeBusinessProfileRows(previousRows, locationId);
    const reviews = reviewRows ? summarizeBusinessProfileReviews(reviewRows, locationId) : null;
    const snapshots = await listDailyMarketingSnapshots({ db: env.DB, ownerId: workspace.ownerId, clientId, service: "Google Business Profile", accountId, limit: 30 }).catch(() => []);
    const status = current.rows || reviews?.total !== null && reviews?.total !== undefined ? "connected" : "no_data";
    return respond({
      status, accountId, locationId, locationName: current.locationName || client.name, dateWindow: window, current, previous, reviews, snapshots,
      updatedAt: new Date().toISOString(),
      dataNote: "Business Profile impressions and interactions are platform-reported. They are not confirmed phone leads or booked jobs. Date comparisons use complete Dublin calendar days.",
      reviewsNote: reviewRows ? undefined : "Review details are unavailable from the connected Windsor source; interaction metrics loaded separately.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not retrieve Google Business Profile data.";
    console.error("Local SEO request failed", message);
    return respond({ status: /not connected/i.test(message) ? "source_not_connected" : "unavailable", message });
  }
}
