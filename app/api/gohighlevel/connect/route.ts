import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { getGhlAuthorizationUrl } from "@/lib/gohighlevel-oauth";

export const dynamic = "force-dynamic";

async function isAdmin(user: { userId: string; email: string }) {
  const row = await env.DB?.prepare("SELECT data FROM workspace_documents WHERE id = 'f2b-agency'").first<{ data: string }>();
  if (!row) return false;
  const data = JSON.parse(row.data);
  return data.ownerId === user.userId || data.staff?.some((person: { email?: string; role?: string }) => person.email?.toLowerCase() === user.email.toLowerCase() && ["Owner", "Admin"].includes(person.role || ""));
}

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in before connecting GoHighLevel." }, { status: 401 });
  if (!env.DB || !await isAdmin(user)) return Response.json({ error: "Only an agency owner or admin can connect GoHighLevel." }, { status: 403 });
  if (!env.GHL_CLIENT_ID || !env.GHL_CLIENT_SECRET || !env.GHL_APP_ID || !env.GHL_REDIRECT_URI || !env.GOOGLE_ADS_TOKEN_ENCRYPTION_KEY) {
    return Response.json({ configured: false, error: "The private HighLevel Marketplace app still needs its app credentials, callback URL and secure token storage configured." }, { status: 503 });
  }
  const state = crypto.randomUUID() + crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
  await env.DB.prepare("DELETE FROM gohighlevel_oauth_states WHERE expires_at < ?1").bind(new Date().toISOString()).run();
  await env.DB.prepare("INSERT INTO gohighlevel_oauth_states (state, owner_id, expires_at) VALUES (?1, ?2, ?3)").bind(state, user.userId, expiresAt).run();
  const installation = getGhlAuthorizationUrl();
  installation.searchParams.set("state", state);
  const cookie = `ghl_oauth_state=${encodeURIComponent(state)}; HttpOnly; Secure; SameSite=Lax; Path=/api/oauth/callback; Max-Age=600`;
  return new Response(null, { status: 302, headers: { Location: installation.toString(), "Cache-Control": "no-store", "Set-Cookie": cookie } });
}
