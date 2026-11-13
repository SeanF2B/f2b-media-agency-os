import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../../chatgpt-auth";

export const dynamic = "force-dynamic";

// Starts Google Drive sign-in for the Media Library. Google returns to the shared /api/google-ads/callback,
// which hands "drive:" states to completeDriveConnection.
export async function GET(request: Request) {
  const back = (status: string) => Response.redirect(new URL(`/?page=Media%20Library&driveConnection=${status}`, request.url), 302);
  const user = await getChatGPTUser();
  if (!user) return back("sign-in-required");
  if (!env.DB || !env.GOOGLE_ADS_CLIENT_ID || !env.GOOGLE_ADS_CLIENT_SECRET || !env.GOOGLE_ADS_TOKEN_ENCRYPTION_KEY) return back("not-configured");
  const row = await env.DB.prepare("SELECT data FROM workspace_documents WHERE id = 'f2b-agency'").first<{ data: string }>();
  if (!row) return back("workspace-unavailable");
  const data = JSON.parse(row.data);
  const admin = data.ownerId === user.userId || data.staff?.some((person: { email?: string; role?: string }) => person.email?.toLowerCase() === user.email.toLowerCase() && ["Owner", "Admin"].includes(person.role || ""));
  if (!admin) return back("admin-required");
  const state = `drive:${crypto.randomUUID()}${crypto.randomUUID()}`;
  const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
  url.search = new URLSearchParams({ client_id: env.GOOGLE_ADS_CLIENT_ID, redirect_uri: `${new URL(request.url).origin}/api/google-ads/callback`, response_type: "code", scope: "https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/userinfo.email", access_type: "offline", prompt: "consent", include_granted_scopes: "true", state }).toString();
  return new Response(null, { status: 302, headers: { Location: url.toString(), "Set-Cookie": `f2b_google_drive_oauth_state=${state}; Max-Age=600; Path=/api/google-ads; Secure; HttpOnly; SameSite=Lax`, "Cache-Control": "no-store" } });
}
