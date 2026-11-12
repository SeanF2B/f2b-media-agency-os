import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../../chatgpt-auth";

export const dynamic = "force-dynamic";

async function isAdmin(user: { userId: string; email: string }) {
  const row = await env.DB?.prepare("SELECT data FROM workspace_documents WHERE id = 'f2b-agency'").first<{ data: string }>();
  if (!row) return false;
  const data = JSON.parse(row.data);
  return data.ownerId === user.userId || data.staff?.some((person: { email?: string; role?: string }) => person.email?.toLowerCase() === user.email.toLowerCase() && ["Owner", "Admin"].includes(person.role || ""));
}

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in before connecting Search Console." }, { status: 401 });
  if (!env.DB || !await isAdmin(user)) return Response.json({ error: "Only an agency owner or admin can connect Search Console." }, { status: 403 });
  if (!env.GOOGLE_ADS_CLIENT_ID || !env.GOOGLE_ADS_CLIENT_SECRET || !env.GOOGLE_ADS_TOKEN_ENCRYPTION_KEY) return Response.json({ error: "Google OAuth credentials are not configured on the app server yet." }, { status: 503 });
  const state = crypto.randomUUID() + crypto.randomUUID();
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({
    client_id: env.GOOGLE_ADS_CLIENT_ID,
    redirect_uri: `${new URL(request.url).origin}/api/google-ads/callback`,
    response_type: "code",
    scope: "https://www.googleapis.com/auth/webmasters.readonly https://www.googleapis.com/auth/analytics.readonly",
    access_type: "offline",
    prompt: "consent",
    state: `searchConsole:${state}`,
  }).toString();
  return new Response(null, { status: 302, headers: { Location: url.toString(), "Set-Cookie": `f2b_search_console_oauth_state=${state}; Max-Age=600; Path=/api/google-ads; Secure; HttpOnly; SameSite=Lax`, "Cache-Control": "no-store" } });
}
