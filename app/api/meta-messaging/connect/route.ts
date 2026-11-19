// Facebook Login for one sub-account's Messenger + Instagram DMs (Launchpad → Messaging → Connect). Admins only.
import { env } from "cloudflare:workers";
import { authorizeAdmin } from "@/lib/settings-auth";
import { configuredMetaApiVersion } from "@/lib/meta-ads-direct";
import { META_MESSAGING_SCOPES } from "@/lib/conversations/meta-rules";

export const dynamic = "force-dynamic";

const back = (request: Request, result: string, clientId = "") => {
  const to = new URL("/", request.url); to.searchParams.set("metaMessaging", result); if (clientId) to.searchParams.set("clientId", clientId);
  return new Response(null, { status: 302, headers: { Location: to.toString(), "Cache-Control": "no-store" } });
};

export async function GET(request: Request) {
  const auth = await authorizeAdmin("connect Facebook and Instagram messages");
  if (auth.error) return auth.error;
  const url = new URL(request.url);
  const clientId = (url.searchParams.get("clientId") || "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 100);
  if (!env.META_APP_ID || !env.META_APP_SECRET || !env.META_TOKEN_ENCRYPTION_KEY) return back(request, "not-configured", clientId);
  let version: string; try { version = configuredMetaApiVersion(); } catch { return back(request, "version-not-configured", clientId); }
  const state = crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "");
  const dialog = new URL(`https://www.facebook.com/${version}/dialog/oauth`);
  dialog.search = new URLSearchParams({ client_id: env.META_APP_ID, redirect_uri: `${url.origin}/api/meta-messaging/callback`, response_type: "code", scope: META_MESSAGING_SCOPES.join(","), state, auth_type: "rerequest" }).toString();
  return new Response(null, { status: 302, headers: { Location: dialog.toString(), "Set-Cookie": `f2b_meta_msg_state=${state}.${clientId || "agency"}; Max-Age=600; Path=/api/meta-messaging; Secure; HttpOnly; SameSite=Lax`, "Cache-Control": "no-store" } });
}
