import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { generateKeyPairSync, sign } from "node:crypto";
import { conditionPasses, enqueueGhlContactAutomations, enqueueMarketingAutomations, processDueMarketingAutomations } from "../worker/marketing-automations.ts";
import { buildMarketingAutomationMap, connectMarketingAutomationBranch, duplicateMarketingAutomationNode, normalizeMarketingAutomationNodeType, normalizeMarketingAutomationPosition, parseWaitDuration, parseWaitUntil, reorderMarketingAutomationNodes, simulateMarketingAutomation, validateMarketingAutomationNodes } from "../lib/marketing-automation.js";
import { emailTemplateFieldIds, parseStaffEmailConfig, renderStaffEmailTemplate } from "../lib/marketing-automation-email.js";
import { isMarketingGhlContactTrigger, isValidMarketingTriggerDateTime, marketingGhlContactTriggerMatches, marketingTriggerMatches, parseMarketingTrigger, serializeMarketingTrigger } from "../lib/marketing-trigger.js";
import { buildMarketingContactUpdate, parseMarketingContactUpdate } from "../lib/marketing-contact-update.js";
import { parseGhlContactWebhook, verifyGhlWebhookSignature } from "../lib/gohighlevel-webhook.ts";

class TestD1 {
  db = new DatabaseSync(":memory:");
  constructor() {
    this.db.exec("CREATE TABLE IF NOT EXISTS marketing_ghl_contact_birthdays (owner_id TEXT NOT NULL, client_id TEXT NOT NULL, contact_id TEXT NOT NULL, birthday_month_day TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(owner_id, client_id, contact_id))");
    this.db.exec("CREATE TABLE IF NOT EXISTS marketing_ghl_birthday_cursors (owner_id TEXT NOT NULL, client_id TEXT NOT NULL, last_contact_id TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL, PRIMARY KEY(owner_id, client_id))");
    this.db.exec("CREATE TABLE IF NOT EXISTS marketing_ghl_contact_status_state (owner_id TEXT NOT NULL, client_id TEXT NOT NULL, contact_id TEXT NOT NULL, field_id TEXT NOT NULL, status_value TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL, PRIMARY KEY(owner_id, client_id, contact_id, field_id))");
  }
  prepare(sql) {
    const statement = this.db.prepare(sql);
    let params = [];
    const query = {
      bind: (...values) => { params = values; return query; },
      first: async () => statement.get(...params),
      all: async () => ({ results: statement.all(...params) }),
      run: async () => ({ meta: { changes: Number(statement.run(...params).changes) } }),
    };
    return query;
  }
  async batch(queries) { const results = []; for (const query of queries) results.push(await query.run()); return results; }
}

test("GoHighLevel contact webhook verifies signed raw payloads and normalizes only safe contact fields", async () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyBase64 = publicKey.export({ type: "spki", format: "der" }).toString("base64");
  const body = JSON.stringify({ type: "ContactCreate", locationId: "location-123456", id: "contact-123456", webhookId: "delivery-123", name: "Jamie Example", email: "jamie@example.com", tags: ["Lead", "New"], customFields: [{ id: "private", value: "discard me" }, { id: "custom-field-123456", value: "2026-10-29" }] });
  const signature = sign(null, Buffer.from(body), privateKey).toString("base64");
  assert.equal(await verifyGhlWebhookSignature(body, signature, publicKeyBase64), true);
  assert.equal(await verifyGhlWebhookSignature(`${body} `, signature, publicKeyBase64), false);
  assert.equal(await verifyGhlWebhookSignature(body, "invalid", publicKeyBase64), false);
  assert.deepEqual(parseGhlContactWebhook(JSON.parse(body)), {
    type: "ContactCreate", locationId: "location-123456", contactId: "contact-123456", webhookId: "delivery-123",
    values: { id: "contact-123456", name: "Jamie Example", email: "jamie@example.com", tags: ["Lead", "New"], "customField_custom-field-123456": "2026-10-29" },
  });
  assert.deepEqual(parseGhlContactWebhook({ type: "ContactDelete", locationId: "location-123456", id: "contact-123456" }), {
    type: "ContactDelete", locationId: "location-123456", contactId: "contact-123456", webhookId: "", values: { id: "contact-123456" },
  });
  assert.deepEqual(parseGhlContactWebhook({ type: "ContactDndUpdate", locationId: "location-123456", id: "contact-123456", dnd: false, dndSettings: { SMS: { status: "active" }, Email: { status: "inactive" } }, inboundDndSettings: { all: { status: "inactive" }, WhatsApp: { status: "active" } } }), {
    type: "ContactDndUpdate", locationId: "location-123456", contactId: "contact-123456", webhookId: "", values: { id: "contact-123456", globalDnd: "false", emailDnd: "inactive", smsDnd: "active", inboundAllDnd: "inactive", inbound_whatsappDnd: "active" },
  });
  assert.equal(parseGhlContactWebhook({ type: "InboundMessage", locationId: "location-123456", contactId: "contact-123456", direction: "outbound" }), null);
  assert.deepEqual(parseGhlContactWebhook({ type: "InboundMessage", locationId: "location-123456", contactId: "contact-123456", direction: "inbound", messageId: "message-123456", conversationId: "conversation-123456", messageType: "SMS", status: "delivered", body: "Do not persist this message" }), {
    type: "InboundMessage", locationId: "location-123456", contactId: "contact-123456", webhookId: "", values: { id: "contact-123456", messageId: "message-123456", conversationId: "conversation-123456", messageType: "SMS", messageStatus: "delivered", messageDirection: "inbound" },
  });
  assert.deepEqual(parseGhlContactWebhook({ type: "OutboundMessage", locationId: "location-123456", contactId: "contact-123456", direction: "outbound", messageId: "message-654321", messageType: "SMS", status: "delivered", body: "Do not store the outbound message body" }), {
    type: "OutboundMessage", locationId: "location-123456", contactId: "contact-123456", webhookId: "", values: { id: "contact-123456", messageId: "message-654321", messageType: "SMS", messageStatus: "delivered", messageDirection: "outbound" },
  });
});

test("GoHighLevel webhook automation enqueue is location scoped, event scoped and idempotent", async () => {
  const db = new TestD1();
  db.db.exec(`
    CREATE TABLE gohighlevel_location_links (owner_id TEXT, client_id TEXT, location_id TEXT, UNIQUE(owner_id, client_id));
    CREATE TABLE marketing_assets (id TEXT, owner_id TEXT, client_id TEXT, kind TEXT, name TEXT, slug TEXT, status TEXT, data TEXT);
    CREATE TABLE marketing_executions (id TEXT PRIMARY KEY, owner_id TEXT, automation_id TEXT, trigger_key TEXT, status TEXT, input TEXT, result TEXT, run_at TEXT, created_at TEXT, updated_at TEXT, UNIQUE(owner_id, automation_id, trigger_key));
    CREATE TABLE marketing_ghl_contact_state (owner_id TEXT, client_id TEXT, contact_id TEXT, tags_json TEXT, updated_at TEXT, PRIMARY KEY(owner_id, client_id, contact_id));
  `);
  db.db.prepare("INSERT INTO gohighlevel_location_links VALUES ('owner-1','client-1','location-123456')").run();
  const workflow = (event) => JSON.stringify({ nodes: [
    { id: "trigger", type: "trigger", config: serializeMarketingTrigger(event, "") },
    ...(event === "contact_created" ? [{ id: "condition", type: "condition", label: "Has email", config: JSON.stringify({ fieldId: "email", operator: "isNotEmpty" }) }] : []),
    ...(event === "contact_updated" ? [{ id: "update", type: "updateContact", label: "Map contact", config: JSON.stringify({ mappings: [{ fieldId: "email", contactField: "email" }] }) }] : []),
    ...(event === "appointment_created" ? [{ id: "condition", type: "condition", label: "Has title", config: JSON.stringify({ fieldId: "appointmentTitle", operator: "isNotEmpty" }) }] : []),
    ...(event.startsWith("opportunity_") ? [{ id: "condition", type: "condition", label: "Has opportunity", config: JSON.stringify({ fieldId: event === "opportunity_stage_changed" ? "pipelineStageId" : "opportunityStatus", operator: "isNotEmpty" }) }] : []),
    ...(event === "customer_replied" ? [{ id: "condition", type: "condition", label: "Has reply channel", config: JSON.stringify({ fieldId: "messageType", operator: "isNotEmpty" }) }] : []),
    ...(event === "tag_added" ? [{ id: "tag", type: "trigger", label: "Qualified tag", config: serializeMarketingTrigger(event, "", "", "Europe/Dublin", "Qualified") }] : []),
    { id: "followup", type: "task", label: "Follow up", config: "Call the new lead" },
  ] });
  for (const [id, client, event] of [["created", "client-1", "contact_created"], ["updated", "client-1", "contact_updated"], ["other-client", "client-2", "contact_created"]]) {
    db.db.prepare("INSERT INTO marketing_assets VALUES (?, 'owner-1', ?, 'automation', ?, ?, 'active', ?)").run(id, client, id, id, workflow(event));
  }
  for (const [id, event, tagName] of [["tag-added", "tag_added", "Qualified"], ["tag-removed", "tag_removed", "Lead"]]) {
    const config = serializeMarketingTrigger(event, "", "", "Europe/Dublin", tagName);
    db.db.prepare("INSERT INTO marketing_assets VALUES (?, 'owner-1', 'client-1', 'automation', ?, ?, 'active', ?)").run(id, id, id, JSON.stringify({ nodes: [{ id: "trigger", type: "trigger", config }, { id: "task", type: "task", label: "Tag change", config: "Review tag change" }] }));
  }
  db.db.prepare("INSERT INTO marketing_assets VALUES (?, 'owner-1', 'client-1', 'automation', ?, ?, 'active', ?)").run("appointment", "appointment", "appointment", workflow("appointment_created"));
  db.db.prepare("INSERT INTO marketing_assets VALUES (?, 'owner-1', 'client-1', 'automation', ?, ?, 'active', ?)").run("opportunity-status", "opportunity status", "opportunity-status", workflow("opportunity_status_changed"));
  db.db.prepare("INSERT INTO marketing_assets VALUES (?, 'owner-1', 'client-1', 'automation', ?, ?, 'active', ?)").run("opportunity-stage", "opportunity stage", "opportunity-stage", workflow("opportunity_stage_changed"));
  db.db.prepare("INSERT INTO marketing_assets VALUES (?, 'owner-1', 'client-1', 'automation', ?, ?, 'active', ?)").run("customer-replied", "customer replied", "customer-replied", workflow("customer_replied"));
  const event = parseGhlContactWebhook({ type: "ContactCreate", locationId: "location-123456", id: "contact-123456", webhookId: "delivery-123", name: "Jamie Example", email: "jamie@example.com", tags: ["Lead"] });
  assert.ok(event);
  await enqueueGhlContactAutomations(db, event, new Date("2026-10-27T12:00:00.000Z"));
  await enqueueGhlContactAutomations(db, event, new Date("2026-10-27T12:00:01.000Z"));
  const updateEvent = parseGhlContactWebhook({ type: "ContactUpdate", locationId: "location-123456", id: "contact-123456", webhookId: "delivery-124", name: "Jamie Example", email: "jamie@example.com", phone: "+35312345678" });
  assert.ok(updateEvent);
  await enqueueGhlContactAutomations(db, updateEvent, new Date("2026-10-27T12:00:02.000Z"));
  const tagAdded = parseGhlContactWebhook({ type: "ContactTagUpdate", locationId: "location-123456", id: "contact-123456", webhookId: "delivery-125", name: "Jamie Example", email: "jamie@example.com", tags: ["Lead", "Qualified"] });
  assert.ok(tagAdded);
  await enqueueGhlContactAutomations(db, tagAdded, new Date("2026-10-27T12:00:03.000Z"));
  await enqueueGhlContactAutomations(db, tagAdded, new Date("2026-10-27T12:00:04.000Z"));
  const tagRemoved = parseGhlContactWebhook({ type: "ContactTagUpdate", locationId: "location-123456", id: "contact-123456", webhookId: "delivery-126", name: "Jamie Example", email: "jamie@example.com", tags: ["Qualified"] });
  assert.ok(tagRemoved);
  await enqueueGhlContactAutomations(db, tagRemoved, new Date("2026-10-27T12:00:05.000Z"));
  const appointment = parseGhlContactWebhook({ type: "AppointmentCreate", locationId: "location-123456", webhookId: "delivery-127", appointment: { id: "appointment-123", contactId: "contact-123456", title: "Roof inspection", appointmentStatus: "confirmed", startTime: "2026-11-01T10:00:00Z", calendarId: "calendar-123" } });
  assert.ok(appointment);
  await enqueueGhlContactAutomations(db, appointment, new Date("2026-10-27T12:00:06.000Z"));
  const opportunityStatus = parseGhlContactWebhook({ type: "OpportunityStatusUpdate", locationId: "location-123456", webhookId: "delivery-128", id: "opportunity-123456", contactId: "contact-123456", name: "Roof replacement", status: "won", pipelineId: "pipeline-123456", pipelineStageId: "stage-123456", monetaryValue: 5000 });
  assert.ok(opportunityStatus);
  await enqueueGhlContactAutomations(db, opportunityStatus, new Date("2026-10-27T12:00:07.000Z"));
  const opportunityStage = parseGhlContactWebhook({ type: "OpportunityStageUpdate", locationId: "location-123456", webhookId: "delivery-129", id: "opportunity-123456", contactId: "contact-123456", name: "Roof replacement", status: "open", pipelineId: "pipeline-123456", pipelineStageId: "stage-789012" });
  assert.ok(opportunityStage);
  await enqueueGhlContactAutomations(db, opportunityStage, new Date("2026-10-27T12:00:08.000Z"));
  const inbound = parseGhlContactWebhook({ type: "InboundMessage", locationId: "location-123456", webhookId: "delivery-130", contactId: "contact-123456", direction: "inbound", messageId: "message-123456", messageType: "SMS", body: "private message content" });
  assert.ok(inbound);
  await enqueueGhlContactAutomations(db, inbound, new Date("2026-10-27T12:00:09.000Z"));
  const runs = db.db.prepare("SELECT automation_id, input FROM marketing_executions ORDER BY automation_id").all();
  assert.deepEqual(runs.map((run) => run.automation_id), ["appointment", "created", "customer-replied", "opportunity-stage", "opportunity-status", "tag-added", "tag-removed"]);
  const input = JSON.parse(runs.find((run) => run.automation_id === "created").input);
  assert.equal(input.clientId, "client-1");
  assert.equal(input.data.contactSync.contactId, "contact-123456");
  assert.equal(input.data.values.email, "jamie@example.com");
  assert.equal(input.data.values.phone, undefined, "only fields referenced by workflow steps should be persisted");
  const appointmentInput = JSON.parse(runs.find((run) => run.automation_id === "appointment").input);
  assert.equal(appointmentInput.data.values.appointmentTitle, "Roof inspection");
  assert.equal(appointmentInput.data.values.email, undefined);
  assert.equal(JSON.parse(runs.find((run) => run.automation_id === "opportunity-status").input).data.values.opportunityStatus, "won");
  assert.equal(JSON.parse(runs.find((run) => run.automation_id === "opportunity-stage").input).data.values.pipelineStageId, "stage-789012");
  const replyValues = JSON.parse(runs.find((run) => run.automation_id === "customer-replied").input).data.values;
  assert.deepEqual(replyValues, { messageType: "SMS" });
  assert.equal(JSON.stringify(runs.find((run) => run.automation_id === "customer-replied").input).includes("private message content"), false);
});

