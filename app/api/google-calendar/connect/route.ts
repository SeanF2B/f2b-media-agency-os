import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../../chatgpt-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.redirect(new URL("/?googleCalendarConnection=sign-in-required", request.url));
  if (!env.DB || !env.GOOGLE_ADS_CLIENT_ID || !env.GOOGLE_ADS_CLIENT_SECRET || !env.GOOGLE_ADS_TOKEN_ENCRYPTION_KEY) return Response.redirect(new URL("/?googleCalendarConnection=not-configured", request.url));
  const row = await env.DB.prepare("SELECT data FROM workspace_documents WHERE id = 'f2b-agency'").first<{ data: string }>();
  if (!row) return Response.redirect(new URL("/?googleCalendarConnection=workspace-unavailable", request.url));
  const data = JSON.parse(row.data);
  const admin = data.ownerId === user.userId || data.staff?.some((person: { email?: string; role?: string }) => person.email?.toLowerCase() === user.email.toLowerCase() && ["Owner", "Admin"].includes(person.role || ""));
  if (!admin) return Response.redirect(new URL("/?googleCalendarConnection=admin-required", request.url));
  const state = `calendar:${crypto.randomUUID()}${crypto.randomUUID()}`;
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({ client_id: env.GOOGLE_ADS_CLIENT_ID, redirect_uri: `${new URL(request.url).origin}/api/google-ads/callback`, response_type: "code", scope: "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/userinfo.email", access_type: "offline", prompt: "consent", include_granted_scopes: "true", state }).toString();
  return new Response(null, { status: 302, headers: { Location: url.toString(), "Set-Cookie": `f2b_google_calendar_oauth_state=${state}; Max-Age=600; Path=/api/google-ads; Secure; HttpOnly; SameSite=Lax`, "Cache-Control": "no-store" } });
}
