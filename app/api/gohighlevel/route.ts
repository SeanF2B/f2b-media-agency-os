import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";
import { encryptGhlToken, mapGhlPagesToCampaignUrls, readGhlLandingPageMap, verifyGhlConnection } from "@/lib/gohighlevel";
import { getGhlRequestedScopes } from "@/lib/gohighlevel-oauth";
import { gohighlevelSetupConfigured } from "@/lib/integration-readiness.mjs";

export const dynamic = "force-dynamic";

async function adminContext(user: { userId: string; email: string }) {
  const row = await env.DB?.prepare("SELECT data FROM workspace_documents WHERE id = 'f2b-agency'").first<{ data: string }>();
  if (!row) return null;
  const data = JSON.parse(row.data);
  const admin = data.ownerId === user.userId || data.staff?.some((person: { email?: string; role?: string }) => person.email?.toLowerCase() === user.email.toLowerCase() && ["Owner", "Admin"].includes(person.role || ""));
  return admin ? { data, ownerId: data.ownerId } : null;
}

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in before checking GoHighLevel." }, { status: 401 });
  if (!env.DB) return Response.json({ error: "The private workspace database is unavailable." }, { status: 503 });
  const access = await adminContext(user);
  if (!access) return Response.json({ error: "Only an agency owner or admin can manage GoHighLevel connections." }, { status: 403 });
  const clientId = new URL(request.url).searchParams.get("clientId") || "";
  if (!clientId || !access.data.clients?.some((client: { id: string }) => client.id === clientId)) return Response.json({ error: "Choose a client in this workspace." }, { status: 404 });
  const connection = await env.DB.prepare("SELECT location_id, location_name, linked_at FROM gohighlevel_location_links WHERE owner_id = ?1 AND client_id = ?2").bind(access.ownerId, clientId).first<{ location_id: string; location_name: string; linked_at: string }>().catch(() => null);
  const legacy = !connection ? await env.DB.prepare("SELECT location_id, location_name, connected_at, last_verified_at FROM gohighlevel_connections WHERE owner_id = ?1 AND client_id = ?2").bind(access.ownerId, clientId).first<{ location_id: string; location_name: string; connected_at: string; last_verified_at: string }>().catch(() => null) : null;
  const linked = connection || legacy;
  const wantPages = new URL(request.url).searchParams.get("pages") === "1";
  if (wantPages && linked) {
    try {
      const client = access.data.clients.find((item: { id: string }) => item.id === clientId);
      const rawPageMap = await readGhlLandingPageMap(access.ownerId, clientId, client.services || []);
      const pageMap = rawPageMap.status === "connected" ? mapGhlPagesToCampaignUrls(rawPageMap, client.services || []) : rawPageMap;
      return Response.json({ connection: { connected: true, locationId: linked.location_id, locationName: linked.location_name, connectedAt: "linked_at" in linked ? linked.linked_at : linked.connected_at, lastVerifiedAt: "last_verified_at" in linked ? linked.last_verified_at : "" }, pageMap }, { headers: { "Cache-Control": "no-store" } });
    } catch (error) {
      return Response.json({ connection: { connected: true, locationId: linked.location_id, locationName: linked.location_name }, error: error instanceof Error ? error.message : "Could not read GHL funnels." }, { status: 502, headers: { "Cache-Control": "no-store" } });
    }
  }
  const agency = await env.DB.prepare("SELECT company_id, scopes, connected_at FROM gohighlevel_agency_connections WHERE owner_id = ?1").bind(access.ownerId).first<{ company_id: string; scopes: string; connected_at: string }>().catch(() => null);
  const grantedScopes = String(agency?.scopes || "").split(/[\s,]+/).filter(Boolean);
  return Response.json({ configured: gohighlevelSetupConfigured({ clientId: env.GHL_CLIENT_ID, clientSecret: env.GHL_CLIENT_SECRET, appId: env.GHL_APP_ID, redirectUri: env.GHL_REDIRECT_URI, encryptionKey: env.GOOGLE_ADS_TOKEN_ENCRYPTION_KEY }), agencyConnected: Boolean(agency), companyId: agency?.company_id || "", scopes: grantedScopes, requestedScopes: getGhlRequestedScopes(), connection: linked ? { connected: true, locationId: linked.location_id, locationName: linked.location_name, connectedAt: "linked_at" in linked ? linked.linked_at : linked.connected_at, lastVerifiedAt: "last_verified_at" in linked ? linked.last_verified_at : "" } : { connected: false, locationId: "", locationName: "" }, permissions: grantedScopes, capabilities: { anyGrantedDocumentedApiEndpoint: true, findFunnelsAndPages: true, readPublishedPageUrl: true, editWorkflows: grantedScopes.includes("workflows.write"), configureGoogleAdsConversionActions: grantedScopes.includes("adPublishing.write"), editPageBuilder: false } }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in before connecting GoHighLevel." }, { status: 401 });
  if (!env.DB) return Response.json({ error: "The private workspace database is unavailable." }, { status: 503 });
  const access = await adminContext(user);
  if (!access) return Response.json({ error: "Only an agency owner or admin can connect GoHighLevel." }, { status: 403 });
  if (!env.GOOGLE_ADS_TOKEN_ENCRYPTION_KEY) return Response.json({ error: "Secure token storage is not configured on this app yet. The owner must set the Worker secret GOOGLE_ADS_TOKEN_ENCRYPTION_KEY before connecting any account." }, { status: 503 });
  try {
    const body = await request.json() as { clientId?: string; locationId?: string; token?: string };
    const clientId = String(body.clientId || "").trim().slice(0, 120);
    const locationId = String(body.locationId || "").trim().slice(0, 120);
    const token = String(body.token || "").trim();
    if (!clientId || !access.data.clients?.some((client: { id: string }) => client.id === clientId)) return Response.json({ error: "Choose a client in this workspace." }, { status: 404 });
    if (!/^[a-zA-Z0-9_-]{8,120}$/.test(locationId)) return Response.json({ error: "Enter the GHL sub-account Location ID (8–120 letters, numbers, hyphens or underscores)." }, { status: 400 });
    if (token.length < 20 || token.length > 5000 || /\s/.test(token)) return Response.json({ error: "Paste the Private Integration token exactly as HighLevel generated it." }, { status: 400 });
    const verified = await verifyGhlConnection(token, locationId);
    const encrypted = await encryptGhlToken(token);
    const now = new Date().toISOString();
    await env.DB.prepare("INSERT INTO gohighlevel_connections (owner_id, client_id, location_id, location_name, encrypted_token, token_iv, connected_at, last_verified_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?7) ON CONFLICT(owner_id, client_id) DO UPDATE SET location_id = excluded.location_id, location_name = excluded.location_name, encrypted_token = excluded.encrypted_token, token_iv = excluded.token_iv, connected_at = excluded.connected_at, last_verified_at = excluded.last_verified_at")
      .bind(access.ownerId, clientId, locationId, verified.name, encrypted.ciphertext, encrypted.iv, now).run();
    return Response.json({ ok: true, connection: { connected: true, locationId, locationName: verified.name, connectedAt: now, lastVerifiedAt: now }, funnelsFound: verified.funnelCount, capabilities: { findFunnelsAndPages: true, readPublishedPageUrl: true, editPageBuilder: false } }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not verify the GoHighLevel connection." }, { status: 502 });
  }
}

export async function DELETE(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in before disconnecting GoHighLevel." }, { status: 401 });
  if (!env.DB) return Response.json({ error: "The private workspace database is unavailable." }, { status: 503 });
  const access = await adminContext(user);
  if (!access) return Response.json({ error: "Only an agency owner or admin can disconnect GoHighLevel." }, { status: 403 });
  const clientId = new URL(request.url).searchParams.get("clientId") || "";
  if (!clientId || !access.data.clients?.some((client: { id: string }) => client.id === clientId)) return Response.json({ error: "Choose a client in this workspace." }, { status: 404 });
  await env.DB.prepare("DELETE FROM gohighlevel_location_links WHERE owner_id = ?1 AND client_id = ?2").bind(access.ownerId, clientId).run().catch(() => null);
  await env.DB.prepare("DELETE FROM gohighlevel_connections WHERE owner_id = ?1 AND client_id = ?2").bind(access.ownerId, clientId).run();
  return Response.json({ ok: true });
}
