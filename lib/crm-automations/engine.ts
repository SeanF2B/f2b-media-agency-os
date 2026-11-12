// Event-driven runner for native CRM Automations.
//
// D1 budget rules (we are close to the free daily read limit):
//  * every query is index-backed and bounded with LIMIT; nothing scans a whole table;
//  * an idle tick (no automation switched on, nothing waiting) costs a few index probes and no row reads;
//  * change detection reads only rows changed since a stored cursor;
//  * writes are grouped into db.batch() calls.
//
// Idempotency: events carry a unique dedupe_key, a run is unique per (automation, event), a contact can only be
// active once per automation, each step is unique per (run, node), and every side effect is either an upsert
// with a deterministic id or (email) sent with a Resend Idempotency-Key derived from run + step.

import {
  type AutomationDefinition, type AutomationNode, type Branch, type ConditionSet, type ContactFacts,
  evaluateConditions, nextNodeId, nextScheduleFire, nodeById, nodeSummary, nodeTitle, normalizeTag, renderMerge, triggerOf, waitUntil, zonedToUtc,
} from "./model.ts";
import { AUTOMATION_SCHEMA_SQL } from "./schema-sql.ts";

export type Stmt = {
  bind(...values: unknown[]): Stmt;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results?: T[] }>;
  run(): Promise<{ meta: { changes?: number } }>;
};
export type Db = { prepare(sql: string): Stmt; batch(statements: Stmt[]): Promise<unknown[]> };
export type EmailMessage = { to: string; subject: string; text: string; html: string; idempotencyKey: string };
export type Effects = { sendEmail?: (message: EmailMessage) => Promise<void> };

type LiveAutomation = { id: string; owner_id: string; scope_id: string; trigger_type: string; definition: string; next_fire_at: string | null; parsed?: AutomationDefinition | null };
type EventRow = { id: string; owner_id: string; scope_id: string; event_type: string; contact_id: string | null; payload: string; source_automation_id: string | null; created_at: string };
type RunRow = { id: string; owner_id: string; automation_id: string; scope_id: string; contact_id: string; status: string; current_node_id: string | null; resume_at: string | null; attempts: number };
type Workspace = { ownerId?: string; staff?: Array<{ id: string; name?: string; email?: string; role?: string; isBot?: boolean }>; tasks?: Array<Record<string, unknown>>; [key: string]: unknown };

const LEASE_MS = 10 * 60_000;
const CURSOR_SLACK_MS = 2 * 60_000;
const MAX_STEPS_PER_PASS = 25;
const MAX_RUNS_PER_TICK = 25;
const MAX_EVENTS_PER_TICK = 100;
const MAX_ATTEMPTS = 3;
const SCHEDULE_AUDIENCE_LIMIT = 500;

const iso = (date: Date) => date.toISOString();
const uid = (prefix: string) => `${prefix}_${crypto.randomUUID()}`;
const changes = (result: unknown) => Number((result as { meta?: { changes?: number } })?.meta?.changes || 0);
const parse = <T>(value: unknown, fallback: T): T => { try { return JSON.parse(String(value)) as T; } catch { return fallback; } };

