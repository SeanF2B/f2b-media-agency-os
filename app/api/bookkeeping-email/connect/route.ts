import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { GMAIL_SCOPE, gmailOAuthReady } from "@/lib/bookkeeping-email";

export const dynamic = "force-dynamic";

// Starts Gmail sign-in for a Bookkeeping inbox. Google returns to the shared /api/google-ads/callback (state "gmail:<scope>:<nonce>").
export async function GET(request: Request) {
  const scope = (new URL(request.url).searchParams.get("scope") || "agency").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 80) || "agency";
  const back = (status: string) => Response.redirect(new URL(`/?page=Bookkeeping&gmailConnection=${status}`, request.url), 302);
  const user = await getChatGPTUser();
  if (!user) return back("sign-in-required");
  if (!gmailOAuthReady()) return back("not-configured");
  const row = await env.DB!.prepare("SELECT data FROM workspace_documents WHERE id = 'f2b-agency'").first<{ data: string }>();
  if (!row) return back("workspace-unavailable");
  const data = JSON.parse(row.data);
  const admin = data.ownerId === user.userId || data.staff?.some((person: { email?: string; role?: string }) => person.email?.toLowerCase() === user.email.toLowerCase() && ["Owner", "Admin"].includes(person.role || ""));
  if (!admin) return back("admin-required");
  const nonce = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, "");
  const state = `gmail:${scope}:${nonce}`;
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({ client_id: env.GOOGLE_ADS_CLIENT_ID!, redirect_uri: `${new URL(request.url).origin}/api/google-ads/callback`, response_type: "code", scope: GMAIL_SCOPE, access_type: "offline", prompt: "consent", include_granted_scopes: "true", state }).toString();
  return new Response(null, { status: 302, headers: { Location: url.toString(), "Set-Cookie": `f2b_gmail_oauth_state=${nonce}; Max-Age=600; Path=/api/google-ads; Secure; HttpOnly; SameSite=Lax`, "Cache-Control": "no-store" } });
}