test("GoHighLevel DND updates cancel only queued customer messages suppressed by the changed preference", async () => {
  const db = new TestD1();
  db.db.exec(`
    CREATE TABLE gohighlevel_location_links (owner_id TEXT, client_id TEXT, location_id TEXT, UNIQUE(owner_id, client_id));
    CREATE TABLE marketing_assets (id TEXT, owner_id TEXT, client_id TEXT, kind TEXT, name TEXT, slug TEXT, status TEXT, data TEXT);
    CREATE TABLE marketing_executions (id TEXT PRIMARY KEY, owner_id TEXT, automation_id TEXT, trigger_key TEXT, status TEXT, input TEXT, result TEXT, run_at TEXT, created_at TEXT, updated_at TEXT, UNIQUE(owner_id, automation_id, trigger_key));
  `);
  db.db.prepare("INSERT INTO gohighlevel_location_links VALUES ('owner-1','client-1','location-123456')").run();
  const add = (id, nodeType) => {
    const data = JSON.stringify({ nodes: [{ id: "trigger", type: "trigger", config: "{}" }, { id: "message", type: nodeType, config: "{}" }] });
    db.db.prepare("INSERT INTO marketing_assets VALUES (?, 'owner-1', 'client-1', 'automation', ?, ?, 'active', ?)").run(id, id, id, data);
    const input = JSON.stringify({ clientId: "client-1", data: { contactSync: { contactId: "contact-123456" } } });
    db.db.prepare("INSERT INTO marketing_executions VALUES (?, 'owner-1', ?, ?, 'queued', ?, '{}', '2026-10-28T12:00:00.000Z', '2026-10-27T12:00:00.000Z', '2026-10-27T12:00:00.000Z')").run(`run-${id}`, id, `trigger-${id}`, input);
  };
  add("sms-flow", "customerSms");
  add("email-flow", "customerEmail");
  add("task-flow", "task");
  const event = parseGhlContactWebhook({ type: "ContactDndUpdate", locationId: "location-123456", id: "contact-123456", dnd: false, dndSettings: { SMS: { status: "active" } } });
  assert.ok(event);
  await enqueueGhlContactAutomations(db, event, new Date("2026-10-27T12:00:01.000Z"));
  const results = db.db.prepare("SELECT automation_id, status, result FROM marketing_executions ORDER BY automation_id").all();
  assert.deepEqual(results.map(({ automation_id, status }) => [automation_id, status]), [["email-flow", "queued"], ["sms-flow", "cancelled"], ["task-flow", "queued"]]);
  assert.equal(JSON.parse(results.find(({ automation_id }) => automation_id === "sms-flow").result).detail, "GoHighLevel do-not-contact settings changed; queued customer message cancelled.");
});

test("GoHighLevel outbound status webhooks update only the exactly matched message and contact", async () => {
  const db = new TestD1();
  db.db.exec(`
    CREATE TABLE gohighlevel_location_links (owner_id TEXT, client_id TEXT, location_id TEXT, UNIQUE(owner_id, client_id));
    CREATE TABLE marketing_executions (id TEXT PRIMARY KEY, owner_id TEXT, automation_id TEXT, trigger_key TEXT, status TEXT, input TEXT, result TEXT, run_at TEXT, created_at TEXT, updated_at TEXT, UNIQUE(owner_id, automation_id, trigger_key));
  `);
  db.db.prepare("INSERT INTO gohighlevel_location_links VALUES ('owner-1','client-1','location-123456')").run();
  const input = JSON.stringify({ clientId: "client-1", data: { contactSync: { contactId: "contact-123456" } } });
  const result = JSON.stringify({ externalMessages: { "node-sms": { status: "sent", channel: "SMS", providerMessageId: "message-654321", contactId: "contact-123456" } } });
  db.db.prepare("INSERT INTO marketing_executions VALUES ('run-1','owner-1','automation-1','trigger-1','succeeded',?1,?2,'2026-10-27T12:00:00.000Z','2026-10-27T12:00:00.000Z','2026-10-27T12:00:00.000Z')").run(input, result);
  const event = parseGhlContactWebhook({ type: "OutboundMessage", locationId: "location-123456", contactId: "contact-123456", direction: "outbound", messageId: "message-654321", messageType: "SMS", status: "delivered", body: "Private message text" });
  assert.ok(event);
  await enqueueGhlContactAutomations(db, event, new Date("2026-10-27T12:01:00.000Z"));
  const delivered = JSON.parse(db.db.prepare("SELECT result FROM marketing_executions WHERE id = 'run-1'").get().result);
  assert.deepEqual(delivered.externalMessages["node-sms"], { status: "sent", channel: "SMS", providerMessageId: "message-654321", contactId: "contact-123456", deliveryStatus: "delivered", checkedAt: "2026-10-27T12:01:00.000Z" });
  const wrongContact = parseGhlContactWebhook({ type: "OutboundMessage", locationId: "location-123456", contactId: "contact-987654", direction: "outbound", messageId: "message-654321", messageType: "SMS", status: "failed" });
  await enqueueGhlContactAutomations(db, wrongContact, new Date("2026-10-27T12:02:00.000Z"));
  const unchanged = JSON.parse(db.db.prepare("SELECT result FROM marketing_executions WHERE id = 'run-1'").get().result);
  assert.equal(unchanged.externalMessages["node-sms"].deliveryStatus, "delivered");
  assert.equal(JSON.stringify(event).includes("Private message text"), false);
});