// ---------- schema ----------
// Runs the idempotent CREATE ... IF NOT EXISTS statements once per isolate per database binding,
// so the feature also works before the migration has been applied.
const schemaReady = new WeakMap<object, Promise<void>>();
export function ensureAutomationTables(db: Db) {
  let ready = schemaReady.get(db);
  if (!ready) {
    const statements = AUTOMATION_SCHEMA_SQL.split(/;\s*\n/).map((part) => part.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n").trim()).filter(Boolean);
    ready = db.batch(statements.map((sql) => db.prepare(sql))).then(() => undefined).catch((error) => { schemaReady.delete(db); throw error; });
    schemaReady.set(db, ready);
  }
  return ready;
}

// ---------- events ----------
export type AutomationEvent = { ownerId: string; scopeId: string; type: string; contactId: string | null; payload: Record<string, unknown>; dedupeKey: string; sourceAutomationId?: string | null };
export function eventStatement(db: Db, event: AutomationEvent, now: Date) {
  return db.prepare("INSERT OR IGNORE INTO crm_automation_events (id, owner_id, scope_id, event_type, contact_id, payload, dedupe_key, source_automation_id, status, created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,'pending',?9)")
    .bind(uid("ev"), event.ownerId, event.scopeId || "", event.type, event.contactId, JSON.stringify(event.payload || {}), event.dedupeKey.slice(0, 300), event.sourceAutomationId || null, iso(now));
}
export async function emitAutomationEvent(db: Db, event: AutomationEvent, now = new Date()) {
  await ensureAutomationTables(db);
  await eventStatement(db, event, now).run();
}

export function triggerMatches(automation: { id: string; scope_id: string; trigger_type: string; parsed?: AutomationDefinition | null }, event: Pick<EventRow, "scope_id" | "event_type" | "payload" | "source_automation_id" | "contact_id">) {
  if (automation.scope_id !== (event.scope_id || "") || automation.trigger_type !== event.event_type || !event.contact_id) return false;
  if (event.source_automation_id && event.source_automation_id === automation.id) return false; // an automation never re-triggers itself
  const config = (automation.parsed && triggerOf(automation.parsed)?.config) || {};
  const payload = parse<Record<string, unknown>>(event.payload, {});
  switch (event.event_type) {
    case "form_lead": return !config.formName || String(payload.source || "") === `Website form · ${String(config.formName)}`.slice(0, 100);
    case "tag_added": return Boolean(config.tag) && normalizeTag(config.tag) === normalizeTag(payload.tag);
    case "stage_changed": return Boolean(config.pipelineId) && config.pipelineId === payload.pipelineId && (!config.fromStageId || config.fromStageId === payload.fromStageId) && (!config.toStageId || config.toStageId === payload.toStageId);
    case "task_completed":
      if (config.match === "automation") return Boolean(payload.byAutomation);
      if (config.match === "title") return Boolean(config.titleContains) && String(payload.title || "").toLowerCase().includes(String(config.titleContains).toLowerCase());
      return true;
    default: return false;
  }
}

// ---------- contact facts ----------
export async function loadContactFacts(db: Db, ownerId: string, contactId: string): Promise<ContactFacts | null> {
  const contact = await db.prepare("SELECT id, client_id, first_name, last_name, email, phone, company, source FROM crm_contacts WHERE id=?1 AND owner_id=?2").bind(contactId, ownerId).first<Record<string, string | null>>();
  if (!contact) return null;
  const [tags, stages] = await Promise.all([
    db.prepare("SELECT tag FROM crm_contact_tags WHERE owner_id=?1 AND contact_id=?2 LIMIT 200").bind(ownerId, contactId).all<{ tag: string }>(),
    db.prepare("SELECT stage_id FROM crm_opportunities WHERE owner_id=?1 AND contact_id=?2 ORDER BY updated_at DESC LIMIT 50").bind(ownerId, contactId).all<{ stage_id: string }>(),
  ]);
  return {
    id: String(contact.id), client_id: contact.client_id || null,
    first_name: String(contact.first_name || ""), last_name: String(contact.last_name || ""), email: String(contact.email || ""), phone: String(contact.phone || ""), company: String(contact.company || ""), source: String(contact.source || ""),
    tags: (tags.results || []).map((row) => row.tag), stageIds: (stages.results || []).map((row) => row.stage_id),
  };
}

const contactName = (contact: ContactFacts) => [contact.first_name, contact.last_name].filter(Boolean).join(" ") || contact.email || contact.phone || "this contact";

// ---------- workspace (tasks / staff live in the workspace JSON document) ----------
async function readWorkspace(db: Db) {
  const row = await db.prepare("SELECT data, updated_at FROM workspace_documents WHERE id = 'f2b-agency'").first<{ data: string; updated_at: string }>();
  return row ? { data: parse<Workspace>(row.data, {}), version: row.updated_at } : null;
}
async function updateWorkspace(db: Db, mutate: (data: Workspace) => Workspace | null) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const current = await readWorkspace(db);
    if (!current) return false;
    const next = mutate(current.data);
    if (!next) return true;
    const saved = await db.prepare("UPDATE workspace_documents SET data = ?1, updated_at = ?2 WHERE id = 'f2b-agency' AND updated_at = ?3").bind(JSON.stringify(next), `crm-auto-${crypto.randomUUID()}`, current.version).run();
    if (changes(saved) === 1) return true;
  }
  throw new Error("The task list was busy. The step will be retried.");
}

function dublinDate(date: Date) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Dublin", year: "numeric", month: "2-digit", day: "2-digit" }).format(date);
}

function escapeHtml(value: string) { return value.replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char] as string); }
function htmlEmail(text: string) {
  return `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;line-height:1.6;color:#22272b">${text.split(/\n{2,}/).map((paragraph) => `<p style="margin:0 0 14px">${escapeHtml(paragraph).replace(/\n/g, "<br>")}</p>`).join("")}</div>`;
}

// ---------- step execution ----------
type StepResult = { status: "done" | "skipped" | "waiting"; detail: string; branch?: Branch; resumeAt?: Date };
type StepContext = { db: Db; run: RunRow; node: AutomationNode; contact: ContactFacts; now: Date; effects: Effects; dryRun: boolean; workspace: () => Promise<Workspace | null>; lookups: Lookups; events: AutomationEvent[] };
type Lookups = { stageName: (id: string) => string; staffName: (id: string) => string };

