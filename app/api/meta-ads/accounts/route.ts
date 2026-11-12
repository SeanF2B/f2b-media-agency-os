import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { getTeamPermissions } from "@/lib/access-permissions";
import { listDirectMetaAdAccounts, metaAdsConnectionExists, configuredMetaApiVersion } from "@/lib/meta-ads-direct";

export const dynamic = "force-dynamic";
const respond = (error: string, status = 400) => Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
type Profile = { id?: string; email?: string; isBot?: boolean; role?: string; permissions?: Parameters<typeof getTeamPermissions>[1] };
type Workspace = { ownerId?: string; staff?: Profile[] };
export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return respond("Sign in to choose a Meta Ads account.", 401);
  if (!env.DB) return respond("The workspace database is unavailable.", 503);
  const saved = await env.DB.prepare("SELECT data FROM workspace_documents WHERE id = ?1").bind("f2b-agency").first<{ data: string }>();
  if (!saved?.data) return respond("The workspace is unavailable.", 503);
  const workspace = JSON.parse(saved.data) as Workspace;
  const owner = workspace.ownerId === user.userId;
  const profile = (workspace.staff || []).find((member) => !member.isBot && (member.id === user.userId || member.email?.toLowerCase() === user.email.toLowerCase()));
  const admin = owner || ["Owner", "Admin"].includes(profile?.role || "");
  const permissions = owner ? { reports: true } : getTeamPermissions(profile?.role || "Viewer", profile?.permissions);
  if (!admin || !permissions.reports) return respond("Only an owner or admin can view and map connected Meta Ads accounts.", 403);
  const ownerId = String(workspace.ownerId || user.userId);
  if (await metaAdsConnectionExists(ownerId)) {
    try {
      const accounts = await listDirectMetaAdAccounts(ownerId);
      return Response.json({ accounts, source: "Meta Marketing API", apiVersion: configuredMetaApiVersion() }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      return respond(error instanceof Error ? error.message : "Could not list direct Meta Ads accounts.", 502);
    }
  }
  if (!env.WINDSOR_API_KEY) return respond("The Windsor API key is not configured on the app server.", 503);
  try {
    const params = new URLSearchParams({ api_key: env.WINDSOR_API_KEY, date_preset: "last_7d", fields: "account_id,account_name", _max_rows: "1000", _renderer: "json" });
    const response = await fetch(`https://connectors.windsor.ai/facebook?${params}`, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string; code?: string; details?: { connect_url?: string } };
      if (body.code === "no_accounts_configured") return Response.json({ error: "No Facebook or Instagram Ads account is connected to Windsor yet.", connectUrl: body.details?.connect_url || "https://onboard.windsor.ai?datasource=facebook" }, { status: 409, headers: { "Cache-Control": "no-store" } });
      const detail = String(body.error || "").slice(0, 400);
      throw new Error(`Windsor returned HTTP ${response.status}.${detail ? ` ${detail}` : ""}`);
    }
    const payload = await response.json() as { data?: Array<Record<string, unknown>> };
    if (!Array.isArray(payload.data)) throw new Error("Windsor returned an unexpected Meta Ads account list.");
    const byId = new Map<string, { id: string; name: string }>();
    for (const row of payload.data) {
      const id = String(row.account_id || "").replace(/^act_/i, "").replace(/\D/g, "");
      const name = String(row.account_name || "Meta Ads account").trim();
      if (id) byId.set(id, { id, name });
    }
    const accounts = [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
    return Response.json({ accounts, source: "Windsor.ai" }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not list Windsor Meta Ads accounts.";
    return respond(message, 502);
  }
}
