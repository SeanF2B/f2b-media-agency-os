import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { getTeamPermissions, type TeamPermissions } from "@/lib/access-permissions";
import { metaAdsConnectionExists, readDirectMetaAdPreview } from "@/lib/meta-ads-direct";

export const dynamic = "force-dynamic";
const respond = (body: Record<string, unknown>, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return respond({ error: "Sign in to view Meta ad previews." }, 401);
  if (!env.DB) return respond({ error: "The workspace database is unavailable." }, 503);
  const saved = await env.DB.prepare("SELECT data FROM workspace_documents WHERE id = ?1").bind("f2b-agency").first<{ data: string }>();
  if (!saved?.data) return respond({ error: "The workspace is unavailable." }, 503);
  const workspace = JSON.parse(saved.data) as { ownerId?: string; staff?: Array<{ id?: string; email?: string; isBot?: boolean; role?: string; permissions?: Partial<TeamPermissions>; clientAccessIds?: string[] }>; clients?: Array<{ id: string; metaAdsAccountId?: string }> };
  const owner = workspace.ownerId === user.userId;
  const profile = (workspace.staff || []).find((member) => !member.isBot && (member.id === user.userId || member.email?.toLowerCase() === user.email.toLowerCase()));
  const admin = owner || ["Owner", "Admin"].includes(profile?.role || "");
  const permissions = owner ? { reports: true } : getTeamPermissions(profile?.role || "Viewer", profile?.permissions);
  if (!admin && !permissions.reports) return respond({ error: "You do not have permission to view Meta Ads." }, 403);
  const url = new URL(request.url);
  const clientId = url.searchParams.get("clientId") || "";
  const adId = url.searchParams.get("adId") || "";
  const client = (workspace.clients || []).find((item) => item.id === clientId);
  if (!client) return respond({ error: "Choose a client in this workspace." }, 404);
  if (!admin && Array.isArray(profile?.clientAccessIds) && !profile.clientAccessIds.includes(clientId)) return respond({ error: "You do not have access to this client’s Meta Ads account." }, 403);
  if (!/^\d{6,24}$/.test(adId)) return respond({ error: "The selected Meta ad ID is not valid." }, 400);
  const accountId = String(client.metaAdsAccountId || "").replace(/^act_/i, "").replace(/\D/g, "");
  if (!accountId) return respond({ error: "Link a Meta Ads account to this client first." }, 409);
  const ownerId = String(workspace.ownerId || user.userId);
  if (!(await metaAdsConnectionExists(ownerId))) return respond({ error: "Live Meta previews require a direct Meta Ads connection. Windsor previews are shown when Windsor supplies a preview link." }, 409);
  try {
    const preview = await readDirectMetaAdPreview(ownerId, accountId, adId);
    return respond({ status: "connected", ...preview });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create the Meta ad preview.";
    return respond({ error: message }, 502);
  }
}
