import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { getTeamPermissions, type TeamPermissions } from "@/lib/access-permissions";
import { processDailyMarketingSnapshots } from "@/lib/marketing-daily-sync";
import type { MarketingSnapshotService } from "@/lib/marketing-data-history";
import { getGoogleAdsCampaignMetrics, googleAdsConnectionReady } from "@/lib/google-ads-direct";
import { metaAdsConnectionExists, readDirectMetaAdsInsights } from "@/lib/meta-ads-direct";

export const dynamic = "force-dynamic";
const respond = (body: Record<string, unknown>, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const services = new Set<MarketingSnapshotService>(["Google Ads", "Meta Ads", "Search Console", "GA4", "Google Business Profile"]);
type Workspace = {
  ownerId?: string;
  staff?: Array<{ id?: string; email?: string; role?: string; isBot?: boolean; permissions?: Partial<TeamPermissions> }>;
  clients?: Array<{ id: string; name?: string; googleAdsAccountId?: string; metaAdsAccountId?: string; googleSearchConsoleAccountId?: string; googleAnalyticsAccountId?: string; googleBusinessProfileAccountId?: string; googleBusinessProfileLocationId?: string }>;
};

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return respond({ status: "unauthorized", message: "Sign in to retry a client data sync." }, 401);
  if (!env.DB) return respond({ status: "unavailable", message: "The workspace database is unavailable." }, 503);
  let body: { clientId?: string; service?: string };
  try { body = await request.json() as typeof body; }
  catch { return respond({ status: "invalid_request", message: "Choose a client and service to retry." }, 400); }
  const clientId = String(body.clientId || "");
  const service = String(body.service || "") as MarketingSnapshotService;
  if (!clientId || !services.has(service)) return respond({ status: "invalid_request", message: "Choose a valid client and service." }, 400);

  const row = await env.DB.prepare("SELECT data FROM workspace_documents WHERE id = ?1").bind("f2b-agency").first<{ data: string }>();
  if (!row?.data) return respond({ status: "unavailable", message: "The workspace could not be loaded." }, 503);
  let workspace: Workspace;
  try { workspace = JSON.parse(row.data) as Workspace; }
  catch { return respond({ status: "unavailable", message: "The workspace data could not be read." }, 503); }
  const ownerId = String(workspace.ownerId || user.userId);
  const profile = (workspace.staff || []).find((member) => !member.isBot && (member.id === user.userId || member.email?.toLowerCase() === user.email.toLowerCase()));
  const isAdmin = workspace.ownerId === user.userId || ["Owner", "Admin"].includes(profile?.role || "");
  const permissions = getTeamPermissions(profile?.role || "Viewer", profile?.permissions);
  if (!isAdmin || !permissions.team) return respond({ status: "forbidden", message: "Only a workspace owner or admin can retry an integration sync." }, 403);
  const client = (workspace.clients || []).find((item) => item.id === clientId);
  if (!client) return respond({ status: "not_found", message: "Choose a client in this workspace." }, 404);

  const accountId = service === "Google Ads" ? String(client.googleAdsAccountId || "").replace(/\D/g, "")
    : service === "Meta Ads" ? String(client.metaAdsAccountId || "").replace(/^act_/i, "").replace(/\D/g, "")
      : service === "Search Console" ? String(client.googleSearchConsoleAccountId || "").trim()
        : service === "GA4" ? String(client.googleAnalyticsAccountId || "").trim()
          : String(client.googleBusinessProfileAccountId || "").trim();
  if (!accountId || (service === "Google Business Profile" && !client.googleBusinessProfileLocationId)) {
    return respond({ status: "not_mapped", message: `Map this client to a ${service} account${service === "Google Business Profile" ? " and location" : ""} before retrying.` }, 409);
  }

  const current = await env.DB.prepare("SELECT status, last_attempt_at, detail FROM marketing_sync_state WHERE owner_id = ?1 AND client_id = ?2 AND service = ?3 AND account_id = ?4")
    .bind(ownerId, client.id, service, accountId).first<{ status: string; last_attempt_at: string; detail: string | null }>();
  if (current?.status === "syncing" && Date.now() - Date.parse(current.last_attempt_at) < 15 * 60 * 1000) {
    return respond({ status: "in_progress", message: `${client.name || "This client"}’s ${service} sync is already running.` }, 409);
  }

  try {
    const result = await processDailyMarketingSnapshots({
      DB: env.DB,
      WINDSOR_API_KEY: env.WINDSOR_API_KEY,
      isGoogleAdsDirect: googleAdsConnectionReady,
      readDirectGoogleAds: async (id, account, window) => (await getGoogleAdsCampaignMetrics(id, account, window)).rows,
      isMetaAdsDirect: metaAdsConnectionExists,
      readDirectMetaAds: (id, account, window) => readDirectMetaAdsInsights(id, account, window, "campaigns"),
    }, new Date(), { clientId: client.id, service });
    const latest = await env.DB.prepare("SELECT status, last_attempt_at, detail FROM marketing_sync_state WHERE owner_id = ?1 AND client_id = ?2 AND service = ?3 AND account_id = ?4")
      .bind(ownerId, client.id, service, accountId).first<{ status: string; last_attempt_at: string; detail: string | null }>();
    if (latest?.status === "connected" || latest?.status === "no_data") return respond({ status: latest.status, clientId, service, lastAttemptAt: latest.last_attempt_at, message: latest.status === "no_data" ? "The connection worked, but the provider returned no rows for this period." : "The client’s data synced successfully." });
    if (latest?.status === "unavailable") return respond({ status: "unavailable", clientId, service, lastAttemptAt: latest.last_attempt_at, message: latest.detail || "The provider sync failed. Check its connection and try again later." }, 502);
    if (result.status === "not_configured") return respond({ status: "not_configured", message: "No provider is configured for this sync. Connect Windsor or the direct service integration first." }, 503);
    if (latest?.status === "syncing" || result.synced === 0) return respond({ status: "in_progress", message: "This sync is already queued or running. Refresh Integrations shortly to see its result." }, 409);
    return respond({ status: "unavailable", message: "The provider sync did not reach a confirmed result." }, 502);
  } catch (error) {
    console.error("Manual marketing sync retry failed", { clientId, service, message: error instanceof Error ? error.message : "unknown error" });
    return respond({ status: "unavailable", message: "The sync could not complete. Check the integration connection and try again." }, 502);
  }
}
