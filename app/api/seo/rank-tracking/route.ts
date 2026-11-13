import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../../chatgpt-auth";

// Google rank tracking (Operations → SEO & competitors → Rank tracking). Location-specific Google SERP positions
// from DataForSEO — separate from Search Console's average position. Checks run on demand, at most once a day
// per keyword, with a per-client keyword cap so costs stay small and predictable.
export const dynamic = "force-dynamic";
const respond = (body: Record<string, unknown>, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const LIMITS = { keywordsPerClient: 50, checksPerKeywordPerDay: 1 };
const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS seo_rank_keywords (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, client_id TEXT NOT NULL, keyword TEXT NOT NULL, location TEXT NOT NULL, device TEXT NOT NULL, grp TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, UNIQUE (owner_id, client_id, keyword, location, device))",
  "CREATE TABLE IF NOT EXISTS seo_rank_checks (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, keyword_id TEXT NOT NULL, checked_at TEXT NOT NULL, position INTEGER, url TEXT, competitors_json TEXT NOT NULL DEFAULT '{}', cost_usd REAL, error TEXT)",
  "CREATE INDEX IF NOT EXISTS seo_rank_checks_kw_idx ON seo_rank_checks (owner_id, keyword_id, checked_at)",
  "CREATE INDEX IF NOT EXISTS seo_rank_keywords_client_idx ON seo_rank_keywords (owner_id, client_id)",
];
type Client = { id: string; name: string; website?: string; wordpressSiteUrl?: string; seoCompetitors?: string[] };
const hostOf = (value?: string) => { try { return value ? new URL(/^https?:\/\//.test(value) ? value : `https://${value}`).hostname.replace(/^www\./, "").toLowerCase() : ""; } catch { return ""; } };

async function context(clientId: string) {
  const user = await getChatGPTUser();
  if (!user) return { response: respond({ error: "Sign in first." }, 401) };
  if (!env.DB) return { response: respond({ error: "The workspace database is unavailable." }, 503) };
  const row = await env.DB.prepare("SELECT owner_id, json_extract(data, '$.ownerId') AS owner, json_extract(data, '$.staff') AS staff, json_extract(data, '$.clients') AS clients FROM workspace_documents WHERE id = ?1").bind("f2b-agency").first<{ owner_id: string; owner: string; staff: string; clients: string }>();
  if (!row) return { response: respond({ error: "The workspace is unavailable." }, 503) };
  const staff = JSON.parse(row.staff || "[]") as Array<{ id?: string; email?: string; role?: string; isBot?: boolean }>;
  const profile = staff.find((item) => !item.isBot && (item.id === user.userId || item.email?.toLowerCase() === user.email.toLowerCase()));
  if (!(row.owner === user.userId || row.owner_id === user.userId || ["Owner", "Admin"].includes(profile?.role || ""))) return { response: respond({ error: "Only an owner or admin can use rank tracking." }, 403) };
  const client = (JSON.parse(row.clients || "[]") as Client[]).find((item) => item.id === clientId);
  if (!client) return { response: respond({ error: "Choose a client in this workspace." }, 404) };
  return { ownerId: String(row.owner || row.owner_id), client, db: env.DB };
}

async function list(db: D1Database, ownerId: string, clientId: string) {
  try {
    const keywords = (await db.prepare("SELECT id, keyword, location, device, grp FROM seo_rank_keywords WHERE owner_id = ?1 AND client_id = ?2 ORDER BY grp, keyword").bind(ownerId, clientId).all<{ id: string; keyword: string; location: string; device: string; grp: string }>()).results || [];
    if (!keywords.length) return [];
    const checks = (await db.prepare(`SELECT keyword_id, checked_at, position, url, competitors_json, error FROM seo_rank_checks WHERE owner_id = ?1 AND keyword_id IN (${keywords.map((_, i) => `?${i + 2}`).join(",")}) ORDER BY checked_at DESC LIMIT 2000`).bind(ownerId, ...keywords.map((item) => item.id)).all<{ keyword_id: string; checked_at: string; position: number | null; url: string | null; competitors_json: string; error: string | null }>()).results || [];
    return keywords.map((kw) => { const history = checks.filter((c) => c.keyword_id === kw.id).slice(0, 30).map((c) => ({ at: c.checked_at, position: c.position, url: c.url, competitors: JSON.parse(c.competitors_json || "{}"), error: c.error })); return { ...kw, history }; });
  } catch { return []; }
}

export async function GET(request: Request) {
  const ctx = await context(new URL(request.url).searchParams.get("clientId") || "");
  if ("response" in ctx) return ctx.response;
  return respond({ keywords: await list(ctx.db, ctx.ownerId, ctx.client.id), limits: LIMITS, clientHost: hostOf(ctx.client.website || ctx.client.wordpressSiteUrl), ready: Boolean(env.DATAFORSEO_API_LOGIN && env.DATAFORSEO_API_PASSWORD) });
}

export async function POST(request: Request) {
  let body: { clientId?: string; action?: string; keywords?: string[]; location?: string; device?: string; group?: string; ids?: string[]; competitors?: string[]; acknowledgeCost?: boolean };
  try { body = await request.json() as typeof body; } catch { return respond({ error: "Invalid request." }, 400); }
  const ctx = await context(String(body.clientId || ""));
  if ("response" in ctx) return ctx.response;
  for (const sql of SCHEMA) await ctx.db.prepare(sql).run();
  const now = new Date().toISOString();
  if (body.action === "add") {
    const keywords = [...new Set((body.keywords || []).map((item) => String(item).trim().toLowerCase().slice(0, 120)).filter(Boolean))];
    const location = String(body.location || "Ireland").trim().slice(0, 120), device = body.device === "mobile" ? "mobile" : "desktop", grp = String(body.group || "").trim().slice(0, 60);
    const existing = await ctx.db.prepare("SELECT COUNT(*) AS n FROM seo_rank_keywords WHERE owner_id = ?1 AND client_id = ?2").bind(ctx.ownerId, ctx.client.id).first<{ n: number }>();
    const room = LIMITS.keywordsPerClient - Number(existing?.n || 0);
    if (room <= 0) return respond({ error: `This client already tracks ${LIMITS.keywordsPerClient} keywords (the limit).` }, 429);
    const add = keywords.slice(0, room);
    if (add.length) await ctx.db.batch(add.map((keyword) => ctx.db.prepare("INSERT OR IGNORE INTO seo_rank_keywords (id, owner_id, client_id, keyword, location, device, grp, created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)").bind(crypto.randomUUID(), ctx.ownerId, ctx.client.id, keyword, location, device, grp, now)));
    return respond({ added: add.length, skipped: keywords.length - add.length, keywords: await list(ctx.db, ctx.ownerId, ctx.client.id) });
  }
  if (body.action === "remove") {
    const ids = (body.ids || []).map(String).slice(0, 100);
    if (ids.length) await ctx.db.batch(ids.map((id) => ctx.db.prepare("DELETE FROM seo_rank_keywords WHERE owner_id = ?1 AND client_id = ?2 AND id = ?3").bind(ctx.ownerId, ctx.client.id, id)));
    return respond({ keywords: await list(ctx.db, ctx.ownerId, ctx.client.id) });
  }
  if (body.action !== "check") return respond({ error: "Unknown action." }, 400);
  const login = env.DATAFORSEO_API_LOGIN, password = env.DATAFORSEO_API_PASSWORD;
  if (!login || !password) return respond({ error: "DataForSEO isn’t connected." }, 503);
  const all = await list(ctx.db, ctx.ownerId, ctx.client.id);
  const dayAgo = Date.now() - 20 * 3_600_000;
  const due = all.filter((kw) => (!body.ids?.length || body.ids.includes(kw.id)) && !(kw.history[0] && !kw.history[0].error && new Date(kw.history[0].at).getTime() > dayAgo));
  if (!due.length) return respond({ error: "These keywords were already checked in the last day." }, 429);
  if (body.acknowledgeCost !== true) return respond({ status: "confirmation_required", count: due.length, message: `This runs ${due.length} paid Google ranking check${due.length === 1 ? "" : "s"} through DataForSEO (about $0.002 each).` }, 409);
  const host = hostOf(ctx.client.website || ctx.client.wordpressSiteUrl);
  if (!host) return respond({ error: "Add the client’s website in their profile so rankings can be matched." }, 400);
  const competitors = (body.competitors || ctx.client.seoCompetitors || []).map(hostOf).filter(Boolean).slice(0, 5);
  const auth = `Basic ${btoa(`${login}:${password}`)}`;
  const results: Array<{ id: string; position: number | null; url: string | null; competitors: Record<string, number | null>; cost: number | null; error: string | null }> = [];
  for (let i = 0; i < due.length; i += 10) {
    const chunk = due.slice(i, i + 10);
    await Promise.all(chunk.map(async (kw) => {
      try {
        const task: Record<string, unknown> = { keyword: kw.keyword, language_code: "en", device: kw.device, depth: 100 };
        if (/^ireland$/i.test(kw.location)) task.location_code = 2372; else task.location_name = kw.location;
        const response = await fetch("https://api.dataforseo.com/v3/serp/google/organic/live/regular", { method: "POST", headers: { Authorization: auth, "Content-Type": "application/json" }, body: JSON.stringify([task]), signal: AbortSignal.timeout(30_000) });
        const json = await response.json().catch(() => null) as any;
        const t = json?.tasks?.[0];
        if (!t || t.status_code !== 20000) throw new Error(t?.status_message || `HTTP ${response.status}`);
        const items = (t.result?.[0]?.items || []).filter((item: any) => item?.type === "organic");
        const find = (h: string) => items.find((item: any) => hostOf(item.url).endsWith(h));
        const mine = find(host);
        results.push({ id: kw.id, position: mine ? Number(mine.rank_group) : null, url: mine ? String(mine.url) : null, competitors: Object.fromEntries(competitors.map((h) => [h, find(h) ? Number(find(h).rank_group) : null])), cost: typeof t.cost === "number" ? t.cost : null, error: null });
      } catch (error) { results.push({ id: kw.id, position: null, url: null, competitors: {}, cost: null, error: error instanceof Error ? error.message.slice(0, 200) : "Failed" }); }
    }));
  }
  await ctx.db.batch(results.map((r) => ctx.db.prepare("INSERT INTO seo_rank_checks (id, owner_id, keyword_id, checked_at, position, url, competitors_json, cost_usd, error) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)").bind(crypto.randomUUID(), ctx.ownerId, r.id, now, r.position, r.url, JSON.stringify(r.competitors), r.cost, r.error)));
  return respond({ checked: results.length, costUsd: results.reduce((sum, r) => sum + (r.cost || 0), 0), keywords: await list(ctx.db, ctx.ownerId, ctx.client.id) });
}