async function executeStep(ctx: StepContext): Promise<StepResult> {
  const { db, run, node, contact, now, effects, dryRun } = ctx;
  const c = node.config || {};
  const key = `crm-auto-${run.id}-${node.id}`;
  switch (node.type) {
    case "send_email": {
      if (!contact.email) return { status: "skipped", detail: "Skipped: this contact has no email address." };
      const subject = renderMerge(String(c.subject || ""), contact).slice(0, 200);
      const body = renderMerge(String(c.body || ""), contact).slice(0, 20_000);
      if (dryRun) return { status: "done", detail: `Would email ${contact.email}\nSubject: ${subject}\n\n${body.slice(0, 600)}${body.length > 600 ? "…" : ""}` };
      if (!effects.sendEmail) throw new Error("Email isn't set up yet. Add RESEND_API_KEY and TASK_NOTIFICATION_FROM to the Worker.");
      await effects.sendEmail({ to: contact.email, subject, text: body, html: htmlEmail(body), idempotencyKey: key });
      return { status: "done", detail: `Emailed ${contact.email} · "${subject}"` };
    }
    case "add_tag": case "remove_tag": {
      const tag = normalizeTag(c.tag);
      if (!tag) return { status: "skipped", detail: "Skipped: no tag chosen." };
      const has = contact.tags.includes(tag);
      if (node.type === "add_tag") {
        if (has) return { status: "done", detail: `Already tagged "${tag}".` };
        contact.tags.push(tag);
        if (dryRun) return { status: "done", detail: `Would add tag "${tag}".` };
        const saved = await db.prepare("INSERT OR IGNORE INTO crm_contact_tags (owner_id, contact_id, tag, created_at) VALUES (?1,?2,?3,?4)").bind(run.owner_id, contact.id, tag, iso(now)).run();
        if (changes(saved)) ctx.events.push({ ownerId: run.owner_id, scopeId: run.scope_id, type: "tag_added", contactId: contact.id, payload: { tag }, dedupeKey: `tag:${contact.id}:${tag}:${key}`, sourceAutomationId: run.automation_id });
        return { status: "done", detail: `Added tag "${tag}".` };
      }
      if (!has) return { status: "done", detail: `Didn't have tag "${tag}".` };
      contact.tags = contact.tags.filter((item) => item !== tag);
      if (dryRun) return { status: "done", detail: `Would remove tag "${tag}".` };
      await db.prepare("DELETE FROM crm_contact_tags WHERE owner_id=?1 AND contact_id=?2 AND tag=?3").bind(run.owner_id, contact.id, tag).run();
      return { status: "done", detail: `Removed tag "${tag}".` };
    }
    case "move_stage": {
      const pipelineId = String(c.pipelineId || ""), stageId = String(c.stageId || "");
      const stage = await db.prepare("SELECT s.id, s.name FROM crm_pipeline_stages s JOIN crm_pipelines p ON p.id = s.pipeline_id WHERE s.id=?1 AND s.owner_id=?2 AND s.pipeline_id=?3 AND p.archived=0").bind(stageId, run.owner_id, pipelineId).first<{ id: string; name: string }>();
      if (!stage) throw new Error("The chosen pipeline stage no longer exists. Pick another stage.");
      const deal = await db.prepare("SELECT id, stage_id FROM crm_opportunities WHERE owner_id=?1 AND contact_id=?2 AND pipeline_id=?3 ORDER BY updated_at DESC LIMIT 1").bind(run.owner_id, contact.id, pipelineId).first<{ id: string; stage_id: string }>();
      if (deal?.stage_id === stageId) return { status: "done", detail: `Already in "${stage.name}".` };
      contact.stageIds = [stageId, ...contact.stageIds.filter((id) => id !== deal?.stage_id)];
      if (dryRun) return { status: "done", detail: deal ? `Would move their deal to "${stage.name}".` : `Would create a deal in "${stage.name}".` };
      const stamp = iso(now);
      if (deal) {
        await db.batch([
          db.prepare("UPDATE crm_opportunities SET stage_id=?1, updated_at=?2 WHERE owner_id=?3 AND id=?4").bind(stageId, stamp, run.owner_id, deal.id),
          db.prepare("INSERT INTO crm_automation_stage_snapshot (owner_id, opportunity_id, stage_id) VALUES (?1,?2,?3) ON CONFLICT(owner_id, opportunity_id) DO UPDATE SET stage_id=excluded.stage_id").bind(run.owner_id, deal.id, stageId),
        ]);
        ctx.events.push({ ownerId: run.owner_id, scopeId: run.scope_id, type: "stage_changed", contactId: contact.id, payload: { opportunityId: deal.id, pipelineId, fromStageId: deal.stage_id, toStageId: stageId }, dedupeKey: `stage:${deal.id}:${stageId}:${key}`, sourceAutomationId: run.automation_id });
        return { status: "done", detail: `Moved their deal to "${stage.name}".` };
      }
      const dealId = `ao_${run.id.slice(-12)}_${node.id}`.slice(0, 80);
      await db.batch([
        db.prepare("INSERT OR IGNORE INTO crm_opportunities (id, owner_id, pipeline_id, stage_id, contact_id, client_id, title, value, currency, source, notes, created_at, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,0,'EUR','automation','',?8,?8)").bind(dealId, run.owner_id, pipelineId, stageId, contact.id, contact.client_id, contactName(contact).slice(0, 200), stamp),
        db.prepare("INSERT OR IGNORE INTO crm_automation_stage_snapshot (owner_id, opportunity_id, stage_id) VALUES (?1,?2,?3)").bind(run.owner_id, dealId, stageId),
      ]);
      return { status: "done", detail: `Created a deal in "${stage.name}".` };
    }
    case "create_task": {
      const workspace = await ctx.workspace();
      const assigneeId = String(c.assigneeId || "");
      const assignee = workspace?.staff?.find((member) => member.id === assigneeId);
      const days = Math.max(0, Math.min(365, Math.round(Number(c.dueInDays) || 0)));
      const due = dublinDate(new Date(now.getTime() + days * 86_400_000));
      const title = renderMerge(String(c.title || ""), contact).slice(0, 200) || "Follow up";
      if (dryRun) return { status: "done", detail: `Would create task "${title}"${assignee ? ` for ${assignee.name}` : ""}, due ${due}.` };
      const taskId = `auto-${run.id.slice(-12)}-${node.id}`.slice(0, 80);
      const notes = [renderMerge(String(c.notes || ""), contact), `Contact: ${contactName(contact)}${contact.email ? ` · ${contact.email}` : ""}${contact.phone ? ` · ${contact.phone}` : ""}`].filter(Boolean).join("\n\n").slice(0, 4000);
      await updateWorkspace(db, (data) => {
        const tasks = Array.isArray(data.tasks) ? data.tasks : [];
        if (tasks.some((task) => task.id === taskId)) return null; // already created on an earlier attempt
        const task = { id: taskId, clientId: run.scope_id || contact.client_id || "", projectId: "", title, assigneeId: assignee ? assignee.id : "", status: "To do", priority: "Normal", service: "CRM", estimate: 0, due, createdAt: iso(now), createdById: "automation", notes, automationRunId: run.id, automationId: run.automation_id, automationContactId: contact.id, automationScopeId: run.scope_id };
        return { ...data, tasks: [task, ...tasks] };
      });
      return { status: "done", detail: `Created task "${title}"${assignee ? ` for ${assignee.name}` : ""}, due ${due}.` };
    }
    case "notify": {
      const message = renderMerge(String(c.message || "Automation update for {{contact.full_name}}"), contact).slice(0, 500);
      const workspace = await ctx.workspace();
      const ids = Array.isArray(c.recipientIds) && c.recipientIds.length ? c.recipientIds.map(String) : [String(workspace?.ownerId || "")];
      const recipients = (workspace?.staff || []).filter((member) => !member.isBot && ids.includes(member.id) && member.email?.includes("@"));
      const fallback = recipients.length ? recipients : (workspace?.staff || []).filter((member) => !member.isBot && member.role === "Owner" && member.email?.includes("@")).slice(0, 1);
      if (dryRun) return { status: "done", detail: `Would alert ${fallback.map((member) => member.name).join(", ") || "you"} in the app${c.email === false ? "" : " and by email"}: "${message}"` };
      await db.prepare("INSERT OR IGNORE INTO crm_automation_notifications (id, owner_id, scope_id, automation_id, run_id, contact_id, title, body, created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9)")
        .bind(`nt_${run.id.slice(-12)}_${node.id}`.slice(0, 80), run.owner_id, run.scope_id, run.automation_id, run.id, contact.id, message, `Contact: ${contactName(contact)}`, iso(now)).run();
      let emailed = "";
      if (c.email !== false && fallback.length) {
        if (!effects.sendEmail) emailed = " Email alerts aren't set up yet (RESEND_API_KEY / TASK_NOTIFICATION_FROM).";
        else {
          for (const member of fallback) await effects.sendEmail({ to: String(member.email), subject: `Automation alert: ${message}`.slice(0, 200), text: `${message}\n\nContact: ${contactName(contact)}${contact.email ? ` (${contact.email})` : ""}`, html: htmlEmail(`${message}\n\nContact: ${contactName(contact)}${contact.email ? ` (${contact.email})` : ""}`), idempotencyKey: `${key}-${member.id}` });
          emailed = ` Emailed ${fallback.map((member) => member.name).join(", ")}.`;
        }
      }
      return { status: "done", detail: `Alert sent: "${message}".${emailed}` };
    }
    case "wait": {
      const until = waitUntil(c, now);
      if (!until || until.getTime() <= now.getTime()) return { status: "done", detail: "No wait needed." };
      const label = new Intl.DateTimeFormat("en-IE", { timeZone: "Europe/Dublin", dateStyle: "medium", timeStyle: "short" }).format(until);
      if (dryRun) return { status: "done", detail: `Would wait until ${label}.` };
      return { status: "waiting", detail: `Waiting until ${label}.`, resumeAt: until };
    }
    case "if_else": {
      const passed = evaluateConditions(c.conditions as ConditionSet, contact);
      return { status: "done", branch: passed ? "yes" : "no", detail: passed ? "Yes — the rules matched." : "No — the rules didn't match." };
    }
    default:
      return { status: "skipped", detail: "This step type isn't supported yet." };
  }
}

