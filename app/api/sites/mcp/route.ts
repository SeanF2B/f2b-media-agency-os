import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { cleanMcpError, extractSites, wordpressMcpCall } from "@/lib/wordpress-mcp";

export const dynamic = "force-dynamic";

async function admin(user: { userId: string; email: string }) {
  const row = await env.DB?.prepare("SELECT data FROM workspace_documents WHERE id = 'f2b-agency'").first<{ data: string }>();
  if (!row) return false;
  const data = JSON.parse(row.data);
  return data.ownerId === user.userId || data.staff?.some((person: { email?: string; role?: string; isBot?: boolean }) => !person.isBot && person.email?.toLowerCase() === user.email.toLowerCase() && ["Owner", "Admin"].includes(person.role || ""));
}

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in before managing WordPress sites." }, { status: 401 });
  if (!env.DB || !await admin(user)) return Response.json({ error: "Only an agency owner or admin can manage the WordPress account connection." }, { status: 403 });
  const connected = Boolean(await env.DB.prepare("SELECT owner_id FROM wordpress_mcp_connections WHERE owner_id = ?1").bind(user.userId).first());
  if (!connected) return Response.json({ connected: false, sites: [] }, { headers: { "Cache-Control": "no-store" } });
  try {
    const result = await wordpressMcpCall(user.userId, "wpcom-user-sites", {});
    return Response.json({ connected: true, sites: extractSites(result) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ connected: true, sites: [], error: cleanMcpError(error) }, { headers: { "Cache-Control": "no-store" } });
  }
}

export async function DELETE() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in before disconnecting WordPress." }, { status: 401 });
  if (!env.DB || !await admin(user)) return Response.json({ error: "Only an agency owner or admin can disconnect WordPress." }, { status: 403 });
  await env.DB.prepare("DELETE FROM wordpress_mcp_connections WHERE owner_id = ?1").bind(user.userId).run();
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
