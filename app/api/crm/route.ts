import { crmScopeFrom } from "@/lib/client-accounts/client-accounts-api";
import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";

export const dynamic = "force-dynamic";
const reply = (error: string, status = 400) => Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
const stages = ["New lead", "Contacted", "Qualified", "Appointment booked", "Proposal sent", "Won", "Lost"] as const;
type StageCategory = "open" | "won" | "lost";
type WorkspaceData = { ownerId?: string; clients?: Array<{ id: string; name: string; company?: string; logo?: string; contact?: string; email?: string; phone?: string }>; staff?: Array<{ id: string; name: string; avatar?: string; email?: string; role?: string; isBot?: boolean }> };
type PipelineRow = { id: string; name: string; description: string; stage_id: string | null; stage_name: string | null; stage_position: number | null; stage_category: StageCategory | null };
type PipelineView = { id: string; name: string; description: string; clientId?: string | null; stages: Array<{ id: string; name: string; position: number; category: StageCategory }> };

async function context() {
  const user = await getChatGPTUser();
  if (!user) return { response: reply("Sign in before opening the CRM.", 401) };
  if (!env.DB) return { response: reply("The private workspace database is unavailable.", 503) };
  const row = await env.DB.prepare(`
    SELECT json_object(
      'ownerId', owner_id,
      'clients', json(COALESCE((SELECT json_group_array(json(value)) FROM json_each(data, '$.clients')), '[]')),
      'staff', json(COALESCE((SELECT json_group_array(json_object(
        'id', json_extract(value, '$.id'), 'name', json_extract(value, '$.name'),
        'avatar', CASE WHEN substr(COALESCE(json_extract(value, '$.avatar'), ''), 1, 11) = 'data:image/' THEN '' ELSE json_extract(value, '$.avatar') END,
        'email', json_extract(value, '$.email'), 'role', json_extract(value, '$.role'), 'isBot', json_extract(value, '$.isBot')
      )) FROM json_each(data, '$.staff')), '[]'))
    ) AS data
    FROM workspace_documents WHERE id = 'f2b-agency'
  `).first<{ data: string }>();
  if (!row?.data) return { response: reply("The agency workspace could not be found.", 503) };
  let workspace: WorkspaceData;
  try { workspace = JSON.parse(row.data); } catch { return { response: reply("The agency workspace data could not be read.", 503) }; }
  const admin = workspace.ownerId === user.userId || workspace.staff?.some((person: { email?: string; role?: string; isBot?: boolean }) => !person.isBot && person.email?.toLowerCase() === user.email.toLowerCase() && ["Owner", "Admin"].includes(person.role || ""));
  if (!admin) return { response: reply("Only an agency owner or admin can manage CRM records.", 403) };
  return { db: env.DB, ownerId: String(workspace.ownerId || ""), workspace, user };
}

function clean(value: unknown, max = 500) { return typeof value === "string" ? value.trim().slice(0, max) : ""; }
function stageCategory(name: string): StageCategory { return /^won$/i.test(name) ? "won" : /^lost$/i.test(name) ? "lost" : "open"; }
async function ensureOrderTable(db: D1Database) {
  await db.prepare("CREATE TABLE IF NOT EXISTS crm_opportunity_order (owner_id TEXT NOT NULL, opportunity_id TEXT NOT NULL, sort_order REAL NOT NULL, PRIMARY KEY (owner_id, opportunity_id))").run();
}

// Spam / do-not-disturb flags live in their own small table so no migration is needed.
const flagTableSql = "CREATE TABLE IF NOT EXISTS crm_flags (owner_id TEXT NOT NULL, kind TEXT NOT NULL, ref_id TEXT NOT NULL, flag TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (owner_id, kind, ref_id, flag))";
async function readFlags(db: D1Database, ownerId: string) {
  try { return ((await db.prepare("SELECT kind, ref_id, flag FROM crm_flags WHERE owner_id = ?1").bind(ownerId).all<{ kind: string; ref_id: string; flag: string }>()).results || []); }
  catch { return []; } // table not created yet — nothing flagged
}

const tagTableSql = "CREATE TABLE IF NOT EXISTS crm_contact_tags (owner_id TEXT NOT NULL, contact_id TEXT NOT NULL, tag TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (owner_id, contact_id, tag))";
const smartListTableSql = "CREATE TABLE IF NOT EXISTS crm_smart_lists (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, client_id TEXT, name TEXT NOT NULL, filters TEXT NOT NULL, created_at TEXT NOT NULL)";
async function readTags(db: D1Database, ownerId: string) {
  try { return ((await db.prepare("SELECT contact_id, tag FROM crm_contact_tags WHERE owner_id = ?1").bind(ownerId).all<{ contact_id: string; tag: string }>()).results || []); }
  catch { return []; }
}
async function readSmartLists(db: D1Database, ownerId: string, clientId: string | null) {
  try { return ((await db.prepare("SELECT id, name, filters FROM crm_smart_lists WHERE owner_id = ?1 AND COALESCE(client_id,'') = ?2 ORDER BY created_at").bind(ownerId, clientId || "").all<{ id: string; name: string; filters: string }>()).results || []).map((row) => { let filters: unknown = {}; try { filters = JSON.parse(row.filters); } catch { /* keep empty */ } return { id: row.id, name: row.name, filters }; }); }
  catch { return []; }
}
const cleanTag = (value: unknown) => clean(value, 40).replace(/\s+/g, " ").toLowerCase();

async function ensurePipeline(db: D1Database, ownerId: string) {
  const existing = await db.prepare("SELECT id FROM crm_pipelines WHERE owner_id = ?1 AND archived = 0 ORDER BY created_at LIMIT 1").bind(ownerId).first<{ id: string }>();
  if (existing) return;
  const now = new Date().toISOString(), id = crypto.randomUUID();
  const inserts = [db.prepare("INSERT INTO crm_pipelines (id, owner_id, name, description, created_at, updated_at) VALUES (?1, ?2, 'Sales pipeline', 'Default agency sales pipeline', ?3, ?3)").bind(id, ownerId, now)];
  stages.forEach((name, position) => inserts.push(db.prepare("INSERT INTO crm_pipeline_stages (id, owner_id, pipeline_id, name, position, category, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)").bind(crypto.randomUUID(), ownerId, id, name, position, stageCategory(name), now)));
  await db.batch(inserts);
}

