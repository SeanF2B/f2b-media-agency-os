import { env } from "cloudflare:workers";
import { sealGhlSecret } from "@/lib/gohighlevel-oauth";

export const dynamic = "force-dynamic";

function finish(request: Request, result: string) {
  const target = new URL("/", request.url);
  target.searchParams.set("gohighlevelConnection", result);
  return new Response(null, { status: 302, headers: { Location: target.toString(), "Cache-Control": "no-store", "Set-Cookie": "ghl_oauth_state=; HttpOnly; Secure; SameSite=Lax; Path=/api/oauth/callback; Max-Age=0" } });
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const stateCookie = request.headers.get("Cookie")?.match(/(?:^|;\s*)ghl_oauth_state=([^;]+)/)?.[1] || "";
  const state = url.searchParams.get("state") || decodeURIComponent(stateCookie);
  const code = url.searchParams.get("code") || "";
  if (!env.DB || !state || !code || !env.GHL_CLIENT_ID || !env.GHL_CLIENT_SECRET || !env.GHL_REDIRECT_URI || !env.GOOGLE_ADS_TOKEN_ENCRYPTION_KEY) {
    console.error("GoHighLevel OAuth callback setup incomplete", { hasDatabase: Boolean(env.DB), hasState: Boolean(state), hasCode: Boolean(code), hasClientId: Boolean(env.GHL_CLIENT_ID), hasClientSecret: Boolean(env.GHL_CLIENT_SECRET), hasRedirectUri: Boolean(env.GHL_REDIRECT_URI), hasEncryptionKey: Boolean(env.GOOGLE_ADS_TOKEN_ENCRYPTION_KEY) });
    return finish(request, "setup-incomplete");
  }
  const stateRow = await env.DB.prepare("SELECT owner_id FROM gohighlevel_oauth_states WHERE state = ?1 AND expires_at > ?2").bind(state, new Date().toISOString()).first<{ owner_id: string }>();
  if (!stateRow) return finish(request, "state-expired");
  await env.DB.prepare("DELETE FROM gohighlevel_oauth_states WHERE state = ?1").bind(state).run();
  try {
    const response = await fetch("https://services.leadconnectorhq.com/oauth/token", {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", Version: "v3" },
      body: new URLSearchParams({ client_id: env.GHL_CLIENT_ID, client_secret: env.GHL_CLIENT_SECRET, grant_type: "authorization_code", code, user_type: "Company", redirect_uri: env.GHL_REDIRECT_URI }), signal: AbortSignal.timeout(15000),
    });
    const tokens = await response.json().catch(() => ({})) as { refreshToken?: string; accessToken?: string; refresh_token?: string; access_token?: string; companyId?: string; company_id?: string; scope?: string; error?: string; error_description?: string; message?: string };
    const refreshToken = tokens.refreshToken || tokens.refresh_token || "";
    const accessToken = tokens.accessToken || tokens.access_token || "";
    const companyId = tokens.companyId || tokens.company_id || "";
    if (!response.ok || !refreshToken || !accessToken || !companyId) {
      console.error("GoHighLevel OAuth code exchange failed", { status: response.status, hasAccessToken: Boolean(accessToken), hasRefreshToken: Boolean(refreshToken), hasCompanyId: Boolean(companyId), providerError: String(tokens.error_description || tokens.error || tokens.message || "").slice(0, 240) });
      return finish(request, "oauth-failed");
    }
    const [encrypted, encryptedAccess] = await Promise.all([sealGhlSecret(refreshToken), sealGhlSecret(accessToken)]);
    const now = new Date().toISOString();
    const expires = new Date(Date.now() + 23 * 60 * 60_000).toISOString();
    await env.DB.prepare("INSERT INTO gohighlevel_agency_connections (owner_id, company_id, encrypted_refresh_token, token_iv, encrypted_access_token, access_token_iv, access_expires_at, scopes, connected_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?9) ON CONFLICT(owner_id) DO UPDATE SET company_id = excluded.company_id, encrypted_refresh_token = excluded.encrypted_refresh_token, token_iv = excluded.token_iv, encrypted_access_token = excluded.encrypted_access_token, access_token_iv = excluded.access_token_iv, access_expires_at = excluded.access_expires_at, scopes = excluded.scopes, updated_at = excluded.updated_at")
      .bind(stateRow.owner_id, companyId, encrypted.ciphertext, encrypted.iv, encryptedAccess.ciphertext, encryptedAccess.iv, expires, tokens.scope || "", now).run();
    return finish(request, "connected");
  } catch (error) {
    console.error("GoHighLevel OAuth callback failed", error instanceof Error ? error.message : "unknown");
    return finish(request, "oauth-failed");
  }
}