// ---------- runs ----------
function stepTitle(node: AutomationNode, lookups?: Lookups) { return `${nodeTitle(node)} · ${nodeSummary(node, lookups)}`.slice(0, 200); }

export async function startRunStatements(db: Db, automation: { id: string; owner_id: string; scope_id: string; parsed: AutomationDefinition }, contactId: string, eventId: string, summary: string, now: Date) {
  const trigger = triggerOf(automation.parsed);
  const first = trigger ? nextNodeId(automation.parsed, trigger.id) : null;
  const runId = uid("run"), stamp = iso(now);
  return [
    db.prepare(`INSERT OR IGNORE INTO crm_automation_runs (id, owner_id, automation_id, scope_id, contact_id, status, dry_run, current_node_id, resume_at, event_id, trigger_summary, started_at, updated_at, finished_at) VALUES (?1,?2,?3,?4,?5,?6,0,?7,?8,?9,?10,?11,?11,?12)`)
      .bind(runId, automation.owner_id, automation.id, automation.scope_id, contactId, first ? "running" : "completed", first, first ? stamp : null, eventId, summary.slice(0, 300), stamp, first ? null : stamp),
    db.prepare("UPDATE crm_automations SET total_runs = total_runs + 1, last_run_at = ?1 WHERE id = ?2 AND EXISTS (SELECT 1 FROM crm_automation_runs WHERE id = ?3)").bind(stamp, automation.id, runId),
    db.prepare("INSERT OR IGNORE INTO crm_automation_steps (id, owner_id, run_id, node_id, node_type, title, status, detail, created_at, updated_at) SELECT ?1,?2,?3,?4,'trigger',?5,'done',?6,?7,?7 WHERE EXISTS (SELECT 1 FROM crm_automation_runs WHERE id=?3)")
      .bind(uid("st"), automation.owner_id, runId, trigger?.id || "trigger", trigger ? stepTitle(trigger) : "Trigger", summary.slice(0, 500), stamp),
  ];
}

