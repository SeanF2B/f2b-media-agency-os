import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { AUTOMATION_SCHEMA_SQL } from "../lib/crm-automations/schema-sql.ts";
import { processCrmAutomations, simulateRun, emitAutomationEvent, ensureAutomationTables } from "../lib/crm-automations/engine.ts";
import { blankDefinition, insertNode, removeNode, duplicateNode, sanitizeDefinition, readinessProblems, nextScheduleFire, zonedToUtc, evaluateConditions, renderMerge, nodeById } from "../lib/crm-automations/model.ts";

const crmSql = await readFile(new URL("../drizzle/0041_native_crm.sql", import.meta.url), "utf8");
const automationSql = await readFile(new URL("../drizzle/0043_crm_automations.sql", import.meta.url), "utf8");

// Minimal D1 stand-in on node:sqlite (sequential, transactional batches like D1).
function d1(raw) {
  const prepare = (sql) => {
    const make = (params) => ({
      bind: (...values) => make(values.map((value) => (value === undefined ? null : typeof value === "boolean" ? Number(value) : value))),
      first: async () => raw.prepare(sql).get(...params) ?? null,
      all: async () => ({ results: raw.prepare(sql).all(...params) }),
      run: async () => { const info = raw.prepare(sql).run(...params); return { meta: { changes: Number(info.changes) } }; },
    });
    return make([]);
  };
  return {
    prepare,
    batch: async (statements) => { raw.exec("BEGIN"); try { const out = []; for (const statement of statements) out.push(await statement.run()); raw.exec("COMMIT"); return out; } catch (error) { raw.exec("ROLLBACK"); throw error; } },
  };
}