export async function GET(request: Request) {
  const access = await context(); if (access.response) return access.response;
  const { db, ownerId, workspace } = access;
  try {
    await ensurePipeline(db, ownerId);
    await ensureOrderTable(db);
    const url = new URL(request.url);
    if (url.searchParams.get("summary") === "1") {
      // Strict: a sub-account only sees its own pipelines; the agency only sees agency pipelines.
      const rawScope = clean(url.searchParams.get("clientId"), 80);
      const scopeClient = rawScope === "agency" ? "" : rawScope;
      const fromDate = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get("from") || "") ? String(url.searchParams.get("from")) : "";
      const toDate = /^\d{4}-\d{2}-\d{2}$/.test(url.searchParams.get("to") || "") ? `${url.searchParams.get("to")}T23:59:59.999Z` : "";
      const rows = await db.prepare("SELECT s.category, o.currency, COUNT(*) AS total, SUM(o.value) AS value FROM crm_opportunities o JOIN crm_pipeline_stages s ON s.id=o.stage_id AND s.owner_id=o.owner_id JOIN crm_pipelines p ON p.id=o.pipeline_id AND p.owner_id=o.owner_id WHERE o.owner_id=?1 AND p.archived=0 AND s.category IN ('open','won') AND COALESCE(p.client_id,'')=?2 AND (?3='' OR o.created_at>=?3) AND (?4='' OR o.created_at<=?4) GROUP BY s.category, o.currency").bind(ownerId, scopeClient, fromDate, toDate).all<{ category: string; currency: string; total: number; value: number }>();
      const groups = (rows.results || []).map((row) => ({ category: row.category, currency: clean(row.currency, 3) || "EUR", count: Number(row.total) || 0, value: Number(row.value) || 0 }));
      const stageRows = await db.prepare("SELECT s.name, s.category, s.position, o.currency, COUNT(o.id) AS total, COALESCE(SUM(o.value),0) AS value FROM crm_pipeline_stages s JOIN crm_pipelines p ON p.id=s.pipeline_id AND p.owner_id=s.owner_id LEFT JOIN crm_opportunities o ON o.stage_id=s.id AND o.owner_id=s.owner_id AND (?3='' OR o.created_at>=?3) AND (?4='' OR o.created_at<=?4) WHERE s.owner_id=?1 AND p.archived=0 AND COALESCE(p.client_id,'')=?2 GROUP BY s.id, o.currency ORDER BY p.created_at, s.position").bind(ownerId, scopeClient, fromDate, toDate).all<{ name: string; category: string; position: number; currency: string | null; total: number; value: number }>();
      const stages = (stageRows.results || []).map((row) => ({ name: String(row.name), category: String(row.category), currency: clean(row.currency, 3) || "EUR", count: Number(row.total) || 0, value: Number(row.value) || 0 }));
      return Response.json({ open: groups.filter((row) => row.category === "open"), won: groups.filter((row) => row.category === "won"), stages }, { headers: { "Cache-Control": "no-store" } });
    }
    const search = clean(url.searchParams.get("search"), 120).toLowerCase();
    // Server-side client scope (f2b_client cookie or ?clientId=). No scope = everything (legacy behaviour).
    const scope = crmScopeFrom(request) as { clientId: string | null } | null;
    const pipeWhere = !scope ? "" : scope.clientId ? " AND p.client_id = ?2" : " AND p.client_id IS NULL";
    const scopeArgs: string[] = scope?.clientId ? [ownerId, scope.clientId] : [ownerId];
    const contactSql = !scope
      ? "SELECT * FROM crm_contacts WHERE owner_id = ?1 ORDER BY updated_at DESC LIMIT 1000"
      : scope.clientId
        ? "SELECT * FROM crm_contacts WHERE owner_id = ?1 AND ((client_id = ?2 AND source <> 'client' AND id NOT IN (SELECT o.contact_id FROM crm_opportunities o JOIN crm_pipelines p ON p.id = o.pipeline_id WHERE o.owner_id = ?1 AND o.contact_id IS NOT NULL AND p.client_id IS NULL)) OR id IN (SELECT o.contact_id FROM crm_opportunities o JOIN crm_pipelines p ON p.id = o.pipeline_id WHERE o.owner_id = ?1 AND p.client_id = ?2)) ORDER BY updated_at DESC LIMIT 1000"
        : "SELECT * FROM crm_contacts WHERE owner_id = ?1 AND (client_id IS NULL OR id IN (SELECT o.contact_id FROM crm_opportunities o JOIN crm_pipelines p ON p.id = o.pipeline_id WHERE o.owner_id = ?1 AND p.client_id IS NULL)) ORDER BY updated_at DESC LIMIT 1000";
    const [contacts, pipelineRows, opportunityRows, activityRows] = await Promise.all([
      db.prepare(contactSql).bind(...scopeArgs).all<Record<string, unknown>>(),
      db.prepare(`SELECT p.*, s.id AS stage_id, s.name AS stage_name, s.position AS stage_position, s.category AS stage_category FROM crm_pipelines p LEFT JOIN crm_pipeline_stages s ON s.owner_id = p.owner_id AND s.pipeline_id = p.id WHERE p.owner_id = ?1 AND p.archived = 0${pipeWhere} ORDER BY p.created_at, s.position`).bind(...scopeArgs).all<PipelineRow & { client_id?: string | null }>(),
      db.prepare(`SELECT o.*, c.first_name, c.last_name, c.email, c.phone, c.company, s.name AS stage_name FROM crm_opportunities o LEFT JOIN crm_contacts c ON c.id = o.contact_id AND c.owner_id = o.owner_id LEFT JOIN crm_pipeline_stages s ON s.id = o.stage_id AND s.owner_id = o.owner_id WHERE o.owner_id = ?1 AND o.pipeline_id IN (SELECT p.id FROM crm_pipelines p WHERE p.owner_id = ?1${pipeWhere}) ORDER BY o.updated_at DESC LIMIT 2000`).bind(...scopeArgs).all<Record<string, unknown>>(),
      db.prepare("SELECT * FROM crm_activities WHERE owner_id = ?1 ORDER BY created_at DESC LIMIT 1000").bind(ownerId).all<Record<string, unknown>>(),
    ]);
    const [flags, tags, smartLists] = await Promise.all([readFlags(db, ownerId), readTags(db, ownerId), readSmartLists(db, ownerId, scope?.clientId || null)]);
    const orderRows = await db.prepare("SELECT opportunity_id, sort_order FROM crm_opportunity_order WHERE owner_id = ?1").bind(ownerId).all<{ opportunity_id: string; sort_order: number }>();
    const orderByOpportunity = new Map((orderRows.results || []).map((row) => [row.opportunity_id, row.sort_order] as const));
    const pipelines = new Map<string, PipelineView>();
    for (const r of pipelineRows.results || []) {
      if (!pipelines.has(r.id)) pipelines.set(r.id, { id: r.id, name: r.name, description: r.description, clientId: (r as { client_id?: string | null }).client_id ?? null, stages: [] } as PipelineView);
      if (r.stage_id && r.stage_name && r.stage_position !== null && r.stage_category) pipelines.get(r.id)?.stages.push({ id: r.stage_id, name: r.stage_name, position: r.stage_position, category: r.stage_category });
    }
    const visibleOpps = new Set((opportunityRows.results || []).map((row) => String(row.id))), visibleContacts = new Set((contacts.results || []).map((row) => String(row.id)));
    const matches = (item: Record<string, unknown>) => !search || [item.title, item.first_name, item.last_name, item.email, item.company].some((value) => String(value || "").toLowerCase().includes(search));
    return Response.json({ flags: flags.filter((row) => row.kind === "contact" ? visibleContacts.has(String(row.ref_id)) : visibleOpps.has(String(row.ref_id))), tags: tags.filter((row) => visibleContacts.has(String(row.contact_id))), smartLists, contacts: contacts.results || [], pipelines: [...pipelines.values()], opportunities: (opportunityRows.results || []).map((row) => ({ ...row, sort_order: orderByOpportunity.has(String(row.id)) ? orderByOpportunity.get(String(row.id)) : null })).filter(matches), activities: (activityRows.results || []).filter((a) => !scope || visibleOpps.has(String(a.opportunity_id)) || visibleContacts.has(String(a.contact_id))), clients: (workspace.clients || []).filter((item) => !scope?.clientId || String(item.id) === scope.clientId).map((item) => ({ id: String(item.id), name: String(item.name), company: String(item.company || ""), logo: String(item.logo || ""), contact: String(item.contact || ""), email: String(item.email || ""), phone: String(item.phone || "") })), staff: (workspace.staff || []).filter((item) => !item.isBot).map((item) => ({ id: String(item.id), name: String(item.name), avatar: String(item.avatar || "") })) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return reply(error instanceof Error ? error.message : "Could not load CRM records.", 500); }
}

export async function POST(request: Request) {
  const access = await context(); if (access.response) return access.response;
  const { db, ownerId, user } = access;
  let body: Record<string, unknown>; try { body = await request.json() as Record<string, unknown>; } catch { return reply("Send valid CRM details."); }
  const action = clean(body.action, 40), now = new Date().toISOString();
  try {
    if (action === "syncClients") {
      await db.prepare("CREATE TABLE IF NOT EXISTS crm_client_sync_done (owner_id TEXT NOT NULL, client_id TEXT NOT NULL, PRIMARY KEY (owner_id, client_id))").run();
      await ensurePipeline(db, ownerId);
      const pipeline = await db.prepare("SELECT id FROM crm_pipelines WHERE owner_id=?1 AND archived=0 ORDER BY created_at LIMIT 1").bind(ownerId).first<{ id: string }>();
      if (!pipeline) return Response.json({ ok: true, created: 0 });
      const stageRows = await db.prepare("SELECT id, category FROM crm_pipeline_stages WHERE owner_id=?1 AND pipeline_id=?2 AND category IN ('won','lost')").bind(ownerId, pipeline.id).all<{ id: string; category: string }>();
      const wonStage = (stageRows.results || []).find((row) => row.category === "won")?.id, lostStage = (stageRows.results || []).find((row) => row.category === "lost")?.id;
      const doneRows = await db.prepare("SELECT client_id FROM crm_client_sync_done WHERE owner_id=?1").bind(ownerId).all<{ client_id: string }>();
      const done = new Set((doneRows.results || []).map((row) => row.client_id));
      let created = 0;
      for (const client of (access.workspace.clients || []) as Array<Record<string, unknown>>) {
        const clientId = String(client.id || ""); if (!clientId || done.has(clientId)) continue;
        const status = String(client.status || "Active");
        const stageId = /lost|churn|cancel|inactive|ended|former|archiv/i.test(status) ? lostStage : wonStage;
        const name = clean(client.name, 200) || clean(client.company, 200) || "Client";
        const email = clean(client.email, 254).toLowerCase(), phone = clean(client.phone, 40), company = clean(client.company, 200) || name;
        const person = clean(client.contact, 200) || name; const parts = person.split(/\s+/);
        let contact = await db.prepare("SELECT id FROM crm_contacts WHERE owner_id=?1 AND (client_id=?2 OR (?3<>'' AND email=?3)) LIMIT 1").bind(ownerId, clientId, email).first<{ id: string }>();
        if (!contact) {
          const id = crypto.randomUUID();
          await db.prepare("INSERT INTO crm_contacts (id, owner_id, client_id, first_name, last_name, email, phone, company, source, notes, created_at, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,'client','',?9,?9)").bind(id, ownerId, clientId, parts[0] || "", parts.slice(1).join(" "), email, phone, company, now).run();
          contact = { id };
        }
        const existing = await db.prepare("SELECT id FROM crm_opportunities WHERE owner_id=?1 AND client_id=?2 LIMIT 1").bind(ownerId, clientId).first();
        if (!existing && stageId) {
          const fee = Array.isArray(client.services) ? (client.services as Array<{ fee?: number }>).reduce((sum, service) => sum + (Number(service.fee) || 0), 0) : 0;
          await db.prepare("INSERT INTO crm_opportunities (id, owner_id, pipeline_id, stage_id, contact_id, client_id, title, value, currency, source, notes, created_at, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,'EUR','client','',?9,?9)").bind(crypto.randomUUID(), ownerId, pipeline.id, stageId, contact.id, clientId, name, Math.max(0, fee), now).run();
          created += 1;
        }
        await db.prepare("INSERT OR IGNORE INTO crm_client_sync_done (owner_id, client_id) VALUES (?1,?2)").bind(ownerId, clientId).run();
      }
      return Response.json({ ok: true, created });
    }
    if (action === "saveContact") {
      const id = clean(body.id, 80) || crypto.randomUUID(), email = clean(body.email, 254).toLowerCase();
      const firstName = clean(body.firstName, 100), lastName = clean(body.lastName, 100);
      if (!firstName && !lastName && !email && !clean(body.phone, 40)) return reply("Add at least a name, email, or phone number.");
      // Inside a client sub-account, new contacts belong to that client so they show in its list.
      const clientId = clean(body.clientId, 100) || (crmScopeFrom(request) as { clientId: string | null } | null)?.clientId || null;
      if (clientId && !(access.workspace.clients || []).some((item) => String(item.id) === clientId)) return reply("Choose a client in this workspace.");
      const sql = "INSERT INTO crm_contacts (id, owner_id, client_id, first_name, last_name, email, phone, company, source, notes, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11) ON CONFLICT(id) DO UPDATE SET client_id=excluded.client_id, first_name=excluded.first_name, last_name=excluded.last_name, email=excluded.email, phone=excluded.phone, company=excluded.company, notes=excluded.notes, updated_at=excluded.updated_at WHERE crm_contacts.owner_id=excluded.owner_id";
      await db.prepare(sql).bind(id, ownerId, clientId, firstName, lastName, email, clean(body.phone, 40), clean(body.company, 200), clean(body.source, 100) || "manual", clean(body.notes, 4000), now).run();
      if (Array.isArray(body.tags)) {
        const tags = [...new Set(body.tags.map(cleanTag).filter(Boolean))].slice(0, 30);
        await db.prepare(tagTableSql).run();
        await db.batch([db.prepare("DELETE FROM crm_contact_tags WHERE owner_id=?1 AND contact_id=?2").bind(ownerId, id), ...tags.map((tag) => db.prepare("INSERT OR IGNORE INTO crm_contact_tags (owner_id, contact_id, tag, created_at) VALUES (?1,?2,?3,?4)").bind(ownerId, id, tag, now))]);
      }
      return Response.json({ ok: true, id });
    }
    if (action === "deleteContacts" || action === "tagContacts" || action === "flagContacts") {
      const ids = Array.isArray(body.ids) ? [...new Set(body.ids.map((x: unknown) => clean(x, 80)).filter(Boolean))].slice(0, 500) : [];
      if (!ids.length) return reply("Select at least one contact.");
      const owned = new Set<string>();
      for (let i = 0; i < ids.length; i += 90) {
        const chunk = ids.slice(i, i + 90);
        const rows = await db.prepare(`SELECT id FROM crm_contacts WHERE owner_id=?1 AND id IN (${chunk.map((_, n) => `?${n + 2}`).join(",")})`).bind(ownerId, ...chunk).all<{ id: string }>();
        (rows.results || []).forEach((row) => owned.add(row.id));
      }
      const valid = ids.filter((id) => owned.has(id));
      if (!valid.length) return reply("Those contacts are no longer available.", 404);
      const statements: D1PreparedStatement[] = [];
      if (action === "deleteContacts") {
        await db.prepare(tagTableSql).run(); await db.prepare(flagTableSql).run();
        for (const id of valid) statements.push(
          db.prepare("UPDATE crm_opportunities SET contact_id=NULL, updated_at=?3 WHERE owner_id=?1 AND contact_id=?2").bind(ownerId, id, now),
          db.prepare("DELETE FROM crm_activities WHERE owner_id=?1 AND contact_id=?2").bind(ownerId, id),
          db.prepare("DELETE FROM crm_contact_tags WHERE owner_id=?1 AND contact_id=?2").bind(ownerId, id),
          db.prepare("DELETE FROM crm_flags WHERE owner_id=?1 AND kind='contact' AND ref_id=?2").bind(ownerId, id),
          db.prepare("DELETE FROM crm_contacts WHERE owner_id=?1 AND id=?2").bind(ownerId, id));
      } else if (action === "tagContacts") {
        const tag = cleanTag(body.tag); if (!tag) return reply("Enter a tag.");
        await db.prepare(tagTableSql).run();
        for (const id of valid) statements.push(body.on === false
          ? db.prepare("DELETE FROM crm_contact_tags WHERE owner_id=?1 AND contact_id=?2 AND tag=?3").bind(ownerId, id, tag)
          : db.prepare("INSERT OR IGNORE INTO crm_contact_tags (owner_id, contact_id, tag, created_at) VALUES (?1,?2,?3,?4)").bind(ownerId, id, tag, now));
      } else {
        const flag = clean(body.flag, 20); if (!["spam", "dnd"].includes(flag)) return reply("Choose a flag.");
        await db.prepare(flagTableSql).run();
        for (const id of valid) statements.push(body.on === false
          ? db.prepare("DELETE FROM crm_flags WHERE owner_id=?1 AND kind='contact' AND ref_id=?2 AND flag=?3").bind(ownerId, id, flag)
          : db.prepare("INSERT OR IGNORE INTO crm_flags (owner_id, kind, ref_id, flag, created_at) VALUES (?1,'contact',?2,?3,?4)").bind(ownerId, id, flag, now));
      }
      for (let i = 0; i < statements.length; i += 50) await db.batch(statements.slice(i, i + 50));
      return Response.json({ ok: true, count: valid.length });
    }
    if (action === "saveSmartList" || action === "deleteSmartList") {
      await db.prepare(smartListTableSql).run();
      const scopeClient = (crmScopeFrom(request) as { clientId: string | null } | null)?.clientId || null;
      if (action === "deleteSmartList") { await db.prepare("DELETE FROM crm_smart_lists WHERE owner_id=?1 AND id=?2").bind(ownerId, clean(body.id, 80)).run(); return Response.json({ ok: true }); }
      const name = clean(body.name, 80); if (!name) return reply("Name the smart list.");
      const f = body.filters && typeof body.filters === "object" ? body.filters as Record<string, unknown> : {};
      const filters = { search: clean(f.search, 120), tags: Array.isArray(f.tags) ? f.tags.map(cleanTag).filter(Boolean).slice(0, 20) : [], tagMode: f.tagMode === "all" ? "all" : "any", source: clean(f.source, 100), dnd: ["only", "exclude"].includes(String(f.dnd)) ? String(f.dnd) : "", spam: ["only", "exclude"].includes(String(f.spam)) ? String(f.spam) : "", hasEmail: f.hasEmail === true, hasPhone: f.hasPhone === true };
      const id = clean(body.id, 80) || crypto.randomUUID();
      await db.prepare("INSERT INTO crm_smart_lists (id, owner_id, client_id, name, filters, created_at) VALUES (?1,?2,?3,?4,?5,?6) ON CONFLICT(id) DO UPDATE SET name=excluded.name, filters=excluded.filters WHERE crm_smart_lists.owner_id=excluded.owner_id").bind(id, ownerId, scopeClient, name, JSON.stringify(filters), now).run();
      return Response.json({ ok: true, id });
    }
    if (action === "setFlag") {
      const kind = clean(body.kind, 20), refId = clean(body.refId, 80), flag = clean(body.flag, 20);
      if (!["contact", "opportunity"].includes(kind) || !["spam", "dnd"].includes(flag) || !refId) return reply("Choose a contact or card and a flag.");
      const table = kind === "contact" ? "crm_contacts" : "crm_opportunities";
      if (!await db.prepare(`SELECT id FROM ${table} WHERE owner_id=?1 AND id=?2`).bind(ownerId, refId).first()) return reply("That record is no longer available.", 404);
      await db.prepare(flagTableSql).run();
      if (body.on === false) await db.prepare("DELETE FROM crm_flags WHERE owner_id=?1 AND kind=?2 AND ref_id=?3 AND flag=?4").bind(ownerId, kind, refId, flag).run();
      else await db.prepare("INSERT OR IGNORE INTO crm_flags (owner_id, kind, ref_id, flag, created_at) VALUES (?1,?2,?3,?4,?5)").bind(ownerId, kind, refId, flag, now).run();
      return Response.json({ ok: true });
    }
    if (action === "createPipeline") {
      const name = clean(body.name, 120); if (!name) return reply("Enter a pipeline name.");
      const id = crypto.randomUUID(), names: string[] = Array.isArray(body.stages) ? body.stages.map((x: unknown) => clean(x, 80)).filter(Boolean).slice(0, 30) : [...stages];
      if (!names.some((x) => stageCategory(x) === "open")) names.unshift("New lead");
      if (!names.some((x) => stageCategory(x) === "won")) names.push("Won");
      if (!names.some((x) => stageCategory(x) === "lost")) names.push("Lost");
      await db.batch([db.prepare("INSERT INTO crm_pipelines (id, owner_id, client_id, name, description, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)").bind(id, ownerId, (crmScopeFrom(request) as { clientId: string | null } | null)?.clientId ?? null, name, clean(body.description, 500), now), ...names.map((stageName: string, position: number) => db.prepare("INSERT INTO crm_pipeline_stages (id, owner_id, pipeline_id, name, position, category, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)").bind(crypto.randomUUID(), ownerId, id, stageName, position, stageCategory(stageName), now))]);
      return Response.json({ ok: true, id });
    }
    if (action === "createStage") {
      const pipelineId = clean(body.pipelineId, 80), name = clean(body.name, 80);
      if (!pipelineId || !name) return reply("Choose a pipeline and enter a stage name.");
      const pipeline = await db.prepare("SELECT id FROM crm_pipelines WHERE owner_id=?1 AND id=?2 AND archived=0").bind(ownerId, pipelineId).first();
      if (!pipeline) return reply("That pipeline is no longer available.", 404);
      const [countRow, duplicate, positionRow] = await Promise.all([
        db.prepare("SELECT COUNT(*) AS total FROM crm_pipeline_stages WHERE owner_id=?1 AND pipeline_id=?2").bind(ownerId, pipelineId).first<{ total: number }>(),
        db.prepare("SELECT id FROM crm_pipeline_stages WHERE owner_id=?1 AND pipeline_id=?2 AND lower(name)=lower(?3) LIMIT 1").bind(ownerId, pipelineId, name).first(),
        db.prepare("SELECT COALESCE(MAX(position), -1) + 1 AS position FROM crm_pipeline_stages WHERE owner_id=?1 AND pipeline_id=?2").bind(ownerId, pipelineId).first<{ position: number }>(),
      ]);
      if (duplicate) return reply("A stage with that name already exists in this pipeline.", 409);
      if (Number(countRow?.total || 0) >= 30) return reply("This pipeline already has 30 stages, the maximum allowed.", 409);
      const id = crypto.randomUUID();
      await db.batch([
        db.prepare("INSERT INTO crm_pipeline_stages (id, owner_id, pipeline_id, name, position, category, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)").bind(id, ownerId, pipelineId, name, Number(positionRow?.position || 0), stageCategory(name), now),
        db.prepare("UPDATE crm_pipelines SET updated_at=?1 WHERE owner_id=?2 AND id=?3").bind(now, ownerId, pipelineId),
      ]);
      return Response.json({ ok: true, id });
    }
    if (action === "updateStage") {
      const pipelineId = clean(body.pipelineId, 80), stageId = clean(body.stageId, 80), name = clean(body.name, 80);
      if (!pipelineId || !stageId || !name) return reply("Enter a name for this stage.");
      const current = await db.prepare("SELECT id FROM crm_pipeline_stages WHERE owner_id=?1 AND pipeline_id=?2 AND id=?3").bind(ownerId, pipelineId, stageId).first();
      if (!current) return reply("That stage is no longer available.", 404);
      const duplicate = await db.prepare("SELECT id FROM crm_pipeline_stages WHERE owner_id=?1 AND pipeline_id=?2 AND lower(name)=lower(?3) AND id<>?4 LIMIT 1").bind(ownerId, pipelineId, name, stageId).first();
      if (duplicate) return reply("A stage with that name already exists in this pipeline.", 409);
      await db.batch([
        db.prepare("UPDATE crm_pipeline_stages SET name=?1 WHERE owner_id=?2 AND pipeline_id=?3 AND id=?4").bind(name, ownerId, pipelineId, stageId),
        db.prepare("UPDATE crm_pipelines SET updated_at=?1 WHERE owner_id=?2 AND id=?3").bind(now, ownerId, pipelineId),
      ]);
      return Response.json({ ok: true, id: stageId });
    }
    if (action === "swapStages") {
      const pipelineId = clean(body.pipelineId, 80), stageId = clean(body.stageId, 80), otherStageId = clean(body.otherStageId, 80);
      if (!pipelineId || !stageId || !otherStageId || stageId === otherStageId) return reply("Choose a neighbouring stage to swap with.");
      const [current, other] = await Promise.all([
        db.prepare("SELECT id, position FROM crm_pipeline_stages WHERE owner_id=?1 AND pipeline_id=?2 AND id=?3").bind(ownerId, pipelineId, stageId).first<{ id: string; position: number }>(),
        db.prepare("SELECT id, position FROM crm_pipeline_stages WHERE owner_id=?1 AND pipeline_id=?2 AND id=?3").bind(ownerId, pipelineId, otherStageId).first<{ id: string; position: number }>(),
      ]);
      if (!current || !other) return reply("Those stages are no longer available.", 404);
      await db.batch([
        db.prepare("UPDATE crm_pipeline_stages SET position=CASE id WHEN ?1 THEN ?2 WHEN ?3 THEN ?4 END WHERE owner_id=?5 AND pipeline_id=?6 AND id IN (?1, ?3)").bind(stageId, other.position, otherStageId, current.position, ownerId, pipelineId),
        db.prepare("UPDATE crm_pipelines SET updated_at=?1 WHERE owner_id=?2 AND id=?3").bind(now, ownerId, pipelineId),
      ]);
      return Response.json({ ok: true });
    }
    if (action === "reorderStages") {
      const pipelineId = clean(body.pipelineId, 80);
      const stageIds = Array.isArray(body.stageIds) ? body.stageIds.map((value) => clean(value, 80)) : [];
      const existing = await db.prepare("SELECT id FROM crm_pipeline_stages WHERE owner_id=?1 AND pipeline_id=?2 ORDER BY position").bind(ownerId, pipelineId).all<{ id: string }>();
      const existingIds = new Set((existing.results || []).map((stage) => stage.id));
      if (!existingIds.size || stageIds.length !== existingIds.size || new Set(stageIds).size !== existingIds.size || stageIds.some((id) => !existingIds.has(id))) return reply("The stage order is out of date. Refresh and try again.");
      await db.batch(stageIds.map((id, position) => db.prepare("UPDATE crm_pipeline_stages SET position=?1 WHERE owner_id=?2 AND pipeline_id=?3 AND id=?4").bind(position, ownerId, pipelineId, id)));
      return Response.json({ ok: true });
    }
    if (action === "deleteStage") {
      const pipelineId = clean(body.pipelineId, 80), stageId = clean(body.stageId, 80);
      if (!pipelineId || !stageId) return reply("Choose a stage to delete.");
      const current = await db.prepare("SELECT id, position FROM crm_pipeline_stages WHERE owner_id=?1 AND pipeline_id=?2 AND id=?3").bind(ownerId, pipelineId, stageId).first<{ id: string; position: number }>();
      if (!current) return reply("That stage is no longer available.", 404);
      const occupied = await db.prepare("SELECT COUNT(*) AS total FROM crm_opportunities WHERE owner_id=?1 AND pipeline_id=?2 AND stage_id=?3").bind(ownerId, pipelineId, stageId).first<{ total: number }>();
      const targetStageId = clean(body.moveToStageId, 80);
      if (Number(occupied?.total || 0) > 0) {
        if (!targetStageId || targetStageId === stageId || !await db.prepare("SELECT id FROM crm_pipeline_stages WHERE owner_id=?1 AND pipeline_id=?2 AND id=?3").bind(ownerId, pipelineId, targetStageId).first()) return reply("Choose another stage to move these opportunities into before deleting this stage.");
      }
      await db.batch([
        ...(Number(occupied?.total || 0) > 0 ? [db.prepare("UPDATE crm_opportunities SET stage_id=?1, updated_at=?2 WHERE owner_id=?3 AND pipeline_id=?4 AND stage_id=?5").bind(targetStageId, now, ownerId, pipelineId, stageId)] : []),
        db.prepare("UPDATE crm_pipeline_stages SET position=position-1 WHERE owner_id=?1 AND pipeline_id=?2 AND position>?3").bind(ownerId, pipelineId, current.position),
        db.prepare("DELETE FROM crm_pipeline_stages WHERE owner_id=?1 AND pipeline_id=?2 AND id=?3").bind(ownerId, pipelineId, stageId),
        db.prepare("UPDATE crm_pipelines SET updated_at=?1 WHERE owner_id=?2 AND id=?3").bind(now, ownerId, pipelineId),
      ]);
      return Response.json({ ok: true });
    }
    if (action === "deleteOpportunity") {
      const id = clean(body.id, 80);
      const current = await db.prepare("SELECT id FROM crm_opportunities WHERE owner_id=?1 AND id=?2").bind(ownerId, id).first();
      if (!current) return reply("That opportunity is no longer available.", 404);
      await ensureOrderTable(db);
      await db.batch([
        db.prepare("DELETE FROM crm_activities WHERE owner_id=?1 AND opportunity_id=?2").bind(ownerId, id),
        db.prepare("DELETE FROM crm_opportunity_order WHERE owner_id=?1 AND opportunity_id=?2").bind(ownerId, id),
        db.prepare("DELETE FROM crm_opportunities WHERE owner_id=?1 AND id=?2").bind(ownerId, id),
      ]);
      return Response.json({ ok: true, id });
    }
    if (action === "reorderOpportunities") {
      const ids = Array.isArray(body.ids) ? body.ids.map((value: unknown) => clean(value, 80)).filter(Boolean).slice(0, 500) : [];
      if (!ids.length) return reply("Nothing to reorder.");
      const placeholders = ids.map((_, index) => `?${index + 2}`).join(",");
      const owned = await db.prepare(`SELECT id FROM crm_opportunities WHERE owner_id=?1 AND id IN (${placeholders})`).bind(ownerId, ...ids).all<{ id: string }>();
      const ownedIds = new Set((owned.results || []).map((row) => row.id));
      await ensureOrderTable(db);
      const statements = ids.filter((id) => ownedIds.has(id)).map((id, index) => db.prepare("INSERT INTO crm_opportunity_order (owner_id, opportunity_id, sort_order) VALUES (?1, ?2, ?3) ON CONFLICT(owner_id, opportunity_id) DO UPDATE SET sort_order = excluded.sort_order").bind(ownerId, id, index));
      if (statements.length) await db.batch(statements);
      return Response.json({ ok: true });
    }
    if (action === "updateOpportunityValue") {
      const id = clean(body.id, 80);
      const value = Math.round(Number(body.value) * 100) / 100;
      if (!Number.isFinite(value) || value < 0 || value > 1_000_000_000) return reply("Enter a valid amount.");
      const current = await db.prepare("SELECT id FROM crm_opportunities WHERE owner_id=?1 AND id=?2").bind(ownerId, id).first();
      if (!current) return reply("That opportunity is no longer available.", 404);
      await db.prepare("UPDATE crm_opportunities SET value=?1, source=CASE WHEN source='website estimate' THEN 'website form' ELSE source END, updated_at=?2 WHERE owner_id=?3 AND id=?4").bind(value, now, ownerId, id).run();
      return Response.json({ ok: true, id, value });
    }
    if (action === "updateOpportunityMeta") {
      const id = clean(body.id, 80);
      const current = await db.prepare("SELECT id FROM crm_opportunities WHERE owner_id=?1 AND id=?2").bind(ownerId, id).first();
      if (!current) return reply("That opportunity is no longer available.", 404);
      const assignedTo = clean(body.assignedTo, 80) || null;
      if (assignedTo && !(access.workspace.staff || []).some((item) => item.id === assignedTo)) return reply("Choose a teammate in this workspace.");
      const expectedCloseDate = clean(body.expectedCloseDate, 20) || null;
      if (expectedCloseDate && !/^\d{4}-\d{2}-\d{2}$/.test(expectedCloseDate)) return reply("Choose a valid target date.");
      await db.prepare("UPDATE crm_opportunities SET assigned_to=?1, expected_close_date=?2, updated_at=?3 WHERE owner_id=?4 AND id=?5").bind(assignedTo, expectedCloseDate, now, ownerId, id).run();
      return Response.json({ ok: true, id });
    }
    if (action === "createOpportunity" || action === "moveOpportunity" || action === "updateOpportunity") {
      const id = clean(body.id, 80) || crypto.randomUUID();
      if (action === "createOpportunity") {
        const pipeline = await db.prepare("SELECT id FROM crm_pipelines WHERE owner_id=?1 AND id=?2 AND archived=0").bind(ownerId, clean(body.pipelineId, 80)).first();
        const stage = await db.prepare("SELECT id FROM crm_pipeline_stages WHERE owner_id=?1 AND pipeline_id=?2 AND id=?3").bind(ownerId, clean(body.pipelineId, 80), clean(body.stageId, 80)).first();
        if (!pipeline || !stage || !clean(body.title, 200)) return reply("Choose a pipeline, stage, and opportunity name.");
        let contactId = clean(body.contactId, 80) || null;
        if (contactId && !await db.prepare("SELECT id FROM crm_contacts WHERE owner_id=?1 AND id=?2").bind(ownerId, contactId).first()) return reply("That contact is not in this workspace.");
        const clientId = clean(body.clientId, 100) || (crmScopeFrom(request) as { clientId: string | null } | null)?.clientId || null;
        if (clientId && !(access.workspace.clients || []).some((item) => String(item.id) === clientId)) return reply("Choose a client in this workspace.");
        if (!contactId) {
          // Every manually added opportunity also becomes a contact.
          const nc = body.newContact && typeof body.newContact === "object" ? body.newContact as Record<string, unknown> : {};
          const email = clean(nc.email, 254).toLowerCase(), phone = clean(nc.phone, 40);
          const existing = email || phone ? await db.prepare("SELECT id FROM crm_contacts WHERE owner_id=?1 AND COALESCE(client_id,'')=COALESCE(?2,'') AND ((?3<>'' AND lower(email)=?3) OR (?4<>'' AND phone=?4)) LIMIT 1").bind(ownerId, clientId, email, phone).first<{ id: string }>() : null;
          if (existing) contactId = existing.id;
          else {
            const typed = [clean(nc.firstName, 100), clean(nc.lastName, 100)].filter(Boolean);
            const parts = typed.length ? typed : clean(body.title, 200).split(/\s+/).filter(Boolean);
            contactId = crypto.randomUUID();
            await db.prepare("INSERT INTO crm_contacts (id, owner_id, client_id, first_name, last_name, email, phone, company, source, notes, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'manual', '', ?9, ?9)").bind(contactId, ownerId, clientId, (typed.length ? typed[0] : parts[0] || "").slice(0, 100), (typed.length ? typed.slice(1).join(" ") : parts.slice(1).join(" ")).slice(0, 100), email, phone, clean(nc.company, 200), now).run();
          }
        }
        const assignedTo = clean(body.assignedTo, 80) || null;
        if (assignedTo && !(access.workspace.staff || []).some((item) => item.id === assignedTo)) return reply("Choose a teammate in this workspace.");
        await db.prepare("INSERT INTO crm_opportunities (id, owner_id, pipeline_id, stage_id, contact_id, client_id, title, value, currency, assigned_to, expected_close_date, source, notes, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, 'manual', ?12, ?13, ?13)").bind(id, ownerId, clean(body.pipelineId, 80), clean(body.stageId, 80), contactId, clientId, clean(body.title, 200), Math.max(0, Number(body.value) || 0), clean(body.currency, 3) || "EUR", assignedTo, clean(body.expectedCloseDate, 20) || null, clean(body.notes, 4000), now).run();
        return Response.json({ ok: true, id });
      }
      const current = await db.prepare("SELECT id, pipeline_id FROM crm_opportunities WHERE owner_id=?1 AND id=?2").bind(ownerId, id).first<{ id: string; pipeline_id: string }>();
      if (!current) return reply("That opportunity is no longer available.", 404);
      if (action === "moveOpportunity") {
        const stage = await db.prepare("SELECT id FROM crm_pipeline_stages WHERE owner_id=?1 AND pipeline_id=?2 AND id=?3").bind(ownerId, current.pipeline_id, clean(body.stageId, 80)).first();
        if (!stage) return reply("Choose a stage in this pipeline.");
        await db.prepare("UPDATE crm_opportunities SET stage_id=?1, updated_at=?2 WHERE owner_id=?3 AND id=?4").bind(clean(body.stageId, 80), now, ownerId, id).run();
      } else {
        let contactId: string | null = clean(body.contactId, 80) || null;
        const nc = body.newContact && typeof body.newContact === "object" ? body.newContact as Record<string, unknown> : null;
        if (nc && (clean(nc.firstName, 100) || clean(nc.lastName, 100) || clean(nc.email, 254) || clean(nc.phone, 40))) {
          contactId = crypto.randomUUID();
          await db.prepare("INSERT INTO crm_contacts (id, owner_id, client_id, first_name, last_name, email, phone, company, source, notes, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, 'manual', '', ?9, ?9)").bind(contactId, ownerId, clean(body.clientId, 100) || (crmScopeFrom(request) as { clientId: string | null } | null)?.clientId || null, clean(nc.firstName, 100), clean(nc.lastName, 100), clean(nc.email, 254).toLowerCase(), clean(nc.phone, 40), clean(nc.company, 200), now).run();
        } else if (contactId && !await db.prepare("SELECT id FROM crm_contacts WHERE owner_id=?1 AND id=?2").bind(ownerId, contactId).first()) return reply("That contact is not in this workspace.");
        const clientId = clean(body.clientId, 100) || (crmScopeFrom(request) as { clientId: string | null } | null)?.clientId || null;
        if (clientId && !(access.workspace.clients || []).some((item) => String(item.id) === clientId)) return reply("Choose a client in this workspace.");
        await db.prepare("UPDATE crm_opportunities SET contact_id=?1, client_id=?2 WHERE owner_id=?3 AND id=?4").bind(contactId, clientId, ownerId, id).run();
      }
      if (action === "updateOpportunity") await db.prepare("UPDATE crm_opportunities SET title=?1, source=CASE WHEN source='website estimate' AND value<>?2 THEN 'website form' ELSE source END, value=?2, notes=?3, assigned_to=?4, expected_close_date=?5, updated_at=?6 WHERE owner_id=?7 AND id=?8").bind(clean(body.title, 200) || "Untitled opportunity", Math.max(0, Number(body.value) || 0), clean(body.notes, 4000), clean(body.assignedTo, 80) || null, clean(body.expectedCloseDate, 20) || null, now, ownerId, id).run();
      return Response.json({ ok: true, id });
    }
    if (action === "addActivity") {
      const bodyText = clean(body.body, 4000), contactId = clean(body.contactId, 80) || null, opportunityId = clean(body.opportunityId, 80) || null;
      if (!bodyText || (!contactId && !opportunityId)) return reply("Add a note to a contact or opportunity.");
      if (contactId && !await db.prepare("SELECT id FROM crm_contacts WHERE owner_id=?1 AND id=?2").bind(ownerId, contactId).first()) return reply("That contact is not in this workspace.");
      if (opportunityId && !await db.prepare("SELECT id FROM crm_opportunities WHERE owner_id=?1 AND id=?2").bind(ownerId, opportunityId).first()) return reply("That opportunity is not in this workspace.");
      const id = crypto.randomUUID();
      await db.prepare("INSERT INTO crm_activities (id, owner_id, opportunity_id, contact_id, activity_type, body, created_by, created_at) VALUES (?1, ?2, ?3, ?4, 'note', ?5, ?6, ?7)").bind(id, ownerId, opportunityId, contactId, bodyText, clean(user.email, 254), now).run();
      return Response.json({ ok: true, id });
    }
    if (action === "archivePipeline") {
      const pipelineId = clean(body.pipelineId, 80);
      if (await db.prepare("SELECT id FROM crm_opportunities WHERE owner_id=?1 AND pipeline_id=?2 LIMIT 1").bind(ownerId, pipelineId).first()) return reply("Move or close its opportunities before archiving this pipeline.", 409);
      await db.prepare("UPDATE crm_pipelines SET archived=1, updated_at=?1 WHERE owner_id=?2 AND id=?3").bind(now, ownerId, pipelineId).run();
      return Response.json({ ok: true });
    }
    return reply("Choose a supported CRM action.");
  } catch (error) { return reply(error instanceof Error ? error.message : "The CRM change could not be saved.", 500); }
}
