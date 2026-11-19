import { env } from "cloudflare:workers";
import { authorizeAdmin } from "@/lib/settings-auth";

// Launchpad → Google Business Profile: one Google sign-in with the Business Profile permission, used to publish
// Content calendar posts and show live Google posts. Returns via the shared /api/google-ads/callback ("gbp:").
export const dynamic = "force-dynamic";
export async function GET(request: Request) {
  const auth = await authorizeAdmin("connect Google Business Profile");
  if (auth.error) return auth.error;
  if (!env.GOOGLE_ADS_CLIENT_ID || !env.GOOGLE_ADS_CLIENT_SECRET || !env.GOOGLE_ADS_TOKEN_ENCRYPTION_KEY) return Response.redirect(new URL("/?page=Content&gbpConnection=not-configured", request.url), 302);
  const state = `gbp:${crypto.randomUUID()}${crypto.randomUUID()}`;
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({ client_id: env.GOOGLE_ADS_CLIENT_ID, redirect_uri: `${new URL(request.url).origin}/api/google-ads/callback`, response_type: "code", scope: "https://www.googleapis.com/auth/business.manage https://www.googleapis.com/auth/userinfo.email", access_type: "offline", prompt: "consent", include_granted_scopes: "true", state }).toString();
  return new Response(null, { status: 302, headers: { Location: url.toString(), "Set-Cookie": `f2b_gbp_oauth_state=${state}; Max-Age=600; Path=/api/google-ads; Secure; HttpOnly; SameSite=Lax`, "Cache-Control": "no-store" } });
}
