import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";
import { ensureAutomationTables, emitAutomationEvent, firstFireAt, simulateRun, startRunStatements, type Db } from "../../../lib/crm-automations/engine.ts";
import { blankDefinition, normalizeTag, readinessProblems, sanitizeDefinition, sendsEmail, triggerOf, type AutomationDefinition } from "../../../lib/crm-automations/model.ts";

export const dynamic = "force-dynamic";
const noStore = { "Cache-Control": "no-store" };
const reply = (error: string, status = 400, extra: Record<string, unknown> = {}) => Response.json({ error, ...extra }, { status, headers: noStore });
const ok = (body: Record<string, unknown>) => Response.json(body, { headers: noStore });
const clean = (value: unknown, max = 500) => (typeof value === "string" ? value.trim().slice(0, max) : "");

type Staff = { id: string; name: string; email?: string; role?: string; isBot?: boolean };
type WorkspaceData = { ownerId?: string; clients?: Array<{ id: string; name: string }>; staff?: Staff[] };
type AutomationRow = { id: string; scope_id: string; name: string; status: "on" | "off"; trigger_type: string; definition: string; sends_email: number; next_fire_at: string | null; last_run_at: string | null; total_runs: number; enabled_by: string | null; enabled_at: string | null; created_at: string; updated_at: string };

// Same access rule as /api/crm: owners and admins only (the sidebar also hides this page from everyone else).
async function context() {
  const user = await getChatGPTUser();
  if (!user) return { response: reply("Sign in before opening Automations.", 401) };
  if (!env.DB) return { response: reply("The private workspace database is unavailable.", 503) };
  const row = await env.DB.prepare(`SELECT json_object(
      'ownerId', owner_id,
      'clients', json(COALESCE((SELECT json_group_array(json_object('id', json_extract(value,'$.id'), 'name', json_extract(value,'$.name'))) FROM json_each(data, '$.clients')), '[]')),
      'staff', json(COALESCE((SELECT json_group_array(json_object('id', json_extract(value,'$.id'), 'name', json_extract(value,'$.name'), 'email', json_extract(value,'$.email'), 'role', json_extract(value,'$.role'), 'isBot', json_extract(value,'$.isBot'))) FROM json_each(data, '$.staff')), '[]'))
    ) AS data FROM workspace_documents WHERE id = 'f2b-agency'`).first<{ data: string }>();
  if (!row?.data) return { response: reply("The agency workspace could not be found.", 503) };
  let workspace: WorkspaceData;
  try { workspace = JSON.parse(row.data); } catch { return { response: reply("The agency workspace data could not be read.", 503) }; }
  const isOwner = workspace.ownerId === user.userId;
  const isAdmin = isOwner || Boolean(workspace.staff?.some((person) => !person.isBot && person.email?.toLowerCase() === user.email.toLowerCase() && ["Owner", "Admin"].includes(person.role || "")));
  if (!isAdmin) return { response: reply("Only an agency owner or admin can manage automations.", 403) };
  const db = env.DB as unknown as Db;
  await ensureAutomationTables(db);
  return { db, raw: env.DB, ownerId: String(workspace.ownerId || ""), workspace, user, isAdmin };
}

function scopeFrom(value: unknown, workspace: WorkspaceData) {
  const scope = clean(value, 100);
  if (scope && !(workspace.clients || []).some((client) => String(client.id) === scope)) return null;
  return scope;
}

function listItem(row: AutomationRow) {
  const definition = (() => { try { return JSON.parse(row.definition) as AutomationDefinition; } catch { return blankDefinition(); } })();
  return { id: row.id, scopeId: row.scope_id, name: row.name, status: row.status, triggerType: row.trigger_type, trigger: triggerOf(definition) || null, sendsEmail: Boolean(row.sends_email), nextFireAt: row.next_fire_at, lastRunAt: row.last_run_at, totalRuns: Number(row.total_runs) || 0, updatedAt: row.updated_at, enabledBy: row.enabled_by, enabledAt: row.enabled_at };
}