test("appointment approaching trigger schedules one background run at its configured lead time", async () => {
  const db = new TestD1();
  db.db.exec(`
    CREATE TABLE gohighlevel_location_links (owner_id TEXT, client_id TEXT, location_id TEXT, UNIQUE(owner_id, client_id));
    CREATE TABLE marketing_assets (id TEXT, owner_id TEXT, client_id TEXT, kind TEXT, name TEXT, slug TEXT, status TEXT, data TEXT);
    CREATE TABLE marketing_executions (id TEXT PRIMARY KEY, owner_id TEXT, automation_id TEXT, trigger_key TEXT, status TEXT, input TEXT, result TEXT, run_at TEXT, created_at TEXT, updated_at TEXT, UNIQUE(owner_id, automation_id, trigger_key));
    CREATE TABLE marketing_ghl_contact_state (owner_id TEXT, client_id TEXT, contact_id TEXT, tags_json TEXT, updated_at TEXT, PRIMARY KEY(owner_id, client_id, contact_id));
  `);
  db.db.prepare("INSERT INTO gohighlevel_location_links VALUES ('owner-1','client-1','location-123456')").run();
  const config = serializeMarketingTrigger("appointment_approaching", "", "", "Europe/Dublin", "", { amount: 1, unit: "days" });
  const nodes = [{ id: "trigger", type: "trigger", config }, { id: "condition", type: "condition", label: "Appointment title", config: JSON.stringify({ fieldId: "appointmentTitle", operator: "isNotEmpty" }) }, { id: "task", type: "task", label: "Prepare", config: "Prepare for the appointment" }];
  db.db.prepare("INSERT INTO marketing_assets VALUES ('auto-1','owner-1','client-1','automation','Reminder','reminder','active',?)").run(JSON.stringify({ nodes }));
  const event = parseGhlContactWebhook({ type: "AppointmentCreate", locationId: "location-123456", webhookId: "delivery-1", appointment: { id: "appointment-123", contactId: "contact-123456", title: "Roof inspection", appointmentStatus: "confirmed", startTime: "2026-10-30T10:00:00.000Z" } });
  assert.ok(event);
  const receivedAt = new Date("2026-10-27T10:00:00.000Z");
  await enqueueGhlContactAutomations(db, event, receivedAt);
  await enqueueGhlContactAutomations(db, { ...event, webhookId: "redelivery-with-new-id" }, receivedAt);
  const rows = db.db.prepare("SELECT trigger_key, status, run_at, created_at, input FROM marketing_executions").all();
  assert.equal(rows.length, 1, "duplicate delivery does not create another reminder");
  assert.equal(rows[0].status, "queued");
  assert.equal(rows[0].run_at, "2026-10-29T10:00:00.000Z");
  assert.equal(rows[0].created_at, receivedAt.toISOString());
  assert.match(rows[0].trigger_key, /appointment-123/);
  assert.equal(JSON.parse(rows[0].input).data.values.appointmentTitle, "Roof inspection");
  const alreadyDue = parseGhlContactWebhook({ type: "AppointmentCreate", locationId: "location-123456", webhookId: "delivery-2", appointment: { id: "appointment-456", contactId: "contact-123456", title: "Past lead time", startTime: "2026-10-27T12:00:00.000Z" } });
  assert.ok(alreadyDue);
  await enqueueGhlContactAutomations(db, alreadyDue, receivedAt);
  assert.equal(db.db.prepare("SELECT COUNT(*) AS total FROM marketing_executions").get().total, 1, "appointments whose reminder time already passed are ignored");
});

test("GoHighLevel birthday reminders store only month and day and queue in the background", async () => {
  const db = new TestD1();
  db.db.exec(`
    CREATE TABLE gohighlevel_location_links (owner_id TEXT, client_id TEXT, location_id TEXT, UNIQUE(owner_id, client_id));
    CREATE TABLE marketing_assets (id TEXT, owner_id TEXT, client_id TEXT, kind TEXT, name TEXT, slug TEXT, status TEXT, data TEXT);
    CREATE TABLE marketing_executions (id TEXT PRIMARY KEY, owner_id TEXT, automation_id TEXT, trigger_key TEXT, status TEXT, input TEXT, result TEXT, run_at TEXT, created_at TEXT, updated_at TEXT, UNIQUE(owner_id, automation_id, trigger_key));
    CREATE TABLE marketing_ghl_contact_state (owner_id TEXT, client_id TEXT, contact_id TEXT, tags_json TEXT, updated_at TEXT, PRIMARY KEY(owner_id, client_id, contact_id));
  `);
  db.db.prepare("INSERT INTO gohighlevel_location_links VALUES ('owner-1','client-1','location-123456')").run();
  const trigger = serializeMarketingTrigger("birthday", "", "", "Europe/Dublin", "", undefined, { time: "09:00", leapDayPolicy: "feb28" });
  const nodes = [
    { id: "trigger", type: "trigger", config: trigger },
    { id: "condition", type: "condition", label: "Has birthday", config: JSON.stringify({ fieldId: "dateOfBirth", operator: "isNotEmpty" }) },
    { id: "task", type: "task", label: "Prepare", config: "Send a birthday greeting" },
  ];
  db.db.prepare("INSERT INTO marketing_assets VALUES ('birthday-auto','owner-1','client-1','automation','Birthday','birthday','active',?)").run(JSON.stringify({ nodes }));
  const created = parseGhlContactWebhook({ type: "ContactCreate", locationId: "location-123456", webhookId: "birthday-contact", id: "contact-123456", dateOfBirth: "1990-10-29T00:00:00.000Z", email: "private@example.test" });
  assert.ok(created);
  await enqueueGhlContactAutomations(db, created, new Date("2026-10-27T08:00:00.000Z"));
  const stored = db.db.prepare("SELECT birthday_month_day FROM marketing_ghl_contact_birthdays").get();
  assert.equal(stored.birthday_month_day, "10-29", "birthday storage must not retain the birth year or unrelated contact details");
  await processDueMarketingAutomations(db, new Date("2026-10-27T08:05:00.000Z"));
  const run = db.db.prepare("SELECT trigger_key, status, run_at, input FROM marketing_executions").get();
  assert.equal(run.trigger_key, "ghl:birthday:contact-123456:2026");
  assert.equal(run.status, "queued");
  assert.equal(run.run_at, "2026-10-29T09:00:00.000Z");
  const input = JSON.parse(run.input);
  assert.deepEqual(input.data.values, { dateOfBirth: "10-29" });
  await processDueMarketingAutomations(db, new Date("2026-10-27T08:10:00.000Z"));
  assert.equal(db.db.prepare("SELECT COUNT(*) AS total FROM marketing_executions").get().total, 1, "the runner must not enqueue duplicate yearly reminders");
});

test("birthday runner pages large client lists without skipping or duplicating contacts", async () => {
  const db = new TestD1();
  db.db.exec(`
    CREATE TABLE marketing_assets (id TEXT, owner_id TEXT, client_id TEXT, kind TEXT, name TEXT, slug TEXT, status TEXT, data TEXT);
    CREATE TABLE marketing_executions (id TEXT PRIMARY KEY, owner_id TEXT, automation_id TEXT, trigger_key TEXT, status TEXT, input TEXT, result TEXT, run_at TEXT, created_at TEXT, updated_at TEXT, UNIQUE(owner_id, automation_id, trigger_key));
  `);
  const nodes = [
    { id: "trigger", type: "trigger", config: serializeMarketingTrigger("birthday", "", "", "UTC", "", undefined, { time: "09:00" }) },
    { id: "task", type: "task", label: "Prepare", config: "Send a birthday greeting" },
  ];
  db.db.prepare("INSERT INTO marketing_assets VALUES ('birthday-auto','owner-1','client-1','automation','Birthday','birthday','active',?)").run(JSON.stringify({ nodes }));
  const insert = db.db.prepare("INSERT INTO marketing_ghl_contact_birthdays VALUES ('owner-1','client-1',?,'10-29','seed')");
  for (let index = 1; index <= 501; index++) insert.run(`contact-${String(index).padStart(4, "0")}`);
  const now = new Date("2026-10-27T08:00:00.000Z");
  await processDueMarketingAutomations(db, now);
  assert.equal(db.db.prepare("SELECT COUNT(*) AS total FROM marketing_executions").get().total, 500);
  await processDueMarketingAutomations(db, new Date(now.getTime() + 5 * 60_000));
  assert.equal(db.db.prepare("SELECT COUNT(*) AS total FROM marketing_executions").get().total, 501);
  await processDueMarketingAutomations(db, new Date(now.getTime() + 10 * 60_000));
  assert.equal(db.db.prepare("SELECT COUNT(*) AS total FROM marketing_executions").get().total, 501);
});

test("GoHighLevel custom date field changes schedule one scoped run and replace stale dates", async () => {
  const db = new TestD1();
  db.db.exec(`
    CREATE TABLE gohighlevel_location_links (owner_id TEXT, client_id TEXT, location_id TEXT, UNIQUE(owner_id, client_id));
    CREATE TABLE marketing_assets (id TEXT, owner_id TEXT, client_id TEXT, kind TEXT, name TEXT, slug TEXT, status TEXT, data TEXT);
    CREATE TABLE marketing_executions (id TEXT PRIMARY KEY, owner_id TEXT, automation_id TEXT, trigger_key TEXT, status TEXT, input TEXT, result TEXT, run_at TEXT, created_at TEXT, updated_at TEXT, UNIQUE(owner_id, automation_id, trigger_key));
    CREATE TABLE marketing_ghl_contact_state (owner_id TEXT, client_id TEXT, contact_id TEXT, tags_json TEXT, updated_at TEXT, PRIMARY KEY(owner_id, client_id, contact_id));
  `);
  db.db.prepare("INSERT INTO gohighlevel_location_links VALUES ('owner-1','client-1','location-123456')").run();
  const config = serializeMarketingTrigger("date_field", "", "", "Europe/Dublin", "", undefined, undefined, { fieldId: "custom-field-123456", fieldName: "Inspection date", fieldType: "DATE", time: "10:30" });
  const nodes = [{ id: "trigger", type: "trigger", config }, { id: "condition", type: "condition", label: "Has date", config: JSON.stringify({ fieldId: "customField_custom-field-123456", operator: "isNotEmpty" }) }, { id: "task", type: "task", label: "Prepare", config: "Prepare for inspection" }];
  db.db.prepare("INSERT INTO marketing_assets VALUES ('date-auto','owner-1','client-1','automation','Inspection reminder','inspection','active',?)").run(JSON.stringify({ nodes }));
  const now = new Date("2026-10-27T08:00:00.000Z");
  const created = parseGhlContactWebhook({ type: "ContactCreate", locationId: "location-123456", webhookId: "date-created", id: "contact-123456", customFields: [{ id: "custom-field-123456", value: "2026-10-30" }] });
  assert.ok(created);
  await enqueueGhlContactAutomations(db, created, now);
  let run = db.db.prepare("SELECT trigger_key, status, run_at, input FROM marketing_executions").get();
  assert.equal(run.run_at, "2026-10-30T10:30:00.000Z");
  assert.deepEqual(JSON.parse(run.input).data.values, { "customField_custom-field-123456": "2026-10-30" });
  const sameDate = parseGhlContactWebhook({ type: "ContactUpdate", locationId: "location-123456", webhookId: "date-same", id: "contact-123456", customFields: [{ id: "custom-field-123456", value: "2026-10-30" }] });
  assert.ok(sameDate);
  await enqueueGhlContactAutomations(db, sameDate, now);
  assert.equal(db.db.prepare("SELECT COUNT(*) AS total FROM marketing_executions").get().total, 1, "same date updates revive the existing idempotent reminder instead of cancelling it");
  assert.equal(db.db.prepare("SELECT status FROM marketing_executions").get().status, "queued");
  const updated = parseGhlContactWebhook({ type: "ContactUpdate", locationId: "location-123456", webhookId: "date-updated", id: "contact-123456", customFields: [{ id: "custom-field-123456", value: "2026-11-02" }] });
  assert.ok(updated);
  await enqueueGhlContactAutomations(db, updated, now);
  const runs = db.db.prepare("SELECT trigger_key, status, run_at FROM marketing_executions ORDER BY run_at").all();
  assert.equal(runs.length, 2);
  assert.deepEqual(runs.map((item) => item.status), ["cancelled", "queued"]);
  assert.equal(runs[1].run_at, "2026-11-02T10:30:00.000Z");
  const deleted = parseGhlContactWebhook({ type: "ContactDelete", locationId: "location-123456", id: "contact-123456" });
  assert.ok(deleted);
  await enqueueGhlContactAutomations(db, deleted, now);
  assert.equal(db.db.prepare("SELECT COUNT(*) AS total FROM marketing_executions WHERE status = 'queued'").get().total, 0, "deleting a GHL contact cancels their scheduled custom-date reminder");
});

