import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../app/chatgpt-auth";
import { crmClientScope, getTeamPermissions } from "@/lib/access-permissions";

export const respond = (body: Record<string, unknown>, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

/** Owner/admin gate shared by the Settings API routes. */
export async function authorizeAdmin(action = "manage settings"): Promise<{ ownerId: string; error?: never } | { error: Response; ownerId?: never }> {
  const user = await getChatGPTUser();
  if (!user) return { error: respond({ error: `Sign in to ${action}.` }, 401) };
  if (!env.DB) return { error: respond({ error: "The private workspace database is not available." }, 503) };
  const row = await env.DB.prepare("SELECT owner_id, data FROM workspace_documents WHERE id = ?1")
    .bind("f2b-agency").first<{ owner_id: string; data: string }>();
  if (!row?.data) return { error: respond({ error: "The agency workspace could not be loaded." }, 503) };
  let workspace: any;
  try { workspace = JSON.parse(row.data); } catch { return { error: respond({ error: "The agency workspace data could not be read." }, 503) }; }
  const profile = (workspace.staff || []).find((member: any) => !member?.isBot && (member?.id === user.userId || String(member?.email || "").toLowerCase() === user.email.toLowerCase()));
  const isOwner = row.owner_id === user.userId || workspace.ownerId === user.userId || String(workspace.settings?.adminEmail || "").toLowerCase() === user.email.toLowerCase();
  const isAdmin = isOwner || (profile?.role === "Admin" && getTeamPermissions(profile.role, profile.permissions).team);
  if (!isAdmin) return { error: respond({ error: "Only the workspace owner or an admin can do this." }, 403) };
  return { ownerId: row.owner_id || workspace.ownerId || user.userId };
}

/** Admins get everything (scope null). Sub-account staff allowed to use `page` get only their own sub-account ids. */
export async function authorizeAdminOrSubAccount(action: string, page: "CRM" | "Conversations"): Promise<{ ownerId: string; scope: string[] | null; error?: never } | { error: Response; ownerId?: never; scope?: never }> {
  const admin = await authorizeAdmin(action);
  if (!admin.error) return { ownerId: admin.ownerId, scope: null };
  if (admin.error.status !== 403) return { error: admin.error };
  const user = await getChatGPTUser();
  const row = await env.DB!.prepare("SELECT owner_id, data FROM workspace_documents WHERE id = ?1").bind("f2b-agency").first<{ owner_id: string; data: string }>();
  let workspace: any = {}; try { workspace = JSON.parse(row?.data || "{}"); } catch { /* handled below */ }
  const profile = user && (workspace.staff || []).find((member: any) => !member?.isBot && (member?.id === user.userId || String(member?.email || "").toLowerCase() === user.email.toLowerCase()));
  const scope = crmClientScope(profile, page).filter((id: string) => (workspace.clients || []).some((client: any) => String(client.id) === id));
  if (!scope.length) return { error: admin.error };
  return { ownerId: row?.owner_id || workspace.ownerId || "", scope };
}
