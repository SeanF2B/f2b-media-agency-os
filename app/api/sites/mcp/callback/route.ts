import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../../../chatgpt-auth";
import { encryptWordPressMcpToken } from "@/lib/wordpress-mcp";

export const dynamic = "force-dynamic";

function finish(request: Request, result: string) {
  const target = new URL("/", request.url);
  target.searchParams.set("wordpressAccount", result);
  return new Response(null, { status: 302, headers: { Location: target.toString(), "Cache-Control": "no-store", "Referrer-Policy": "no-referrer" } });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code") || "";
  const state = url.searchParams.get("state") || "";
  const user = await getChatGPTUser();
  if (!env.DB || !user || !code || !state) return finish(request, "setup-incomplete");
  const stateRow = await env.DB.prepare("SELECT owner_id, code_verifier FROM wordpress_mcp_oauth_states WHERE state = ?1 AND expires_at > ?2").bind(state, new Date().toISOString()).first<{ owner_id: string; code_verifier: string }>();
  if (!stateRow || stateRow.owner_id !== user.userId) return finish(request, "state-expired");
  await env.DB.prepare("DELETE FROM wordpress_mcp_oauth_states WHERE state = ?1").bind(state).run();
  const app = await env.DB.prepare("SELECT client_id FROM wordpress_mcp_oauth_apps WHERE owner_id = ?1").bind(user.userId).first<{ client_id: string }>();
  if (!app?.client_id || !env.WORDPRESS_MCP_TOKEN_ENCRYPTION_KEY) return finish(request, "setup-incomplete");
  try {
    const response = await fetch("https://public-api.wordpress.com/oauth2-1/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" }, body: new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: new URL("/api/sites/mcp/callback", request.url).toString(), code_verifier: stateRow.code_verifier, client_id: app.client_id }), signal: AbortSignal.timeout(15_000) });
    const token = await response.json().catch(() => ({})) as { access_token?: string; refresh_token?: string; expires_in?: number; error?: string; error_description?: string };
    if (!response.ok || !token.access_token) {
      console.error("WordPress MCP OAuth token exchange failed", { status: response.status, providerError: String(token.error_description || token.error || "").slice(0, 180) });
      return finish(request, "oauth-failed");
    }
    const encryptedAccess = await encryptWordPressMcpToken(token.access_token);
    const encryptedRefresh = token.refresh_token ? await encryptWordPressMcpToken(token.refresh_token) : null;
    const now = new Date().toISOString();
    const expiresAt = typeof token.expires_in === "number" ? new Date(Date.now() + token.expires_in * 1000).toISOString() : null;
    await env.DB.prepare("INSERT INTO wordpress_mcp_connections (owner_id, encrypted_access_token, access_token_iv, encrypted_refresh_token, refresh_token_iv, token_expires_at, wp_username, connected_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, NULL, ?7, ?7) ON CONFLICT(owner_id) DO UPDATE SET encrypted_access_token = excluded.encrypted_access_token, access_token_iv = excluded.access_token_iv, encrypted_refresh_token = excluded.encrypted_refresh_token, refresh_token_iv = excluded.refresh_token_iv, token_expires_at = excluded.token_expires_at, connected_at = excluded.connected_at, updated_at = excluded.updated_at")
      .bind(user.userId, encryptedAccess.ciphertext, encryptedAccess.iv, encryptedRefresh?.ciphertext || null, encryptedRefresh?.iv || null, expiresAt, now).run();
    return finish(request, "connected");
  } catch (error) {
    console.error("WordPress OAuth callback failed", error instanceof Error ? error.message : "unknown error");
    return finish(request, "oauth-failed");
  }
}