test("workflow conditions compare saved field values safely and case-insensitively", () => {
  assert.equal(conditionPasses("service=roof repair", { service: "Roof Repair" }), true);
  assert.equal(conditionPasses("services=roof,gutters", { services: ["roof", "gutters"] }), true);
  assert.equal(conditionPasses("service=roof", { service: "gutter" }), false);
  assert.equal(conditionPasses("missing", {}), false);
  assert.equal(conditionPasses("=value", { "": "value" }), false);
  assert.equal(conditionPasses(JSON.stringify({ fieldId: "area", operator: "greaterThan", value: "100" }), { area: "150" }), true);
  assert.equal(conditionPasses(JSON.stringify({ fieldId: "service", operator: "contains", value: "roof" }), { service: "Roof repair" }), true);
  assert.equal(conditionPasses(JSON.stringify({ fieldId: "missing", operator: "isEmpty" }), {}), false);
});

test("workflow conditions support AND and OR groups and reject oversized groups", () => {
  const rules = [
    { fieldId: "service", operator: "contains", value: "roof" },
    { fieldId: "budget", operator: "greaterThan", value: "1000" },
  ];
  assert.equal(conditionPasses(JSON.stringify({ mode: "and", conditions: rules }), { service: "Roof repair", budget: "1500" }), true);
  assert.equal(conditionPasses(JSON.stringify({ mode: "and", conditions: rules }), { service: "Roof repair", budget: "500" }), false);
  assert.equal(conditionPasses(JSON.stringify({ mode: "or", conditions: rules }), { service: "Gutter repair", budget: "1500" }), true);
  assert.equal(conditionPasses(JSON.stringify({ mode: "or", conditions: rules }), { service: "Gutter repair", budget: "500" }), false);
  assert.equal(conditionPasses(JSON.stringify({ mode: "or", conditions: [...rules, ...rules, ...rules, ...rules, ...rules] }), { service: "Roof repair", budget: "1500" }), false);
});

test("workflow dry test follows the same saved branch conditions without running actions", () => {
  const nodes = [
    { id: "trigger", type: "trigger", config: "{}" },
    { id: "condition", type: "condition", label: "Has email", config: JSON.stringify({ fieldId: "email", operator: "isNotEmpty", thenNodeId: "email-task", elseNodeId: "no-email" }) },
    { id: "email-task", type: "task", label: "Email lead", config: "Call the lead" },
    { id: "yes-end", type: "end", label: "Finish yes path", config: "" },
    { id: "no-email", type: "end", label: "No email", config: "" },
  ];
  const withEmail = simulateMarketingAutomation(nodes, { email: "jamie@example.test" });
  assert.equal(withEmail.outcome, "ended");
  assert.deepEqual(withEmail.steps.map((step) => step.id), ["condition", "email-task", "yes-end"]);
  assert.match(withEmail.steps[1].detail, /^Would create task:/);
  const withoutEmail = simulateMarketingAutomation(nodes, { email: "" });
  assert.equal(withoutEmail.outcome, "ended");
  assert.deepEqual(withoutEmail.steps.map((step) => step.id), ["condition", "no-email"]);
  assert.equal(JSON.stringify(withEmail).includes("jamie@example.test"), false, "the dry-run output does not retain test answers");
});

test("workflow dry test stops safely at wait and rejects backward branch loops", () => {
  const wait = simulateMarketingAutomation([{ id: "trigger", type: "trigger" }, { id: "wait", type: "wait", label: "Wait", config: JSON.stringify({ amount: 2, unit: "hours" }) }, { id: "task", type: "task", config: "Task" }]);
  assert.equal(wait.outcome, "paused");
  assert.equal(wait.steps.length, 1, "a dry test must not claim that later steps ran after a wait");
  const loop = simulateMarketingAutomation([{ id: "trigger", type: "trigger" }, { id: "condition", type: "condition", label: "Bad route", config: JSON.stringify({ fieldId: "x", operator: "equals", value: "y", thenNodeId: "trigger" }) }], { x: "y" });
  assert.equal(loop.outcome, "invalid");
  assert.match(loop.error, /later step/);
});

test("workflow route map shows sequential steps, explicit branches and workflow endings", () => {
  const map = buildMarketingAutomationMap([
    { id: "trigger", type: "trigger", label: "Form submitted" },
    { id: "condition", type: "condition", label: "Has email", config: JSON.stringify({ thenNodeId: "email", elseNodeId: "no-email" }) },
    { id: "email", type: "email", label: "Send email" },
    { id: "no-email", type: "end", label: "Finish" },
  ]);
  assert.deepEqual(map.nodes.map((node) => node.label), ["Form submitted", "Has email", "Send email", "Finish"]);
  assert.deepEqual(map.nodes.map((node) => node.position), [{ x: 40, y: 40 }, { x: 360, y: 40 }, { x: 680, y: 40 }, { x: 40, y: 210 }]);
  assert.deepEqual(map.edges.map(({ from, to, branch }) => [from, to, branch]), [
    ["trigger", "condition", "Next"],
    ["condition", "email", "Yes"],
    ["condition", "no-email", "No"],
    ["email", "no-email", "Next"],
  ]);
  assert.deepEqual(buildMarketingAutomationMap(null), { nodes: [], edges: [] });
  assert.deepEqual(buildMarketingAutomationMap([{ id: "positioned", type: "task", position: { x: -5, y: 6500 } }]).nodes[0].position, { x: 0, y: 6000 });
});

test("condition branches can be connected to later steps without mutating the saved draft", () => {
  const original = [
    { id: "trigger", type: "trigger", config: "{}" },
    { id: "condition", type: "condition", config: JSON.stringify({ fieldId: "email", operator: "isNotEmpty" }) },
    { id: "yes", type: "email", config: "{}" },
    { id: "no", type: "end", config: "{}" },
  ];
  const connected = connectMarketingAutomationBranch(original, "condition", "yes", "yes");
  assert.equal(connected.error, "");
  assert.equal(JSON.parse(connected.nodes[1].config).thenNodeId, "yes");
  assert.equal(original[1].config.includes("thenNodeId"), false);
  const preview = simulateMarketingAutomation(connected.nodes, { email: "owner@example.com" });
  assert.deepEqual(preview.steps.map((step) => step.id), ["condition", "yes", "no"]);
  assert.equal(preview.outcome, "ended");
  const routedNo = connectMarketingAutomationBranch(connected.nodes, "condition", "no", "no");
  assert.equal(JSON.parse(routedNo.nodes[1].config).elseNodeId, "no");
  assert.equal(connectMarketingAutomationBranch(original, "condition", "yes", "trigger").error, "A branch must connect to a later workflow step.");
  assert.equal(connectMarketingAutomationBranch(original, "yes", "no", "no").error, "Choose a condition step to connect.");
});

test("automation node position sanitizer persists only finite bounded coordinates", () => {
  assert.deepEqual(normalizeMarketingAutomationPosition({ x: 184.7, y: 92.2 }), { x: 185, y: 92 });
  assert.deepEqual(normalizeMarketingAutomationPosition({ x: -4, y: 8000 }), { x: 0, y: 6000 });
  assert.equal(normalizeMarketingAutomationPosition({ x: "NaN", y: 40 }), null);
  assert.equal(normalizeMarketingAutomationPosition(null), null);
});

test("workflow steps can be duplicated without copying the trigger or mutating the original", () => {
  const original = [{ id: "trigger", type: "trigger", label: "Start", config: "{}" }, { id: "condition", type: "condition", label: "Check", config: JSON.stringify({ fieldId: "email", operator: "isNotEmpty", thenNodeId: "task" }), position: { x: 240, y: 120 } }, { id: "task", type: "task", label: "Follow up", config: "Call" }];
  const copied = duplicateMarketingAutomationNode(original, 1, () => "condition-copy");
  assert.equal(copied.error, "");
  assert.deepEqual(copied.nodes.map((node) => node.id), ["trigger", "condition", "condition-copy", "task"]);
  assert.equal(copied.nodes[2].label, "Check (copy)");
  assert.equal(JSON.parse(copied.nodes[2].config).thenNodeId, "task");
  assert.deepEqual(copied.nodes[2].position, { x: 280, y: 160 }, "canvas copies are offset so both cards remain visible");
  assert.equal(original.length, 3);
  assert.equal(duplicateMarketingAutomationNode(original, 0).error, "Choose a workflow step after the trigger.");
});

test("workflow nodes can be reordered without moving the trigger", () => {
  const nodes = [{ id: "trigger", type: "trigger" }, { id: "a", type: "task" }, { id: "b", type: "wait" }];
  const result = reorderMarketingAutomationNodes(nodes, 2, 1);
  assert.equal(result.error, "");
  assert.deepEqual(result.nodes.map((node) => node.id), ["trigger", "b", "a"]);
  assert.equal(reorderMarketingAutomationNodes(nodes, 0, 2).nodes, nodes);
});

test("saved workflow node types preserve contact update and terminal actions", () => {
  assert.equal(normalizeMarketingAutomationNodeType("updateContact"), "updateContact");
  assert.equal(normalizeMarketingAutomationNodeType("end"), "end");
  assert.equal(normalizeMarketingAutomationNodeType("stop"), "stop");
  assert.equal(normalizeMarketingAutomationNodeType("unsupported"), "task");
});

test("workflow drag reorder rejects backward condition routes", () => {
  const nodes = [
    { id: "trigger", type: "trigger", config: "" },
    { id: "condition", type: "condition", config: JSON.stringify({ fieldId: "email", operator: "isNotEmpty", thenNodeId: "send", elseNodeId: "stop" }) },
    { id: "send", type: "email", config: "" },
    { id: "stop", type: "end", config: "" },
  ];
  const result = reorderMarketingAutomationNodes(nodes, 3, 1);
  assert.match(result.error, /backward/);
  assert.equal(result.nodes, nodes);
});

