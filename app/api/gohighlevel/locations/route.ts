import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { getGhlAgencyAccessToken, getGhlRequestedScopes } from "@/lib/gohighlevel-oauth";
import { gohighlevelSetupConfigured } from "@/lib/integration-readiness.mjs";

export const dynamic = "force-dynamic";

async function adminOwner(user: { userId: string; email: string }) {
  const row = await env.DB?.prepare("SELECT data FROM workspace_documents WHERE id = 'f2b-agency'").first<{ data: string }>();
  if (!row) return null;
  const data = JSON.parse(row.data);
  const admin = data.ownerId === user.userId || data.staff?.some((person: { email?: string; role?: string }) => person.email?.toLowerCase() === user.email.toLowerCase() && ["Owner", "Admin"].includes(person.role || ""));
  return admin ? { ownerId: data.ownerId, data } : null;
}

async function listInstalledLocations(accessToken: string, companyId: string, locationId?: string) {
  const all: Array<{ _id?: string; locationId?: string; name?: string; isInstalled?: boolean }> = [];
  let pageToken = "";
  let installToFutureLocations: boolean | null = null;
  for (let page = 0; page < 100; page++) {
    const query = new URLSearchParams({ companyId, appId: env.GHL_APP_ID || "", isInstalled: "true", pageSize: "100" });
    if (locationId) query.set("locationId", locationId);
    if (pageToken) query.set("pageToken", pageToken);
    const response = await fetch(`https://services.leadconnectorhq.com/oauth/installed-locations?${query}`, { headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json", Version: "v3" }, signal: AbortSignal.timeout(15000) });
    const payload = await response.json().catch(() => ({})) as { items?: Array<{ _id?: string; locationId?: string; name?: string; isInstalled?: boolean }>; pagination?: { nextPageToken?: string }; installToFutureLocations?: boolean; error?: string };
    if (!response.ok) throw new Error(response.status === 403 ? "HighLevel denied the installed-location list. Check the agency installation and Marketplace scopes." : `HighLevel returned HTTP ${response.status} while loading locations.`);
    all.push(...(payload.items || []));
    if (typeof payload.installToFutureLocations === "boolean") installToFutureLocations = payload.installToFutureLocations;
    const next = String(payload.pagination?.nextPageToken || "");
    if (!next || next === pageToken) break;
    pageToken = next;
  }
  return { locations: all, installToFutureLocations };
}

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in first." }, { status: 401 });
  if (!env.DB) return Response.json({ error: "The private workspace database is unavailable." }, { status: 503 });
  const access = await adminOwner(user);
  if (!access) return Response.json({ error: "Only an agency owner or admin can manage this connection." }, { status: 403 });
  const configured = gohighlevelSetupConfigured({ clientId: env.GHL_CLIENT_ID, clientSecret: env.GHL_CLIENT_SECRET, appId: env.GHL_APP_ID, redirectUri: env.GHL_REDIRECT_URI, encryptionKey: env.GOOGLE_ADS_TOKEN_ENCRYPTION_KEY });
  try {
    const agency = await getGhlAgencyAccessToken(access.ownerId);
    const installed = await listInstalledLocations(agency.accessToken, agency.companyId);
    const links = await env.DB.prepare("SELECT client_id, location_id, location_name FROM gohighlevel_location_links WHERE owner_id = ?1").bind(access.ownerId).all<{ client_id: string; location_id: string; location_name: string }>();
    const mapped = new Map((links.results || []).map((row) => [row.client_id, row]));
    const locations = installed.locations.map((location) => ({ id: String(location.locationId || location._id || ""), name: String(location.name || "Unnamed sub-account") })).filter((location) => location.id);
    return Response.json({ configured, connected: true, companyId: agency.companyId, locations, installToFutureLocations: installed.installToFutureLocations, links: Object.fromEntries(mapped.entries()), callbackUrl: `${new URL(request.url).origin}/api/oauth/callback`, requestedScopes: getGhlRequestedScopes() }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    const existing = await env.DB.prepare("SELECT company_id, scopes, connected_at FROM gohighlevel_agency_connections WHERE owner_id = ?1").bind(access.ownerId).first<{ company_id: string; scopes: string; connected_at: string }>();
    if (!existing) return Response.json({ configured, connected: false, locations: [], links: {}, callbackUrl: `${new URL(request.url).origin}/api/oauth/callback`, requestedScopes: getGhlRequestedScopes() }, { headers: { "Cache-Control": "no-store" } });
    return Response.json({ configured, connected: true, error: error instanceof Error ? error.message : "Could not load HighLevel sub-accounts.", locations: [], links: {}, companyId: existing.company_id, scopes: existing.scopes, connectedAt: existing.connected_at, callbackUrl: `${new URL(request.url).origin}/api/oauth/callback`, requestedScopes: getGhlRequestedScopes() }, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in first." }, { status: 401 });
  if (!env.DB) return Response.json({ error: "The private workspace database is unavailable." }, { status: 503 });
  const access = await adminOwner(user);
  if (!access) return Response.json({ error: "Only an agency owner or admin can manage this connection." }, { status: 403 });
  const body = await request.json().catch(() => ({})) as { clientId?: string; locationId?: string };
  const clientId = String(body.clientId || "");
  const locationId = String(body.locationId || "");
  if (!access.data.clients?.some((client: { id: string }) => client.id === clientId)) return Response.json({ error: "Choose a client in this workspace." }, { status: 404 });
  try {
    const agency = await getGhlAgencyAccessToken(access.ownerId);
    const installed = await listInstalledLocations(agency.accessToken, agency.companyId, locationId);
    const location = installed.locations.find((item) => String(item.locationId || item._id || "") === locationId);
    if (!location) return Response.json({ error: "That sub-account is not installed for the connected HighLevel app. Install the app there first." }, { status: 400 });
    const now = new Date().toISOString();
    await env.DB.prepare("INSERT INTO gohighlevel_location_links (owner_id, client_id, location_id, location_name, linked_at) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(owner_id, client_id) DO UPDATE SET location_id = excluded.location_id, location_name = excluded.location_name, linked_at = excluded.linked_at").bind(access.ownerId, clientId, locationId, String(location.name || ""), now).run();
    // Minting a location token verifies the consent includes usable location scopes.
    const locationToken = await fetch("https://services.leadconnectorhq.com/oauth/location-token", { method: "POST", headers: { Authorization: `Bearer ${agency.accessToken}`, "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json", Version: "v3" }, body: new URLSearchParams({ companyId: agency.companyId, locationId }), signal: AbortSignal.timeout(15000) });
    if (!locationToken.ok) {
      await env.DB.prepare("DELETE FROM gohighlevel_location_links WHERE owner_id = ?1 AND client_id = ?2").bind(access.ownerId, clientId).run();
      return Response.json({ error: "HighLevel could not issue a location token. Reinstall the app with the requested sub-account scopes." }, { status: 403 });
    }
    return Response.json({ ok: true, locationId, locationName: String(location.name || "") }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return Response.json({ error: error instanceof Error ? error.message : "Could not link HighLevel sub-account." }, { status: 502 }); }
}