async function finishRun(db: Db, runId: string, fields: { status: string; current: string | null; resumeAt: string | null; error?: string | null; attempts?: number }, now: Date) {
  const done = fields.status === "completed" || fields.status === "failed" || fields.status === "cancelled";
  await db.prepare("UPDATE crm_automation_runs SET status=?1, current_node_id=?2, resume_at=?3, error=?4, attempts=COALESCE(?5, attempts), updated_at=?6, finished_at=?7 WHERE id=?8")
    .bind(fields.status, fields.current, fields.resumeAt, fields.error ?? null, fields.attempts ?? null, iso(now), done ? iso(now) : null, runId).run();
}

function stepWrite(db: Db, run: { id: string; owner_id: string }, node: AutomationNode, status: string, detail: string, now: Date, lookups?: Lookups) {
  return db.prepare("INSERT INTO crm_automation_steps (id, owner_id, run_id, node_id, node_type, title, status, detail, created_at, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?9) ON CONFLICT(run_id, node_id) DO UPDATE SET status=excluded.status, detail=excluded.detail, updated_at=excluded.updated_at")
    .bind(uid("st"), run.owner_id, run.id, node.id, node.type, stepTitle(node, lookups), status, detail.slice(0, 2000), iso(now));
}

async function makeLookups(db: Db, ownerId: string, workspace: () => Promise<Workspace | null>, definition: AutomationDefinition): Promise<Lookups> {
  const stageIds = [...new Set(definition.nodes.flatMap((node) => [node.config?.stageId, node.config?.fromStageId, node.config?.toStageId]).filter(Boolean).map(String))].slice(0, 50);
  const names = new Map<string, string>();
  if (stageIds.length) {
    const rows = await db.prepare(`SELECT id, name FROM crm_pipeline_stages WHERE owner_id=?1 AND id IN (${stageIds.map((_, index) => `?${index + 2}`).join(",")})`).bind(ownerId, ...stageIds).all<{ id: string; name: string }>();
    for (const row of rows.results || []) names.set(row.id, row.name);
  }
  const staff = definition.nodes.some((node) => node.type === "create_task") ? (await workspace())?.staff || [] : [];
  return { stageName: (id) => names.get(id) || "a stage", staffName: (id) => staff.find((member) => member.id === id)?.name || "a teammate" };
}

async function advanceRun(db: Db, run: RunRow, now: Date, effects: Effects, workspace: () => Promise<Workspace | null>, paused: (ownerId: string, scopeId: string) => Promise<boolean>) {
  const lease = iso(new Date(now.getTime() + LEASE_MS));
  const claim = await db.prepare("UPDATE crm_automation_runs SET resume_at=?1, updated_at=?2 WHERE id=?3 AND resume_at IS ?4 AND status IN ('running','waiting')").bind(lease, iso(now), run.id, run.resume_at).run();
  if (changes(claim) !== 1) return;
  const automation = await db.prepare("SELECT status, definition FROM crm_automations WHERE id=?1 AND owner_id=?2").bind(run.automation_id, run.owner_id).first<{ status: string; definition: string }>();
  if (!automation || automation.status !== "on") return finishRun(db, run.id, { status: "cancelled", current: run.current_node_id, resumeAt: null, error: "The automation was switched off or deleted." }, now);
  if (await paused(run.owner_id, run.scope_id)) return finishRun(db, run.id, { status: "cancelled", current: run.current_node_id, resumeAt: null, error: "Stopped by the kill switch for this account." }, now);
  const definition = parse<AutomationDefinition>(automation.definition, { nodes: [], edges: [] });
  const contact = await loadContactFacts(db, run.owner_id, run.contact_id);
  if (!contact) return finishRun(db, run.id, { status: "failed", current: run.current_node_id, resumeAt: null, error: "This contact no longer exists." }, now);
  const lookups = await makeLookups(db, run.owner_id, workspace, definition);
  const events: AutomationEvent[] = [];
  let current = run.current_node_id;
  try {
    for (let count = 0; current && count < MAX_STEPS_PER_PASS; count++) {
      const node = nodeById(definition, current);
      if (!node) { current = null; break; } // step was removed while the contact was waiting
      const prior = await db.prepare("SELECT status, detail FROM crm_automation_steps WHERE run_id=?1 AND node_id=?2").bind(run.id, node.id).first<{ status: string; detail: string }>();
      let result: StepResult;
      if (prior && (prior.status === "done" || prior.status === "skipped")) {
        result = { status: prior.status as "done" | "skipped", detail: prior.detail, branch: node.type === "if_else" ? (prior.detail.startsWith("Yes") ? "yes" : "no") : undefined };
      } else if (prior?.status === "waiting") {
        result = { status: "done", detail: `${prior.detail.replace(/^Waiting/, "Waited")}` };
        await stepWrite(db, run, node, "done", result.detail, now, lookups).run();
      } else {
        await stepWrite(db, run, node, "started", "Working on it…", now, lookups).run();
        result = await executeStep({ db, run, node, contact, now, effects, dryRun: false, workspace, lookups, events });
        await stepWrite(db, run, node, result.status, result.detail, now, lookups).run();
      }
      if (result.status === "waiting" && result.resumeAt) {
        if (events.length) await db.batch(events.map((event) => eventStatement(db, event, now)));
        return finishRun(db, run.id, { status: "waiting", current: node.id, resumeAt: iso(result.resumeAt), attempts: 0 }, now);
      }
      current = nextNodeId(definition, node.id, node.type === "if_else" ? result.branch : undefined);
    }
    if (events.length) await db.batch(events.map((event) => eventStatement(db, event, now)));
    if (current) return finishRun(db, run.id, { status: "running", current, resumeAt: iso(now), attempts: 0 }, now); // long flow: continue next tick
    return finishRun(db, run.id, { status: "completed", current: null, resumeAt: null, attempts: 0 }, now);
  } catch (error) {
    if (events.length) await db.batch(events.map((event) => eventStatement(db, event, now))).catch(() => undefined);
    const message = (error instanceof Error ? error.message : String(error)).slice(0, 500);
    const attempts = (Number(run.attempts) || 0) + 1;
    const node = current ? nodeById(definition, current) : null;
    const permanent = /no longer exists|isn't set up|not set up|pick another/i.test(message);
    if (!permanent && attempts < MAX_ATTEMPTS) {
      if (node) await stepWrite(db, run, node, "started", `Retrying soon: ${message}`, now, lookups).run();
      return finishRun(db, run.id, { status: "running", current, resumeAt: iso(new Date(now.getTime() + attempts * 5 * 60_000)), error: message, attempts }, now);
    }
    if (node) await stepWrite(db, run, node, "failed", message, now, lookups).run();
    return finishRun(db, run.id, { status: "failed", current, resumeAt: null, error: message, attempts }, now);
  }
}