export async function GET(request: Request) {
  const access = await context(); if (access.response) return access.response;
  const { raw, ownerId, workspace } = access;
  const url = new URL(request.url);
  const scope = scopeFrom(url.searchParams.get("scope"), workspace);
  if (scope === null) return reply("Choose a client in this workspace.");
  try {
    const runId = clean(url.searchParams.get("runId"), 120);
    if (runId) {
      const run = await raw.prepare("SELECT id FROM crm_automation_runs WHERE id=?1 AND owner_id=?2").bind(runId, ownerId).first();
      if (!run) return reply("That run could not be found.", 404);
      const steps = await raw.prepare("SELECT node_id, node_type, title, status, detail, created_at, updated_at FROM crm_automation_steps WHERE run_id=?1 ORDER BY created_at, updated_at LIMIT 100").bind(runId).all();
      return ok({ steps: steps.results || [] });
    }
    const contactSearch = url.searchParams.get("contacts");
    if (contactSearch !== null) {
      const term = `%${clean(contactSearch, 80).replace(/[%_]/g, "")}%`;
      const rows = scope
        ? await raw.prepare("SELECT id, first_name, last_name, email, phone FROM crm_contacts WHERE owner_id=?1 AND client_id=?2 AND (first_name || ' ' || last_name || ' ' || email || ' ' || phone) LIKE ?3 ORDER BY updated_at DESC LIMIT 20").bind(ownerId, scope, term).all()
        : await raw.prepare("SELECT id, first_name, last_name, email, phone FROM crm_contacts WHERE owner_id=?1 AND client_id IS NULL AND (first_name || ' ' || last_name || ' ' || email || ' ' || phone) LIKE ?2 ORDER BY updated_at DESC LIMIT 20").bind(ownerId, term).all();
      return ok({ contacts: rows.results || [] });
    }
    const id = clean(url.searchParams.get("id"), 120);
    if (id) {
      const row = await raw.prepare("SELECT * FROM crm_automations WHERE id=?1 AND owner_id=?2 AND scope_id=?3").bind(id, ownerId, scope).first<AutomationRow>();
      if (!row) return reply("That automation could not be found.", 404);
      // Website forms show up here automatically once they've sent a lead (contact source "Website form · <name>").
      const siteForms = await raw.prepare(`SELECT DISTINCT substr(source, 16) AS name FROM crm_contacts WHERE owner_id=?1 AND ${scope ? "client_id=?2" : "client_id IS NULL"} AND source LIKE 'Website form · %' LIMIT 50`).bind(...(scope ? [ownerId, scope] : [ownerId])).all<{ name: string }>().catch(() => ({ results: [] as Array<{ name: string }> }));
      const [stages, forms, tags, runs] = await Promise.all([
        raw.prepare("SELECT p.id AS pipeline_id, p.name AS pipeline_name, s.id, s.name, s.position FROM crm_pipelines p JOIN crm_pipeline_stages s ON s.owner_id=p.owner_id AND s.pipeline_id=p.id WHERE p.owner_id=?1 AND p.archived=0 ORDER BY p.created_at, s.position LIMIT 300").bind(ownerId).all<{ pipeline_id: string; pipeline_name: string; id: string; name: string }>(),
        raw.prepare(`SELECT name, kind FROM marketing_assets WHERE owner_id=?1 AND kind IN ('form','funnel','survey','calculator') AND ${scope ? "client_id=?2" : "client_id IS NULL"} ORDER BY updated_at DESC LIMIT 100`).bind(...(scope ? [ownerId, scope] : [ownerId])).all<{ name: string; kind: string }>().catch(() => ({ results: [] as Array<{ name: string; kind: string }> })),
        raw.prepare("SELECT DISTINCT tag FROM crm_contact_tags WHERE owner_id=?1 ORDER BY tag LIMIT 200").bind(ownerId).all<{ tag: string }>(),
        raw.prepare("SELECT r.id, r.contact_id, r.status, r.dry_run, r.trigger_summary, r.error, r.started_at, r.updated_at, r.finished_at, c.first_name, c.last_name, c.email FROM crm_automation_runs r LEFT JOIN crm_contacts c ON c.id=r.contact_id AND c.owner_id=r.owner_id WHERE r.owner_id=?1 AND r.automation_id=?2 ORDER BY r.started_at DESC LIMIT 50").bind(ownerId, id).all(),
      ]);
      const pipelines = new Map<string, { id: string; name: string; stages: Array<{ id: string; name: string }> }>();
      for (const stage of stages.results || []) {
        if (!pipelines.has(stage.pipeline_id)) pipelines.set(stage.pipeline_id, { id: stage.pipeline_id, name: stage.pipeline_name, stages: [] });
        pipelines.get(stage.pipeline_id)?.stages.push({ id: stage.id, name: stage.name });
      }
      return ok({
        automation: { ...listItem(row), definition: JSON.parse(row.definition) },
        options: {
          pipelines: [...pipelines.values()],
          forms: [...(forms.results || []).map((form) => ({ name: form.name, kind: form.kind })), ...(siteForms.results || []).filter((f) => f.name && !(forms.results || []).some((m) => m.name === f.name)).map((f) => ({ name: f.name, kind: "website" }))],
          tags: (tags.results || []).map((tag) => tag.tag),
          staff: (workspace.staff || []).map((member) => ({ id: member.id, name: member.name, isBot: Boolean(member.isBot) })),
          emailReady: Boolean(env.RESEND_API_KEY && env.TASK_NOTIFICATION_FROM),
        },
        runs: runs.results || [],
      });
    }
    const [rows, setting, notifications] = await Promise.all([
      raw.prepare("SELECT * FROM crm_automations WHERE owner_id=?1 AND scope_id=?2 ORDER BY updated_at DESC LIMIT 200").bind(ownerId, scope).all<AutomationRow>(),
      raw.prepare("SELECT paused, paused_by, paused_at FROM crm_automation_scope_settings WHERE owner_id=?1 AND scope_id=?2").bind(ownerId, scope).first<{ paused: number; paused_by: string | null; paused_at: string | null }>(),
      raw.prepare("SELECT id, automation_id, title, body, read_at, created_at FROM crm_automation_notifications WHERE owner_id=?1 AND scope_id=?2 ORDER BY created_at DESC LIMIT 20").bind(ownerId, scope).all(),
    ]);
    return ok({
      scope,
      clients: (workspace.clients || []).map((client) => ({ id: String(client.id), name: String(client.name || "Client") })),
      automations: (rows.results || []).map(listItem),
      killSwitch: { paused: Boolean(setting?.paused), pausedBy: setting?.paused_by || null, pausedAt: setting?.paused_at || null },
      notifications: notifications.results || [],
    });
  } catch (error) { return reply(error instanceof Error ? error.message : "Could not load automations.", 500); }
}