test("marketing triggers preserve legacy slugs and match only their source event", () => {
  assert.deepEqual(parseMarketingTrigger("lead-form"), { event: "form_submitted", assetSlug: "lead-form" });
  assert.deepEqual(parseMarketingTrigger(serializeMarketingTrigger("contact_created", "lead-form")), { event: "contact_created", assetSlug: "lead-form" });
  const form = { slug: "lead-form", kind: "form" };
  assert.equal(marketingTriggerMatches(serializeMarketingTrigger("form_submitted", "lead-form"), form, { data: {} }), true);
  assert.equal(marketingTriggerMatches(serializeMarketingTrigger("survey_completed", "lead-form"), form, { data: {} }), false);
  assert.equal(marketingTriggerMatches(serializeMarketingTrigger("contact_created", "lead-form"), form, { data: { contactSync: { status: "synced", created: true } } }), true);
  assert.equal(marketingTriggerMatches(serializeMarketingTrigger("contact_created", "lead-form"), form, { data: { contactSync: { status: "synced", created: false } } }), false);
  assert.equal(marketingTriggerMatches(serializeMarketingTrigger("contact_updated", "lead-form"), form, { data: { contactSync: { status: "synced", created: false } } }), true);
  assert.equal(marketingTriggerMatches(serializeMarketingTrigger("contact_updated", "lead-form"), form, { data: { contactSync: { status: "failed", created: false } } }), false);
  assert.equal(marketingTriggerMatches(serializeMarketingTrigger("quote_requested", "quote-calc"), { slug: "quote-calc", kind: "calculator" }, { data: { quoteSummary: { total: 100 } } }), true);
  assert.equal(marketingTriggerMatches(serializeMarketingTrigger("quote_requested", "quote-calc"), { slug: "quote-calc", kind: "calculator" }, { data: {} }), false);
  assert.equal(parseMarketingTrigger(serializeMarketingTrigger("tag_added", "", "", "Europe/Dublin", "Qualified")).tagName, "Qualified");
  assert.equal(isMarketingGhlContactTrigger("tag_removed"), true);
  assert.equal(isMarketingGhlContactTrigger("contact_status_changed"), true);
  const statusTrigger = serializeMarketingTrigger("contact_status_changed", "", "", "Europe/Dublin", "", undefined, undefined, undefined, { fieldId: "status-field-123", fieldName: "Lead status" });
  assert.equal(parseMarketingTrigger(statusTrigger).statusFieldId, "status-field-123");
  assert.equal(marketingGhlContactTriggerMatches(statusTrigger, "ContactUpdate"), true);
  assert.equal(isMarketingGhlContactTrigger("appointment_created"), true);
  assert.equal(isMarketingGhlContactTrigger("appointment_approaching"), true);
  assert.equal(marketingGhlContactTriggerMatches(serializeMarketingTrigger("appointment_approaching", "", "", "Europe/Dublin", "", { amount: 2, unit: "hours" }), "AppointmentCreate"), true);
  assert.equal(marketingGhlContactTriggerMatches(serializeMarketingTrigger("opportunity_status_changed", ""), "OpportunityStatusUpdate"), true);
  assert.equal(marketingGhlContactTriggerMatches(serializeMarketingTrigger("opportunity_stage_changed", ""), "OpportunityStageUpdate"), true);
  assert.equal(isValidMarketingTriggerDateTime("2026-11-02T09:30:00.000Z"), true);
  assert.equal(isValidMarketingTriggerDateTime("2026-11-02 09:30"), false);
});

test("GoHighLevel contact status trigger stores a baseline and fires only when its selected custom field changes", async () => {
  const db = new TestD1();
  db.db.exec(`
    CREATE TABLE gohighlevel_location_links (owner_id TEXT, client_id TEXT, location_id TEXT, UNIQUE(owner_id, client_id));
    CREATE TABLE marketing_assets (id TEXT, owner_id TEXT, client_id TEXT, kind TEXT, name TEXT, slug TEXT, status TEXT, data TEXT);
    CREATE TABLE marketing_executions (id TEXT PRIMARY KEY, owner_id TEXT, automation_id TEXT, trigger_key TEXT, status TEXT, input TEXT, result TEXT, run_at TEXT, created_at TEXT, updated_at TEXT, UNIQUE(owner_id, automation_id, trigger_key));
    CREATE TABLE marketing_ghl_contact_state (owner_id TEXT, client_id TEXT, contact_id TEXT, tags_json TEXT, updated_at TEXT, PRIMARY KEY(owner_id, client_id, contact_id));
  `);
  db.db.prepare("INSERT INTO gohighlevel_location_links VALUES ('owner-1','client-1','location-123456')").run();
  const statusFieldId = "custom-status-123";
  const nodes = [
    { id: "trigger", type: "trigger", config: serializeMarketingTrigger("contact_status_changed", "", "", "Europe/Dublin", "", undefined, undefined, undefined, { fieldId: statusFieldId, fieldName: "Lead status" }) },
    { id: "update", type: "updateContact", config: JSON.stringify({ mappings: [{ fieldId: `customField_${statusFieldId}`, contactField: "firstName" }] }) },
  ];
  db.db.prepare("INSERT INTO marketing_assets VALUES ('status-flow','owner-1','client-1','automation','Status flow','status-flow','active',?)").run(JSON.stringify({ nodes }));
  const created = parseGhlContactWebhook({ type: "ContactCreate", locationId: "location-123456", webhookId: "status-created", id: "contact-123456", customFields: [{ id: statusFieldId, value: "New" }] });
  await enqueueGhlContactAutomations(db, created, new Date("2026-10-27T12:00:00.000Z"));
  assert.equal(db.db.prepare("SELECT COUNT(*) AS total FROM marketing_executions").get().total, 0, "create event only establishes the first known status");
  const unrelated = parseGhlContactWebhook({ type: "ContactUpdate", locationId: "location-123456", webhookId: "status-unrelated", id: "contact-123456", phone: "+35312345678", customFields: [{ id: statusFieldId, value: "New" }] });
  await enqueueGhlContactAutomations(db, unrelated, new Date("2026-10-27T12:00:01.000Z"));
  assert.equal(db.db.prepare("SELECT COUNT(*) AS total FROM marketing_executions").get().total, 0, "unchanged status does not trigger");
  const changed = parseGhlContactWebhook({ type: "ContactUpdate", locationId: "location-123456", webhookId: "status-changed", id: "contact-123456", customFields: [{ id: statusFieldId, value: "Qualified" }] });
  await enqueueGhlContactAutomations(db, changed, new Date("2026-10-27T12:00:02.000Z"));
  assert.equal(db.db.prepare("SELECT COUNT(*) AS total FROM marketing_executions").get().total, 1, "change enqueues exactly one run even if workflow contains an update action");
  const execution = db.db.prepare("SELECT input FROM marketing_executions").get();
  assert.equal(JSON.parse(execution.input).data.values[`customField_${statusFieldId}`], "Qualified");
});

test("submission enqueue starts only matching published-source and contact-sync triggers", async () => {
  const db = new TestD1();
  db.db.exec(`
    CREATE TABLE marketing_assets (id TEXT, owner_id TEXT, client_id TEXT, kind TEXT, name TEXT, slug TEXT, status TEXT, data TEXT);
    CREATE TABLE marketing_executions (id TEXT PRIMARY KEY, owner_id TEXT, automation_id TEXT, trigger_key TEXT, status TEXT, input TEXT, result TEXT, run_at TEXT, created_at TEXT, updated_at TEXT, UNIQUE(owner_id, automation_id, trigger_key));
  `);
  const workflow = (event) => ({ nodes: [{ id: "trigger", type: "trigger", config: serializeMarketingTrigger(event, "lead-form") }, { id: "end", type: "end", config: "" }] });
  for (const [id, event] of [["form", "form_submitted"], ["created", "contact_created"], ["updated", "contact_updated"], ["survey", "survey_completed"]]) {
    db.db.prepare("INSERT INTO marketing_assets VALUES (?, ?, ?, 'automation', ?, ?, 'active', ?)").run(id, "owner-1", "client-1", id, id, JSON.stringify(workflow(event)));
  }
  const form = { id: "form-1", owner_id: "owner-1", client_id: "client-1", slug: "lead-form" };
  const submission = { id: "submission-1", owner_id: "owner-1", asset_id: "form-1", kind: "form", data: JSON.stringify({ values: { email: "lead@example.com" }, contactSync: { status: "synced", contactId: "contact-1", created: true } }), created_at: "2026-10-27T10:00:00.000Z" };
  await enqueueMarketingAutomations(db, form, submission);
  const runs = db.db.prepare("SELECT automation_id FROM marketing_executions ORDER BY automation_id").all().map((row) => row.automation_id);
  assert.deepEqual(runs, ["created", "form"]);
});

test("contact update mappings allow only valid submitted standard fields", () => {
  const fields = [{ id: "name", label: "Name", type: "text" }, { id: "email", label: "Email", type: "email" }, { id: "consent", label: "Consent", type: "consent" }];
  const config = JSON.stringify({ mappings: [{ fieldId: "name", contactField: "firstName" }, { fieldId: "email", contactField: "email" }] });
  assert.deepEqual(parseMarketingContactUpdate(config, fields), { mappings: [{ fieldId: "name", contactField: "firstName" }, { fieldId: "email", contactField: "email" }] });
  assert.deepEqual(buildMarketingContactUpdate(config, fields, { name: " Alex ", email: "alex@example.test", consent: "yes" }), { payload: { firstName: "Alex", email: "alex@example.test" } });
  assert.match(parseMarketingContactUpdate(JSON.stringify({ mappings: [{ fieldId: "consent", contactField: "dnd" }] }), fields).error, /submitted answer/);
  assert.match(parseMarketingContactUpdate(JSON.stringify({ mappings: [{ fieldId: "name", contactField: "firstName" }, { fieldId: "email", contactField: "firstName" }] }), fields).error, /only once/);
  assert.match(buildMarketingContactUpdate(config, fields, { name: "Alex", email: "not-an-email" }).error, /email answer/);
  assert.match(buildMarketingContactUpdate(config, fields, { name: "", email: "" }).error, /No mapped contact values/);
});

test("contact update action writes only explicit mapped values for a synced contact", async () => {
  const db = new TestD1();
  db.db.exec(`
    CREATE TABLE marketing_assets (id TEXT, owner_id TEXT, client_id TEXT, kind TEXT, name TEXT, slug TEXT, status TEXT, data TEXT);
    CREATE TABLE marketing_executions (id TEXT PRIMARY KEY, owner_id TEXT, automation_id TEXT, trigger_key TEXT, status TEXT, input TEXT, result TEXT, run_at TEXT, created_at TEXT, updated_at TEXT);
  `);
  const config = JSON.stringify({ mappings: [{ fieldId: "name", contactField: "firstName" }, { fieldId: "email", contactField: "email" }] });
  const nodes = [{ id: "trigger", type: "trigger", label: "Lead form", config: "lead-form" }, { id: "update", type: "updateContact", label: "Update contact", config }];
  db.db.prepare("INSERT INTO marketing_assets VALUES (?, ?, ?, 'automation', ?, ?, 'active', ?)").run("auto-update", "owner-1", "client-1", "Update contact", "update-test", JSON.stringify({ nodes }));
  const at = "2026-10-27T10:00:00.000Z";
  const input = { formSlug: "lead-form", clientId: "client-1", fields: [{ id: "name", label: "Name", type: "text" }, { id: "email", label: "Email", type: "email" }, { id: "consent", label: "Consent", type: "consent" }], data: { values: { name: "Alex", email: "alex@example.test", consent: "yes" }, contactSync: { status: "synced", contactId: "hl-contact-1" } } };
  db.db.prepare("INSERT INTO marketing_executions VALUES (?, ?, ?, ?, 'queued', ?, '{}', ?, ?, ?)").run("run-update", "owner-1", "auto-update", "submission-1", JSON.stringify(input), at, at, at);
  const writes = [];
  await processDueMarketingAutomations(db, new Date(at), undefined, undefined, async (...args) => writes.push(args));
  assert.deepEqual(writes, [["owner-1", "client-1", "hl-contact-1", { firstName: "Alex", email: "alex@example.test" }]]);
  const run = db.db.prepare("SELECT status, result FROM marketing_executions WHERE id = 'run-update'").get();
  assert.equal(run.status, "succeeded");
  assert.match(JSON.parse(run.result).log.join(" "), /Updated GoHighLevel contact fields: firstName, email/);
  assert.equal(validateMarketingAutomationNodes(nodes, "client-1"), null);
});

