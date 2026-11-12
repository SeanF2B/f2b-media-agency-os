import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { encryptMetaToken, configuredMetaApiVersion } from "@/lib/meta-ads-direct";

export const dynamic = "force-dynamic";

function finish(request: Request, result: string) {
  const location = new URL("/", request.url);
  location.searchParams.set("metaAdsConnection", result);
  return new Response(null, { status: 302, headers: { Location: location.toString(), "Set-Cookie": "f2b_meta_ads_oauth_state=; Max-Age=0; Path=/api/meta-ads; Secure; HttpOnly; SameSite=Lax", "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user || !env.DB) return finish(request, "sign-in-required");
  const workspaceRow = await env.DB.prepare("SELECT data FROM workspace_documents WHERE id = 'f2b-agency'").first<{ data: string }>();
  if (!workspaceRow?.data) return finish(request, "workspace-unavailable");
  const workspace = JSON.parse(workspaceRow.data);
  const admin = workspace.ownerId === user.userId || workspace.staff?.some((member: { email?: string; role?: string }) => member.email?.toLowerCase() === user.email.toLowerCase() && ["Owner", "Admin"].includes(member.role || ""));
  if (!admin) return finish(request, "admin-required");
  const url = new URL(request.url);
  const state = url.searchParams.get("state") || "";
  const cookie = request.headers.get("cookie")?.split(";").map((item) => item.trim()).find((item) => item.startsWith("f2b_meta_ads_oauth_state="))?.slice("f2b_meta_ads_oauth_state=".length) || "";
  if (url.searchParams.has("error")) return finish(request, "cancelled");
  const code = url.searchParams.get("code") || "";
  if (!state || !cookie || state !== cookie || !code || !env.META_APP_ID || !env.META_APP_SECRET || !env.META_TOKEN_ENCRYPTION_KEY) return finish(request, "oauth-failed");
  try {
    const version = configuredMetaApiVersion();
    const redirectUri = `${url.origin}/api/meta-ads/callback`;
    const exchangeUrl = new URL(`https://graph.facebook.com/${version}/oauth/access_token`);
    exchangeUrl.search = new URLSearchParams({ client_id: env.META_APP_ID, client_secret: env.META_APP_SECRET, redirect_uri: redirectUri, code }).toString();
    const shortResponse = await fetch(exchangeUrl, { signal: AbortSignal.timeout(15_000) });
    const shortResult = await shortResponse.json() as { access_token?: string; error?: { message?: string } };
    if (!shortResponse.ok || !shortResult.access_token) return finish(request, "oauth-failed");

    const longUrl = new URL(`https://graph.facebook.com/${version}/oauth/access_token`);
    longUrl.search = new URLSearchParams({ grant_type: "fb_exchange_token", client_id: env.META_APP_ID, client_secret: env.META_APP_SECRET, fb_exchange_token: shortResult.access_token }).toString();
    const longResponse = await fetch(longUrl, { signal: AbortSignal.timeout(15_000) });
    const longResult = await longResponse.json() as { access_token?: string; expires_in?: number };
    const accessToken = longResponse.ok ? longResult.access_token : undefined;
    const expiresIn = Number(longResult.expires_in || 0);
    if (!accessToken || !Number.isFinite(expiresIn) || expiresIn <= 0) return finish(request, "token-exchange-failed");

    const encrypted = await encryptMetaToken(accessToken);
    const now = new Date(); const nowIso = now.toISOString();
    const expiresAt = new Date(now.getTime() + expiresIn * 1000).toISOString();
    await env.DB.prepare("INSERT INTO meta_ads_connections (owner_id, encrypted_access_token, token_iv, account_email, expires_at, connected_at, updated_at) VALUES (?1, ?2, ?3, '', ?4, ?5, ?5) ON CONFLICT(owner_id) DO UPDATE SET encrypted_access_token = excluded.encrypted_access_token, token_iv = excluded.token_iv, expires_at = excluded.expires_at, updated_at = excluded.updated_at")
      .bind(workspace.ownerId, encrypted.ciphertext, encrypted.iv, expiresAt, nowIso).run();
    return finish(request, "connected");
  } catch (error) {
    console.error("Meta Ads OAuth callback failed", error instanceof Error ? error.message : "unknown");
    return finish(request, "oauth-failed");
  }
}
