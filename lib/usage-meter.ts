import { AsyncLocalStorage } from "node:async_hooks";
import { SERVICES, serviceOf, type ServiceKey } from "./usage-services";

// AI & SEO-data usage metering for client rebilling.
// Every outgoing call to OpenRouter / OpenAI (text AI) and DataForSEO (keyword research, rank checks, backlinks,
// map ranks, audits) is intercepted once at the fetch layer, its real cost read from the response (or worked out
// from the model's published price), and logged against the client the request was for. Nothing about the call
// itself changes; logging runs after the response and never blocks or breaks it.

export type UsageContext = { clientId?: string; feature?: string; route?: string; actor?: string; waitUntil?: (p: Promise<unknown>) => void };
type Db = D1Database;

const store = new AsyncLocalStorage<UsageContext>();
export function runWithUsage<T>(ctx: UsageContext, run: () => T): T { return store.run({ ...(store.getStore() || {}), ...ctx }, run); }
export function usageContext(): UsageContext | undefined { return store.getStore(); }

const FEATURES: Array<[RegExp, string]> = [
  [/^\/api\/seo-suggest/, "SEO page suggestions & AI recommendations"], [/^\/api\/seo\/keywords/, "Keyword research"], [/^\/api\/seo\/keyword-seeds/, "Keyword ideas"],
  [/^\/api\/seo\/rank-tracking/, "Rank tracking"], [/^\/api\/seo\/local-rank/, "Local map rankings"], [/^\/api\/seo\/backlinks/, "Backlinks"], [/^\/api\/community-leads/, "Community lead discovery"],
  [/^\/api\/ai-visibility/, "AI visibility checks"], [/^\/api\/assistant/, "AI assistant"], [/^\/api\/ai-assist/, "AI polish & writing help"], [/^\/api\/ai-command/, "AI commands"], [/^\/api\/ai-employee/, "AI employees"],
  [/^\/api\/proposals/, "Proposals"], [/^\/api\/client-reports/, "Reports & audits"], [/^\/api\/setup-drafts/, "Setup wizards"], [/^\/api\/studio|^\/api\/marketing-studio/, "Content studio"],
  [/^\/api\/social-posts/, "Social posts"], [/^\/api\/email-marketing/, "Email marketing"], [/^\/api\/outreach/, "Outreach"], [/^\/api\/conversations|^\/api\/whatsapp/, "Conversation AI"],
  [/^\/api\/scheduling/, "Scheduling AI"], [/^\/api\/tasks|^\/api\/task-suggestions/, "Task AI"], [/^\/api\/media-library/, "Media library AI"], [/^\/api\/onboarding|^\/api\/marketing-public\/onboarding/, "Onboarding audits"],
  [/^\/api\/operating-world/, "Operating World"], [/^\/api\/marketing-public/, "Public funnels"],
];
export function featureFor(path: string) { for (const [re, label] of FEATURES) if (re.test(path)) return label; return path.replace(/^\/api\//, "").split("/")[0] || "Other"; }

/** What exactly the request asked for (e.g. "review", "polish", "website-audit"), for detailed usage lines. */
export async function actionFromRequest(request: Request): Promise<string> {
  const url = new URL(request.url);
  let v = url.searchParams.get("action") || url.searchParams.get("mode") || url.searchParams.get("kind") || url.searchParams.get("type") || "";
  if (!v && request.method === "POST" && /json/i.test(request.headers.get("content-type") || "") && Number(request.headers.get("content-length") || 0) < 512_000) {
    try { const b = await request.clone().json() as Record<string, unknown>; for (const k of ["mode", "action", "op", "kind", "type", "task", "tool"]) { if (typeof b?.[k] === "string" && b[k]) { v = String(b[k]); break; } } } catch { /* not JSON */ }
  }
  return v.replace(/[-_]/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().slice(0, 40);
}

/** Reads clientId from the query string or a JSON body, without consuming the original request. */
export async function clientIdFromRequest(request: Request): Promise<string> {
  const url = new URL(request.url);
  for (const k of ["clientId", "scopeClientId", "client", "client_id", "scopeId"]) { const v = url.searchParams.get(k); if (v && /^[\w-]{4,80}$/.test(v)) return v; }
  if (request.method === "POST" && /json/i.test(request.headers.get("content-type") || "") && Number(request.headers.get("content-length") || 0) < 512_000) {
    try {
      const body = await request.clone().json() as Record<string, unknown>;
      for (const k of ["clientId", "scopeClientId", "client_id", "scopeId"]) { const v = body?.[k]; if (typeof v === "string" && /^[\w-]{4,80}$/.test(v)) return v; }
    } catch { /* not JSON */ }
  }
  return "";
}

let installed = false;
let dbRef: Db | null = null;
const original = globalThis.fetch;
const isAi = (u: URL) => (u.hostname === "openrouter.ai" && /\/api\/v1\/(responses|chat\/completions)$/.test(u.pathname)) || (u.hostname === "api.openai.com" && /\/v1\/(responses|chat\/completions)$/.test(u.pathname));
const isSeoData = (u: URL) => u.hostname === "api.dataforseo.com" && u.pathname.startsWith("/v3/") && !/\/v3\/appendix\//.test(u.pathname);
const formField = (init: RequestInit | undefined, key: string) => { const b = init?.body; if (b instanceof URLSearchParams) return b.get(key) || ""; if (typeof b === "string") { try { return new URLSearchParams(b).get(key) || ""; } catch { return ""; } } return ""; };
/** Twilio / Resend calls that cost money: which service and how many units. */
function unitCall(u: URL, init: RequestInit | undefined): { kind: ServiceKey; provider: string } | null {
  const post = String(init?.method || "GET").toUpperCase() === "POST";
  if (!post) return null;
  if (u.hostname === "api.twilio.com" && /\/Messages\.json$/.test(u.pathname)) return { kind: /^whatsapp:/i.test(formField(init, "To")) ? "whatsapp" : "sms", provider: "Twilio" };
  if (u.hostname === "api.twilio.com" && /\/IncomingPhoneNumbers\.json$/.test(u.pathname)) return { kind: "phone_number", provider: "Twilio" };
  if (u.hostname === "api.resend.com" && /^\/emails(\/batch)?$/.test(u.pathname)) return { kind: "email", provider: "Resend" };
  return null;
}

/** Patch fetch once per isolate. Safe to call on every request. */
export function installUsageMeter(db: Db | undefined) {
  if (db) dbRef = db;
  if (installed || !db) return;
  installed = true;
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const response = await original(input as never, init);
    try {
      const raw = typeof input === "string" ? input : input instanceof URL ? input.href : (input as Request).url;
      const u = new URL(raw);
      const ai = isAi(u), seo = !ai && isSeoData(u), unit = !ai && !seo ? unitCall(u, init) : null;
      if (unit && response.ok && dbRef) {
        const ctx = store.getStore() || {};
        let units = 1;
        if (unit.kind === "email" && /batch$/.test(u.pathname)) { try { const b = typeof init?.body === "string" ? JSON.parse(init.body) : null; units = Array.isArray(b) ? b.length || 1 : 1; } catch { /* 1 */ } }
        const job = (async () => { if (unit.kind === "sms") { try { const j = await response.clone().json() as { num_segments?: string }; units = Math.max(1, Number(j.num_segments) || 1); } catch { /* 1 */ } } await logUsageEvent(dbRef!, { clientId: ctx.clientId, kind: unit.kind, units, provider: unit.provider, endpoint: u.pathname.replace(/AC[0-9a-f]{32}/i, "AC…").slice(0, 120), feature: ctx.feature || (ctx.route ? featureFor(ctx.route) : "Background"), route: ctx.route, actor: ctx.actor }); })().catch((e) => console.error("usage meter", e));
        if (ctx.waitUntil) ctx.waitUntil(job);
      }
      if ((ai || seo) && response.ok && dbRef) {
        const ctx = store.getStore() || {};
        let model = "";
        if (ai) { try { const body = typeof init?.body === "string" ? JSON.parse(init.body) : null; model = String(body?.model || ""); } catch { /* ignore */ } }
        const job = record(dbRef, ctx, { kind: ai ? "ai" : "seo_data", provider: u.hostname === "api.dataforseo.com" ? "DataForSEO" : u.hostname === "openrouter.ai" ? "OpenRouter" : "OpenAI", endpoint: u.pathname.slice(0, 120), model }, response.clone()).catch((e) => console.error("usage meter", e));
        if (ctx.waitUntil) ctx.waitUntil(job);
      }
    } catch { /* metering must never affect the call */ }
    return response;
  }) as typeof fetch;
}

async function readUsage(res: Response): Promise<{ input: number; output: number; cost: number | null; model: string; tasks: number }> {
  const type = res.headers.get("content-type") || "";
  const text = await res.text();
  let docs: any[] = [];
  if (/event-stream/.test(type) || /^data:/m.test(text.slice(0, 200))) {
    for (const line of text.split("\n")) { const t = line.replace(/^data:\s*/, "").trim(); if (t.startsWith("{")) { try { docs.push(JSON.parse(t)); } catch { /* partial */ } } }
  } else { try { docs = [JSON.parse(text)]; } catch { docs = []; } }
  let input = 0, output = 0, cost: number | null = null, model = "", tasks = 0;
  for (const d of docs) {
    const usage = d?.usage || d?.response?.usage;
    if (usage) {
      input = Number(usage.input_tokens ?? usage.prompt_tokens ?? input) || input;
      output = Number(usage.output_tokens ?? usage.completion_tokens ?? output) || output;
      if (usage.cost != null && Number.isFinite(Number(usage.cost))) cost = Number(usage.cost);
    }
    if (d?.model || d?.response?.model) model = String(d.model || d.response.model);
    if (d?.cost != null && d?.tasks) { cost = Number(d.cost) || 0; tasks = Number(d.tasks_count || d.tasks?.length || 0); } // DataForSEO
  }
  return { input, output, cost, model, tasks };
}

let ready: Promise<unknown> | null = null;
export function ensureUsageTables(db: Db) {
  ready ||= db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS usage_log (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL DEFAULT '', client_id TEXT NOT NULL DEFAULT '', kind TEXT NOT NULL, provider TEXT NOT NULL, feature TEXT NOT NULL DEFAULT '', route TEXT NOT NULL DEFAULT '', endpoint TEXT NOT NULL DEFAULT '', model TEXT NOT NULL DEFAULT '', input_tokens INTEGER NOT NULL DEFAULT 0, output_tokens INTEGER NOT NULL DEFAULT 0, cost_usd REAL NOT NULL DEFAULT 0, cost_source TEXT NOT NULL DEFAULT '', actor TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, invoice_id TEXT NOT NULL DEFAULT '')"),
    db.prepare("CREATE INDEX IF NOT EXISTS usage_log_client ON usage_log (owner_id, client_id, created_at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS usage_log_time ON usage_log (owner_id, created_at)"),
    db.prepare("CREATE TABLE IF NOT EXISTS usage_billing_settings (owner_id TEXT PRIMARY KEY, enabled INTEGER NOT NULL DEFAULT 1, markup_pct REAL NOT NULL DEFAULT 100, usd_rate REAL NOT NULL DEFAULT 0.92, include_seo_data INTEGER NOT NULL DEFAULT 1, min_charge REAL NOT NULL DEFAULT 0, updated_at TEXT NOT NULL DEFAULT '', updated_by TEXT NOT NULL DEFAULT '')"),
    db.prepare("CREATE TABLE IF NOT EXISTS usage_billing_clients (owner_id TEXT NOT NULL, client_id TEXT NOT NULL, markup_pct REAL, enabled INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL DEFAULT '', updated_by TEXT NOT NULL DEFAULT '', PRIMARY KEY (owner_id, client_id))"),
    db.prepare("CREATE TABLE IF NOT EXISTS usage_billing_audit (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, client_id TEXT NOT NULL DEFAULT '', action TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '{}', actor TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL)"),
    db.prepare("CREATE INDEX IF NOT EXISTS usage_billing_audit_time ON usage_billing_audit (owner_id, created_at)"),
    db.prepare("CREATE TABLE IF NOT EXISTS usage_services (owner_id TEXT NOT NULL, service TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, markup_pct REAL, unit_cost_usd REAL, updated_at TEXT NOT NULL DEFAULT '', updated_by TEXT NOT NULL DEFAULT '', PRIMARY KEY (owner_id, service))"),
    db.prepare("CREATE TABLE IF NOT EXISTS usage_client_services (owner_id TEXT NOT NULL, client_id TEXT NOT NULL, service TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL DEFAULT '', updated_by TEXT NOT NULL DEFAULT '', PRIMARY KEY (owner_id, client_id, service))"),
    db.prepare("CREATE INDEX IF NOT EXISTS usage_log_kind ON usage_log (owner_id, kind, created_at)"),
    db.prepare("CREATE TABLE IF NOT EXISTS usage_model_prices (model TEXT PRIMARY KEY, prompt REAL NOT NULL, completion REAL NOT NULL, fetched_at TEXT NOT NULL)"),
  ]).catch((e) => { ready = null; throw e; });
  return ready;
}

