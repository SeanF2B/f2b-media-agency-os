import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";

export const dynamic = "force-dynamic";
const reply = (error: string, status = 400) => Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });
const stages = ["New lead", "Contacted", "Qualified", "Appointment booked", "Proposal sent", "Won", "Lost"] as const;
type StageCategory = "open" | "won" | "lost";
type WorkspaceData = { ownerId?: string; clients?: Array<{ id: string; name: string; company?: string; logo?: string; contact?: string; email?: string; phone?: string }>; staff?: Array<{ id: string; name: string; avatar?: string; email?: string; role?: string; isBot?: boolean }> };
type PipelineRow = { id: string; name: string; description: string; stage_id: string | null; stage_name: string | null; stage_position: number | null; stage_category: StageCategory | null };
type PipelineView = { id: string; name: string; description: string; stages: Array<{ id: string; name: string; position: number; category: StageCategory }> };

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
      const rows = await db.prepare("SELECT s.category, o.currency, COUNT(*) AS total, SUM(o.value) AS value FROM crm_opportunities o JOIN crm_pipeline_stages s ON s.id=o.stage_id AND s.owner_id=o.owner_id JOIN crm_pipelines p ON p.id=o.pipeline_id AND p.owner_id=o.owner_id WHERE o.owner_id=?1 AND p.archived=0 AND s.category IN ('open','won') GROUP BY s.category, o.currency").bind(ownerId).all<{ category: string; currency: string; total: number; value: number }>();
      const groups = (rows.results || []).map((row) => ({ category: row.category, currency: clean(row.currency, 3) || "EUR", count: Number(row.total) || 0, value: Number(row.value) || 0 }));
      return Response.json({ open: groups.filter((row) => row.category === "open"), won: groups.filter((row) => row.category === "won") }, { headers: { "Cache-Control": "no-store" } });
    }
    const search = clean(url.searchParams.get("search"), 120).toLowerCase();
    const [contacts, pipelineRows, opportunityRows, activityRows] = await Promise.all([
      db.prepare("SELECT * FROM crm_contacts WHERE owner_id = ?1 ORDER BY updated_at DESC LIMIT 1000").bind(ownerId).all<Record<string, unknown>>(),
      db.prepare("SELECT p.*, s.id AS stage_id, s.name AS stage_name, s.position AS stage_position, s.category AS stage_category FROM crm_pipelines p LEFT JOIN crm_pipeline_stages s ON s.owner_id = p.owner_id AND s.pipeline_id = p.id WHERE p.owner_id = ?1 AND p.archived = 0 ORDER BY p.created_at, s.position").bind(ownerId).all<PipelineRow>(),
      db.prepare("SELECT o.*, c.first_name, c.last_name, c.email, c.phone, c.company, s.name AS stage_name FROM crm_opportunities o LEFT JOIN crm_contacts c ON c.id = o.contact_id AND c.owner_id = o.owner_id LEFT JOIN crm_pipeline_stages s ON s.id = o.stage_id AND s.owner_id = o.owner_id WHERE o.owner_id = ?1 ORDER BY o.updated_at DESC LIMIT 2000").bind(ownerId).all<Record<string, unknown>>(),
      db.prepare("SELECT * FROM crm_activities WHERE owner_id = ?1 ORDER BY created_at DESC LIMIT 1000").bind(ownerId).all<Record<string, unknown>>(),
    ]);
    const orderRows = await db.prepare("SELECT opportunity_id, sort_order FROM crm_opportunity_order WHERE owner_id = ?1").bind(ownerId).all<{ opportunity_id: string; sort_order: number }>();
    const orderByOpportunity = new Map((orderRows.results || []).map((row) => [row.opportunity_id, row.sort_order] as const));
    const pipelines = new Map<string, PipelineView>();
    for (const r of pipelineRows.results || []) {
      if (!pipelines.has(r.id)) pipelines.set(r.id, { id: r.id, name: r.name, description: r.description, stages: [] });
      if (r.stage_id && r.stage_name && r.stage_position !== null && r.stage_category) pipelines.get(r.id)?.stages.push({ id: r.stage_id, name: r.stage_name, position: r.stage_position, category: r.stage_category });
    }
    const matches = (item: Record<string, unknown>) => !search || [item.title, item.first_name, item.last_name, item.email, item.company].some((value) => String(value || "").toLowerCase().includes(search));
    return Response.json({ contacts: contacts.results || [], pipelines: [...pipelines.values()], opportunities: (opportunityRows.results || []).map((row) => ({ ...row, sort_order: orderByOpportunity.has(String(row.id)) ? orderByOpportunity.get(String(row.id)) : null })).filter(matches), activities: activityRows.results || [], clients: (workspace.clients || []).map((item) => ({ id: String(item.id), name: String(item.name), company: String(item.company || ""), logo: String(item.logo || ""), contact: String(item.contact || ""), email: String(item.email || ""), phone: String(item.phone || "") })), staff: (workspace.staff || []).filter((item) => !item.isBot).map((item) => ({ id: String(item.id), name: String(item.name), avatar: String(item.avatar || "") })) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return reply(error instanceof Error ? error.message : "Could not load CRM records.", 500); }
}

