import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { configuredMetaApiVersion } from "@/lib/meta-ads-direct";

export const dynamic = "force-dynamic";

function finish(request: Request, result: string) {
  const location = new URL("/", request.url);
  location.searchParams.set("metaAdsConnection", result);
  return new Response(null, { status: 302, headers: { Location: location.toString(), "Cache-Control": "no-store" } });
}

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in before connecting Meta Ads." }, { status: 401 });
  if (!env.DB) return Response.json({ error: "The workspace database is unavailable." }, { status: 503 });
  const row = await env.DB.prepare("SELECT data FROM workspace_documents WHERE id = 'f2b-agency'").first<{ data: string }>();
  if (!row) return Response.json({ error: "The workspace is unavailable." }, { status: 503 });
  const workspace = JSON.parse(row.data);
  const admin = workspace.ownerId === user.userId || workspace.staff?.some((member: { email?: string; role?: string }) => member.email?.toLowerCase() === user.email.toLowerCase() && ["Owner", "Admin"].includes(member.role || ""));
  if (!admin) return Response.json({ error: "Only an agency owner or admin can connect Meta Ads." }, { status: 403 });
  if (!env.META_APP_ID || !env.META_APP_SECRET || !env.META_TOKEN_ENCRYPTION_KEY) return finish(request, "not-configured");
  let version: string;
  try { version = configuredMetaApiVersion(); }
  catch { return finish(request, "version-not-configured"); }
  const state = crypto.randomUUID() + crypto.randomUUID();
  const redirectUri = `${new URL(request.url).origin}/api/meta-ads/callback`;
  const url = new URL(`https://www.facebook.com/${version}/dialog/oauth`);
  url.search = new URLSearchParams({ client_id: env.META_APP_ID, redirect_uri: redirectUri, response_type: "code", scope: "ads_read,ads_management", state, auth_type: "rerequest" }).toString();
  return new Response(null, { status: 302, headers: { Location: url.toString(), "Set-Cookie": `f2b_meta_ads_oauth_state=${state}; Max-Age=600; Path=/api/meta-ads; Secure; HttpOnly; SameSite=Lax`, "Cache-Control": "no-store" } });
}