test("specific-date workflow queues in the background and runs once at its selected instant", async () => {
  const db = new TestD1();
  db.db.exec(`
    CREATE TABLE marketing_assets (id TEXT, owner_id TEXT, client_id TEXT, kind TEXT, name TEXT, slug TEXT, status TEXT, data TEXT);
    CREATE TABLE marketing_executions (id TEXT PRIMARY KEY, owner_id TEXT, automation_id TEXT, trigger_key TEXT, status TEXT, input TEXT, result TEXT, run_at TEXT, created_at TEXT, updated_at TEXT);
    CREATE UNIQUE INDEX marketing_executions_trigger_once_idx ON marketing_executions(owner_id, automation_id, trigger_key);
    CREATE TABLE workspace_documents (id TEXT PRIMARY KEY, data TEXT, updated_at TEXT);
    INSERT INTO workspace_documents VALUES ('f2b-agency', '{"ownerId":"owner-1","clients":[{"id":"client-1","name":"Example Client"}],"tasks":[],"activity":[]}', 'seed');
  `);
  const runAt = "2026-10-27T11:00:00.000Z";
  const nodes = [{ id: "trigger", type: "trigger", label: "Scheduled", config: serializeMarketingTrigger("specific_date_time", "", runAt) }, { id: "task", type: "task", label: "Create task", config: "Prepare scheduled follow-up" }];
  db.db.prepare("INSERT INTO marketing_assets VALUES (?, ?, ?, 'automation', ?, ?, 'active', ?)").run("auto-scheduled", "owner-1", "client-1", "Scheduled follow-up", "scheduled-1", JSON.stringify({ nodes }));
  await processDueMarketingAutomations(db, new Date("2026-10-27T10:00:00.000Z"));
  let run = db.db.prepare("SELECT status, run_at, input FROM marketing_executions").get();
  assert.equal(run.status, "queued");
  assert.equal(run.run_at, runAt);
  assert.equal(JSON.parse(run.input).kind, "scheduled");
  assert.equal(db.db.prepare("SELECT COUNT(*) AS count FROM workspace_documents").get().count, 1);
  await processDueMarketingAutomations(db, new Date(runAt));
  run = db.db.prepare("SELECT status FROM marketing_executions").get();
  assert.equal(run.status, "succeeded");
  assert.equal(JSON.parse(db.db.prepare("SELECT data FROM workspace_documents WHERE id = 'f2b-agency'").get().data).tasks.length, 1);
  await processDueMarketingAutomations(db, new Date("2026-10-27T11:05:00.000Z"));
  assert.equal(db.db.prepare("SELECT COUNT(*) AS count FROM marketing_executions").get().count, 1);
  assert.equal(JSON.parse(db.db.prepare("SELECT data FROM workspace_documents WHERE id = 'f2b-agency'").get().data).tasks.length, 1);
});

test("automation wait units and activation validation enforce seven-day maximum", () => {
  assert.deepEqual(parseWaitDuration("5"), { amount: 5, unit: "minutes", milliseconds: 300_000 });
  assert.deepEqual(parseWaitDuration(JSON.stringify({ amount: 2, unit: "hours" })), { amount: 2, unit: "hours", milliseconds: 7_200_000 });
  assert.deepEqual(parseWaitDuration(JSON.stringify({ amount: 7, unit: "days" })), { amount: 7, unit: "days", milliseconds: 604_800_000 });
  assert.equal(parseWaitDuration(JSON.stringify({ amount: 8, unit: "days" })), null);
  assert.deepEqual(parseWaitUntil(JSON.stringify({ dateTime: "2026-11-02T09:30:00.000Z" })), { runAt: "2026-11-02T09:30:00.000Z" });
  assert.equal(parseWaitUntil("not-a-date"), null);
  assert.equal(validateMarketingAutomationNodes([{ type: "trigger", config: "lead-form" }, { type: "wait", config: JSON.stringify({ amount: 1, unit: "days" }) }, { type: "end", config: "" }], null), null);
  assert.equal(validateMarketingAutomationNodes([{ type: "trigger", config: "lead-form" }, { type: "waitUntil", config: JSON.stringify({ dateTime: "2026-11-02T09:30:00.000Z" }) }], null), null);
  assert.equal(validateMarketingAutomationNodes([{ id: "trigger", type: "trigger", config: serializeMarketingTrigger("specific_date_time", "", "2026-11-02T09:30:00.000Z") }, { id: "task", type: "task", config: "Scheduled follow-up" }], "client-1"), null);
  assert.equal(validateMarketingAutomationNodes([{ id: "trigger", type: "trigger", config: serializeMarketingTrigger("contact_created", "") }, { id: "task", type: "task", config: "Follow up" }], "client-1"), null);
  assert.match(validateMarketingAutomationNodes([{ id: "trigger", type: "trigger", config: serializeMarketingTrigger("contact_created", "") }, { id: "task", type: "task", config: "Follow up" }], null), /client linked to a GoHighLevel location/);
  assert.equal(validateMarketingAutomationNodes([{ id: "trigger", type: "trigger", config: serializeMarketingTrigger("contact_created", "lead-form") }, { id: "end", type: "end", config: "" }], null), null);
  assert.match(validateMarketingAutomationNodes([{ type: "trigger", config: "lead-form" }, { type: "waitUntil", config: "" }], null), /valid date and time/);
  assert.match(validateMarketingAutomationNodes([{ type: "trigger", config: "lead-form" }, { type: "wait", config: JSON.stringify({ amount: 8, unit: "days" }) }], null), /seven days/);
});

test("condition branch destinations must be valid forward workflow steps", () => {
  const nodes = [
    { id: "trigger", type: "trigger", config: "lead-form" },
    { id: "condition", type: "condition", config: JSON.stringify({ fieldId: "service", operator: "equals", value: "roof", thenNodeId: "yes", elseNodeId: "no" }) },
    { id: "yes", type: "end", config: "" },
    { id: "no", type: "end", config: "" },
  ];
  assert.equal(validateMarketingAutomationNodes(nodes, null), null);
  const grouped = structuredClone(nodes);
  grouped[1].config = JSON.stringify({ mode: "or", conditions: [{ fieldId: "service", operator: "contains", value: "roof" }, { fieldId: "budget", operator: "greaterThan", value: "1000" }], thenNodeId: "yes", elseNodeId: "no" });
  assert.equal(validateMarketingAutomationNodes(grouped, null), null);
  grouped[1].config = JSON.stringify({ mode: "xor", conditions: [{ fieldId: "service", operator: "equals", value: "roof" }], thenNodeId: "yes" });
  assert.match(validateMarketingAutomationNodes(grouped, null), /supported comparison/);
  grouped[1].config = JSON.stringify({ mode: "and", conditions: Array.from({ length: 9 }, () => ({ fieldId: "service", operator: "equals", value: "roof" })) });
  assert.match(validateMarketingAutomationNodes(grouped, null), /supported comparison/);
  const missing = structuredClone(nodes);
  missing[1].config = JSON.stringify({ fieldId: "service", operator: "equals", value: "roof", thenNodeId: "missing" });
  assert.match(validateMarketingAutomationNodes(missing, null), /existing step/);
  const backwards = structuredClone(nodes);
  backwards[1].config = JSON.stringify({ fieldId: "service", operator: "equals", value: "roof", thenNodeId: "trigger" });
  assert.match(validateMarketingAutomationNodes(backwards, null), /later step/);
});

test("workflow condition routes matched and unmatched submissions to their selected branches", async () => {
  const db = new TestD1();
  db.db.exec(`
    CREATE TABLE marketing_assets (id TEXT, owner_id TEXT, client_id TEXT, kind TEXT, name TEXT, slug TEXT, status TEXT, data TEXT);
    CREATE TABLE marketing_executions (id TEXT PRIMARY KEY, owner_id TEXT, automation_id TEXT, trigger_key TEXT, status TEXT, input TEXT, result TEXT, run_at TEXT, created_at TEXT, updated_at TEXT);
  `);
  const nodes = [
    { id: "trigger", type: "trigger", label: "Form submitted", config: "lead-form" },
    { id: "condition", type: "condition", label: "Qualified roofing enquiry?", config: JSON.stringify({ mode: "and", conditions: [{ fieldId: "service", operator: "equals", value: "roof" }, { fieldId: "budget", operator: "greaterThan", value: "1000" }], thenNodeId: "yes-end", elseNodeId: "no-end" }) },
    { id: "yes-end", type: "end", label: "Yes path end", config: "" },
    { id: "no-end", type: "end", label: "No path end", config: "" },
  ];
  db.db.prepare("INSERT INTO marketing_assets VALUES (?, ?, NULL, 'automation', ?, ?, 'active', ?)").run("auto-branch", "owner-1", "Branch test", "branch-test", JSON.stringify({ nodes }));
  const now = "2026-10-27T10:00:00.000Z";
  for (const [id, service, budget] of [["run-yes", "roof", "1500"], ["run-no", "roof", "500"]]) {
    db.db.prepare("INSERT INTO marketing_executions VALUES (?, ?, ?, ?, 'queued', ?, '{}', ?, ?, ?)").run(id, "owner-1", "auto-branch", id, JSON.stringify({ formSlug: "lead-form", data: { values: { service, budget } } }), now, now, now);
  }
  await processDueMarketingAutomations(db, new Date(now));
  const results = Object.fromEntries(db.db.prepare("SELECT id, status, result FROM marketing_executions").all().map((row) => [row.id, { status: row.status, log: JSON.parse(row.result).log }]));
  assert.equal(results["run-yes"].status, "succeeded");
  assert.match(results["run-yes"].log.join(" "), /matched; continuing at “Yes path end”/);
  assert.match(results["run-yes"].log.join(" "), /Yes path end/);
  assert.equal(results["run-no"].status, "succeeded");
  assert.match(results["run-no"].log.join(" "), /not matched; continuing at “No path end”/);
  assert.match(results["run-no"].log.join(" "), /No path end/);
  assert.doesNotMatch(results["run-yes"].log.join(" "), /No path end/);
});

test("internal email settings validate and render submission values without sending", () => {
  const config = JSON.stringify({ recipientStaffId: "staff-1", subject: "New {{service}} request", body: "{{name}} · {{email}} · {{clientName}} · {{formName}}" });
  assert.deepEqual(parseStaffEmailConfig(config), { recipientStaffId: "staff-1", subject: "New {{service}} request", body: "{{name}} · {{email}} · {{clientName}} · {{formName}}" });
  assert.equal(parseStaffEmailConfig(JSON.stringify({ recipientStaffId: "staff-1", subject: "Bad\nSubject", body: "x" })), null);
  assert.deepEqual(emailTemplateFieldIds("{{name}} {{clientName}}"), ["name", "clientName"]);
  assert.equal(renderStaffEmailTemplate("{{name}} · {{services}} · {{clientName}} · {{formName}}", { name: "Sam", services: ["Roof", "Gutter"] }, { clientName: "Example", formName: "Lead form" }), "Sam · Roof, Gutter · Example · Lead form");
});