let ownerCache: { id: string; at: number } | null = null;
async function ownerId(db: Db) {
  if (ownerCache && Date.now() - ownerCache.at < 600_000) return ownerCache.id;
  const row = await db.prepare("SELECT owner_id, json_extract(data, '$.ownerId') AS o FROM workspace_documents WHERE id = 'f2b-agency'").first<{ owner_id: string; o: string | null }>();
  ownerCache = { id: String(row?.owner_id || row?.o || ""), at: Date.now() }; // same precedence as authorizeAdmin
  return ownerCache.id;
}

/** USD per token for a model, from OpenRouter's public price list (refreshed daily). */
async function priceFor(db: Db, model: string): Promise<{ prompt: number; completion: number } | null> {
  if (!model) return null;
  const hit = await db.prepare("SELECT prompt, completion, fetched_at FROM usage_model_prices WHERE model = ?1").bind(model).first<{ prompt: number; completion: number; fetched_at: string }>();
  if (hit && Date.now() - Date.parse(hit.fetched_at) < 86_400_000) return hit;
  try {
    const res = await original("https://openrouter.ai/api/v1/models", { signal: AbortSignal.timeout(8000) });
    const j = await res.json() as { data?: Array<{ id: string; pricing?: { prompt?: string; completion?: string } }> };
    const now = new Date().toISOString();
    const rows = (j.data || []).filter((m) => m.pricing).map((m) => db.prepare("INSERT INTO usage_model_prices (model, prompt, completion, fetched_at) VALUES (?1,?2,?3,?4) ON CONFLICT(model) DO UPDATE SET prompt=excluded.prompt, completion=excluded.completion, fetched_at=excluded.fetched_at").bind(m.id, Number(m.pricing!.prompt) || 0, Number(m.pricing!.completion) || 0, now));
    for (let i = 0; i < rows.length; i += 80) await db.batch(rows.slice(i, i + 80));
  } catch { /* use the stale price if any */ }
  return await db.prepare("SELECT prompt, completion FROM usage_model_prices WHERE model = ?1").bind(model).first<{ prompt: number; completion: number }>() || hit || null;
}