export async function POST(request: Request) {
  const access = await context(); if (access.response) return access.response;
  const { db, ownerId, user } = access;
  let body: Record<string, unknown>; try { body = await request.json() as Record<string, unknown>; } catch { return reply("Send valid CRM details."); }
  const action = clean(body.action, 40), now = new Date().toISOString();
  try {
    if (action === "saveContact") {
      const id = clean(body.id, 80) || crypto.randomUUID(), email = clean(body.email, 254).toLowerCase();
      const firstName = clean(body.firstName, 100), lastName = clean(body.lastName, 100);
      if (!firstName && !lastName && !email && !clean(body.phone, 40)) return reply("Add at least a name, email, or phone number.");
      const clientId = clean(body.clientId, 100) || null;
      if (clientId && !(access.workspace.clients || []).some((item) => String(item.id) === clientId)) return reply("Choose a client in this workspace.");
      const sql = "INSERT INTO crm_contacts (id, owner_id, client_id, first_name, last_name, email, phone, company, source, notes, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11) ON CONFLICT(id) DO UPDATE SET client_id=excluded.client_id, first_name=excluded.first_name, last_name=excluded.last_name, email=excluded.email, phone=excluded.phone, company=excluded.company, notes=excluded.notes, updated_at=excluded.updated_at WHERE crm_contacts.owner_id=excluded.owner_id";
      await db.prepare(sql).bind(id, ownerId, clientId, firstName, lastName, email, clean(body.phone, 40), clean(body.company, 200), clean(body.source, 100) || "manual", clean(body.notes, 4000), now).run();
      return Response.json({ ok: true, id });
    }
    if (action === "createPipeline") {
      const name = clean(body.name, 120); if (!name) return reply("Enter a pipeline name.");
      const id = crypto.randomUUID(), names: string[] = Array.isArray(body.stages) ? body.stages.map((x: unknown) => clean(x, 80)).filter(Boolean).slice(0, 30) : [...stages];
      if (!names.some((x) => stageCategory(x) === "open")) names.unshift("New lead");
      if (!names.some((x) => stageCategory(x) === "won")) names.push("Won");
      if (!names.some((x) => stageCategory(x) === "lost")) names.push("Lost");
      await db.batch([db.prepare("INSERT INTO crm_pipelines (id, owner_id, name, description, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?5)").bind(id, ownerId, name, clean(body.description, 500), now), ...names.map((stageName: string, position: number) => db.prepare("INSERT INTO crm_pipeline_stages (id, owner_id, pipeline_id, name, position, category, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)").bind(crypto.randomUUID(), ownerId, id, stageName, position, stageCategory(stageName), now))]);
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
      await db.prepare("UPDATE crm_opportunities SET value=?1, updated_at=?2 WHERE owner_id=?3 AND id=?4").bind(value, now, ownerId, id).run();
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
        const contactId = clean(body.contactId, 80) || null;
        if (contactId && !await db.prepare("SELECT id FROM crm_contacts WHERE owner_id=?1 AND id=?2").bind(ownerId, contactId).first()) return reply("That contact is not in this workspace.");
        const clientId = clean(body.clientId, 100) || null;
        if (clientId && !(access.workspace.clients || []).some((item) => String(item.id) === clientId)) return reply("Choose a client in this workspace.");
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
      } else await db.prepare("UPDATE crm_opportunities SET title=?1, value=?2, notes=?3, assigned_to=?4, expected_close_date=?5, updated_at=?6 WHERE owner_id=?7 AND id=?8").bind(clean(body.title, 200) || "Untitled opportunity", Math.max(0, Number(body.value) || 0), clean(body.notes, 4000), clean(body.assignedTo, 80) || null, clean(body.expectedCloseDate, 20) || null, now, ownerId, id).run();
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