// ---------- test run (dry run) ----------
export type SimulatedStep = { nodeId: string; title: string; status: string; detail: string };
export async function simulateRun(db: Db, input: { ownerId: string; automationId: string; scopeId: string; definition: AutomationDefinition; contactId: string }, now = new Date(), saveHistory = true) {
  const contact = await loadContactFacts(db, input.ownerId, input.contactId);
  if (!contact) throw new Error("That contact could not be found.");
  let cachedWorkspace: Promise<Workspace | null> | null = null;
  const workspace = () => (cachedWorkspace ||= readWorkspace(db).then((row) => row?.data || null));
  const lookups = await makeLookups(db, input.ownerId, workspace, input.definition);
  const trigger = triggerOf(input.definition);
  const run: RunRow = { id: uid("run"), owner_id: input.ownerId, automation_id: input.automationId, scope_id: input.scopeId, contact_id: contact.id, status: "running", current_node_id: null, resume_at: null, attempts: 0 };
  const steps: SimulatedStep[] = trigger ? [{ nodeId: trigger.id, title: stepTitle(trigger, lookups), status: "simulated", detail: `Test started for ${contactName(contact)}.` }] : [];
  let current = trigger ? nextNodeId(input.definition, trigger.id) : null;
  for (let count = 0; current && count < 80; count++) {
    const node = nodeById(input.definition, current);
    if (!node) break;
    let result: StepResult;
    try { result = await executeStep({ db, run, node, contact, now, effects: {}, dryRun: true, workspace, lookups, events: [] }); }
    catch (error) { result = { status: "skipped", detail: `Would fail: ${error instanceof Error ? error.message : String(error)}` }; }
    steps.push({ nodeId: node.id, title: stepTitle(node, lookups), status: result.status === "skipped" ? "skipped" : "simulated", detail: result.detail });
    current = nextNodeId(input.definition, node.id, node.type === "if_else" ? result.branch : undefined);
  }
  if (saveHistory) {
    const stamp = iso(now);
    await db.batch([
      db.prepare("INSERT INTO crm_automation_runs (id, owner_id, automation_id, scope_id, contact_id, status, dry_run, trigger_summary, started_at, updated_at, finished_at) VALUES (?1,?2,?3,?4,?5,'completed',1,'Test run (nothing was sent)',?6,?6,?6)").bind(run.id, input.ownerId, input.automationId, input.scopeId, contact.id, stamp),
      ...steps.map((step) => db.prepare("INSERT INTO crm_automation_steps (id, owner_id, run_id, node_id, node_type, title, status, detail, created_at, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?9)")
        .bind(uid("st"), input.ownerId, run.id, step.nodeId, nodeById(input.definition, step.nodeId)?.type || "trigger", step.title, step.status, step.detail.slice(0, 2000), stamp)),
    ]);
  }
  return { runId: run.id, contact: { id: contact.id, name: contactName(contact), email: contact.email }, steps };
}

// ---------- change detection (cheap, cursor-based) ----------
async function readCursor(db: Db, ownerId: string, name: string) {
  return (await db.prepare("SELECT value FROM crm_automation_cursors WHERE owner_id=?1 AND name=?2").bind(ownerId, name).first<{ value: string }>())?.value || null;
}
function cursorStatement(db: Db, ownerId: string, name: string, value: string) {
  return db.prepare("INSERT INTO crm_automation_cursors (owner_id, name, value) VALUES (?1,?2,?3) ON CONFLICT(owner_id, name) DO UPDATE SET value=excluded.value").bind(ownerId, name, value);
}
function nextCursor(seen: string[], limitHit: boolean, now: Date, previous: string) {
  const max = seen.reduce((best, value) => (value > best ? value : best), previous);
  if (limitHit) return max;
  const slack = iso(new Date(now.getTime() - CURSOR_SLACK_MS));
  return max > slack ? max : slack;
}