async function record(db: Db, ctx: UsageContext, call: { kind: "ai" | "seo_data"; provider: string; endpoint: string; model: string }, res: Response) {
  await ensureUsageTables(db);
  const u = await readUsage(res);
  const model = u.model || call.model;
  let cost = u.cost, source = cost != null ? "provider" : "";
  if (cost == null && call.kind === "ai" && (u.input || u.output)) {
    const p = await priceFor(db, model.includes("/") ? model : `openai/${model}`);
    if (p) { cost = u.input * p.prompt + u.output * p.completion; source = "price-list"; }
  }
  if (cost == null) { cost = 0; source = "unknown"; }
  await db.prepare("INSERT INTO usage_log (id, owner_id, client_id, kind, provider, feature, route, endpoint, model, input_tokens, output_tokens, cost_usd, cost_source, actor, created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15)")
    .bind(crypto.randomUUID(), await ownerId(db), String(ctx.clientId || ""), call.kind, call.provider, String(ctx.feature || (ctx.route ? featureFor(ctx.route) : "Background")).slice(0, 80), String(ctx.route || "").slice(0, 120), call.endpoint, model.slice(0, 120), u.input, u.output, Math.round(cost * 1e6) / 1e6, source, String(ctx.actor || "system").slice(0, 160), new Date().toISOString()).run();
}

