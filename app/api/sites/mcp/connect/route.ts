import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../../../chatgpt-auth";

export const dynamic = "force-dynamic";

async function isAdmin(user: { userId: string; email: string }) {
  const row = await env.DB?.prepare("SELECT data FROM workspace_documents WHERE id = 'f2b-agency'").first<{ data: string }>();
  if (!row) return false;
  const data = JSON.parse(row.data);
  return data.ownerId === user.userId || data.staff?.some((person: { email?: string; role?: string; isBot?: boolean }) => !person.isBot && person.email?.toLowerCase() === user.email.toLowerCase() && ["Owner", "Admin"].includes(person.role || ""));
}

function base64Url(bytes: Uint8Array) {
  return btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join("")).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in before connecting WordPress." }, { status: 401 });
  if (!env.DB || !await isAdmin(user)) return Response.json({ error: "Only an agency owner or admin can connect WordPress." }, { status: 403 });
  try {
    let app = await env.DB.prepare("SELECT client_id FROM wordpress_mcp_oauth_apps WHERE owner_id = ?1").bind(user.userId).first<{ client_id: string }>();
    const redirectUri = new URL("/api/sites/mcp/callback", request.url).toString();
    if (!app?.client_id) {
      const response = await fetch("https://public-api.wordpress.com/oauth2-1/register", { method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify({ client_name: "F2B Media Agency OS", redirect_uris: [redirectUri], grant_types: ["authorization_code", "refresh_token"], response_types: ["code"], token_endpoint_auth_method: "none" }), signal: AbortSignal.timeout(15_000) });
      const registered = await response.json().catch(() => ({})) as { client_id?: string; error?: string; error_description?: string };
      if (!response.ok || !registered.client_id) throw new Error(registered.error_description || registered.error || `WordPress client registration failed (HTTP ${response.status}).`);
      await env.DB.prepare("INSERT INTO wordpress_mcp_oauth_apps (owner_id, client_id, created_at) VALUES (?1, ?2, ?3) ON CONFLICT(owner_id) DO UPDATE SET client_id = excluded.client_id, created_at = excluded.created_at").bind(user.userId, registered.client_id, new Date().toISOString()).run();
      app = { client_id: registered.client_id };
    }
    const verifier = base64Url(crypto.getRandomValues(new Uint8Array(48)));
    const challenge = base64Url(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
    const state = base64Url(crypto.getRandomValues(new Uint8Array(32)));
    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    await env.DB.prepare("DELETE FROM wordpress_mcp_oauth_states WHERE expires_at < ?1").bind(new Date().toISOString()).run();
    await env.DB.prepare("INSERT INTO wordpress_mcp_oauth_states (state, owner_id, code_verifier, expires_at) VALUES (?1, ?2, ?3, ?4)").bind(state, user.userId, verifier, expiresAt).run();
    const authorization = new URL("https://public-api.wordpress.com/oauth2-1/authorize");
    authorization.search = new URLSearchParams({ response_type: "code", client_id: app.client_id, redirect_uri: redirectUri, code_challenge: challenge, code_challenge_method: "S256", scope: "global", state }).toString();
    return new Response(null, { status: 302, headers: { Location: authorization.toString(), "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not start WordPress account authorization." }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}
