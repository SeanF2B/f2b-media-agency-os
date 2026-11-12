import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { getTeamPermissions } from "@/lib/access-permissions";
import { summarizeGoogleAdsConnectedAccounts } from "@/lib/google-ads-accounts";

export const dynamic = "force-dynamic";
const respond = (error: string, status = 400) => Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return respond("Sign in to find connected Google Ads accounts.", 401);
  if (!env.DB) return respond("The workspace database is unavailable.", 503);
  const saved = await env.DB.prepare("SELECT data FROM workspace_documents WHERE id = ?1").bind("f2b-agency").first<{ data: string }>();
  if (!saved?.data) return respond("The workspace is unavailable.", 503);
  const workspace = JSON.parse(saved.data) as { ownerId?: string; staff?: Array<{ id?: string; email?: string; isBot?: boolean; role?: string; permissions?: Parameters<typeof getTeamPermissions>[1] }> };
  const owner = workspace.ownerId === user.userId;
  const profile = (workspace.staff || []).find((member) => !member.isBot && (member.id === user.userId || member.email?.toLowerCase() === user.email.toLowerCase()));
  const admin = owner || ["Owner", "Admin"].includes(profile?.role || "");
  const permissions = owner ? { reports: true } : getTeamPermissions(profile?.role || "Viewer", profile?.permissions);
  if (!admin || !permissions.reports) return respond("Only an owner or admin can list and map connected Google Ads accounts.", 403);
  if (!env.WINDSOR_API_KEY) return respond("The Windsor API key is not configured on the app server.", 503);

  try {
    const params = new URLSearchParams({ api_key: env.WINDSOR_API_KEY, date_preset: "last_7d", fields: "account_id,account_name", _max_rows: "1000", _renderer: "json" });
    const response = await fetch(`https://connectors.windsor.ai/google_ads?${params}`, { signal: AbortSignal.timeout(15_000) });
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string; code?: string; details?: { connect_url?: string } };
      if (body.code === "no_accounts_configured") return Response.json({ error: "No Google Ads account is connected to Windsor yet.", connectUrl: body.details?.connect_url || "https://onboard.windsor.ai?datasource=google_ads" }, { status: 409, headers: { "Cache-Control": "no-store" } });
      throw new Error(`Windsor returned HTTP ${response.status}.${body.error ? ` ${String(body.error).slice(0, 300)}` : ""}`);
    }
    const payload = await response.json() as { data?: Array<Record<string, unknown>> };
    if (!Array.isArray(payload.data)) throw new Error("Windsor returned an unexpected Google Ads account list.");
    const accounts = summarizeGoogleAdsConnectedAccounts(payload.data);
    return Response.json({ accounts, source: "Windsor.ai · reporting access", note: "These accounts can be linked for read-only reports. Direct Ads edits use a connected Google login with Google Ads API access on its Cloud project." }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not list connected Google Ads accounts.";
    return respond(message, 502);
  }
}