function setup() {
  const raw = new DatabaseSync(":memory:");
  raw.exec(crmSql);
  raw.exec("CREATE TABLE workspace_documents (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, data TEXT NOT NULL, updated_at TEXT NOT NULL)");
  raw.prepare("INSERT INTO workspace_documents VALUES ('f2b-agency','owner',?,'v1')").run(JSON.stringify({ ownerId: "owner", staff: [{ id: "owner", name: "Sean", email: "sean@example.com", role: "Owner" }], tasks: [] }));
  raw.exec("INSERT INTO crm_pipelines VALUES ('p1','owner','Sales','',0,'t','t'); INSERT INTO crm_pipeline_stages VALUES ('s1','owner','p1','New lead',0,'open','t'),('s2','owner','p1','Qualified',1,'open','t');");
  return { raw, db: d1(raw) };
}
const at = (minutes) => new Date(Date.UTC(2026, 10, 12, 10, 0) + minutes * 60_000);
function addContact(raw, id, created, extra = {}) {
  raw.prepare("INSERT INTO crm_contacts (id, owner_id, client_id, first_name, last_name, email, phone, company, source, notes, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
    .run(id, "owner", extra.client ?? "client-a", extra.first ?? "Ann", "Lee", extra.email ?? "ann@example.com", "", "", extra.source ?? "Website form · Contact us", "", created.toISOString(), created.toISOString());
}
function automation(raw, id, definition, extra = {}) {
  raw.prepare("INSERT INTO crm_automations (id, owner_id, scope_id, name, status, trigger_type, definition, sends_email, next_fire_at, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
    .run(id, "owner", extra.scope ?? "client-a", "Test", extra.status ?? "on", definition.nodes[0].config.type, JSON.stringify(definition), 1, extra.next ?? null, "t", "t");
}
function leadFlow() {
  let def = blankDefinition();
  def.nodes[0].config = { type: "form_lead", formName: "Contact us" };
  def = insertNode(def, "trigger", { id: "tag", type: "add_tag", config: { tag: "New Lead" } });
  def = insertNode(def, "tag", { id: "email", type: "send_email", config: { subject: "Hi {{contact.first_name}}", body: "Welcome {{contact.full_name}}" } });
  def = insertNode(def, "email", { id: "wait", type: "wait", config: { amount: 1, unit: "days" } });
  def = insertNode(def, "wait", { id: "notify", type: "notify", config: { message: "Follow up {{contact.first_name}}", email: false } });
  return def;
}

test("embedded schema matches the migration and applies cleanly twice", async () => {
  assert.equal(AUTOMATION_SCHEMA_SQL, automationSql);
  const { db, raw } = setup();
  await ensureAutomationTables(db);
  raw.exec(automationSql); // idempotent
  const names = new Set(raw.prepare("SELECT name FROM sqlite_master").all().map((row) => row.name));
  for (const name of ["crm_automations", "crm_automation_runs", "crm_automation_steps", "crm_automation_events", "crm_contact_tags", "crm_automation_scope_settings", "crm_automation_runs_one_active_idx"]) assert.ok(names.has(name), name);
});

test("a website lead runs through tag → email → wait → notify, exactly once", async () => {
  const { db, raw } = setup();
  await ensureAutomationTables(db);
  automation(raw, "a1", leadFlow());
  const sent = [];
  const effects = { sendEmail: async (message) => { sent.push(message); } };
  await processCrmAutomations(db, at(0), effects); // sets the lead cursor; nothing to do yet
  addContact(raw, "c1", at(1));
  await processCrmAutomations(db, at(5), effects);
  assert.equal(sent.length, 1);
  assert.equal(sent[0].subject, "Hi Ann");
  assert.equal(sent[0].text, "Welcome Ann Lee");
  assert.ok(sent[0].idempotencyKey.includes("email"));
  assert.deepEqual(raw.prepare("SELECT tag FROM crm_contact_tags").all().map((row) => row.tag), ["new lead"]);
  let run = raw.prepare("SELECT * FROM crm_automation_runs WHERE dry_run=0").get();
  assert.equal(run.status, "waiting");
  // Ticks during the wait do nothing and never resend.
  await processCrmAutomations(db, at(10), effects);
  await processCrmAutomations(db, at(60), effects);
  assert.equal(sent.length, 1);
  await processCrmAutomations(db, at(24 * 60 + 10), effects);
  run = raw.prepare("SELECT * FROM crm_automation_runs WHERE dry_run=0").get();
  assert.equal(run.status, "completed");
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM crm_automation_notifications").get().n, 1);
  assert.equal(raw.prepare("SELECT total_runs FROM crm_automations").get().total_runs, 1);
  assert.equal(sent.length, 1);
  const steps = raw.prepare("SELECT node_id, status FROM crm_automation_steps WHERE run_id=? ORDER BY created_at").all(run.id).map((row) => `${row.node_id}:${row.status}`);
  assert.deepEqual(steps.sort(), ["email:done", "notify:done", "tag:done", "trigger:done", "wait:done"].sort());
});

test("a contact can't be in the same automation twice at once, and duplicate events start nothing", async () => {
  const { db, raw } = setup();
  await ensureAutomationTables(db);
  let def = blankDefinition();
  def.nodes[0].config = { type: "tag_added", tag: "vip" };
  def = insertNode(def, "trigger", { id: "wait", type: "wait", config: { amount: 2, unit: "days" } });
  automation(raw, "a2", def);
  addContact(raw, "c1", at(0));
  await emitAutomationEvent(db, { ownerId: "owner", scopeId: "client-a", type: "tag_added", contactId: "c1", payload: { tag: "VIP" }, dedupeKey: "k1" }, at(1));
  await emitAutomationEvent(db, { ownerId: "owner", scopeId: "client-a", type: "tag_added", contactId: "c1", payload: { tag: "VIP" }, dedupeKey: "k1" }, at(1)); // exact duplicate
  await emitAutomationEvent(db, { ownerId: "owner", scopeId: "client-a", type: "tag_added", contactId: "c1", payload: { tag: "vip" }, dedupeKey: "k2" }, at(2)); // re-tagged while active
  await processCrmAutomations(db, at(3));
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM crm_automation_events").get().n, 2);
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM crm_automation_runs").get().n, 1);
  assert.equal(raw.prepare("SELECT total_runs FROM crm_automations").get().total_runs, 1);
  // Events for another client never reach this client's automation.
  await emitAutomationEvent(db, { ownerId: "owner", scopeId: "client-b", type: "tag_added", contactId: "c1", payload: { tag: "vip" }, dedupeKey: "k3" }, at(4));
  await processCrmAutomations(db, at(5));
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM crm_automation_runs").get().n, 1);
});

test("kill switch stops new runs and cancels waiting ones", async () => {
  const { db, raw } = setup();
  await ensureAutomationTables(db);
  let def = blankDefinition();
  def.nodes[0].config = { type: "tag_added", tag: "vip" };
  def = insertNode(def, "trigger", { id: "wait", type: "wait", config: { amount: 10, unit: "minutes" } });
  def = insertNode(def, "wait", { id: "email", type: "send_email", config: { subject: "x", body: "y" } });
  automation(raw, "a3", def);
  addContact(raw, "c1", at(0));
  addContact(raw, "c2", at(0), { email: "b@example.com" });
  const sent = [];
  await emitAutomationEvent(db, { ownerId: "owner", scopeId: "client-a", type: "tag_added", contactId: "c1", payload: { tag: "vip" }, dedupeKey: "a" }, at(1));
  await processCrmAutomations(db, at(1), { sendEmail: async (m) => sent.push(m) });
  raw.exec("INSERT INTO crm_automation_scope_settings (owner_id, scope_id, paused) VALUES ('owner','client-a',1)");
  await emitAutomationEvent(db, { ownerId: "owner", scopeId: "client-a", type: "tag_added", contactId: "c2", payload: { tag: "vip" }, dedupeKey: "b" }, at(2));
  await processCrmAutomations(db, at(30), { sendEmail: async (m) => sent.push(m) });
  assert.equal(sent.length, 0);
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM crm_automation_runs").get().n, 1);
  assert.equal(raw.prepare("SELECT status FROM crm_automation_runs").get().status, "cancelled");
});

test("pipeline stage changes are detected from a cursor and branch on If/Else", async () => {
  const { db, raw } = setup();
  await ensureAutomationTables(db);
  let def = blankDefinition();
  def.nodes[0].config = { type: "stage_changed", pipelineId: "p1", toStageId: "s2" };
  def = insertNode(def, "trigger", { id: "if", type: "if_else", config: { conditions: { match: "all", rules: [{ field: "tag", op: "has", value: "vip" }] } } });
  def = insertNode(def, "if", { id: "yes", type: "add_tag", config: { tag: "hot" } }, "yes");
  def = insertNode(def, "if", { id: "no", type: "add_tag", config: { tag: "cold" } }, "no");
  automation(raw, "a4", def, { scope: "" });
  addContact(raw, "c1", at(0), { client: null });
  raw.prepare("INSERT INTO crm_opportunities (id, owner_id, pipeline_id, stage_id, contact_id, client_id, title, created_at, updated_at) VALUES ('o1','owner','p1','s1','c1',NULL,'Deal',?,?)").run(at(0).toISOString(), at(0).toISOString());
  await processCrmAutomations(db, at(1)); // baseline snapshot
  raw.prepare("UPDATE crm_opportunities SET stage_id='s2', updated_at=? WHERE id='o1'").run(at(2).toISOString());
  await processCrmAutomations(db, at(5)); // detects + queues the event
  await processCrmAutomations(db, at(10)); // (also runs on same tick; harmless)
  const tags = raw.prepare("SELECT tag FROM crm_contact_tags WHERE contact_id='c1'").all().map((row) => row.tag);
  assert.deepEqual(tags, ["cold"]);
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM crm_automation_runs").get().n, 1);
});

test("test run simulates every step without sending or changing anything", async () => {
  const { db, raw } = setup();
  await ensureAutomationTables(db);
  addContact(raw, "c1", at(0));
  const def = leadFlow();
  const result = await simulateRun(db, { ownerId: "owner", automationId: "a1", scopeId: "client-a", definition: def, contactId: "c1" }, at(0));
  assert.equal(result.steps.length, 5);
  assert.match(result.steps[2].detail, /Would email ann@example.com/);
  assert.match(result.steps[3].detail, /Would wait until/);
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM crm_contact_tags").get().n, 0);
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM crm_automation_notifications").get().n, 0);
  assert.equal(raw.prepare("SELECT dry_run FROM crm_automation_runs").get().dry_run, 1);
});

test("create task writes one task into the workspace even if the step is retried", async () => {
  const { db, raw } = setup();
  await ensureAutomationTables(db);
  let def = blankDefinition();
  def.nodes[0].config = { type: "tag_added", tag: "vip" };
  def = insertNode(def, "trigger", { id: "task", type: "create_task", config: { title: "Call {{contact.first_name}}", assigneeId: "owner", dueInDays: 2 } });
  automation(raw, "a5", def);
  addContact(raw, "c1", at(0));
  await emitAutomationEvent(db, { ownerId: "owner", scopeId: "client-a", type: "tag_added", contactId: "c1", payload: { tag: "vip" }, dedupeKey: "t" }, at(1));
  await processCrmAutomations(db, at(1));
  // Simulate a crash after the task was written: put the run back to running at the same step.
  raw.exec("UPDATE crm_automation_runs SET status='running', current_node_id='task', resume_at='2000-01-01'; DELETE FROM crm_automation_steps WHERE node_id='task';");
  await processCrmAutomations(db, at(2));
  const tasks = JSON.parse(raw.prepare("SELECT data FROM workspace_documents").get().data).tasks;
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].title, "Call Ann");
  assert.equal(tasks[0].automationContactId, "c1");
});

