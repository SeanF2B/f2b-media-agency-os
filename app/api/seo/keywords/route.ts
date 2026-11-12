import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { getTeamPermissions, type TeamPermissions } from "@/lib/access-permissions";
import { mergeDataForSeoDifficulty, parseDataForSeoDifficulty, parseDataForSeoIdeas, type DataForSeoKeywordIdea } from "@/lib/dataforseo-keywords";
import { competitorDomainIntersectionRequest, normalizePublicDomain, parseCompetitorKeywordIntersection, type CompetitorKeywordResult } from "@/lib/dataforseo-competitors";

export const dynamic = "force-dynamic";
const respond = (body: Record<string, unknown>, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
type WorkspaceForKeywordResearch = {
  ownerId?: string;
  staff?: Array<{ isBot?: boolean; id?: string; email?: string; role?: string; permissions?: Partial<TeamPermissions>; clientAccessIds?: string[] }>;
  clients?: Array<{ id: string; [key: string]: unknown }>;
};

async function accessFor(clientId: string) {
  const user = await getChatGPTUser();
  if (!user) return { response: respond({ status: "unauthorized", message: "Sign in to research SEO keywords." }, 401) };
  if (!env.DB) return { response: respond({ status: "unavailable", message: "The workspace database is unavailable." }, 503) };
  const row = await env.DB.prepare("SELECT data FROM workspace_documents WHERE id = ?1").bind("f2b-agency").first<{ data: string }>();
  if (!row?.data) return { response: respond({ status: "unavailable", message: "The workspace is unavailable." }, 503) };
  const workspace = JSON.parse(row.data) as WorkspaceForKeywordResearch;
  const owner = workspace.ownerId === user.userId;
  const profile = (workspace.staff || []).find((item) => !item.isBot && (item.id === user.userId || item.email?.toLowerCase() === user.email.toLowerCase()));
  const admin = owner || ["Owner", "Admin"].includes(profile?.role || "");
  const permissions = owner ? { clients: true } : getTeamPermissions(profile?.role || "Viewer", profile?.permissions);
  const client = (workspace.clients || []).find((item) => item.id === clientId);
  if (!client) return { response: respond({ status: "not_found", message: "Choose a client in this workspace." }, 404) };
  if (!admin && (!permissions.clients || (Array.isArray(profile?.clientAccessIds) && !profile.clientAccessIds.includes(clientId)))) return { response: respond({ status: "forbidden", message: "You do not have access to this client’s SEO data." }, 403) };
  return { user, ownerId: String(workspace.ownerId || user.userId), client, admin, db: env.DB };
}

export async function GET(request: Request) {
  const clientId = new URL(request.url).searchParams.get("clientId") || "";
  const context = await accessFor(clientId);
  if ("response" in context) return context.response;
  if (!context.admin) return respond({ status: "forbidden", message: "Only an owner or admin can run keyword research." }, 403);
  const rows = await context.db.prepare("SELECT run_id, created_at, location_name, seed_keywords_json, provider_cost_usd, results_json FROM seo_keyword_research_runs WHERE owner_id = ?1 AND client_id = ?2 ORDER BY created_at DESC LIMIT 20")
    .bind(context.ownerId, context.client.id).all<{ run_id: string; created_at: string; location_name: string; seed_keywords_json: string; provider_cost_usd: number | null; results_json: string }>();
  const history = (rows.results || []).flatMap((row) => {
    try { return [{ id: row.run_id, createdAt: row.created_at, location: row.location_name, seeds: JSON.parse(row.seed_keywords_json), costUsd: row.provider_cost_usd, results: JSON.parse(row.results_json) as DataForSeoKeywordIdea[] }]; }
    catch { return []; }
  });
  const ready = Boolean(env.DATAFORSEO_API_LOGIN && env.DATAFORSEO_API_PASSWORD);
  const competitorRows = await context.db.prepare("SELECT run_id, created_at, location_name, client_domain, request_count, competitors_json, provider_cost_usd FROM seo_competitor_keyword_research_runs WHERE owner_id = ?1 AND client_id = ?2 ORDER BY created_at DESC LIMIT 20")
    .bind(context.ownerId, context.client.id).all<{ run_id: string; created_at: string; location_name: string; client_domain: string; request_count: number; competitors_json: string; provider_cost_usd: number | null }>();
  const competitorHistory = (competitorRows.results || []).flatMap((row) => {
    try { return [{ id: row.run_id, createdAt: row.created_at, location: row.location_name, clientDomain: row.client_domain, requestCount: row.request_count, costUsd: row.provider_cost_usd, competitors: JSON.parse(row.competitors_json) as CompetitorKeywordResult[] }]; }
    catch { return []; }
  });
  return respond({ status: ready ? "ready" : "missing_connection", message: ready ? undefined : "Add DATAFORSEO_API_LOGIN and DATAFORSEO_API_PASSWORD as Cloudflare Worker secrets to enable keyword ideas, difficulty and competitor keyword gaps.", history, competitorHistory });
}

async function postDataForSeo(login: string, password: string, endpoint: string, body: unknown) {
  const response = await fetch(`https://api.dataforseo.com/v3/dataforseo_labs/google/${endpoint}/live`, {
    method: "POST",
    headers: { Authorization: `Basic ${btoa(`${login}:${password}`)}`, "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify([body]),
    signal: AbortSignal.timeout(30_000),
  });
  if (!response.ok) throw new Error(`DataForSEO returned HTTP ${response.status}. Check the connection and account balance.`);
  return response.json() as Promise<unknown>;
}

export async function POST(request: Request) {
  let body: { action?: string; clientId?: string; seeds?: string[]; competitors?: string[]; location?: string; acknowledgeProviderCharge?: boolean };
  try { body = await request.json() as typeof body; } catch { return respond({ status: "invalid_request", message: "The keyword request is not valid." }, 400); }
  const context = await accessFor(String(body.clientId || ""));
  if ("response" in context) return context.response;
  if (!context.admin) return respond({ status: "forbidden", message: "Only an owner or admin can run keyword research." }, 403);
  if (body.acknowledgeProviderCharge !== true) return respond({ status: "confirmation_required", message: "Confirm that this research may use paid DataForSEO credits. The actual cost is shown after the request." }, 400);
  const login = env.DATAFORSEO_API_LOGIN;
  const password = env.DATAFORSEO_API_PASSWORD;
  if (!login || !password) return respond({ status: "missing_connection", message: "DataForSEO is not connected yet. Add DATAFORSEO_API_LOGIN and DATAFORSEO_API_PASSWORD as Cloudflare Worker secrets." }, 503);
  if (body.action === "competitor_gaps") {
    if (body.acknowledgeProviderCharge !== true) return respond({ status: "confirmation_required", message: "Confirm that each competitor comparison may use one paid DataForSEO request. The actual provider cost will be shown after the check." }, 400);
    const sourceDomain = normalizePublicDomain(String(context.client.wordpressSiteUrl || context.client.website || ""));
    if (!sourceDomain) return respond({ status: "client_domain_missing", message: "Add this client’s public website domain to the client profile before checking competitor keywords." }, 409);
    const location = String(body.location || "").trim().replace(/\s+/g, " ").slice(0, 120);
    if (!location) return respond({ status: "invalid_location", message: "Enter a target location, such as Galway, Ireland." }, 400);
    const competitors = Array.isArray(body.competitors) ? [...new Set(body.competitors.map((item) => normalizePublicDomain(String(item))).filter((item): item is string => Boolean(item) && item !== sourceDomain))].slice(0, 3) : [];
    if (!competitors.length) return respond({ status: "invalid_competitors", message: "Add one to three valid competitor domains. Competitor URLs must be public websites, not search terms." }, 400);
    const results = await Promise.all(competitors.map(async (competitor): Promise<CompetitorKeywordResult> => {
      try {
        const payload = await postDataForSeo(login, password, "domain_intersection", competitorDomainIntersectionRequest(sourceDomain, competitor, location));
        return parseCompetitorKeywordIntersection(payload, competitor);
      } catch (error) {
        return { competitorDomain: competitor, status: "unavailable", message: error instanceof Error ? error.message : "Competitor results could not be loaded.", costUsd: null, totalCount: null, keywords: [] };
      }
    }));
    const providerCostUsd = results.every((result) => result.costUsd != null) ? results.reduce((sum, result) => sum + (result.costUsd || 0), 0) : null;
    const createdAt = new Date().toISOString();
    const runId = crypto.randomUUID();
    await context.db.prepare("INSERT INTO seo_competitor_keyword_research_runs (run_id, owner_id, client_id, created_at, location_name, client_domain, request_count, competitors_json, provider_cost_usd) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)")
      .bind(runId, context.ownerId, context.client.id, createdAt, location, sourceDomain, competitors.length, JSON.stringify(results), providerCostUsd).run();
    return respond({ status: results.some((result) => result.status === "connected") ? "connected" : "unavailable", clientId: context.client.id, clientDomain: sourceDomain, location, competitors: results, updatedAt: createdAt, historyId: runId, providerCostUsd, dataNote: "These are DataForSEO’s weekly organic ranking estimates for the selected location. A keyword gap means a competitor ranked in the returned dataset while the client did not; it is an opportunity to review, not proof of demand, leads, or a guaranteed ranking." });
  }
  const seeds = Array.isArray(body.seeds) ? [...new Set(body.seeds.map((item) => String(item).trim().replace(/\s+/g, " ")).filter((item) => item.length >= 3 && item.length <= 120))].slice(0, 10) : [];
  const location = String(body.location || "").trim().replace(/\s+/g, " ").slice(0, 120);
  if (!seeds.length) return respond({ status: "invalid_seeds", message: "Add at least one keyword phrase with three or more characters." }, 400);
  if (!location) return respond({ status: "invalid_location", message: "Enter a target location, such as Galway, Ireland." }, 400);
  try {
    const ideasPayload = await postDataForSeo(login, password, "keyword_ideas", { keywords: seeds, location_name: location, language_name: "English", closely_variants: true, limit: 50, order_by: ["relevance,desc"] });
    const parsedIdeas = parseDataForSeoIdeas(ideasPayload);
    if (parsedIdeas.statusCode !== 20000) return respond({ status: "provider_error", message: `DataForSEO: ${parsedIdeas.message || "Keyword ideas were not returned."}` }, 502);
    let results = parsedIdeas.ideas;
    let difficultyCost: number | null = null;
    let difficultyNote = "";
    if (results.length) {
      try {
        const difficultyPayload = await postDataForSeo(login, password, "bulk_keyword_difficulty", { keywords: results.map((item) => item.keyword).slice(0, 50), location_name: location, language_name: "English" });
        const parsedDifficulty = parseDataForSeoDifficulty(difficultyPayload);
        if (parsedDifficulty.statusCode === 20000) {
          results = mergeDataForSeoDifficulty(results, parsedDifficulty.difficulty);
          difficultyCost = parsedDifficulty.cost;
        } else difficultyNote = `Organic keyword difficulty was not returned: ${parsedDifficulty.message || "provider error"}.`;
      } catch (error) {
        difficultyNote = error instanceof Error ? `${error.message} Organic keyword difficulty is unavailable for this run.` : "Organic keyword difficulty was unavailable for this run.";
      }
    }
    const costUsd = (parsedIdeas.cost ?? 0) + (difficultyCost ?? 0);
    const createdAt = new Date().toISOString();
    const runId = crypto.randomUUID();
    await context.db.prepare("INSERT INTO seo_keyword_research_runs (run_id, owner_id, client_id, created_at, location_name, seed_keywords_json, provider_cost_usd, results_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)")
      .bind(runId, context.ownerId, context.client.id, createdAt, location, JSON.stringify(seeds), parsedIdeas.cost == null && difficultyCost == null ? null : costUsd, JSON.stringify(results)).run();
    return respond({ status: "connected", source: "DataForSEO", clientId: context.client.id, location, seeds, count: results.length, results, providerCostUsd: parsedIdeas.cost == null && difficultyCost == null ? null : costUsd, costs: { keywordIdeasUsd: parsedIdeas.cost, keywordDifficultyUsd: difficultyCost }, updatedAt: createdAt, dataNote: `Search volumes are approximate demand estimates. Paid competition describes advertising competition; SEO difficulty is DataForSEO’s organic top-10 ranking estimate. These are not current rankings or promised traffic.${difficultyNote ? ` ${difficultyNote}` : ""}`, historyId: runId });
  } catch (error) {
    const message = error instanceof Error && error.name === "TimeoutError" ? "DataForSEO took too long to respond. No result was confirmed; retry the research." : error instanceof Error ? error.message : "Could not reach DataForSEO.";
    console.error("DataForSEO keyword research failed", message);
    return respond({ status: "unavailable", message }, 502);
  }
}
