import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { getTeamPermissions, type TeamPermissions } from "@/lib/access-permissions";
import { compareMetaAdsTotals, metaAdsPerformanceWindow, summarizeMetaAdsCampaignDailyClicks, summarizeMetaAdsDailyClicks, summarizeMetaAdsDailySpend, summarizeMetaAdsRows, summarizeMetaAdsTotals, type MetaAdsRange, type MetaAdsSection, type MetaAdsRow } from "@/lib/meta-ads-performance";
import { listDailyMarketingSnapshots, loadCachedMarketingData, saveDailyMarketingSnapshot } from "@/lib/marketing-data-history";
import { metaAdsConnectionExists, readDirectMetaAdsInsights, configuredMetaApiVersion } from "@/lib/meta-ads-direct";

export const dynamic = "force-dynamic";
const respond = (error: string, status = 400) => Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
type WorkspaceProfile = { id?: string; email?: string; isBot?: boolean; role?: string; permissions?: Partial<TeamPermissions>; clientAccessIds?: string[] };
type WorkspaceClient = { id: string; name: string; logo?: string; metaAdsAccountId?: string };
type WorkspaceData = { ownerId?: string; staff?: WorkspaceProfile[]; clients?: WorkspaceClient[]; settings?: { currency?: string } };
function priorWindow(current: { start: string; end: string }) {
  const start = new Date(`${current.start}T00:00:00Z`), end = new Date(`${current.end}T00:00:00Z`);
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
  const previousEnd = new Date(start); previousEnd.setUTCDate(previousEnd.getUTCDate() - 1);
  const previousStart = new Date(previousEnd); previousStart.setUTCDate(previousStart.getUTCDate() - days + 1);
  return { start: previousStart.toISOString().slice(0, 10), end: previousEnd.toISOString().slice(0, 10) };
}
const fields: Record<MetaAdsSection, string> = {
  campaigns: "account_id,account_name,date,campaign,campaign_id,campaign_status,spend,impressions,clicks,actions_lead",
  ad_sets: "account_id,account_name,date,campaign,campaign_id,campaign_status,adset_name,adset_id,adset_status,spend,impressions,clicks,actions_lead",
  ads: "account_id,account_name,date,campaign,campaign_id,campaign_status,adset_name,adset_id,ad_name,ad_id,spend,impressions,clicks,actions_lead,ad_preview_shareable_link",
  audiences: "account_id,account_name,date,campaign,campaign_id,age,gender,spend,impressions,clicks,actions_lead",
  locations: "account_id,account_name,date,campaign,campaign_id,country,spend,impressions,clicks,actions_lead",
};
async function readRows(ownerId: string, accountId: string, window: { start: string; end: string }, section: MetaAdsSection = "campaigns", campaignId?: string, cacheScope?: { ownerId: string; clientId: string }) {
  const direct = await metaAdsConnectionExists(ownerId);
  if (!direct && !env.WINDSOR_API_KEY) throw new Error("Neither a direct Meta Ads connection nor the Windsor API key is configured.");
  const key = JSON.stringify({ source: direct ? "meta-marketing-api" : "windsor", accountId, window, section, campaignId: campaignId || "" });
  const load = async () => {
    if (direct) return readDirectMetaAdsInsights(ownerId, accountId, window, section, campaignId);
    const params = new URLSearchParams({ api_key: env.WINDSOR_API_KEY!, fields: fields[section], date_from: window.start, date_to: window.end, select_accounts: accountId, _max_rows: "1000", _renderer: "json" });
    if (campaignId && /^\d+$/.test(campaignId)) params.set("filter", JSON.stringify([["campaign_id", "eq", campaignId]]));
    const response = await fetch(`https://connectors.windsor.ai/facebook?${params}`, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) {
      const detail = (await response.text().catch(() => "")).slice(0, 500);
      throw new Error(`Windsor could not read Meta Ads data (HTTP ${response.status}). ${detail}`);
    }
    const payload = await response.json() as { data?: MetaAdsRow[] };
    if (!Array.isArray(payload.data)) throw new Error("Windsor returned an unexpected Meta Ads response.");
    return payload.data;
  };
  if (!cacheScope || !env.DB) return load();
  return (await loadCachedMarketingData({ db: env.DB, ...cacheScope, service: "Meta Ads", key }, load)).data;
}

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return respond("Sign in to view Meta Ads results.", 401);
  if (!env.DB) return respond("The workspace database is unavailable.", 503);
  const saved = await env.DB.prepare("SELECT data FROM workspace_documents WHERE id = ?1").bind("f2b-agency").first<{ data: string }>();
  if (!saved?.data) return respond("The workspace is unavailable.", 503);
  const workspace = JSON.parse(saved.data) as WorkspaceData;
  const owner = workspace.ownerId === user.userId;
  const profile = (workspace.staff || []).find((member) => !member.isBot && (member.id === user.userId || member.email?.toLowerCase() === user.email.toLowerCase()));
  const admin = owner || ["Owner", "Admin"].includes(profile?.role || "");
  const permissions = owner ? { reports: true } : getTeamPermissions(profile?.role || "Viewer", profile?.permissions);
  if (!admin && !permissions.reports) return respond("You do not have permission to view Ads performance.", 403);

  const url = new URL(request.url), clientId = url.searchParams.get("clientId") || "";
  const client = (workspace.clients || []).find((item) => item.id === clientId);
  if (!client) return respond("Choose a client in this workspace.", 404);
  if (!admin && Array.isArray(profile?.clientAccessIds) && !profile.clientAccessIds.includes(clientId)) return respond("You do not have access to this client’s Meta Ads account.", 403);
  const accountId = String(client.metaAdsAccountId || "").replace(/^act_/i, "").replace(/\D/g, "");
  if (!accountId) return Response.json({ status: "not_mapped", clientId, message: "Add this client’s Meta Ads account ID to the client record and connect it in Windsor." }, { headers: { "Cache-Control": "no-store" } });
  const ownerId = String(workspace.ownerId || user.userId);
  if (!env.WINDSOR_API_KEY && !(await metaAdsConnectionExists(ownerId))) return Response.json({ status: "missing_connection", clientId, message: "The Windsor API key is not configured and no direct Meta Ads connection is saved." }, { headers: { "Cache-Control": "no-store" } });
  const range = (url.searchParams.get("range") || "last_30d") as MetaAdsRange;
  if (!["last_7d", "last_30d", "last_90d", "custom"].includes(range)) return respond("Choose a 7, 30, 90 day or custom range.");
  let currentWindow: { start: string; end: string };
  try { currentWindow = metaAdsPerformanceWindow(range, url.searchParams.get("from") || undefined, url.searchParams.get("to") || undefined); }
  catch (error) { return respond(error instanceof Error ? error.message : "Choose valid report dates."); }
  const section = url.searchParams.get("section") as MetaAdsSection | null;
  if (section && !["campaigns", "ad_sets", "ads", "audiences", "locations"].includes(section)) return respond("Choose campaigns, ad sets, ads, audiences or locations.");
  const cacheScope = { ownerId: String(workspace.ownerId || user.userId), clientId };
  const direct = await metaAdsConnectionExists(cacheScope.ownerId);
  try {
    const source = direct ? `Meta Marketing API · read-only · ${configuredMetaApiVersion()}` : "Windsor.ai Meta Ads connector · read-only";
    if (section) {
      const rows = await readRows(cacheScope.ownerId, accountId, currentWindow, section, url.searchParams.get("campaignId") || undefined, cacheScope);
      return Response.json({ status: rows.length ? "connected" : "no_data", source, section, client: { id: client.id, name: client.name, logo: client.logo || "" }, accountId, currency: String(workspace.settings?.currency || "EUR"), dateWindow: { current: currentWindow }, rows: summarizeMetaAdsRows(rows, section), sourceRows: rows.length, mayBeLimited: rows.length >= 1000, updatedAt: new Date().toISOString() }, { headers: { "Cache-Control": "no-store" } });
    }
    const previous = priorWindow(currentWindow);
    const [currentRows, previousRows] = await Promise.all([readRows(cacheScope.ownerId, accountId, currentWindow, "campaigns", undefined, cacheScope), readRows(cacheScope.ownerId, accountId, previous, "campaigns", undefined, cacheScope)]);
    const current = summarizeMetaAdsTotals(currentRows), prior = summarizeMetaAdsTotals(previousRows);
    const campaigns = summarizeMetaAdsRows(currentRows, "campaigns");
    const previousCampaigns = summarizeMetaAdsRows(previousRows, "campaigns");
    const status = currentRows.length ? "connected" : "no_data";
    const fetchedAt = new Date();
    const currentPayload = { totals: { ...current, ctr: current.impressions ? current.clicks / current.impressions : null, costPerLead: current.leads ? current.spend / current.leads : null }, campaigns, daily: summarizeMetaAdsDailyClicks(currentRows), dailySpend: summarizeMetaAdsDailySpend(currentRows), campaignDaily: summarizeMetaAdsCampaignDailyClicks(currentRows), sourceRows: currentRows.length, mayBeLimited: currentRows.length >= 1000 };
    if (range === "last_30d") await saveDailyMarketingSnapshot({ db: env.DB, ...cacheScope, service: "Meta Ads", accountId, status, payload: { current: currentPayload }, fetchedAt }).catch(() => null);
    const snapshots = await listDailyMarketingSnapshots({ db: env.DB, ...cacheScope, service: "Meta Ads", accountId, limit: 30 }).catch(() => []);
    return Response.json({ status, source, client: { id: client.id, name: client.name, logo: client.logo || "" }, accountId, currency: String(workspace.settings?.currency || "EUR"), range, dateWindow: { current: currentWindow, previous }, current: currentPayload, previous: { ...prior, campaigns: previousCampaigns }, changes: compareMetaAdsTotals(current, prior), snapshots, updatedAt: fetchedAt.toISOString(), dataNote: `Spend, clicks and leads are reported by Meta${direct ? " through the direct Meta Marketing API connection" : " through Windsor"}. Lead totals depend on Meta’s configured events and attribution; they are not CRM-verified contacts. Daily history tracks a consistent rolling 30-day window and updates automatically in the background.` }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not retrieve Meta Ads data.";
    console.error("Meta Ads workspace request failed", message);
    return Response.json({ status: /not configured|key/i.test(message) ? "missing_connection" : "unavailable", message }, { headers: { "Cache-Control": "no-store" } });
  }
}
