import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { getTeamPermissions, type TeamPermissions } from "@/lib/access-permissions";
import { parseGoogleMapsLocalRank, type LocalMapsRank } from "@/lib/dataforseo-local-maps";

export const dynamic = "force-dynamic";
const respond = (body: Record<string, unknown>, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
type Workspace = { ownerId?: string; staff?: Array<{ isBot?: boolean; id?: string; email?: string; role?: string; permissions?: Partial<TeamPermissions>; clientAccessIds?: string[] }>; clients?: Array<{ id: string; name: string; wordpressSiteUrl?: string; website?: string; [key: string]: unknown }> };

async function accessFor(clientId: string) {
  const user = await getChatGPTUser();
  if (!user) return { response: respond({ status: "unauthorized", message: "Sign in to check local Google Maps rankings." }, 401) };
  if (!env.DB) return { response: respond({ status: "unavailable", message: "The workspace database is unavailable." }, 503) };
  const row = await env.DB.prepare("SELECT data FROM workspace_documents WHERE id = ?1").bind("f2b-agency").first<{ data: string }>();
  if (!row?.data) return { response: respond({ status: "unavailable", message: "The workspace is unavailable." }, 503) };
  const workspace = JSON.parse(row.data) as Workspace;
  const owner = workspace.ownerId === user.userId;
  const profile = (workspace.staff || []).find((item) => !item.isBot && (item.id === user.userId || item.email?.toLowerCase() === user.email.toLowerCase()));
  const admin = owner || ["Owner", "Admin"].includes(profile?.role || "");
  const permissions = owner ? { clients: true } : getTeamPermissions(profile?.role || "Viewer", profile?.permissions);
  const client = (workspace.clients || []).find((item) => item.id === clientId);
  if (!client) return { response: respond({ status: "not_found", message: "Choose a client in this workspace." }, 404) };
  if (!admin && (!permissions.clients || Array.isArray(profile?.clientAccessIds) && !profile.clientAccessIds.includes(clientId))) return { response: respond({ status: "forbidden", message: "You do not have access to this client’s SEO data." }, 403) };
  return { user, ownerId: String(workspace.ownerId || user.userId), client, admin, db: env.DB };
}

async function readMapsSerp(login: string, password: string, keyword: string, location: string) {
  const response = await fetch("https://api.dataforseo.com/v3/serp/google/maps/live/advanced", {
    method: "POST",
    headers: { Authorization: `Basic ${btoa(`${login}:${password}`)}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify([{ keyword, location_name: location, language_name: "English", se_domain: "google.ie", depth: 20, device: "desktop", search_places: false, search_this_area: true }]),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`DataForSEO returned HTTP ${response.status}. Check the connection and account balance.`);
  return response.json() as Promise<unknown>;
}

export async function GET(request: Request) {
  const clientId = new URL(request.url).searchParams.get("clientId") || "";
  const context = await accessFor(clientId);
  if ("response" in context) return context.response;
  if (!context.admin) return respond({ status: "forbidden", message: "Only an owner or admin can run paid local rank checks." }, 403);
  const rows = await context.db.prepare("SELECT run_id, created_at, location_name, business_name, domain, results_json, provider_cost_usd FROM seo_local_maps_rank_runs WHERE owner_id = ?1 AND client_id = ?2 ORDER BY created_at DESC LIMIT 20").bind(context.ownerId, context.client.id).all<{ run_id: string; created_at: string; location_name: string; business_name: string; domain: string; results_json: string; provider_cost_usd: number | null }>();
  const history = (rows.results || []).flatMap((row) => { try { return [{ id: row.run_id, createdAt: row.created_at, location: row.location_name, businessName: row.business_name, domain: row.domain, results: JSON.parse(row.results_json) as LocalMapsRank[], costUsd: row.provider_cost_usd }]; } catch { return []; } });
  const ready = Boolean(env.DATAFORSEO_API_LOGIN && env.DATAFORSEO_API_PASSWORD);
  return respond({ status: ready ? "ready" : "missing_connection", message: ready ? "Google Maps rank checks are ready. Each keyword check uses paid DataForSEO credits." : "Add DATAFORSEO_API_LOGIN and DATAFORSEO_API_PASSWORD as Cloudflare Worker secrets to enable paid Google Maps rank checks.", history });
}

export async function POST(request: Request) {
  let body: { clientId?: string; keywords?: string[]; location?: string; businessName?: string; domain?: string; acknowledgeProviderCharge?: boolean };
  try { body = await request.json() as typeof body; } catch { return respond({ status: "invalid_request", message: "The local rank request is not valid." }, 400); }
  const context = await accessFor(String(body.clientId || ""));
  if ("response" in context) return context.response;
  if (!context.admin) return respond({ status: "forbidden", message: "Only an owner or admin can run paid local rank checks." }, 403);
  if (body.acknowledgeProviderCharge !== true) return respond({ status: "confirmation_required", message: "This sends one paid Google Maps results request per keyword, up to five keywords. Confirm before running; DataForSEO returns the actual charge afterward." }, 400);
  const login = env.DATAFORSEO_API_LOGIN, password = env.DATAFORSEO_API_PASSWORD;
  if (!login || !password) return respond({ status: "missing_connection", message: "DataForSEO is not connected. Add DATAFORSEO_API_LOGIN and DATAFORSEO_API_PASSWORD as Worker secrets." }, 503);
  const keywords = Array.isArray(body.keywords) ? [...new Set(body.keywords.map((item) => String(item).trim().replace(/\s+/g, " ")).filter((item) => item.length >= 3 && item.length <= 120))].slice(0, 5) : [];
  const location = String(body.location || "").trim().replace(/\s+/g, " ").slice(0, 120);
  const businessName = String(body.businessName || context.client.name || "").trim().replace(/\s+/g, " ").slice(0, 120);
  const domainRaw = String(body.domain || context.client.wordpressSiteUrl || context.client.website || "").trim().slice(0, 255);
  let domain = "";
  if (domainRaw) { try { domain = new URL(domainRaw.includes("://") ? domainRaw : `https://${domainRaw}`).hostname.replace(/^www\./i, "").toLowerCase(); } catch { return respond({ status: "invalid_domain", message: "Enter a valid client website domain, such as example.ie." }, 400); } }
  if (!keywords.length) return respond({ status: "invalid_keywords", message: "Add at least one keyword phrase with three or more characters." }, 400);
  if (!location) return respond({ status: "invalid_location", message: "Enter a target town or area, such as Galway, Ireland." }, 400);
  if (!businessName && !domain) return respond({ status: "missing_match", message: "Add the exact Business Profile name or website domain so listings can be matched safely." }, 400);
  const run = await Promise.all(keywords.map(async (keyword) => {
    try {
      const parsed = parseGoogleMapsLocalRank(await readMapsSerp(login, password, keyword, location), { keyword, location, businessName, domain });
      if (parsed.statusCode !== 20000 || !parsed.result) return { keyword, error: parsed.message || "DataForSEO did not return Maps results.", costUsd: parsed.cost };
      return { keyword, result: parsed.result, costUsd: parsed.cost };
    } catch (error) { return { keyword, error: error instanceof Error ? error.message : "Could not check this local keyword.", costUsd: null }; }
  }));
  const results = run.flatMap((item) => "result" in item ? [item.result] : []);
  const failed = run.filter((item) => "error" in item);
  const knownCosts = run.map((item) => item.costUsd).filter((cost): cost is number => cost != null);
  const totalCost = knownCosts.length === run.length ? knownCosts.reduce((sum, cost) => sum + cost, 0) : null;
  if (!results.length) return respond({ status: "provider_error", message: failed.map((item) => `${item.keyword}: ${item.error}`).join("; ") || "No Maps results were returned.", providerCostUsd: totalCost, failed }, 502);
  const createdAt = new Date().toISOString(), runId = crypto.randomUUID();
  await context.db.prepare("INSERT INTO seo_local_maps_rank_runs (run_id, owner_id, client_id, created_at, location_name, business_name, domain, results_json, provider_cost_usd) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)").bind(runId, context.ownerId, context.client.id, createdAt, location, businessName, domain, JSON.stringify(results), totalCost).run();
  return respond({ status: failed.length ? "partial" : "connected", source: "DataForSEO Google Maps SERP", clientId: context.client.id, location, businessName, domain, count: results.length, requested: keywords.length, results, failed, providerCostUsd: totalCost, updatedAt: createdAt, historyId: runId, dataNote: "Google Maps ranking is a location- and device-specific snapshot, not a guaranteed position everywhere. Checks use the top 20 desktop map listings for the selected area. A missing match means the listing was not found in those returned results; matching uses the exact website domain first, then the supplied business name." });
}