test("builder tree helpers keep a valid tree", () => {
  let def = blankDefinition();
  def = insertNode(def, "trigger", { id: "a", type: "add_tag", config: {} });
  def = insertNode(def, "trigger", { id: "if", type: "if_else", config: {} }); // a moves to the Yes path
  assert.equal(def.edges.find((edge) => edge.source === "if").branch, "yes");
  def = insertNode(def, "if", { id: "b", type: "wait", config: {} }, "no");
  assert.ok(sanitizeDefinition(def).ok);
  def = duplicateNode(def, "a");
  assert.equal(def.nodes.length, 5);
  assert.ok(sanitizeDefinition(def).ok);
  def = removeNode(def, "if");
  assert.deepEqual(def.nodes.map((node) => node.id), ["trigger"]);
  assert.equal(sanitizeDefinition({ nodes: [{ id: "x", type: "trigger", config: {} }, { id: "y", type: "add_tag", config: {} }], edges: [] }).ok, false);
  assert.ok(readinessProblems(blankDefinition()).length > 0);
  assert.equal(nodeById(def, "trigger").type, "trigger");
});

test("schedules respect Dublin time across daylight saving", () => {
  assert.equal(zonedToUtc("2026-07-01T09:00").toISOString(), "2026-07-01T08:00:00.000Z");
  assert.equal(zonedToUtc("2026-12-01T09:00").toISOString(), "2026-12-01T09:00:00.000Z");
  const next = nextScheduleFire({ mode: "recurring", repeat: "daily", time: "09:00" }, new Date("2026-10-24T09:30:00Z"));
  assert.equal(next.toISOString(), "2026-10-25T09:00:00.000Z"); // clocks went back that night
  assert.equal(nextScheduleFire({ mode: "once", at: "2026-01-01T09:00" }, new Date("2026-11-12T00:00:00Z")), null);
});

