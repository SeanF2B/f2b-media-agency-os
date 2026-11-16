import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";
import { ensureFormSubmissionLog } from "@/lib/form-submission-log";
import { SITE_FORMS_SQL, builtInForms, defaultSettings, emptyDefinition, parseJson, type FormDefinition, type FormSettings } from "@/lib/site-forms";

export const dynamic = "force-dynamic";
const reply = (error: string, status = 400) => Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

let ready: Promise<unknown> | null = null;
const ensure = (db: D1Database) => (ready ??= db.batch(SITE_FORMS_SQL.map((sql) => db.prepare(sql))).catch((error) => { ready = null; throw error; }));

async function context() {
  const user = await getChatGPTUser();
  if (!user) return { response: reply("Sign in before opening forms.", 401) };
  if (!env.DB) return { response: reply("The private workspace database is unavailable.", 503) };
  const row = await env.DB.prepare(`SELECT json_object('ownerId', owner_id,
      'clients', json(COALESCE((SELECT json_group_array(json_object('id', json_extract(value,'$.id'), 'name', json_extract(value,'$.name'), 'website', COALESCE(json_extract(value,'$.website'), json_extract(value,'$.wordpressSiteUrl'), ''))) FROM json_each(data,'$.clients')), '[]')),
      'staff', json(COALESCE((SELECT json_group_array(json_object('email', json_extract(value,'$.email'), 'role', json_extract(value,'$.role'), 'isBot', json_extract(value,'$.isBot'))) FROM json_each(data,'$.staff')), '[]'))) AS data
    FROM workspace_documents WHERE id = 'f2b-agency'`).first<{ data: string }>();
  if (!row?.data) return { response: reply("The agency workspace could not be found.", 503) };
  const ws = JSON.parse(row.data) as { ownerId?: string; clients?: Array<{ id: string; name: string; website: string }>; staff?: Array<{ email?: string; role?: string; isBot?: boolean }> };
  const admin = ws.ownerId === user.userId || ws.staff?.some((p) => !p.isBot && p.email?.toLowerCase() === user.email.toLowerCase() && ["Owner", "Admin"].includes(p.role || ""));
  if (!admin) return { response: reply("Only an agency owner or admin can manage forms.", 403) };
  await ensure(env.DB);
  return { db: env.DB, ownerId: String(ws.ownerId || ""), clients: ws.clients || [], email: user.email };
}

// One form per client: these forms are shown merged into another (their submissions count there too).
const FORM_ALIASES: Record<string, string> = {
  "site:a93e6dbd-0d34-46ec-ba5a-6be474d15882:contact": "site:a93e6dbd-0d34-46ec-ba5a-6be474d15882:quote", // Pro Roofers: contact → Free quote form
  "site:24e59da5-e0c9-4620-9424-db227dc5c4d0:book-a-consultation": "site:24e59da5-e0c9-4620-9424-db227dc5c4d0:interior-design", // Red Island: consultation → Interior design
};
type Row = { id: string; client_id: string; form_key: string; name: string; site: string; definition: string; settings: string; updated_at: string; updated_by: string };
const shape = (r: Row) => ({ id: r.id, clientId: r.client_id, formKey: r.form_key, name: r.name, site: r.site, definition: parseJson<FormDefinition>(r.definition, emptyDefinition()), settings: parseJson<FormSettings>(r.settings, defaultSettings()), updatedAt: r.updated_at, updatedBy: r.updated_by });