export async function POST(request: Request) {
  const access = await context(); if (access.response) return access.response;
  const { db, raw, ownerId, workspace, user, isAdmin } = access;
  let body: Record<string, unknown>; try { body = await request.json() as Record<string, unknown>; } catch { return reply("Send valid automation details."); }
  const action = clean(body.action, 40), now = new Date(), stamp = now.toISOString();
  const scope = scopeFrom(body.scope, workspace);
  if (scope === null) return reply("Choose a client in this workspace.");
  const load = async (id: unknown) => raw.prepare("SELECT * FROM crm_automations WHERE id=?1 AND owner_id=?2 AND scope_id=?3").bind(clean(id, 120), ownerId, scope).first<AutomationRow>();
  const cancelActive = (automationId: string, reason: string) => raw.prepare("UPDATE crm_automation_runs SET status='cancelled', error=?1, resume_at=NULL, updated_at=?2, finished_at=?2 WHERE automation_id=?3 AND status IN ('running','waiting') AND dry_run=0").bind(reason, stamp, automationId);
  try {
    if (action === "create") {
      const id = crypto.randomUUID();
      const name = clean(body.name, 120) || "Untitled automation";
      await raw.prepare("INSERT INTO crm_automations (id, owner_id, scope_id, name, status, trigger_type, definition, created_at, updated_at) VALUES (?1,?2,?3,?4,'off','',?5,?6,?6)").bind(id, ownerId, scope, name, JSON.stringify(blankDefinition()), stamp).run();
      return ok({ ok: true, id });
    }

    if (action === "save") {
      const current = await load(body.id);
      if (!current) return reply("That automation could not be found.", 404);
      const checked = sanitizeDefinition(body.definition);
      if (!checked.ok) return reply(checked.error);
      const definition = checked.definition;
      const name = clean(body.name, 120) || current.name;
      const emails = sendsEmail(definition);
      let status = current.status, notice = "";
      if (status === "on") {
        const problems = readinessProblems(definition);
        if (problems.length) { status = "off"; notice = "Saved and switched off, because some steps still need details."; }
        else if (emails && !current.sends_email) { status = "off"; notice = "Saved and switched off, because it now sends emails. Switch it on again to confirm."; }
      }
      const triggerType = String(triggerOf(definition)?.config?.type || "");
      await raw.batch([
        raw.prepare("UPDATE crm_automations SET name=?1, definition=?2, trigger_type=?3, sends_email=?4, status=?5, next_fire_at=?6, updated_at=?7 WHERE id=?8 AND owner_id=?9")
          .bind(name, JSON.stringify(definition), triggerType, emails ? 1 : 0, status, status === "on" ? firstFireAt(definition, now) : null, stamp, current.id, ownerId),
        ...(status === "off" && current.status === "on" ? [cancelActive(current.id, "The automation was switched off.")] : []),
      ]);
      return ok({ ok: true, status, notice });
    }

    if (action === "setStatus") {
      const current = await load(body.id);
      if (!current) return reply("That automation could not be found.", 404);
      if (body.status === "off") {
        await raw.batch([
          raw.prepare("UPDATE crm_automations SET status='off', next_fire_at=NULL, updated_at=?1 WHERE id=?2 AND owner_id=?3").bind(stamp, current.id, ownerId),
          cancelActive(current.id, "The automation was switched off."),
        ]);
        return ok({ ok: true, status: "off" });
      }
      const definition = JSON.parse(current.definition) as AutomationDefinition;
      const problems = readinessProblems(definition);
      if (problems.length) return reply("Finish these before switching on:", 422, { problems });
      if (sendsEmail(definition)) {
        if (!isAdmin) return reply("Only an admin can switch on an automation that sends emails.", 403);
        if (!env.RESEND_API_KEY || !env.TASK_NOTIFICATION_FROM) return reply("Email sending isn't set up yet. Add RESEND_API_KEY and TASK_NOTIFICATION_FROM to the Worker first.", 422);
        if (body.confirmEmails !== true) {
          const subjects = definition.nodes.filter((node) => node.type === "send_email").map((node) => clean(node.config?.subject, 120));
          return reply("Please confirm this automation may send emails to contacts.", 409, { needsConfirmation: true, emailSubjects: subjects });
        }
      }
      const nextFire = firstFireAt(definition, now);
      if (triggerOf(definition)?.config?.type === "schedule" && !nextFire) return reply("The scheduled date has already passed. Choose a future date and time.", 422);
      await raw.prepare("UPDATE crm_automations SET status='on', next_fire_at=?1, enabled_by=?2, enabled_at=?3, updated_at=?3 WHERE id=?4 AND owner_id=?5").bind(nextFire, clean(user.email, 254), stamp, current.id, ownerId).run();
      return ok({ ok: true, status: "on" });
    }

    if (action === "rename") {
      const current = await load(body.id);
      if (!current) return reply("That automation could not be found.", 404);
      await raw.prepare("UPDATE crm_automations SET name=?1, updated_at=?2 WHERE id=?3 AND owner_id=?4").bind(clean(body.name, 120) || current.name, stamp, current.id, ownerId).run();
      return ok({ ok: true });
    }

    if (action === "duplicate") {
      const current = await load(body.id);
      if (!current) return reply("That automation could not be found.", 404);
      const id = crypto.randomUUID();
      await raw.prepare("INSERT INTO crm_automations (id, owner_id, scope_id, name, status, trigger_type, definition, sends_email, created_at, updated_at) VALUES (?1,?2,?3,?4,'off',?5,?6,?7,?8,?8)").bind(id, ownerId, scope, `${current.name} (copy)`.slice(0, 120), current.trigger_type, current.definition, current.sends_email, stamp).run();
      return ok({ ok: true, id });
    }

    if (action === "delete") {
      const current = await load(body.id);
      if (!current) return reply("That automation could not be found.", 404);
      await raw.batch([
        raw.prepare("DELETE FROM crm_automation_steps WHERE run_id IN (SELECT id FROM crm_automation_runs WHERE owner_id=?1 AND automation_id=?2)").bind(ownerId, current.id),
        raw.prepare("DELETE FROM crm_automation_runs WHERE owner_id=?1 AND automation_id=?2").bind(ownerId, current.id),
        raw.prepare("DELETE FROM crm_automations WHERE id=?1 AND owner_id=?2").bind(current.id, ownerId),
      ]);
      return ok({ ok: true });
    }

    if (action === "enroll") {
      // Bulk-add contacts to a workflow from the Contacts list. Each contact starts at the first step after the trigger.
      const current = await load(body.id);
      if (!current) return reply("That automation could not be found.", 404);
      if (current.status !== "on") return reply("Switch the automation on before adding contacts to it.");
      const ids = Array.isArray(body.contactIds) ? [...new Set(body.contactIds.map((x) => clean(x, 120)).filter(Boolean))].slice(0, 200) : [];
      if (!ids.length) return reply("Select at least one contact.");
      const allowed: string[] = [];
      for (let i = 0; i < ids.length; i += 90) {
        const chunk = ids.slice(i, i + 90);
        const rows = await raw.prepare(`SELECT id FROM crm_contacts WHERE owner_id=?1 AND COALESCE(client_id,'')=?2 AND id IN (${chunk.map((_, n) => `?${n + 3}`).join(",")})`).bind(ownerId, scope, ...chunk).all<{ id: string }>();
        (rows.results || []).forEach((row) => allowed.push(row.id));
      }
      if (!allowed.length) return reply("None of those contacts belong to this account.");
      const parsed = JSON.parse(current.definition) as AutomationDefinition;
      const statements = [];
      for (const contactId of allowed) statements.push(...await startRunStatements(db, { id: current.id, owner_id: ownerId, scope_id: scope, parsed }, contactId, `manual:${crypto.randomUUID()}`, "Added manually from Contacts", now));
      for (let i = 0; i < statements.length; i += 90) await raw.batch(statements.slice(i, i + 90) as never);
      return ok({ ok: true, added: allowed.length, skipped: ids.length - allowed.length });
    }
    if (action === "testRun") {
      const current = await load(body.id);
      if (!current) return reply("That automation could not be found.", 404);
      const checked = body.definition ? sanitizeDefinition(body.definition) : { ok: true as const, definition: JSON.parse(current.definition) as AutomationDefinition };
      if (!checked.ok) return reply(checked.error);
      const contactId = clean(body.contactId, 120);
      const contact = await raw.prepare("SELECT client_id FROM crm_contacts WHERE id=?1 AND owner_id=?2").bind(contactId, ownerId).first<{ client_id: string | null }>();
      if (!contact || (contact.client_id || "") !== scope) return reply("Choose a contact from this account.");
      const result = await simulateRun(db, { ownerId, automationId: current.id, scopeId: scope, definition: checked.definition, contactId }, now);
      return ok({ ok: true, ...result });
    }

    if (action === "setKillSwitch") {
      const paused = body.paused === true;
      await raw.batch([
        raw.prepare("INSERT INTO crm_automation_scope_settings (owner_id, scope_id, paused, paused_by, paused_at) VALUES (?1,?2,?3,?4,?5) ON CONFLICT(owner_id, scope_id) DO UPDATE SET paused=excluded.paused, paused_by=excluded.paused_by, paused_at=excluded.paused_at")
          .bind(ownerId, scope, paused ? 1 : 0, clean(user.email, 254), stamp),
        ...(paused ? [raw.prepare("UPDATE crm_automation_runs SET status='cancelled', error='Stopped by the kill switch for this account.', resume_at=NULL, updated_at=?1, finished_at=?1 WHERE owner_id=?2 AND scope_id=?3 AND status IN ('running','waiting')").bind(stamp, ownerId, scope)] : []),
      ]);
      return ok({ ok: true, paused });
    }

    if (action === "markNotificationsRead") {
      await raw.prepare("UPDATE crm_automation_notifications SET read_at=?1 WHERE owner_id=?2 AND scope_id=?3 AND read_at IS NULL").bind(stamp, ownerId, scope).run();
      return ok({ ok: true });
    }

    if (action === "addTag" || action === "removeTag") {
      const contactId = clean(body.contactId, 120), tag = normalizeTag(body.tag);
      if (!tag) return reply("Enter a tag.");
      const contact = await raw.prepare("SELECT client_id FROM crm_contacts WHERE id=?1 AND owner_id=?2").bind(contactId, ownerId).first<{ client_id: string | null }>();
      if (!contact) return reply("That contact could not be found.", 404);
      if (action === "removeTag") {
        await raw.prepare("DELETE FROM crm_contact_tags WHERE owner_id=?1 AND contact_id=?2 AND tag=?3").bind(ownerId, contactId, tag).run();
        return ok({ ok: true });
      }
      const saved = await raw.prepare("INSERT OR IGNORE INTO crm_contact_tags (owner_id, contact_id, tag, created_at) VALUES (?1,?2,?3,?4)").bind(ownerId, contactId, tag, stamp).run();
      if (saved.meta.changes) await emitAutomationEvent(db, { ownerId, scopeId: contact.client_id || "", type: "tag_added", contactId, payload: { tag }, dedupeKey: `tag:${contactId}:${tag}:${stamp}` }, now);
      return ok({ ok: true });
    }

    return reply("Choose a supported automation action.");
  } catch (error) { return reply(error instanceof Error ? error.message : "The automation change could not be saved.", 500); }
}
