// Facebook Login callback: swap the code for a long-lived token, then save the person's Pages as "pending"
// for that sub-account. Launchpad then asks which Page(s) to connect.
import { env } from "cloudflare:workers";
import { authorizeAdminOrSubAccount } from "@/lib/settings-auth";
import { configuredMetaApiVersion } from "@/lib/meta-ads-direct";
import { savePendingPages } from "@/lib/conversations/meta";

export const dynamic = "force-dynamic";

const back = (request: Request, result: string, clientId = "") => {
  const to = new URL("/", request.url); to.searchParams.set("metaMessaging", result); if (clientId) to.searchParams.set("clientId", clientId);
  return new Response(null, { status: 302, headers: { Location: to.toString(), "Set-Cookie": "f2b_meta_msg_state=; Max-Age=0; Path=/api/meta-messaging; Secure; HttpOnly; SameSite=Lax", "Cache-Control": "no-store" } });
};

export async function GET(request: Request) {
  const auth = await authorizeAdminOrSubAccount("connect Facebook and Instagram messages", "Conversations");
  if (auth.error) return back(request, "admin-required");
  const url = new URL(request.url);
  const cookie = request.headers.get("cookie")?.split(";").map((c) => c.trim()).find((c) => c.startsWith("f2b_meta_msg_state="))?.slice("f2b_meta_msg_state=".length) || "";
  const [savedState, rawClient = "agency"] = cookie.split(".");
  const clientId = rawClient === "agency" ? "" : rawClient;
  if (auth.scope && !auth.scope.includes(clientId)) return back(request, "admin-required", clientId);
  if (url.searchParams.has("error")) return back(request, "cancelled", clientId);
  const code = url.searchParams.get("code") || "", state = url.searchParams.get("state") || "";
  if (!code || !state || state !== savedState || !env.META_APP_ID || !env.META_APP_SECRET) return back(request, "oauth-failed", clientId);
  try {
    const version = configuredMetaApiVersion();
    const ex = new URL(`https://graph.facebook.com/${version}/oauth/access_token`);
    ex.search = new URLSearchParams({ client_id: env.META_APP_ID, client_secret: env.META_APP_SECRET, redirect_uri: `${url.origin}/api/meta-messaging/callback`, code }).toString();
    const short = await (await fetch(ex, { signal: AbortSignal.timeout(15_000) })).json() as { access_token?: string };
    if (!short.access_token) return back(request, "oauth-failed", clientId);
    const lg = new URL(`https://graph.facebook.com/${version}/oauth/access_token`);
    lg.search = new URLSearchParams({ grant_type: "fb_exchange_token", client_id: env.META_APP_ID, client_secret: env.META_APP_SECRET, fb_exchange_token: short.access_token }).toString();
    const long = await (await fetch(lg, { signal: AbortSignal.timeout(15_000) })).json() as { access_token?: string };
    // Page tokens fetched with a long-lived user token don't expire.
    const count = await savePendingPages(auth.ownerId, clientId, long.access_token || short.access_token);
    return back(request, count ? "pick" : "no-pages", clientId);
  } catch (e) {
    console.error("Meta messaging callback", e instanceof Error ? e.message : e);
    return back(request, "oauth-failed", clientId);
  }
}