async function detectFormLeads(db: Db, ownerId: string, now: Date) {
  const cursor = await readCursor(db, ownerId, "form_leads");
  if (!cursor) { await cursorStatement(db, ownerId, "form_leads", iso(now)).run(); return; } // start from "now", never backfill
  const rows = (await db.prepare("SELECT id, client_id, source, created_at, updated_at FROM crm_contacts WHERE owner_id=?1 AND updated_at>=?2 AND created_at>=?2 AND source LIKE 'Website form%' ORDER BY updated_at LIMIT 200").bind(ownerId, cursor).all<{ id: string; client_id: string | null; source: string; created_at: string; updated_at: string }>()).results || [];
  await db.batch([
    ...rows.map((row) => eventStatement(db, { ownerId, scopeId: row.client_id || "", type: "form_lead", contactId: row.id, payload: { source: row.source }, dedupeKey: `lead:${row.id}` }, now)),
    cursorStatement(db, ownerId, "form_leads", nextCursor(rows.map((row) => row.updated_at), rows.length === 200, now, cursor)),
  ]);
}

async function detectStageChanges(db: Db, ownerId: string, now: Date) {
  const cursor = await readCursor(db, ownerId, "stages");
  if (!cursor) {
    // One-off baseline when the first stage automation goes live: remember where every deal is today.
    await db.batch([
      db.prepare("INSERT OR IGNORE INTO crm_automation_stage_snapshot (owner_id, opportunity_id, stage_id) SELECT owner_id, id, stage_id FROM crm_opportunities WHERE owner_id=?1").bind(ownerId),
      cursorStatement(db, ownerId, "stages", iso(now)),
    ]);
    return;
  }
  const rows = (await db.prepare("SELECT o.id, o.pipeline_id, o.stage_id, o.contact_id, o.client_id, o.updated_at, s.stage_id AS previous_stage FROM crm_opportunities o LEFT JOIN crm_automation_stage_snapshot s ON s.owner_id=o.owner_id AND s.opportunity_id=o.id WHERE o.owner_id=?1 AND o.updated_at>=?2 ORDER BY o.updated_at LIMIT 200").bind(ownerId, cursor)
    .all<{ id: string; pipeline_id: string; stage_id: string; contact_id: string | null; client_id: string | null; updated_at: string; previous_stage: string | null }>()).results || [];
  const writes: Stmt[] = [];
  for (const row of rows) {
    if (row.previous_stage === row.stage_id) continue;
    if (row.previous_stage && row.contact_id) writes.push(eventStatement(db, { ownerId, scopeId: row.client_id || "", type: "stage_changed", contactId: row.contact_id, payload: { opportunityId: row.id, pipelineId: row.pipeline_id, fromStageId: row.previous_stage, toStageId: row.stage_id }, dedupeKey: `stage:${row.id}:${row.stage_id}:${row.updated_at}` }, now));
    writes.push(db.prepare("INSERT INTO crm_automation_stage_snapshot (owner_id, opportunity_id, stage_id) VALUES (?1,?2,?3) ON CONFLICT(owner_id, opportunity_id) DO UPDATE SET stage_id=excluded.stage_id").bind(ownerId, row.id, row.stage_id));
  }
  writes.push(cursorStatement(db, ownerId, "stages", nextCursor(rows.map((row) => row.updated_at), rows.length === 200, now, cursor)));
  await db.batch(writes);
}

async function detectCompletedTasks(db: Db, ownerId: string, now: Date) {
  const cursor = await readCursor(db, ownerId, "tasks");
  if (!cursor) { await cursorStatement(db, ownerId, "tasks", iso(now)).run(); return; }
  // One row read: tasks live inside the single workspace document.
  const rows = (await db.prepare(`SELECT json_extract(t.value,'$.id') AS id, json_extract(t.value,'$.title') AS title, json_extract(t.value,'$.clientId') AS client_id, json_extract(t.value,'$.completedAt') AS completed_at,
      json_extract(t.value,'$.automationContactId') AS contact_id, json_extract(t.value,'$.automationScopeId') AS scope_id
    FROM workspace_documents w, json_each(w.data, '$.tasks') t
    WHERE w.id='f2b-agency' AND json_extract(t.value,'$.status')='Done' AND json_extract(t.value,'$.completedAt')>=?1 LIMIT 200`).bind(cursor)
    .all<{ id: string; title: string; client_id: string | null; completed_at: string; contact_id: string | null; scope_id: string | null }>()).results || [];
  const writes: Stmt[] = [];
  for (const row of rows) {
    let contactId = row.contact_id;
    const byAutomation = Boolean(row.contact_id);
    if (!contactId && row.client_id) {
      contactId = (await db.prepare("SELECT id FROM crm_contacts WHERE owner_id=?1 AND client_id=?2 ORDER BY updated_at DESC LIMIT 1").bind(ownerId, row.client_id).first<{ id: string }>())?.id || null;
    }
    if (!contactId) continue;
    writes.push(eventStatement(db, { ownerId, scopeId: byAutomation ? row.scope_id || "" : row.client_id || "", type: "task_completed", contactId, payload: { taskId: row.id, title: row.title, byAutomation }, dedupeKey: `task:${row.id}:${row.completed_at}` }, now));
  }
  writes.push(cursorStatement(db, ownerId, "tasks", nextCursor(rows.map((row) => String(row.completed_at)), rows.length === 200, now, cursor)));
  await db.batch(writes);
}