// Unit costs per service, cached per isolate for 5 minutes (keeps D1 reads low).
let unitCache: { owner: string; at: number; costs: Map<string, number> } | null = null;
export function clearUnitCostCache() { unitCache = null; }
async function unitCost(db: Db, owner: string, kind: ServiceKey) {
  if (!unitCache || unitCache.owner !== owner || Date.now() - unitCache.at > 300_000) {
    const rows = (await db.prepare("SELECT service, unit_cost_usd FROM usage_services WHERE owner_id = ?1").bind(owner).all<{ service: string; unit_cost_usd: number | null }>()).results || [];
    unitCache = { owner, at: Date.now(), costs: new Map(rows.filter((r) => r.unit_cost_usd != null).map((r) => [r.service, Number(r.unit_cost_usd)])) };
  }
  return unitCache.costs.get(kind) ?? serviceOf(kind)?.defaultUnitUsd ?? 0;
}

/** Log a unit-priced event (WhatsApp/SMS message, call minutes, phone number, email). Pass `id` to make it idempotent (e.g. one row per call). */
export async function logUsageEvent(db: Db, e: { clientId?: string; kind: ServiceKey; units: number; provider: string; feature?: string; endpoint?: string; route?: string; actor?: string; id?: string }) {
  await ensureUsageTables(db);
  const owner = await ownerId(db);
  const units = Math.max(0, Math.round(e.units * 100) / 100);
  const cost = Math.round(units * await unitCost(db, owner, e.kind) * 1e6) / 1e6;
  const feature = String(e.feature || serviceOf(e.kind)?.label || e.kind).slice(0, 80);
  await db.prepare("INSERT INTO usage_log (id, owner_id, client_id, kind, provider, feature, route, endpoint, model, input_tokens, output_tokens, cost_usd, cost_source, actor, created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,'',?9,0,?10,'unit-price',?11,?12) ON CONFLICT(id) DO UPDATE SET input_tokens=excluded.input_tokens, cost_usd=excluded.cost_usd WHERE usage_log.invoice_id = ''")
    .bind(e.id || crypto.randomUUID(), owner, String(e.clientId || ""), e.kind, e.provider, feature, String(e.route || "").slice(0, 120), String(e.endpoint || "").slice(0, 120), units, cost, String(e.actor || "system").slice(0, 160), new Date().toISOString()).run();
}