test("conditions and merge fields", () => {
  const contact = { id: "c", first_name: "Ann", last_name: "Lee", email: "a@x.ie", phone: "", company: "", source: "Website form · Quote", client_id: null, tags: ["vip"], stageIds: ["s2"] };
  assert.equal(evaluateConditions({ match: "all", rules: [{ field: "source", op: "contains", value: "quote" }, { field: "stage", op: "is", value: "s2" }] }, contact), true);
  assert.equal(evaluateConditions({ match: "any", rules: [{ field: "tag", op: "has_not", value: "vip" }, { field: "phone", op: "not_empty" }] }, contact), false);
  assert.equal(renderMerge("Hi {{ contact.first_name }} / {{contact.unknown}}", contact), "Hi Ann / ");
});

test("date/time trigger fires once for the tagged audience and schedules the next run", async () => {
  const { db, raw } = setup();
  await ensureAutomationTables(db);
  let def = blankDefinition();
  def.nodes[0].config = { type: "schedule", mode: "recurring", repeat: "daily", time: "09:00", audienceTag: "newsletter" };
  def = insertNode(def, "trigger", { id: "tag", type: "add_tag", config: { tag: "nudged" } });
  automation(raw, "a6", def, { next: "2026-11-12T09:00:00.000Z" });
  addContact(raw, "c1", at(0));
  addContact(raw, "c2", at(0), { email: "b@example.com" });
  raw.exec("INSERT INTO crm_contact_tags VALUES ('owner','c1','newsletter','t')");
  await processCrmAutomations(db, at(1)); // 10:01 UTC, past the 09:00 fire time
  await processCrmAutomations(db, at(6)); // must not fire again
  assert.equal(raw.prepare("SELECT COUNT(*) AS n FROM crm_automation_runs").get().n, 1);
  assert.deepEqual(raw.prepare("SELECT contact_id FROM crm_contact_tags WHERE tag='nudged'").all().map((row) => row.contact_id), ["c1"]);
  assert.equal(raw.prepare("SELECT next_fire_at FROM crm_automations").get().next_fire_at, "2026-11-13T09:00:00.000Z");
});