test("automation sends only to an existing non-bot staff recipient using mocked delivery", async () => {
  const db = new TestD1();
  db.db.exec(`
    CREATE TABLE marketing_assets (id TEXT, owner_id TEXT, client_id TEXT, kind TEXT, name TEXT, slug TEXT, status TEXT, data TEXT);
    CREATE TABLE marketing_executions (id TEXT PRIMARY KEY, owner_id TEXT, automation_id TEXT, trigger_key TEXT, status TEXT, input TEXT, result TEXT, run_at TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE workspace_documents (id TEXT PRIMARY KEY, data TEXT, updated_at TEXT);
    INSERT INTO workspace_documents VALUES ('f2b-agency', '{"ownerId":"owner-1","clients":[{"id":"client-1","name":"Example Client"}],"staff":[{"id":"staff-1","name":"Alex","email":"alex@example.test"},{"id":"bot-1","name":"Connor","email":"","isBot":true}],"tasks":[],"activity":[]}', 'seed');
  `);
  const emailConfig = JSON.stringify({ recipientStaffId: "staff-1", subject: "New lead: {{name}}", body: "{{email}} · {{clientName}}" });
  const nodes = [{ id: "trigger", type: "trigger", label: "Form submitted", config: "lead-form" }, { id: "email-1", type: "email", label: "Notify staff", config: emailConfig }];
  db.db.prepare("INSERT INTO marketing_assets VALUES (?, ?, ?, 'automation', ?, ?, 'active', ?)").run("auto-1", "owner-1", "client-1", "New lead notification", "automation-1", JSON.stringify({ nodes }));
  db.db.prepare("INSERT INTO marketing_executions VALUES (?, ?, ?, ?, 'queued', ?, '{}', ?, ?, ?)").run("run-1", "owner-1", "auto-1", "submission-1", JSON.stringify({ formSlug: "lead-form", clientId: "client-1", data: { values: { name: "Sam", email: "sam@example.test" } } }), "2026-10-27T10:00:00.000Z", "2026-10-27T10:00:00.000Z", "2026-10-27T10:00:00.000Z");
  const sent = [];
  await processDueMarketingAutomations(db, new Date("2026-10-27T10:00:00.000Z"), undefined, async (...args) => { sent.push(args); });
  assert.deepEqual(sent, [["owner-1", "alex@example.test", "New lead: Sam", "sam@example.test · Example Client", "marketing-automation/run-1/email-1"]]);
  assert.equal(db.db.prepare("SELECT status FROM marketing_executions WHERE id = 'run-1'").get().status, "succeeded");
});

test("automation refuses bot and customer email recipients", async () => {
  const db = new TestD1();
  db.db.exec(`
    CREATE TABLE marketing_assets (id TEXT, owner_id TEXT, client_id TEXT, kind TEXT, name TEXT, slug TEXT, status TEXT, data TEXT);
    CREATE TABLE marketing_executions (id TEXT PRIMARY KEY, owner_id TEXT, automation_id TEXT, trigger_key TEXT, status TEXT, input TEXT, result TEXT, run_at TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE workspace_documents (id TEXT PRIMARY KEY, data TEXT, updated_at TEXT);
    INSERT INTO workspace_documents VALUES ('f2b-agency', '{"staff":[{"id":"bot-1","name":"Connor","email":"bot@example.test","isBot":true}],"clients":[]}', 'seed');
  `);
  const nodes = [{ id: "trigger", type: "trigger", label: "Form submitted", config: "lead-form" }, { id: "email-1", type: "email", label: "Notify", config: JSON.stringify({ recipientStaffId: "bot-1", subject: "Hello", body: "Test" }) }];
  db.db.prepare("INSERT INTO marketing_assets VALUES (?, ?, ?, 'automation', ?, ?, 'active', ?)").run("auto-1", "owner-1", null, "Notify", "automation-1", JSON.stringify({ nodes }));
  db.db.prepare("INSERT INTO marketing_executions VALUES (?, ?, ?, ?, 'queued', ?, '{}', ?, ?, ?)").run("run-1", "owner-1", "auto-1", "submission-1", JSON.stringify({ data: { values: {} } }), "2026-10-27T10:00:00.000Z", "2026-10-27T10:00:00.000Z", "2026-10-27T10:00:00.000Z");
  let sendCount = 0;
  await processDueMarketingAutomations(db, new Date("2026-10-27T10:00:00.000Z"), undefined, async () => { sendCount++; });
  const run = db.db.prepare("SELECT status, result FROM marketing_executions WHERE id = 'run-1'").get();
  assert.equal(sendCount, 0);
  assert.equal(run.status, "failed");
  assert.match(JSON.parse(run.result).detail, /current staff profile/);
});

test("uncertain customer delivery is checkpointed and never automatically resent", async () => {
  const db = new TestD1();
  db.db.exec(`
    CREATE TABLE marketing_assets (id TEXT, owner_id TEXT, client_id TEXT, kind TEXT, name TEXT, slug TEXT, status TEXT, data TEXT);
    CREATE TABLE marketing_executions (id TEXT PRIMARY KEY, owner_id TEXT, automation_id TEXT, trigger_key TEXT, status TEXT, input TEXT, result TEXT, run_at TEXT, created_at TEXT, updated_at TEXT);
  `);
  const at = "2026-10-27T10:00:00.000Z";
  const fields = [{ id: "email", label: "Email", type: "email" }, { id: "consent", label: "Contact consent", type: "consent", required: true }];
  const nodes = [
    { id: "trigger", type: "trigger", label: "Lead form", config: "lead-form" },
    { id: "send", type: "customerEmail", label: "Send receipt", config: JSON.stringify({ consentFieldId: "consent", subject: "Thanks", message: "We received your request." }) },
  ];
  db.db.prepare("INSERT INTO marketing_assets VALUES (?, ?, ?, 'automation', ?, ?, 'active', ?)").run("auto-message", "owner-1", "client-1", "Customer receipt", "customer-receipt", JSON.stringify({ nodes }));
  const input = { formSlug: "lead-form", clientId: "client-1", fields, data: { values: { consent: "yes" }, contactSync: { status: "synced", contactId: "contact-1" } } };
  db.db.prepare("INSERT INTO marketing_executions VALUES (?, ?, ?, ?, 'queued', ?, '{}', ?, ?, ?)").run("run-message", "owner-1", "auto-message", "submission-1", JSON.stringify(input), at, at, at);

  let attempts = 0;
  await processDueMarketingAutomations(db, new Date(at), undefined, undefined, undefined, async () => {
    attempts++;
    throw new Error("Provider request timed out");
  });
  let run = db.db.prepare("SELECT status, result FROM marketing_executions WHERE id = 'run-message'").get();
  assert.equal(run.status, "failed");
  assert.equal(JSON.parse(run.result).externalMessages.send.status, "unknown");

  db.db.prepare("UPDATE marketing_executions SET status = 'queued', run_at = ?1 WHERE id = 'run-message'").run(at);
  await processDueMarketingAutomations(db, new Date(at), undefined, undefined, undefined, async () => { attempts++; return { status: "sent", providerMessageId: "should-not-send" }; });
  run = db.db.prepare("SELECT status, result FROM marketing_executions WHERE id = 'run-message'").get();
  assert.equal(attempts, 1);
  assert.equal(run.status, "failed");
  assert.equal(JSON.parse(run.result).externalMessages.send.status, "unknown");
  assert.match(JSON.parse(run.result).detail, /outcome is uncertain/);
});

test("transient staff-email failures retry with bounded backoff and preserve the same idempotency key", async () => {
  const db = new TestD1();
  db.db.exec(`
    CREATE TABLE marketing_assets (id TEXT, owner_id TEXT, client_id TEXT, kind TEXT, name TEXT, slug TEXT, status TEXT, data TEXT);
    CREATE TABLE marketing_executions (id TEXT PRIMARY KEY, owner_id TEXT, automation_id TEXT, trigger_key TEXT, status TEXT, input TEXT, result TEXT, run_at TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE workspace_documents (id TEXT PRIMARY KEY, data TEXT, updated_at TEXT);
    INSERT INTO workspace_documents VALUES ('f2b-agency', '{"clients":[],"staff":[{"id":"staff-1","name":"Alex","email":"alex@example.test"}]}', 'seed');
  `);
  const nodes = [{ id: "trigger", type: "trigger", label: "Form submitted", config: "lead-form" }, { id: "email-1", type: "email", label: "Notify staff", config: JSON.stringify({ recipientStaffId: "staff-1", subject: "New lead", body: "A lead arrived." }) }];
  db.db.prepare("INSERT INTO marketing_assets VALUES (?, ?, ?, 'automation', ?, ?, 'active', ?)").run("auto-1", "owner-1", null, "Notify", "automation-1", JSON.stringify({ nodes }));
  const start = new Date("2026-10-27T10:00:00.000Z");
  db.db.prepare("INSERT INTO marketing_executions VALUES (?, ?, ?, ?, 'queued', ?, '{}', ?, ?, ?)").run("run-1", "owner-1", "auto-1", "submission-1", JSON.stringify({ formSlug: "lead-form", data: { values: {} } }), start.toISOString(), start.toISOString(), start.toISOString());
  const idempotencyKeys = [];
  await processDueMarketingAutomations(db, start, undefined, async (_owner, _recipient, _subject, _body, key) => { idempotencyKeys.push(key); throw new Error("Resend HTTP 503 temporary delivery failure"); });
  let run = db.db.prepare("SELECT status, result, run_at FROM marketing_executions WHERE id = 'run-1'").get();
  let result = JSON.parse(run.result);
  assert.equal(run.status, "queued");
  assert.equal(run.run_at, "2026-10-27T10:01:00.000Z");
  assert.equal(result.retrying, true);
  assert.equal(result.attempts, 1);

  await processDueMarketingAutomations(db, new Date("2026-10-27T10:01:00.000Z"), undefined, async (_owner, _recipient, _subject, _body, key) => { idempotencyKeys.push(key); });
  run = db.db.prepare("SELECT status, result FROM marketing_executions WHERE id = 'run-1'").get();
  result = JSON.parse(run.result);
  assert.equal(run.status, "succeeded");
  assert.equal(result.attempts, 1);
  assert.equal(result.retrying, false);
  assert.deepEqual(idempotencyKeys, ["marketing-automation/run-1/email-1", "marketing-automation/run-1/email-1"]);
});

