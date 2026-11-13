import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";
import { aiHeaders, resolveAiProvider } from "@/lib/ai-provider";

// Operations → AI visibility. Asks ChatGPT- and Claude-family models (through the agency's AI provider API) the
// questions a customer might ask, and records whether the client and competitors are mentioned, in what order,
// and which sites are cited. These are sampled API answers — not a fixed ranking and not the consumer apps.
export const dynamic = "force-dynamic";
const respond = (body: Record<string, unknown>, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const TABLE = "CREATE TABLE IF NOT EXISTS ai_visibility_checks (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, client_id TEXT NOT NULL, run_id TEXT NOT NULL, created_at TEXT NOT NULL, platform TEXT NOT NULL, model TEXT NOT NULL, prompt TEXT NOT NULL, location TEXT NOT NULL, web_search INTEGER NOT NULL, mentioned INTEGER NOT NULL, position INTEGER, cited INTEGER NOT NULL, competitors_json TEXT NOT NULL, citations_json TEXT NOT NULL, excerpt TEXT NOT NULL, error TEXT)";
const INDEX = "CREATE INDEX IF NOT EXISTS ai_visibility_checks_client_idx ON ai_visibility_checks (owner_id, client_id, created_at)";
const LIMITS = { promptsPerRun: 5, runsPerDay: 20 };
type Client = { id: string; name: string; company?: string; website?: string; wordpressSiteUrl?: string; seoLocations?: string[] };

async function context(clientId: string) {
  const user = await getChatGPTUser();
  if (!user) return { response: respond({ error: "Sign in first." }, 401) };
  if (!env.DB) return { response: respond({ error: "The workspace database is unavailable." }, 503) };
  const row = await env.DB.prepare("SELECT owner_id, json_extract(data, '$.ownerId') AS owner, json_extract(data, '$.staff') AS staff, json_extract(data, '$.clients') AS clients FROM workspace_documents WHERE id = ?1").bind("f2b-agency").first<{ owner_id: string; owner: string; staff: string; clients: string }>();
  if (!row) return { response: respond({ error: "The workspace is unavailable." }, 503) };
  const staff = JSON.parse(row.staff || "[]") as Array<{ id?: string; email?: string; role?: string; isBot?: boolean }>;
  const profile = staff.find((item) => !item.isBot && (item.id === user.userId || item.email?.toLowerCase() === user.email.toLowerCase()));
  if (!(row.owner === user.userId || row.owner_id === user.userId || ["Owner", "Admin"].includes(profile?.role || ""))) return { response: respond({ error: "Only an owner or admin can run AI visibility checks." }, 403) };
  const client = (JSON.parse(row.clients || "[]") as Client[]).find((item) => item.id === clientId);
  if (!client) return { response: respond({ error: "Choose a client in this workspace." }, 404) };
  return { ownerId: String(row.owner || row.owner_id), storeOwner: row.owner_id, client, db: env.DB };
}

const hostOf = (value?: string) => { try { return value ? new URL(/^https?:\/\//.test(value) ? value : `https://${value}`).hostname.replace(/^www\./, "") : ""; } catch { return ""; } };
const norm = (value: string) => value.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[’']/g, "");
function findFirst(text: string, names: string[]) {
  const hay = norm(text); let best = -1;
  for (const name of names.map((item) => norm(item.trim())).filter((item) => item.length >= 3)) { const at = hay.indexOf(name); if (at >= 0 && (best < 0 || at < best)) best = at; }
  return best;
}
function outputText(payload: any) {
  if (typeof payload?.output_text === "string") return payload.output_text;
  const parts: string[] = [];
  for (const item of payload?.output || []) for (const content of item?.content || []) if (typeof content?.text === "string") parts.push(content.text);
  return parts.join("\n");
}
function citationsOf(payload: any, text: string) {
  const urls = new Set<string>();
  for (const item of payload?.output || []) for (const content of item?.content || []) for (const note of content?.annotations || []) if (note?.url) urls.add(String(note.url));
  for (const match of text.matchAll(/https?:\/\/[^\s)\]>"']+/g)) urls.add(match[0].replace(/[.,;]+$/, ""));
  return [...urls].slice(0, 20);
}

export async function GET(request: Request) {
  const ctx = await context(new URL(request.url).searchParams.get("clientId") || "");
  if ("response" in ctx) return ctx.response;
  try {
    const rows = await ctx.db.prepare("SELECT run_id, created_at, platform, model, prompt, location, web_search, mentioned, position, cited, competitors_json, citations_json, excerpt, error FROM ai_visibility_checks WHERE owner_id = ?1 AND client_id = ?2 ORDER BY created_at DESC LIMIT 120").bind(ctx.ownerId, ctx.client.id).all();
    return respond({ checks: (rows.results || []).map((row: any) => ({ ...row, competitors: JSON.parse(row.competitors_json || "[]"), citations: JSON.parse(row.citations_json || "[]") })), limits: LIMITS });
  } catch { return respond({ checks: [], limits: LIMITS }); }
}

export async function POST(request: Request) {
  let body: { clientId?: string; prompts?: string[]; competitors?: string[]; location?: string; webSearch?: boolean; platforms?: string[] };
  try { body = await request.json() as typeof body; } catch { return respond({ error: "Invalid request." }, 400); }
  const ctx = await context(String(body.clientId || ""));
  if ("response" in ctx) return ctx.response;
  const provider = await resolveAiProvider(env, ctx.storeOwner);
  if (!provider) return respond({ error: "Connect an AI provider (OpenRouter) in Settings → API Keys first." }, 503);
  const prompts = (Array.isArray(body.prompts) ? body.prompts : []).map((item) => String(item).trim().slice(0, 300)).filter(Boolean).slice(0, LIMITS.promptsPerRun);
  if (!prompts.length) return respond({ error: "Add at least one question to test." }, 400);
  const competitors = (Array.isArray(body.competitors) ? body.competitors : []).map((item) => String(item).trim().slice(0, 80)).filter(Boolean).slice(0, 8);
  const location = String(body.location || ctx.client.seoLocations?.[0] || "Ireland").trim().slice(0, 80);
  const webSearch = body.webSearch !== false;
  await ctx.db.prepare(TABLE).run(); await ctx.db.prepare(INDEX).run();
  const since = new Date(Date.now() - 86_400_000).toISOString();
  const today = await ctx.db.prepare("SELECT COUNT(DISTINCT run_id) AS runs FROM ai_visibility_checks WHERE owner_id = ?1 AND created_at >= ?2").bind(ctx.ownerId, since).first<{ runs: number }>();
  if (Number(today?.runs || 0) >= LIMITS.runsPerDay) return respond({ error: `Daily limit reached (${LIMITS.runsPerDay} checks in 24 hours).` }, 429);

  // Platforms: through OpenRouter both families are available; with a direct OpenAI key only ChatGPT models.
  const platforms = [
    { key: "chatgpt", label: "ChatGPT (OpenAI API)", model: provider.name === "OpenRouter" ? String((env as any).AI_VISIBILITY_OPENAI_MODEL || "openai/chatgpt-4o-latest") : provider.model },
    ...(provider.name === "OpenRouter" ? [{ key: "claude", label: "Claude (Anthropic API)", model: String((env as any).AI_VISIBILITY_CLAUDE_MODEL || "anthropic/claude-sonnet-latest") }] : []),
  ].filter((platform) => !body.platforms?.length || body.platforms.includes(platform.key));
  const clientNames = [ctx.client.name, ctx.client.company || "", hostOf(ctx.client.website || ctx.client.wordpressSiteUrl)].filter(Boolean);
  const clientHost = hostOf(ctx.client.website || ctx.client.wordpressSiteUrl);
  const runId = crypto.randomUUID(); const at = new Date().toISOString();
  const jobs = prompts.flatMap((prompt) => platforms.map((platform) => ({ prompt, platform })));
  const results = await Promise.all(jobs.map(async ({ prompt, platform }) => {
    const model = webSearch && provider.name === "OpenRouter" ? `${platform.model}:online` : platform.model;
    try {
      const response = await fetch(`${provider.baseUrl}/responses`, { method: "POST", headers: aiHeaders(env, provider)!, body: JSON.stringify({ model, input: `${prompt}\n\n(I'm based in ${location}.)`, max_output_tokens: 900, store: false }), signal: AbortSignal.timeout(45_000) });
      const payload = await response.json().catch(() => null) as any;
      if (!response.ok) throw new Error(payload?.error?.message || `HTTP ${response.status}`);
      const text = outputText(payload);
      if (!text.trim()) throw new Error("Empty answer");
      const citations = citationsOf(payload, text);
      const clientAt = findFirst(text, clientNames);
      const comp = competitors.map((name) => ({ name, at: findFirst(text, [name, hostOf(name)].filter(Boolean)) })).filter((item) => item.at >= 0);
      const order = [...(clientAt >= 0 ? [{ name: "__client", at: clientAt }] : []), ...comp].sort((a, b) => a.at - b.at);
      const position = clientAt >= 0 ? order.findIndex((item) => item.name === "__client") + 1 : null;
      const cited = Boolean(clientHost) && citations.some((url) => hostOf(url).endsWith(clientHost));
      return { platform: platform.key, label: platform.label, model: String(payload?.model || model), prompt, mentioned: clientAt >= 0, position, cited, competitors: comp.sort((a, b) => a.at - b.at).map((item) => item.name), citations, excerpt: text.slice(0, 1500), error: "" };
    } catch (error) {
      return { platform: platform.key, label: platform.label, model, prompt, mentioned: false, position: null, cited: false, competitors: [] as string[], citations: [] as string[], excerpt: "", error: error instanceof Error ? error.message.slice(0, 200) : "Failed" };
    }
  }));
  await ctx.db.batch(results.map((r) => ctx.db.prepare("INSERT INTO ai_visibility_checks (id, owner_id, client_id, run_id, created_at, platform, model, prompt, location, web_search, mentioned, position, cited, competitors_json, citations_json, excerpt, error) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17)").bind(crypto.randomUUID(), ctx.ownerId, ctx.client.id, runId, at, r.platform, r.model, r.prompt, location, webSearch ? 1 : 0, r.mentioned ? 1 : 0, r.position, r.cited ? 1 : 0, JSON.stringify(r.competitors), JSON.stringify(r.citations), r.excerpt, r.error || null)));
  return respond({ runId, location, webSearch, results });
}