// ---------- the cron entry point ----------
export async function processCrmAutomations(db: Db, nowDate = new Date(), effects: Effects = {}) {
  await ensureAutomationTables(db);
  const now = nowDate;
  const stamp = iso(now);
  const live = ((await db.prepare("SELECT id, owner_id, scope_id, trigger_type, definition, next_fire_at FROM crm_automations WHERE status='on' LIMIT 500").all<LiveAutomation>()).results || [])
    .map((row) => ({ ...row, parsed: parse<AutomationDefinition | null>(row.definition, null) }));

  const pausedCache = new Map<string, Set<string>>();
  const paused = async (ownerId: string, scopeId: string) => {
    if (!pausedCache.has(ownerId)) pausedCache.set(ownerId, new Set(((await db.prepare("SELECT scope_id FROM crm_automation_scope_settings WHERE owner_id=?1 AND paused=1").bind(ownerId).all<{ scope_id: string }>()).results || []).map((row) => row.scope_id)));
    return (pausedCache.get(ownerId) as Set<string>).has(scopeId || "");
  };
  let cachedWorkspace: Promise<Workspace | null> | null = null;
  const workspace = () => (cachedWorkspace ||= readWorkspace(db).then((row) => row?.data || null));

  // 1. Detect CRM changes, only for trigger types that are switched on.
  for (const ownerId of new Set(live.map((row) => row.owner_id))) {
    const types = new Set(live.filter((row) => row.owner_id === ownerId).map((row) => row.trigger_type));
    if (types.has("form_lead")) await detectFormLeads(db, ownerId, now);
    if (types.has("stage_changed")) await detectStageChanges(db, ownerId, now);
    if (types.has("task_completed")) await detectCompletedTasks(db, ownerId, now);
  }

  // 2. Turn pending events into runs.
  const events = (await db.prepare("SELECT id, owner_id, scope_id, event_type, contact_id, payload, source_automation_id, created_at FROM crm_automation_events WHERE status='pending' ORDER BY created_at LIMIT ?1").bind(MAX_EVENTS_PER_TICK).all<EventRow>()).results || [];
  if (events.length) {
    const writes: Stmt[] = [];
    for (const event of events) {
      if (!(await paused(event.owner_id, event.scope_id))) {
        for (const automation of live) {
          if (automation.owner_id !== event.owner_id || !automation.parsed || !triggerMatches(automation, event)) continue;
          writes.push(...await startRunStatements(db, { ...automation, parsed: automation.parsed }, String(event.contact_id), event.id, nodeSummary(triggerOf(automation.parsed) as AutomationNode), now));
        }
      }
      writes.push(db.prepare("UPDATE crm_automation_events SET status='done', processed_at=?1 WHERE id=?2").bind(stamp, event.id));
    }
    // Small batches keep each D1 transaction short.
    for (let index = 0; index < writes.length; index += 60) await db.batch(writes.slice(index, index + 60));
  }

  // 3. Date / time triggers.
  for (const automation of live.filter((row) => row.trigger_type === "schedule" && row.next_fire_at && row.next_fire_at <= stamp && row.parsed)) {
    const config = triggerOf(automation.parsed as AutomationDefinition)?.config || {};
    const next = nextScheduleFire(config, now);
    const claim = await db.prepare("UPDATE crm_automations SET next_fire_at=?1 WHERE id=?2 AND next_fire_at=?3 AND status='on'").bind(next ? iso(next) : null, automation.id, automation.next_fire_at).run();
    if (changes(claim) !== 1 || await paused(automation.owner_id, automation.scope_id)) continue;
    const tag = normalizeTag(config.audienceTag);
    const contacts = (tag
      ? await db.prepare(`SELECT c.id FROM crm_contact_tags t JOIN crm_contacts c ON c.id=t.contact_id AND c.owner_id=t.owner_id WHERE t.owner_id=?1 AND t.tag=?2 AND COALESCE(c.client_id,'')=?3 LIMIT ${SCHEDULE_AUDIENCE_LIMIT}`).bind(automation.owner_id, tag, automation.scope_id).all<{ id: string }>()
      : automation.scope_id
        ? await db.prepare(`SELECT id FROM crm_contacts WHERE owner_id=?1 AND client_id=?2 LIMIT ${SCHEDULE_AUDIENCE_LIMIT}`).bind(automation.owner_id, automation.scope_id).all<{ id: string }>()
        : await db.prepare(`SELECT id FROM crm_contacts WHERE owner_id=?1 AND client_id IS NULL LIMIT ${SCHEDULE_AUDIENCE_LIMIT}`).bind(automation.owner_id).all<{ id: string }>()).results || [];
    const fired = String(automation.next_fire_at);
    const writes: Stmt[] = [];
    for (const contact of contacts) writes.push(...await startRunStatements(db, { ...automation, parsed: automation.parsed as AutomationDefinition }, contact.id, `sched:${fired}:${contact.id}`, `Scheduled for ${fired.slice(0, 16).replace("T", " ")} UTC`, now));
    for (let index = 0; index < writes.length; index += 60) await db.batch(writes.slice(index, index + 60));
  }

  // 4. Advance runs that are due (new runs, finished waits, retries).
  const due = (await db.prepare("SELECT id, owner_id, automation_id, scope_id, contact_id, status, current_node_id, resume_at, attempts FROM crm_automation_runs WHERE status IN ('running','waiting') AND resume_at<=?1 ORDER BY resume_at LIMIT ?2").bind(stamp, MAX_RUNS_PER_TICK).all<RunRow>()).results || [];
  for (const run of due) await advanceRun(db, run, now, effects, workspace, paused);

  return { live: live.length, events: events.length, runs: due.length };
}

/** Schedule helper for the API: when a Date/time automation is switched on, work out its first fire time. */
export function firstFireAt(definition: AutomationDefinition, now = new Date()) {
  const trigger = triggerOf(definition);
  if (trigger?.config?.type !== "schedule") return null;
  const next = nextScheduleFire(trigger.config, now);
  return next ? iso(next) : null;
}
export { zonedToUtc };
