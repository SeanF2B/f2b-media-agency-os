import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../app/chatgpt-auth";
import { getTeamPermissions } from "@/lib/access-permissions";

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