test("automation run reaches a visible dead-letter state after three transient failures", async () => {
  const db = new TestD1();
  db.db.exec(`
    CREATE TABLE marketing_assets (id TEXT, owner_id TEXT, client_id TEXT, kind TEXT, name TEXT, slug TEXT, status TEXT, data TEXT);
    CREATE TABLE marketing_executions (id TEXT PRIMARY KEY, owner_id TEXT, automation_id TEXT, trigger_key TEXT, status TEXT, input TEXT, result TEXT, run_at TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE workspace_documents (id TEXT PRIMARY KEY, data TEXT, updated_at TEXT);
    INSERT INTO workspace_documents VALUES ('f2b-agency', '{"clients":[],"staff":[{"id":"staff-1","name":"Alex","email":"alex@example.test"}]}', 'seed');
  `);
  const nodes = [{ id: "trigger", type: "trigger", label: "Form submitted", config: "lead-form" }, { id: "email-1", type: "email", label: "Notify staff", config: JSON.stringify({ recipientStaffId: "staff-1", subject: "New lead", body: "A lead arrived." }) }];
  db.db.prepare("INSERT INTO marketing_assets VALUES (?, ?, ?, 'automation', ?, ?, 'active', ?)").run("auto-1", "owner-1", null, "Notify", "automation-1", JSON.stringify({ nodes }));
  const start = new Date("2026-10-27T10:00:00.000Z");
  db.db.prepare("INSERT INTO marketing_executions VALUES (?, ?, ?, ?, 'queued', ?, '{}', ?, ?, ?)").run("run-1", "owner-1", "auto-1", "submission-1", JSON.stringify({ formSlug: "lead-form", data: { values: {} } }), start.toISOString(), start.toISOString(), start.toISOString());
  const sendFailure = async () => { throw new Error("Resend HTTP 503 temporary delivery failure"); };
  await processDueMarketingAutomations(db, start, undefined, sendFailure);
  await processDueMarketingAutomations(db, new Date("2026-10-27T10:01:00.000Z"), undefined, sendFailure);
  let run = db.db.prepare("SELECT status, result, run_at FROM marketing_executions WHERE id = 'run-1'").get();
  assert.equal(run.status, "queued");
  assert.equal(run.run_at, "2026-10-27T10:06:00.000Z");
  await processDueMarketingAutomations(db, new Date("2026-10-27T10:06:00.000Z"), undefined, sendFailure);
  run = db.db.prepare("SELECT status, result FROM marketing_executions WHERE id = 'run-1'").get();
  const result = JSON.parse(run.result);
  assert.equal(run.status, "failed");
  assert.equal(result.deadLetter, true);
  assert.equal(result.retrying, false);
  assert.equal(result.attempts, 3);
  assert.equal(result.errors.length, 3);
});

test("matching form submissions wait durably, then create one CRM task and activity entry", async () => {
  const db = new TestD1();
  db.db.exec(`
    CREATE TABLE marketing_assets (id TEXT, owner_id TEXT, client_id TEXT, kind TEXT, name TEXT, slug TEXT, status TEXT, data TEXT);
    CREATE TABLE marketing_executions (id TEXT PRIMARY KEY, owner_id TEXT, automation_id TEXT, trigger_key TEXT, status TEXT, input TEXT, result TEXT, run_at TEXT, created_at TEXT, updated_at TEXT);
    CREATE UNIQUE INDEX marketing_executions_trigger_once_idx ON marketing_executions(owner_id, automation_id, trigger_key);
    CREATE TABLE workspace_documents (id TEXT PRIMARY KEY, data TEXT, updated_at TEXT);
    INSERT INTO workspace_documents VALUES ('f2b-agency', '{"ownerId":"owner-1","clients":[{"id":"client-1","name":"Example Client"}],"tasks":[],"activity":[]}', 'seed');
  `);
  const nodes = [
    { id: "trigger", type: "trigger", label: "Form submitted", config: "lead-form" },
    { id: "wait", type: "wait", label: "Wait", config: "5" },
    { id: "task", type: "task", label: "Create task", config: "Call new lead" },
    { id: "tag", type: "tag", label: "Tag new lead", config: "add: New Lead" },
  ];
  db.db.prepare("INSERT INTO marketing_assets VALUES (?, ?, ?, 'automation', ?, ?, 'active', ?)").run("auto-1", "owner-1", "client-1", "New lead follow-up", "automation-1", JSON.stringify({ nodes }));
  const form = { id: "form-1", owner_id: "owner-1", client_id: "client-1", slug: "lead-form" };
  const submission = { id: "submission-1", owner_id: "owner-1", asset_id: "form-1", kind: "form", data: JSON.stringify({ values: { email: "lead@example.com" }, contactSync: { status: "synced", contactId: "contact-1" } }), created_at: "2026-10-27T10:00:00.000Z" };
  await enqueueMarketingAutomations(db, form, submission);
  await enqueueMarketingAutomations(db, form, submission);
  assert.equal(db.db.prepare("SELECT COUNT(*) AS count FROM marketing_executions").get().count, 1);

  const start = new Date(db.db.prepare("SELECT run_at FROM marketing_executions").get().run_at);
  await processDueMarketingAutomations(db, start);
  const waiting = db.db.prepare("SELECT status, run_at FROM marketing_executions").get();
  assert.equal(waiting.status, "queued");
  assert.equal(waiting.run_at, new Date(start.getTime() + 5 * 60_000).toISOString());
  assert.equal(JSON.parse(db.db.prepare("SELECT data FROM workspace_documents").get().data).tasks.length, 0);

  const tagsApplied = [];
  await processDueMarketingAutomations(db, new Date(start.getTime() + 6 * 60_000), async (...args) => { tagsApplied.push(args); });
  const done = db.db.prepare("SELECT status, result FROM marketing_executions").get();
  const workspace = JSON.parse(db.db.prepare("SELECT data FROM workspace_documents").get().data);
  assert.equal(done.status, "succeeded");
  assert.equal(workspace.tasks.length, 1);
  assert.equal(workspace.tasks[0].title, "Call new lead");
  assert.equal(workspace.tasks[0].clientId, "client-1");
  assert.equal(workspace.activity.length, 1);
  assert.deepEqual(tagsApplied, [["owner-1", "client-1", "contact-1", "POST", "New Lead"]]);
  assert.match(JSON.parse(done.result).log.join(" "), /Created follow-up task/);
});

test("hour-based wait is durable and end step prevents later actions", async () => {
  const db = new TestD1();
  db.db.exec(`
    CREATE TABLE marketing_assets (id TEXT, owner_id TEXT, client_id TEXT, kind TEXT, name TEXT, slug TEXT, status TEXT, data TEXT);
    CREATE TABLE marketing_executions (id TEXT PRIMARY KEY, owner_id TEXT, automation_id TEXT, trigger_key TEXT, status TEXT, input TEXT, result TEXT, run_at TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE workspace_documents (id TEXT PRIMARY KEY, data TEXT, updated_at TEXT);
    INSERT INTO workspace_documents VALUES ('f2b-agency', '{"ownerId":"owner-1","clients":[{"id":"client-1","name":"Example Client"}],"staff":[],"tasks":[],"activity":[]}', 'seed');
  `);
  const nodes = [{ id: "trigger", type: "trigger", label: "Form submitted", config: "lead-form" }, { id: "wait", type: "wait", label: "Wait", config: JSON.stringify({ amount: 2, unit: "hours" }) }, { id: "end", type: "end", label: "End", config: "" }, { id: "task", type: "task", label: "Should not run", config: "Wrong" }];
  db.db.prepare("INSERT INTO marketing_assets VALUES (?, ?, ?, 'automation', ?, ?, 'active', ?)").run("auto-1", "owner-1", "client-1", "Test", "automation-1", JSON.stringify({ nodes }));
  db.db.prepare("INSERT INTO marketing_executions VALUES (?, ?, ?, ?, 'queued', ?, '{}', ?, ?, ?)").run("run-1", "owner-1", "auto-1", "submission-1", JSON.stringify({ clientId: "client-1", data: { values: {} } }), "2026-10-27T10:00:00.000Z", "2026-10-27T10:00:00.000Z", "2026-10-27T10:00:00.000Z");
  await processDueMarketingAutomations(db, new Date("2026-10-27T10:00:00.000Z"));
  assert.equal(db.db.prepare("SELECT run_at FROM marketing_executions WHERE id = 'run-1'").get().run_at, "2026-10-27T12:00:00.000Z");
  await processDueMarketingAutomations(db, new Date("2026-10-27T12:01:00.000Z"));
  const run = db.db.prepare("SELECT status, result FROM marketing_executions WHERE id = 'run-1'").get();
  assert.equal(run.status, "succeeded");
  assert.equal(JSON.parse(db.db.prepare("SELECT data FROM workspace_documents").get().data).tasks.length, 0);
  assert.match(JSON.parse(run.result).log.join(" "), /Workflow ended/);
});

test("calendar wait stores the chosen instant and resumes after that time", async () => {
  const db = new TestD1();
  db.db.exec(`
    CREATE TABLE marketing_assets (id TEXT, owner_id TEXT, client_id TEXT, kind TEXT, name TEXT, slug TEXT, status TEXT, data TEXT);
    CREATE TABLE marketing_executions (id TEXT PRIMARY KEY, owner_id TEXT, automation_id TEXT, trigger_key TEXT, status TEXT, input TEXT, result TEXT, run_at TEXT, created_at TEXT, updated_at TEXT);
    CREATE TABLE workspace_documents (id TEXT PRIMARY KEY, data TEXT, updated_at TEXT);
    INSERT INTO workspace_documents VALUES ('f2b-agency', '{"ownerId":"owner-1","clients":[{"id":"client-1","name":"Example Client"}],"staff":[],"tasks":[],"activity":[]}', 'seed');
  `);
  const nodes = [{ id: "trigger", type: "trigger", label: "Form submitted", config: "lead-form" }, { id: "calendar-wait", type: "waitUntil", label: "Wait until", config: JSON.stringify({ dateTime: "2026-11-02T09:30:00.000Z" }) }, { id: "end", type: "end", label: "End", config: "" }];
  db.db.prepare("INSERT INTO marketing_assets VALUES (?, ?, ?, 'automation', ?, ?, 'active', ?)").run("auto-1", "owner-1", "client-1", "Test", "automation-1", JSON.stringify({ nodes }));
  db.db.prepare("INSERT INTO marketing_executions VALUES (?, ?, ?, ?, 'queued', ?, '{}', ?, ?, ?)").run("run-1", "owner-1", "auto-1", "submission-1", JSON.stringify({ clientId: "client-1", data: { values: {} } }), "2026-10-27T10:00:00.000Z", "2026-10-27T10:00:00.000Z", "2026-10-27T10:00:00.000Z");
  await processDueMarketingAutomations(db, new Date("2026-10-27T10:00:00.000Z"));
  const scheduled = db.db.prepare("SELECT status, run_at, result FROM marketing_executions WHERE id = 'run-1'").get();
  assert.equal(scheduled.status, "queued");
  assert.equal(scheduled.run_at, "2026-11-02T09:30:00.000Z");
  assert.match(JSON.parse(scheduled.result).log.join(" "), /Waiting until 2026-11-02T09:30:00.000Z/);
  await processDueMarketingAutomations(db, new Date("2026-11-02T09:30:00.000Z"));
  assert.equal(db.db.prepare("SELECT status FROM marketing_executions WHERE id = 'run-1'").get().status, "succeeded");
});