// ---------- Billing maths (shared by the API, reports and monthly invoicing) ----------
export type BillingSettings = { enabled: boolean; markupPct: number; usdRate: number; includeSeoData: boolean; minCharge: number; updatedAt: string; updatedBy: string };
export type ServiceSetting = { key: ServiceKey; enabled: boolean; markupPct: number | null; unitUsd: number | null };
export type Billing = { settings: BillingSettings; clients: Map<string, { markupPct: number | null; enabled: boolean }>; services: Map<ServiceKey, ServiceSetting>; clientServices: Map<string, Map<string, boolean>> };
export async function loadBilling(db: Db, owner: string): Promise<Billing> {
  await ensureUsageTables(db);
  const [s, rows, svc, cs] = await Promise.all([
    db.prepare("SELECT * FROM usage_billing_settings WHERE owner_id = ?1").bind(owner).first<any>(),
    db.prepare("SELECT client_id, markup_pct, enabled FROM usage_billing_clients WHERE owner_id = ?1").bind(owner).all<any>().then((r) => r.results || []),
    db.prepare("SELECT service, enabled, markup_pct, unit_cost_usd FROM usage_services WHERE owner_id = ?1").bind(owner).all<any>().then((r) => r.results || []),
    db.prepare("SELECT client_id, service, enabled FROM usage_client_services WHERE owner_id = ?1").bind(owner).all<any>().then((r) => r.results || []),
  ]);
  const includeSeoData = s ? Boolean(s.include_seo_data) : true;
  const services = new Map<ServiceKey, ServiceSetting>(SERVICES.map((d) => { const r = svc.find((x: any) => x.service === d.key); return [d.key, { key: d.key, enabled: r ? Boolean(r.enabled) : d.key === "seo_data" ? includeSeoData : true, markupPct: r?.markup_pct == null ? null : Number(r.markup_pct), unitUsd: r?.unit_cost_usd == null ? null : Number(r.unit_cost_usd) }]; }));
  const clientServices = new Map<string, Map<string, boolean>>();
  for (const r of cs as any[]) { const m = clientServices.get(String(r.client_id)) || new Map(); m.set(String(r.service), Boolean(r.enabled)); clientServices.set(String(r.client_id), m); }
  return {
    settings: { enabled: s ? Boolean(s.enabled) : true, markupPct: s ? Number(s.markup_pct) : 100, usdRate: s ? Number(s.usd_rate) || 0.92 : 0.92, includeSeoData: services.get("seo_data")!.enabled, minCharge: s ? Number(s.min_charge) || 0 : 0, updatedAt: s?.updated_at || "", updatedBy: s?.updated_by || "" },
    clients: new Map(rows.map((r: any) => [String(r.client_id), { markupPct: r.markup_pct == null ? null : Number(r.markup_pct), enabled: Boolean(r.enabled) }])),
    services, clientServices,
  };
}
/** Markup for a client and service: the client's own markup, else the service's, else the agency markup. */
export const markupFor = (b: Billing, clientId: string, kind?: string) => b.clients.get(clientId)?.markupPct ?? (kind ? b.services.get(kind as ServiceKey)?.markupPct : null) ?? b.settings.markupPct;
/** Is this service rebilled for this client? (agency switch, service switch, client switch, client-service switch) */
export const serviceBilled = (b: Billing, clientId: string, kind: string) => b.settings.enabled && b.services.get(kind as ServiceKey)?.enabled !== false && b.clients.get(clientId)?.enabled !== false && b.clientServices.get(clientId)?.get(kind) !== false;
export const billable = (costUsd: number, usdRate: number, markupPct: number) => Math.round(costUsd * usdRate * (1 + markupPct / 100) * 100) / 100;
export async function audit(db: Db, owner: string, action: string, detail: Record<string, unknown>, actor: string, clientId = "") {
  await ensureUsageTables(db);
  await db.prepare("INSERT INTO usage_billing_audit (id, owner_id, client_id, action, detail, actor, created_at) VALUES (?1,?2,?3,?4,?5,?6,?7)").bind(crypto.randomUUID(), owner, clientId, action, JSON.stringify(detail).slice(0, 4000), actor.slice(0, 160), new Date().toISOString()).run();
}
