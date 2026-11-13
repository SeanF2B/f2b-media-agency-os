import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";

// Community Lead Discovery (Operations → Local & community). Finds public Reddit / Quora questions through
// Google results via the agency's DataForSEO account — no scraping and no Reddit/Quora API. Results become a
// task for Grok to draft helpful replies; posting is manual after approval.
export const dynamic = "force-dynamic";
const respond = (body: Record<string, unknown>, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const LIMITS = { queriesPerRun: 4, daysBetweenRuns: 7, runsPerClientPerMonth: 4, workspaceRunsPerMonth: 40 };
const TABLE = "CREATE TABLE IF NOT EXISTS community_lead_runs (run_id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, client_id TEXT NOT NULL, created_at TEXT NOT NULL, queries_json TEXT NOT NULL, result_count INTEGER NOT NULL DEFAULT 0, provider_cost_usd REAL)";
const INDEX = "CREATE INDEX IF NOT EXISTS community_lead_runs_client_idx ON community_lead_runs (owner_id, client_id, created_at)";
type Client = { id: string; name: string; services?: Array<{ name: string }>; seoServices?: string[]; seoLocations?: string[] };

async function context(clientId: string) {
  const user = await getChatGPTUser();
  if (!user) return { response: respond({ error: "Sign in first." }, 401) };
  if (!env.DB) return { response: respond({ error: "The workspace database is unavailable." }, 503) };
  const row = await env.DB.prepare("SELECT owner_id, data FROM workspace_documents WHERE id = ?1").bind("f2b-agency").first<{ owner_id: string; data: string }>();
  if (!row) return { response: respond({ error: "The workspace is unavailable." }, 503) };
  const data = JSON.parse(row.data) as { ownerId?: string; staff?: Array<{ id?: string; email?: string; role?: string; isBot?: boolean }>; clients?: Client[] };
  const profile = (data.staff || []).find((item) => !item.isBot && (item.id === user.userId || item.email?.toLowerCase() === user.email.toLowerCase()));
  const admin = data.ownerId === user.userId || row.owner_id === user.userId || ["Owner", "Admin"].includes(profile?.role || "");
  if (!admin) return { response: respond({ error: "Only an owner or admin can run community discovery." }, 403) };
  const client = (data.clients || []).find((item) => item.id === clientId);
  if (!client) return { response: respond({ error: "Choose a client in this workspace." }, 404) };
  return { ownerId: String(data.ownerId || row.owner_id), client, db: env.DB };
}

async function usage(db: D1Database, ownerId: string, clientId: string) {
  const monthStart = new Date(); monthStart.setUTCDate(1); monthStart.setUTCHours(0, 0, 0, 0);
  try {
    const row = await db.prepare("SELECT (SELECT COUNT(*) FROM community_lead_runs WHERE owner_id=?1 AND client_id=?2 AND created_at>=?3) AS client_runs, (SELECT MAX(created_at) FROM community_lead_runs WHERE owner_id=?1 AND client_id=?2) AS last_run, (SELECT COUNT(*) FROM community_lead_runs WHERE owner_id=?1 AND created_at>=?3) AS all_runs, (SELECT COALESCE(SUM(provider_cost_usd),0) FROM community_lead_runs WHERE owner_id=?1 AND created_at>=?3) AS month_cost").bind(ownerId, clientId, monthStart.toISOString()).first<{ client_runs: number; last_run: string | null; all_runs: number; month_cost: number }>();
    return { clientRuns: Number(row?.client_runs || 0), lastRun: row?.last_run || null, workspaceRuns: Number(row?.all_runs || 0), monthCostUsd: Number(row?.month_cost || 0) };
  } catch { return { clientRuns: 0, lastRun: null, workspaceRuns: 0, monthCostUsd: 0 }; } // table not created yet
}

function queriesFor(client: Client, custom: string[]) {
  const topics = (custom.length ? custom : [...(client.seoServices || []), ...(client.services || []).map((service) => service.name).filter((name) => !/ads|seo|crm|marketing|web design|sites|automation|misc|audit|research|setup|debug/i.test(name))]).map((item) => String(item).trim()).filter((item) => item.length >= 3).slice(0, 2);
  const area = (client.seoLocations || [])[0] || "Ireland";
  const base = topics.length ? topics : [client.name];
  return base.flatMap((topic) => [`site:reddit.com ${topic} ${area}`, `site:quora.com ${topic} ${area}`]).slice(0, LIMITS.queriesPerRun);
}

export async function GET(request: Request) {
  const ctx = await context(new URL(request.url).searchParams.get("clientId") || "");
  if ("response" in ctx) return ctx.response;
  const ready = Boolean(env.DATAFORSEO_API_LOGIN && env.DATAFORSEO_API_PASSWORD);
  return respond({ ready, limits: LIMITS, usage: await usage(ctx.db, ctx.ownerId, ctx.client.id), queries: queriesFor(ctx.client, []) });
}

export async function POST(request: Request) {
  let body: { clientId?: string; topics?: string[]; acknowledgeCost?: boolean };
  try { body = await request.json() as typeof body; } catch { return respond({ error: "Invalid request." }, 400); }
  const ctx = await context(String(body.clientId || ""));
  if ("response" in ctx) return ctx.response;
  const login = env.DATAFORSEO_API_LOGIN, password = env.DATAFORSEO_API_PASSWORD;
  if (!login || !password) return respond({ error: "DataForSEO isn’t connected (DATAFORSEO_API_LOGIN / DATAFORSEO_API_PASSWORD)." }, 503);
  const used = await usage(ctx.db, ctx.ownerId, ctx.client.id);
  if (used.lastRun && Date.now() - new Date(used.lastRun).getTime() < LIMITS.daysBetweenRuns * 86_400_000) return respond({ error: `Already searched for ${ctx.client.name} on ${new Date(used.lastRun).toLocaleDateString("en-IE")}. Next search allowed after ${LIMITS.daysBetweenRuns} days.`, usage: used }, 429);
  if (used.clientRuns >= LIMITS.runsPerClientPerMonth) return respond({ error: `Monthly limit reached for ${ctx.client.name} (${LIMITS.runsPerClientPerMonth} searches).`, usage: used }, 429);
  if (used.workspaceRuns >= LIMITS.workspaceRunsPerMonth) return respond({ error: `Workspace monthly limit reached (${LIMITS.workspaceRunsPerMonth} searches).`, usage: used }, 429);
  const topics = Array.isArray(body.topics) ? body.topics.map((item) => String(item).trim().slice(0, 60)).filter(Boolean).slice(0, 2) : [];
  const queries = queriesFor(ctx.client, topics);
  if (body.acknowledgeCost !== true) return respond({ status: "confirmation_required", queries, message: `This runs ${queries.length} paid Google searches through DataForSEO (a few cents).` }, 409);
  const auth = `Basic ${btoa(`${login}:${password}`)}`;
  const runs = await Promise.all(queries.map(async (keyword) => {
    try {
      const response = await fetch("https://api.dataforseo.com/v3/serp/google/organic/live/regular", { method: "POST", headers: { Authorization: auth, "Content-Type": "application/json" }, body: JSON.stringify([{ keyword, location_code: 2372, language_code: "en", depth: 20 }]), signal: AbortSignal.timeout(25_000) });
      const json = await response.json().catch(() => null) as any;
      const task = json?.tasks?.[0];
      const items = (task?.result?.[0]?.items || []).filter((item: any) => item?.type === "organic" && /^(https:\/\/(www\.|old\.)?reddit\.com\/r\/[^/]+\/comments\/|https:\/\/([a-z]+\.)?quora\.com\/)/i.test(String(item.url || "")));
      return { keyword, cost: typeof task?.cost === "number" ? task.cost : null, items: items.map((item: any) => ({ url: String(item.url), title: String(item.title || "").slice(0, 200), snippet: String(item.description || "").slice(0, 300), platform: /quora\.com/i.test(item.url) ? "Quora" : "Reddit" })) };
    } catch { return { keyword, cost: null, items: [] as Array<{ url: string; title: string; snippet: string; platform: string }>, error: true }; }
  }));
  const seen = new Set<string>();
  const results = runs.flatMap((run) => run.items).filter((item) => { const key = item.url.split("?")[0]; if (seen.has(key)) return false; seen.add(key); return true; }).slice(0, 15);
  const costs = runs.map((run) => run.cost).filter((cost): cost is number => cost != null);
  const cost = costs.length ? costs.reduce((sum, value) => sum + value, 0) : null;
  await ctx.db.prepare(TABLE).run(); await ctx.db.prepare(INDEX).run();
  await ctx.db.prepare("INSERT INTO community_lead_runs (run_id, owner_id, client_id, created_at, queries_json, result_count, provider_cost_usd) VALUES (?1,?2,?3,?4,?5,?6,?7)").bind(crypto.randomUUID(), ctx.ownerId, ctx.client.id, new Date().toISOString(), JSON.stringify(queries), results.length, cost).run();
  return respond({ results, queries, costUsd: cost, failed: runs.filter((run) => "error" in run).map((run) => run.keyword), usage: await usage(ctx.db, ctx.ownerId, ctx.client.id) });
}