export async function GET(request: Request) {
  const ctx = await context();
  if ("response" in ctx) return ctx.response;
  const { db, ownerId, clients } = ctx;
  const url = new URL(request.url);
  const formId = url.searchParams.get("history");
  if (formId) {
    const rows = await db.prepare("SELECT id, summary, created_at, created_by FROM site_form_history WHERE owner_id=?1 AND form_id=?2 ORDER BY created_at DESC LIMIT 100").bind(ownerId, formId.slice(0, 80)).all<{ id: string; summary: string; created_at: string; created_by: string }>();
    return Response.json({ history: (rows.results || []).map((h) => ({ id: h.id, summary: h.summary, at: h.created_at, by: h.created_by })) }, { headers: { "Cache-Control": "no-store" } });
  }
  // Register forms we built (idempotent; unique on owner + form key).
  const now = new Date().toISOString();
  await db.batch(builtInForms().map((f) => db.prepare("INSERT OR IGNORE INTO site_forms (id, owner_id, client_id, form_key, name, site, definition, settings, updated_at, updated_by) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,'Claude')")
    .bind(crypto.randomUUID(), ownerId, f.clientId, f.formKey, f.name, f.site, JSON.stringify(f.definition), JSON.stringify(f.settings), now)));
  await ensureFormSubmissionLog(db);
  const since = new Date(Date.now() - 365 * 86_400_000).toISOString();
  const [forms, stats] = await db.batch([
    db.prepare("SELECT * FROM site_forms WHERE owner_id=?1 ORDER BY name LIMIT 500").bind(ownerId),
    db.prepare("SELECT client_id, form_key, MAX(form_name) AS name, MAX(page_url) AS page, COUNT(*) AS n, MAX(created_at) AS last, SUM(CASE WHEN created_at >= ?3 THEN 1 ELSE 0 END) AS n30 FROM form_submission_log WHERE owner_id=?1 AND created_at >= ?2 AND client_id <> '' GROUP BY form_key LIMIT 500").bind(ownerId, since, new Date(Date.now() - 30 * 86_400_000).toISOString()),
  ]);
  const registered = ((forms.results || []) as Row[]).map(shape).filter((f) => !FORM_ALIASES[f.formKey]);
  const statRows: Array<{ client_id: string; form_key: string; name: string; page: string; n: number; last: string; n30: number }> = [];
  for (const raw of (stats.results || []) as Array<{ client_id: string; form_key: string; name: string; page: string; n: number; last: string; n30: number }>) {
    const key = FORM_ALIASES[raw.form_key] || raw.form_key;
    const hit = statRows.find((row) => row.form_key === key);
    if (!hit) { statRows.push({ ...raw, form_key: key, name: key === raw.form_key ? raw.name : "" }); continue; }
    hit.n += raw.n; hit.n30 += raw.n30; if (raw.last > hit.last) hit.last = raw.last; if (key === raw.form_key) hit.name = raw.name || hit.name;
  }
  const byKey = new Map(statRows.map((s) => [s.form_key, s]));
  const known = new Set(registered.map((f) => f.formKey));
  const hostOf = (raw: string) => { try { return new URL(/^https?:/.test(raw) ? raw : `https://${raw}`).hostname.replace(/^www\./, ""); } catch { return ""; } };
  // Forms seen in submissions but not registered yet (e.g. Red Island's booking forms).
  const discovered = statRows.filter((s) => !known.has(s.form_key)).map((s) => ({ id: "", clientId: s.client_id, formKey: s.form_key, name: s.name || s.form_key.split(":").pop() || "Form", site: hostOf(s.page) || hostOf(clients.find((c) => c.id === s.client_id)?.website || ""), definition: null, settings: null, updatedAt: "", updatedBy: "" }));
  const all = [...registered, ...discovered].map((f) => { const s = byKey.get(f.formKey); return { ...f, clientName: clients.find((c) => c.id === f.clientId)?.name || "Unknown client", submissions: s?.n || 0, last30: s?.n30 || 0, lastAt: s?.last || "" }; });
  const clientIds = [...new Set(all.map((f) => f.clientId))].slice(0, 50);
  const stageRows = clientIds.length ? ((await db.prepare(`SELECT p.client_id, p.name AS pipeline, s.id, s.name FROM crm_pipelines p JOIN crm_pipeline_stages s ON s.pipeline_id=p.id AND s.owner_id=p.owner_id WHERE p.owner_id=?1 AND p.archived=0 AND p.client_id IN (${clientIds.map((_, i) => `?${i + 2}`).join(",")}) ORDER BY p.created_at, s.position LIMIT 400`).bind(ownerId, ...clientIds).all<{ client_id: string; pipeline: string; id: string; name: string }>()).results || []) : [];
  const stages: Record<string, Array<{ id: string; label: string }>> = {};
  for (const r of stageRows) (stages[r.client_id] ||= []).push({ id: r.id, label: `${r.pipeline} → ${r.name}` });
  return Response.json({ forms: all, stages }, { headers: { "Cache-Control": "no-store" } });
}

/** Save a form (creates the registry row for a discovered form). Every save keeps a history snapshot. */
export async function PUT(request: Request) {
  const ctx = await context();
  if ("response" in ctx) return ctx.response;
  const { db, ownerId, clients, email } = ctx;
  const body = await request.json().catch(() => null) as { id?: string; clientId?: string; formKey?: string; name?: string; site?: string; definition?: FormDefinition; settings?: FormSettings; summary?: string } | null;
  if (!body?.formKey || !body.clientId || !clients.some((c) => c.id === body.clientId)) return reply("Choose a client form to save.");
  if (!body.formKey.startsWith(`site:${body.clientId}:`)) return reply("That form does not belong to this client.");
  const definition = body.definition && Array.isArray(body.definition.fields) ? body.definition : emptyDefinition();
  const s = body.settings || defaultSettings();
  const settings: FormSettings = { status: s.status === "paused" ? "paused" : "live", notify: (s.notify || []).map((e) => String(e).trim().toLowerCase()).filter((e) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e)).slice(0, 10), stageId: String(s.stageId || "").slice(0, 80), thankYouUrl: String(s.thankYouUrl || "").slice(0, 300), pages: { mode: ["include", "exclude"].includes(String(s.pages?.mode)) ? s.pages.mode : "all", paths: (s.pages?.paths || []).map((p) => String(p).trim()).filter(Boolean).slice(0, 50) } };
  const defJson = JSON.stringify(definition); if (defJson.length > 60_000) return reply("This form is too large to save.");
  const now = new Date().toISOString();
  const id = body.id || crypto.randomUUID();
  await db.prepare("INSERT INTO site_forms (id, owner_id, client_id, form_key, name, site, definition, settings, updated_at, updated_by) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10) ON CONFLICT(owner_id, form_key) DO UPDATE SET name=excluded.name, site=excluded.site, definition=excluded.definition, settings=excluded.settings, updated_at=excluded.updated_at, updated_by=excluded.updated_by")
    .bind(id, ownerId, body.clientId, body.formKey.slice(0, 160), String(body.name || "Form").slice(0, 120), String(body.site || "").slice(0, 120), defJson, JSON.stringify(settings), now, email).run();
  const saved = await db.prepare("SELECT * FROM site_forms WHERE owner_id=?1 AND form_key=?2").bind(ownerId, body.formKey).first<Row>();
  if (saved) await db.prepare("INSERT INTO site_form_history (id, owner_id, form_id, summary, snapshot, created_at, created_by) VALUES (?1,?2,?3,?4,?5,?6,?7)")
    .bind(crypto.randomUUID(), ownerId, saved.id, String(body.summary || "Saved changes").slice(0, 300), JSON.stringify({ definition, settings, name: body.name }), now, email).run();
  return Response.json({ form: saved ? shape(saved) : null }, { headers: { "Cache-Control": "no-store" } });
}
