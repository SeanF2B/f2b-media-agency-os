import { env } from "cloudflare:workers";
import { authorizeAdmin, authorizeAdminOrSubAccount, respond } from "@/lib/settings-auth";
import { ensureContentTables, gbpConnection, listGooglePosts, syncGbpLocations } from "@/lib/content-publish";

// Google Business Profile for the Content calendar: connection status, locations matched to clients, live posts.
export const dynamic = "force-dynamic";

async function clients() {
  const row = await env.DB!.prepare("SELECT data FROM workspace_documents WHERE id='f2b-agency'").first<{ data: string }>();
  try { return (JSON.parse(row?.data || "{}").clients || []).map((c: any) => ({ id: String(c.id), name: String(c.name || ""), website: String(c.website || c.wordpressSiteUrl || ""), googleBusinessLocation: c.googleBusinessLocation })); } catch { return []; }
}

export async function GET(request: Request) {
  const auth = await authorizeAdminOrSubAccount("view Google Business posts", "CRM");
  if (auth.error) return auth.error;
  await ensureContentTables(env.DB!);
  const url = new URL(request.url);
  const clientId = url.searchParams.get("clientId") || "";
  if (url.searchParams.get("view") === "posts") {
    if (!clientId || (auth.scope && !auth.scope.includes(clientId))) return respond({ error: "Choose a client." }, 400);
    try { return respond(await listGooglePosts(auth.ownerId, clientId)); }
    catch (e) { return respond({ connected: true, matched: true, posts: [], error: e instanceof Error ? e.message : "Google posts couldn't be read." }); }
  }
  if (auth.scope) return respond({ error: "Agency only." }, 403);
  const conn = await gbpConnection(auth.ownerId);
  const locations = (await env.DB!.prepare("SELECT location, title, website, client_id FROM gbp_locations WHERE owner_id=?1 ORDER BY title").bind(auth.ownerId).all<any>()).results || [];
  return respond({ connected: Boolean(conn), email: conn?.account_email || "", locations: locations.map((l: any) => ({ location: l.location, title: l.title, website: l.website, clientId: l.client_id })) });
}

export async function POST(request: Request) {
  const auth = await authorizeAdmin("manage Google Business Profile");
  if (auth.error) return auth.error;
  await ensureContentTables(env.DB!);
  let b: any = {}; try { b = await request.json(); } catch { /* empty */ }
  if (b.action === "sync") { try { return respond({ ok: true, found: await syncGbpLocations(auth.ownerId, await clients()) }); } catch (e) { return respond({ error: e instanceof Error ? e.message : "Couldn't read your Business Profiles." }, 400); } }
  if (b.action === "match") {
    await env.DB!.prepare("UPDATE gbp_locations SET client_id='' WHERE owner_id=?1 AND client_id=?2").bind(auth.ownerId, String(b.clientId || "")).run();
    if (b.location) await env.DB!.prepare("UPDATE gbp_locations SET client_id=?3 WHERE owner_id=?1 AND location=?2").bind(auth.ownerId, String(b.location), String(b.clientId || "")).run();
    return respond({ ok: true });
  }
  return respond({ error: "Unknown action." }, 400);
}
