type DB = D1Database;
type WorkflowNode = { id: string; type: string; label: string; config: string };
type WorkflowData = { nodes?: WorkflowNode[] };
type Submission = { id: string; owner_id: string; asset_id: string; kind: string; data: string; created_at: string };
type SubmissionData = { [key: string]: unknown; contactSync?: { status?: string; created?: boolean }; quoteSummary?: unknown };
type Workspace = { [key: string]: unknown; ownerId?: string; tasks?: Array<Record<string, unknown>>; clients?: Array<Record<string, unknown>>; staff?: Array<{ id: string; name?: string; email?: string; isBot?: boolean }>; activity?: Array<Record<string, unknown>> };
type WorkflowInput = { clientId?: string | null; formSlug?: string; kind?: string; data?: { values?: Record<string, unknown>; contactSync?: { status?: string; contactId?: string } } };
import { emailTemplateFieldIds, parseStaffEmailConfig, renderStaffEmailTemplate } from "../lib/marketing-automation-email.js";
import { conditionPasses, parseWaitDuration, parseWaitUntil } from "../lib/marketing-automation.js";
export { conditionPasses } from "../lib/marketing-automation.js";
import { isValidMarketingTriggerDateTime, marketingTriggerMatches, parseMarketingTrigger } from "../lib/marketing-trigger.js";
import { buildMarketingContactUpdate } from "../lib/marketing-contact-update.js";
import { marketingConsentGranted, parseMarketingCustomerMessage, renderMarketingMessageTemplate } from "../lib/marketing-automation-message.js";
import { GHL_AUTOMATION_CONTACT_FIELDS, type GhlContactWebhook } from "../lib/gohighlevel-webhook.ts";
import { marketingGhlContactTriggerMatches } from "../lib/marketing-trigger.js";
import { marketingDateFieldRunAt, parseMarketingBirthday, nextMarketingBirthday } from "../lib/marketing-birthday.js";

type SubmissionField = { id: string; label?: string; type?: string };

export async function enqueueMarketingAutomations(db: DB, formAsset: { id: string; owner_id: string; slug: string; client_id: string | null; fields?: SubmissionField[] }, submission: Submission) {
  const rows = await db.prepare("SELECT id, data FROM marketing_assets WHERE owner_id = ?1 AND kind = 'automation' AND status = 'active'").bind(formAsset.owner_id).all<{ id: string; data: string }>();
  const now = new Date().toISOString();
  const inserts = (rows.results || []).flatMap((row) => {
    let workflow: WorkflowData;
    try { workflow = JSON.parse(row.data); } catch { return []; }
    const nodes = Array.isArray(workflow.nodes) ? workflow.nodes : [];
    const trigger = nodes[0];
    let submissionData: SubmissionData;
    try { submissionData = JSON.parse(submission.data) as SubmissionData; } catch { return []; }
    if (trigger?.type !== "trigger" || !marketingTriggerMatches(trigger.config, { ...formAsset, kind: submission.kind }, { data: submissionData })) return [];
    return [db.prepare("INSERT OR IGNORE INTO marketing_executions (id, owner_id, automation_id, trigger_key, status, input, result, run_at, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, 'queued', ?5, '{}', ?6, ?6, ?6)")
      .bind(crypto.randomUUID(), formAsset.owner_id, row.id, submission.id, JSON.stringify({ submissionId: submission.id, formAssetId: formAsset.id, formSlug: formAsset.slug, clientId: formAsset.client_id, kind: submission.kind, fields: formAsset.fields || [], data: submissionData }), now)];
  });
  if (inserts.length) await db.batch(inserts);
}

async function enqueueScheduledMarketingAutomations(db: DB, now: string) {
  const rows = await db.prepare("SELECT id, owner_id, client_id, data FROM marketing_assets WHERE kind = 'automation' AND status = 'active'").all<{ id: string; owner_id: string; client_id: string | null; data: string }>();
  const inserts = (rows.results || []).flatMap((row) => {
    let nodes: WorkflowNode[] = [];
    try { nodes = (JSON.parse(row.data) as WorkflowData).nodes || []; } catch { return []; }
    const trigger = nodes[0];
    if (trigger?.type !== "trigger") return [];
    const scheduled = parseMarketingTrigger(trigger.config);
    if (scheduled.event !== "specific_date_time" || !isValidMarketingTriggerDateTime(scheduled.runAt)) return [];
    return [db.prepare("INSERT OR IGNORE INTO marketing_executions (id, owner_id, automation_id, trigger_key, status, input, result, run_at, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, 'queued', ?5, '{}', ?6, ?7, ?7)")
      .bind(crypto.randomUUID(), row.owner_id, row.id, `scheduled:${scheduled.runAt}`, JSON.stringify({ formSlug: "Scheduled workflow", clientId: row.client_id, kind: "scheduled", fields: [], data: { values: {} } }), scheduled.runAt, now)];
  });
  const birthdayClients = await db.prepare("SELECT DISTINCT owner_id, client_id FROM marketing_ghl_contact_birthdays ORDER BY owner_id, client_id").all<{ owner_id: string; client_id: string }>();
  const birthdayCursorUpdates: Array<{ ownerId: string; clientId: string; lastContactId: string }> = [];
  for (const birthdayClient of birthdayClients.results || []) {
    const cursor = await db.prepare("SELECT last_contact_id FROM marketing_ghl_birthday_cursors WHERE owner_id = ?1 AND client_id = ?2")
      .bind(birthdayClient.owner_id, birthdayClient.client_id).first<{ last_contact_id: string }>();
    const birthdayRows = await db.prepare("SELECT owner_id, client_id, contact_id, birthday_month_day FROM marketing_ghl_contact_birthdays WHERE owner_id = ?1 AND client_id = ?2 AND contact_id > ?3 ORDER BY contact_id LIMIT 500")
      .bind(birthdayClient.owner_id, birthdayClient.client_id, cursor?.last_contact_id || "").all<{ owner_id: string; client_id: string; contact_id: string; birthday_month_day: string }>();
    const contacts = birthdayRows.results || [];
    if (!contacts.length) {
      await db.prepare("DELETE FROM marketing_ghl_birthday_cursors WHERE owner_id = ?1 AND client_id = ?2").bind(birthdayClient.owner_id, birthdayClient.client_id).run();
      continue;
    }
    birthdayCursorUpdates.push({ ownerId: birthdayClient.owner_id, clientId: birthdayClient.client_id, lastContactId: contacts.length === 500 ? contacts[contacts.length - 1].contact_id : "" });
    for (const birthday of contacts) {
    for (const row of rows.results || []) {
      if (row.owner_id !== birthday.owner_id || row.client_id !== birthday.client_id) continue;
      let nodes: WorkflowNode[] = [];
      try { nodes = (JSON.parse(row.data) as WorkflowData).nodes || []; } catch { continue; }
      const trigger = nodes[0];
      if (trigger?.type !== "trigger") continue;
      const config = parseMarketingTrigger(trigger.config);
      if (config.event !== "birthday" || config.assetSlug) continue;
      const occurrence = nextMarketingBirthday(birthday.birthday_month_day, new Date(now), config.timeZone || "Europe/Dublin", config.birthdayTime || "09:00", config.leapDayPolicy || "feb28");
      if (!occurrence) continue;
      const values = referencedGhlContactValues(nodes, { id: birthday.contact_id, dateOfBirth: birthday.birthday_month_day });
      const input: WorkflowInput & { fields: typeof GHL_AUTOMATION_CONTACT_FIELDS } = {
        clientId: birthday.client_id,
        formSlug: "GoHighLevel contact birthday",
        kind: "gohighlevel",
        fields: GHL_AUTOMATION_CONTACT_FIELDS,
        data: { values, contactSync: { status: "synced", contactId: birthday.contact_id } },
      };
      inserts.push(db.prepare("INSERT INTO marketing_executions (id, owner_id, automation_id, trigger_key, status, input, result, run_at, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, 'queued', ?5, '{}', ?6, ?7, ?7) ON CONFLICT(owner_id, automation_id, trigger_key) DO UPDATE SET status = 'queued', input = excluded.input, result = '{}', run_at = excluded.run_at, updated_at = excluded.updated_at WHERE marketing_executions.status = 'cancelled'")
        .bind(crypto.randomUUID(), birthday.owner_id, row.id, `ghl:birthday:${birthday.contact_id}:${occurrence.year}`, JSON.stringify(input), occurrence.runAt, now));
      }
    }
  }
  for (let index = 0; index < inserts.length; index += 50) await db.batch(inserts.slice(index, index + 50));
  for (const cursor of birthdayCursorUpdates) {
    if (cursor.lastContactId) {
      await db.prepare("INSERT INTO marketing_ghl_birthday_cursors (owner_id, client_id, last_contact_id, updated_at) VALUES (?1, ?2, ?3, ?4) ON CONFLICT(owner_id, client_id) DO UPDATE SET last_contact_id = excluded.last_contact_id, updated_at = excluded.updated_at")
        .bind(cursor.ownerId, cursor.clientId, cursor.lastContactId, now).run();
    } else {
      await db.prepare("DELETE FROM marketing_ghl_birthday_cursors WHERE owner_id = ?1 AND client_id = ?2").bind(cursor.ownerId, cursor.clientId).run();
    }
  }
}

function referencedGhlContactValues(nodes: WorkflowNode[], values: GhlContactWebhook["values"]) {
  const used = new Set<string>();
  const trigger = nodes[0]?.type === "trigger" ? parseMarketingTrigger(nodes[0].config) : null;
  if (trigger?.event === "date_field" && trigger.customFieldId) used.add(`customField_${trigger.customFieldId}`);
  if (trigger?.event === "contact_status_changed" && trigger.statusFieldId) used.add(`customField_${trigger.statusFieldId}`);
  for (const node of nodes.slice(1)) {
    if (node.type === "condition") {
      try {
        const config = JSON.parse(node.config || "{}");
        if (typeof config.fieldId === "string") used.add(config.fieldId);
        else if (typeof node.config === "string") {
          const split = node.config.indexOf("=");
          if (split > 0) used.add(node.config.slice(0, split).trim());
        }
      } catch {
        const split = String(node.config || "").indexOf("=");
        if (split > 0) used.add(String(node.config).slice(0, split).trim());
      }
    } else if (node.type === "updateContact") {
      try {
        const config = JSON.parse(node.config || "{}");
        for (const mapping of Array.isArray(config.mappings) ? config.mappings : []) if (typeof mapping.fieldId === "string") used.add(mapping.fieldId);
      } catch { /* Invalid workflows do not gain access to unrelated contact values. */ }
    } else if (node.type === "email") {
      const email = parseStaffEmailConfig(node.config || "");
      if (email) for (const fieldId of [...emailTemplateFieldIds(email.subject), ...emailTemplateFieldIds(email.body)]) if (!(["clientName", "formName"].includes(fieldId))) used.add(fieldId);
    }
  }
  return Object.fromEntries([...used].filter((fieldId) => Object.hasOwn(values, fieldId)).map((fieldId) => [fieldId, values[fieldId]]));
}

function normalizeGhlTags(value: unknown) {
  return Array.isArray(value) ? [...new Set(value.filter((tag): tag is string => typeof tag === "string").map((tag) => tag.trim().slice(0, 100)).filter(Boolean))].slice(0, 50) : [];
}

async function cancelQueuedMessagesForGhlDnd(db: DB, ownerId: string, clientId: string, contactId: string, values: Record<string, string | string[]>, now: string) {
  const channelFields = { customerEmail: "emailDnd", customerSms: "smsDnd", customerWhatsapp: "whatsappDnd" } as const;
  const allBlocked = values.globalDnd === "true" || values.inboundAllDnd === "active";
  const blockedChannels = new Set(Object.entries(channelFields)
    .filter(([, field]) => values[field] === "active" || values[`inbound_${field}`] === "active")
    .map(([nodeType]) => nodeType));
  if (!allBlocked && !blockedChannels.size) return 0;

  const executions = await db.prepare("SELECT id, automation_id, input FROM marketing_executions WHERE owner_id = ?1 AND status = 'queued'")
    .bind(ownerId).all<{ id: string; automation_id: string; input: string }>();
  const canceled = [];
  for (const execution of executions.results || []) {
    let input: WorkflowInput;
    try { input = JSON.parse(execution.input) as WorkflowInput; } catch { continue; }
    if (input.clientId !== clientId || input.data?.contactSync?.contactId !== contactId) continue;
    const asset = await db.prepare("SELECT data FROM marketing_assets WHERE owner_id = ?1 AND client_id = ?2 AND id = ?3 AND kind = 'automation'")
      .bind(ownerId, clientId, execution.automation_id).first<{ data: string }>();
    if (!asset) continue;
    let nodes: WorkflowNode[];
    try { nodes = (JSON.parse(asset.data) as WorkflowData).nodes || []; } catch { continue; }
    const hasBlockedMessage = nodes.some((node) => Object.hasOwn(channelFields, node.type) && (allBlocked || blockedChannels.has(node.type as keyof typeof channelFields)));
    if (hasBlockedMessage) canceled.push(db.prepare("UPDATE marketing_executions SET status = 'cancelled', updated_at = ?1, result = ?2 WHERE id = ?3 AND owner_id = ?4 AND status = 'queued'")
      .bind(now, JSON.stringify({ detail: "GoHighLevel do-not-contact settings changed; queued customer message cancelled." }), execution.id, ownerId));
  }
  if (!canceled.length) return 0;
  const results = await db.batch(canceled);
  return (results || []).reduce((total, result) => total + Number(result.meta?.changes || 0), 0);
}

async function recordGhlOutboundMessageStatus(db: DB, ownerId: string, clientId: string, contactId: string, values: Record<string, string | string[]>, now: string) {
  const messageId = String(values.messageId || "");
  const status = String(values.messageStatus || "").toLowerCase();
  const allowed = new Set(["delivered", "failed", "sent", "undelivered", "opened", "clicked", "read", "pending", "scheduled", "opt_out"]);
  if (!/^[A-Za-z0-9_-]{8,160}$/.test(messageId) || !allowed.has(status)) return 0;
  const rows = await db.prepare("SELECT id, automation_id, input, result FROM marketing_executions WHERE owner_id = ?1 AND result LIKE ?2")
    .bind(ownerId, `%\"providerMessageId\":\"${messageId}\"%`).all<{ id: string; automation_id: string; input: string; result: string }>();
  const updates = [];
  const rank: Record<string, number> = { scheduled: 0, pending: 1, sent: 2, delivered: 3, opened: 4, clicked: 4, read: 4, failed: 3, undelivered: 3, opt_out: 3 };
  for (const row of rows.results || []) {
    let input: WorkflowInput;
    let result: { externalMessages?: Record<string, { providerMessageId?: string; contactId?: string; status?: string; deliveryStatus?: string; checkedAt?: string }> };
    try { input = JSON.parse(row.input) as WorkflowInput; result = JSON.parse(row.result || "{}"); } catch { continue; }
    if (input.clientId !== clientId || input.data?.contactSync?.contactId !== contactId) continue;
    const deliveries = result.externalMessages || {};
    const item = Object.values(deliveries).find((message) => message.providerMessageId === messageId && message.contactId === contactId);
    if (!item) continue;
    const current = String(item.deliveryStatus || item.status || "").toLowerCase();
    if (["failed", "undelivered", "opt_out", "opened", "clicked", "read"].includes(current) && status === "sent") continue;
    if (rank[current] !== undefined && rank[status] !== undefined && rank[current] > rank[status]) continue;
    item.deliveryStatus = status;
    item.checkedAt = now;
    updates.push(db.prepare("UPDATE marketing_executions SET result = ?1, updated_at = ?2 WHERE id = ?3 AND owner_id = ?4")
      .bind(JSON.stringify(result), now, row.id, ownerId));
  }
  if (!updates.length) return 0;
  const results = await db.batch(updates);
  return (results || []).reduce((total, result) => total + Number(result.meta?.changes || 0), 0);
}

export async function enqueueGhlContactAutomations(db: DB, webhook: GhlContactWebhook, receivedAt = new Date()) {
  const mappings = await db.prepare("SELECT owner_id, client_id FROM gohighlevel_location_links WHERE location_id = ?1")
    .bind(webhook.locationId).all<{ owner_id: string; client_id: string }>();
  if (!mappings.results?.length) return 0;
  const now = receivedAt.toISOString();
  let keyPart = webhook.webhookId;
  if (!keyPart) {
    const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(webhook)));
    keyPart = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
  }
  const inserts = [];
  for (const mapping of mappings.results) {
    if (!mapping.client_id) continue;
    if (webhook.type === "ContactDelete") {
      await db.prepare("DELETE FROM marketing_ghl_contact_birthdays WHERE owner_id = ?1 AND client_id = ?2 AND contact_id = ?3").bind(mapping.owner_id, mapping.client_id, webhook.contactId).run();
      await db.prepare("DELETE FROM marketing_ghl_contact_state WHERE owner_id = ?1 AND client_id = ?2 AND contact_id = ?3").bind(mapping.owner_id, mapping.client_id, webhook.contactId).run();
      await db.prepare("DELETE FROM marketing_ghl_contact_status_state WHERE owner_id = ?1 AND client_id = ?2 AND contact_id = ?3").bind(mapping.owner_id, mapping.client_id, webhook.contactId).run();
      await db.prepare("UPDATE marketing_executions SET status = 'cancelled', updated_at = ?1, result = '{\"detail\":\"GoHighLevel contact was deleted; birthday run cancelled.\"}' WHERE owner_id = ?2 AND status = 'queued' AND trigger_key LIKE ?3").bind(now, mapping.owner_id, `ghl:birthday:${webhook.contactId}:%`).run();
      const dateFieldRuns = await db.prepare("SELECT id, input FROM marketing_executions WHERE owner_id = ?1 AND status = 'queued' AND trigger_key LIKE 'ghl:date-field:%'")
        .bind(mapping.owner_id).all<{ id: string; input: string }>();
      const deleteContactRuns = (dateFieldRuns.results || []).flatMap((run) => {
        try {
          const input = JSON.parse(run.input) as WorkflowInput;
          return input.data?.contactSync?.contactId === webhook.contactId
            ? [db.prepare("UPDATE marketing_executions SET status = 'cancelled', updated_at = ?1, result = '{\"detail\":\"GoHighLevel contact was deleted; date-field run cancelled.\"}' WHERE id = ?2 AND owner_id = ?3 AND status = 'queued'").bind(now, run.id, mapping.owner_id)]
            : [];
        } catch { return []; }
      });
      if (deleteContactRuns.length) await db.batch(deleteContactRuns);
      continue;
    }
    if (webhook.type === "ContactDndUpdate") {
      await cancelQueuedMessagesForGhlDnd(db, mapping.owner_id, mapping.client_id, webhook.contactId, webhook.values, now);
      continue;
    }
    if (webhook.type === "OutboundMessage") {
      await recordGhlOutboundMessageStatus(db, mapping.owner_id, mapping.client_id, webhook.contactId, webhook.values, now);
      continue;
    }
    if (["ContactCreate", "ContactUpdate"].includes(webhook.type) && Object.hasOwn(webhook.values, "dateOfBirth")) {
      const birthday = parseMarketingBirthday(String(webhook.values.dateOfBirth || ""));
      if (birthday) {
        await db.prepare("INSERT INTO marketing_ghl_contact_birthdays (owner_id, client_id, contact_id, birthday_month_day, updated_at) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(owner_id, client_id, contact_id) DO UPDATE SET birthday_month_day = excluded.birthday_month_day, updated_at = excluded.updated_at")
          .bind(mapping.owner_id, mapping.client_id, webhook.contactId, birthday, now).run();
      } else {
        await db.prepare("DELETE FROM marketing_ghl_contact_birthdays WHERE owner_id = ?1 AND client_id = ?2 AND contact_id = ?3")
          .bind(mapping.owner_id, mapping.client_id, webhook.contactId).run();
      }
      await db.prepare("UPDATE marketing_executions SET status = 'cancelled', updated_at = ?1, result = '{\"detail\":\"GoHighLevel birthday date changed; reminder recalculated.\"}' WHERE owner_id = ?2 AND status = 'queued' AND trigger_key LIKE ?3")
        .bind(now, mapping.owner_id, `ghl:birthday:${webhook.contactId}:%`).run();
    }
    let changedTags = { added: [] as string[], removed: [] as string[] };
    if (webhook.type === "ContactCreate") {
      const tags = normalizeGhlTags(webhook.values.tags);
      await db.prepare("INSERT INTO marketing_ghl_contact_state (owner_id, client_id, contact_id, tags_json, updated_at) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(owner_id, client_id, contact_id) DO UPDATE SET tags_json = excluded.tags_json, updated_at = excluded.updated_at")
        .bind(mapping.owner_id, mapping.client_id, webhook.contactId, JSON.stringify(tags), now).run();
    } else if (webhook.type === "ContactTagUpdate") {
      const prior = await db.prepare("SELECT tags_json FROM marketing_ghl_contact_state WHERE owner_id = ?1 AND client_id = ?2 AND contact_id = ?3")
        .bind(mapping.owner_id, mapping.client_id, webhook.contactId).first<{ tags_json: string }>();
      let oldTagValues: unknown = [];
      if (prior) { try { oldTagValues = JSON.parse(prior.tags_json); } catch { oldTagValues = []; } }
      const oldTags = normalizeGhlTags(oldTagValues);
      const nextTags = normalizeGhlTags(webhook.values.tags);
      const oldSet = new Set(oldTags.map((tag) => tag.toLocaleLowerCase()));
      const nextSet = new Set(nextTags.map((tag) => tag.toLocaleLowerCase()));
      changedTags = {
        added: nextTags.filter((tag) => !oldSet.has(tag.toLocaleLowerCase())),
        removed: oldTags.filter((tag) => !nextSet.has(tag.toLocaleLowerCase())),
      };
      await db.prepare("INSERT INTO marketing_ghl_contact_state (owner_id, client_id, contact_id, tags_json, updated_at) VALUES (?1, ?2, ?3, ?4, ?5) ON CONFLICT(owner_id, client_id, contact_id) DO UPDATE SET tags_json = excluded.tags_json, updated_at = excluded.updated_at")
        .bind(mapping.owner_id, mapping.client_id, webhook.contactId, JSON.stringify(nextTags), now).run();
    }
    const rows = await db.prepare("SELECT id, data FROM marketing_assets WHERE owner_id = ?1 AND client_id = ?2 AND kind = 'automation' AND status = 'active'")
      .bind(mapping.owner_id, mapping.client_id).all<{ id: string; data: string }>();
    for (const row of rows.results || []) {
      let nodes: WorkflowNode[] = [];
      try { nodes = (JSON.parse(row.data) as WorkflowData).nodes || []; } catch { continue; }
      const trigger = nodes[0];
      if (trigger?.type !== "trigger" || !marketingGhlContactTriggerMatches(trigger.config, webhook.type)) continue;
      const parsedTrigger = parseMarketingTrigger(trigger.config);
      if (webhook.type === "ContactUpdate" && parsedTrigger.event !== "contact_status_changed" && nodes.some((node) => node.type === "updateContact")) continue;
      if (parsedTrigger.event === "contact_status_changed") {
        const fieldId = String(parsedTrigger.statusFieldId || "");
        const fieldKey = `customField_${fieldId}`;
        if (!fieldId || !Object.hasOwn(webhook.values, fieldKey)) continue;
        const currentStatus = String(webhook.values[fieldKey] || "").slice(0, 500);
        const prior = await db.prepare("SELECT status_value FROM marketing_ghl_contact_status_state WHERE owner_id = ?1 AND client_id = ?2 AND contact_id = ?3 AND field_id = ?4")
          .bind(mapping.owner_id, mapping.client_id, webhook.contactId, fieldId).first<{ status_value: string }>();
        await db.prepare("INSERT INTO marketing_ghl_contact_status_state (owner_id, client_id, contact_id, field_id, status_value, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6) ON CONFLICT(owner_id, client_id, contact_id, field_id) DO UPDATE SET status_value = excluded.status_value, updated_at = excluded.updated_at")
          .bind(mapping.owner_id, mapping.client_id, webhook.contactId, fieldId, currentStatus, now).run();
        if (webhook.type !== "ContactUpdate" || !prior || prior.status_value === currentStatus) continue;
      }
      if (webhook.type === "ContactTagUpdate") {
        const parsed = parseMarketingTrigger(trigger.config);
        const changes = parsed.event === "tag_added" ? changedTags.added : changedTags.removed;
        if (!changes.some((tag) => tag.toLocaleLowerCase() === String(parsed.tagName || "").toLocaleLowerCase())) continue;
      }
      const input: WorkflowInput & { fields: typeof GHL_AUTOMATION_CONTACT_FIELDS } = {
        clientId: mapping.client_id,
        formSlug: webhook.type === "AppointmentCreate" ? "GoHighLevel appointment" : webhook.type === "ContactCreate" ? "GoHighLevel contact created" : "GoHighLevel contact updated",
        kind: "gohighlevel",
        fields: GHL_AUTOMATION_CONTACT_FIELDS,
        data: { values: referencedGhlContactValues(nodes, webhook.values), contactSync: { status: "synced", contactId: webhook.contactId } },
      };
      let runAt = now;
      let triggerKey = `ghl:${webhook.type}:${keyPart}:${webhook.contactId}`.slice(0, 500);
      if (parsedTrigger.event === "appointment_approaching") {
        const appointmentStart = Date.parse(String(webhook.values.appointmentStartTime || ""));
        const advance = parseWaitDuration(JSON.stringify({ amount: parsedTrigger.advanceAmount, unit: parsedTrigger.advanceUnit }));
        if (!Number.isFinite(appointmentStart) || !advance) continue;
        runAt = new Date(appointmentStart - advance.milliseconds).toISOString();
        if (Date.parse(runAt) <= receivedAt.getTime()) continue;
        const appointmentId = String(webhook.values.appointmentId || "").trim();
        if (!appointmentId) continue;
        triggerKey = `ghl:appointment-approaching:${row.id}:${appointmentId}`.slice(0, 500);
      }
      if (parsedTrigger.event === "date_field") {
        const fieldId = String(parsedTrigger.customFieldId || "");
        const fieldKey = `customField_${fieldId}`;
        if (!fieldId || !Object.hasOwn(webhook.values, fieldKey)) continue;
        const rawDate = String(webhook.values[fieldKey] || "");
        const schedulePrefix = `ghl:date-field:${row.id}:${webhook.contactId}:${fieldId}:`;
        await db.prepare("UPDATE marketing_executions SET status = 'cancelled', updated_at = ?1, result = '{\"detail\":\"GoHighLevel date field changed; previous run cancelled.\"}' WHERE owner_id = ?2 AND automation_id = ?3 AND status = 'queued' AND trigger_key LIKE ?4")
          .bind(now, mapping.owner_id, row.id, `${schedulePrefix}%`).run();
        if (!rawDate) continue;
        const scheduled = marketingDateFieldRunAt(rawDate, parsedTrigger.customFieldType || "DATE", parsedTrigger.timeZone || "Europe/Dublin", parsedTrigger.dateFieldTime || "09:00");
        if (!scheduled || Date.parse(scheduled) <= receivedAt.getTime()) continue;
        runAt = scheduled;
        triggerKey = `${schedulePrefix}${rawDate}`.slice(0, 500);
      }
      if (parsedTrigger.event === "date_field") {
        inserts.push(db.prepare("INSERT INTO marketing_executions (id, owner_id, automation_id, trigger_key, status, input, result, run_at, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, 'queued', ?5, '{}', ?6, ?7, ?7) ON CONFLICT(owner_id, automation_id, trigger_key) DO UPDATE SET status = 'queued', input = excluded.input, result = '{}', run_at = excluded.run_at, updated_at = excluded.updated_at WHERE marketing_executions.status = 'cancelled'")
          .bind(crypto.randomUUID(), mapping.owner_id, row.id, triggerKey, JSON.stringify(input), runAt, now));
      } else {
        inserts.push(db.prepare("INSERT OR IGNORE INTO marketing_executions (id, owner_id, automation_id, trigger_key, status, input, result, run_at, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, 'queued', ?5, '{}', ?6, ?7, ?7)")
          .bind(crypto.randomUUID(), mapping.owner_id, row.id, triggerKey, JSON.stringify(input), runAt, now));
      }
    }
  }
  if (!inserts.length) return 0;
  const results = await db.batch(inserts);
  return (results || []).reduce((total, result) => total + Number(result.meta?.changes || 0), 0);
}

async function updateWorkspace(db: DB, mutate: (data: Workspace) => Workspace | null) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const row = await db.prepare("SELECT data, updated_at FROM workspace_documents WHERE id = 'f2b-agency'").first<{ data: string; updated_at: string }>();
    if (!row) return false;
    let current: Workspace;
    try { current = JSON.parse(row.data); } catch { return false; }
    const next = mutate(current);
    if (!next) return true;
    const saved = await db.prepare("UPDATE workspace_documents SET data = ?1, updated_at = ?2 WHERE id = 'f2b-agency' AND updated_at = ?3")
      .bind(JSON.stringify(next), `marketing-auto-${crypto.randomUUID()}`, row.updated_at).run();
    if (saved.meta.changes === 1) return true;
  }
  return false;
}

const AUTOMATION_MAX_ATTEMPTS = 3;
const AUTOMATION_RETRY_DELAYS_MS = [60_000, 5 * 60_000] as const;

function retryableAutomationError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error || "");
  return !/invalid|unsupported|disabled|choose a current|select a client|needs a whole number|date and time|must use|no synced|not configured|not available|could not load|no longer available|consent|do-not-contact|delivery outcome|already sent|blocked/i.test(message);
}

export async function processDueMarketingAutomations(db: DB, nowDate = new Date(), applyContactTag?: (ownerId: string, clientId: string, contactId: string, method: "POST" | "DELETE", tag: string) => Promise<void>, sendStaffEmail?: (ownerId: string, recipient: string, subject: string, text: string, idempotencyKey: string) => Promise<void>, updateContact?: (ownerId: string, clientId: string, contactId: string, payload: Record<string, string>) => Promise<void>, sendCustomerMessage?: (ownerId: string, clientId: string, contactId: string, nodeType: string, subject: string, message: string) => Promise<{ status: "sent"; providerMessageId: string; channel: string } | { status: "blocked"; detail: string }>) {
  const now = nowDate.toISOString();
  await enqueueScheduledMarketingAutomations(db, now);
  await db.prepare("UPDATE marketing_executions SET status = 'queued', updated_at = ?1 WHERE status = 'running' AND updated_at <= ?2").bind(now, new Date(nowDate.getTime() - 10 * 60_000).toISOString()).run();
  const due = await db.prepare("SELECT id, owner_id, automation_id, trigger_key, input, result FROM marketing_executions WHERE status = 'queued' AND run_at <= ?1 ORDER BY run_at LIMIT 20").bind(now).all<Record<string, unknown>>();
  for (const execution of due.results || []) {
    const claim = await db.prepare("UPDATE marketing_executions SET status = 'running', updated_at = ?1 WHERE id = ?2 AND status = 'queued'").bind(now, execution.id).run();
    if (claim.meta.changes !== 1) continue;
    try {
      const automation = await db.prepare("SELECT name, client_id, status, data FROM marketing_assets WHERE owner_id = ?1 AND id = ?2 AND kind = 'automation'").bind(execution.owner_id, execution.automation_id).first<{ name: string; client_id: string | null; status: string; data: string }>();
      if (!automation || automation.status !== "active") {
        await db.prepare("UPDATE marketing_executions SET status = 'cancelled', result = ?1, updated_at = ?2 WHERE id = ?3").bind(JSON.stringify({ detail: "Automation was paused or removed before this run." }), now, execution.id).run();
        continue;
      }
      const workflow = JSON.parse(automation.data) as WorkflowData;
      const nodes = Array.isArray(workflow.nodes) ? workflow.nodes : [];
      const input = JSON.parse(String(execution.input)) as WorkflowInput & { fields?: SubmissionField[] };
      const values = input.data?.values || {};
      const previous = JSON.parse(String(execution.result || "{}")) as { stepIndex?: number; log?: string[]; attempts?: number; errors?: Array<{ at: string; detail: string }>; externalMessages?: Record<string, { status?: string; providerMessageId?: string; detail?: string; channel?: string; contactId?: string; deliveryStatus?: string; checkedAt?: string }> };
      let stepIndex = Math.max(1, Number(previous.stepIndex) || 1);
      const log = Array.isArray(previous.log) ? previous.log.slice(-40) : [];
      const persistProgress = async () => {
        const saved = await db.prepare("UPDATE marketing_executions SET result = ?1, updated_at = ?2 WHERE id = ?3 AND status = 'running'")
          .bind(JSON.stringify({ ...previous, stepIndex, log, externalMessages: previous.externalMessages || {} }), now, execution.id).run();
        if (saved.meta.changes !== 1) throw new Error("Workflow progress could not be saved safely.");
      };
      let terminal = "succeeded";
      let runAt = now;
      for (let count = 0; stepIndex < nodes.length && count < 12; count++, stepIndex++) {
        const node = nodes[stepIndex];
        const config = String(node.config || "").trim();
        if (node.type === "condition") {
          const matched = conditionPasses(config, values);
          let rule: { thenNodeId?: string; elseNodeId?: string } = {};
          try { rule = JSON.parse(config) as typeof rule; } catch { /* Legacy comparisons have no explicit routes. */ }
          const destinationId = matched ? rule.thenNodeId : rule.elseNodeId;
          if (destinationId) {
            const destinationIndex = nodes.findIndex((candidate) => candidate.id === destinationId);
            if (destinationIndex <= stepIndex) throw new Error(`Condition step “${node.label || "Condition"}” has an invalid branch destination.`);
            log.push(`${node.label || "Condition"}: ${matched ? "matched" : "not matched"}; continuing at “${nodes[destinationIndex].label || nodes[destinationIndex].type}”.`);
            stepIndex = destinationIndex - 1;
          } else if (!matched) {
            log.push(`${node.label || "Condition"}: not matched; workflow ended.`);
            stepIndex = nodes.length;
            break;
          } else {
            log.push(`${node.label || "Condition"}: matched.`);
          }
        } else if (node.type === "wait") {
          const duration = parseWaitDuration(config);
          if (!duration) throw new Error(`Wait step “${node.label}” needs a whole number of minutes, hours or days up to seven days.`);
          runAt = new Date(nowDate.getTime() + duration.milliseconds).toISOString();
          log.push(`Waiting ${duration.amount} ${duration.unit}.`);
          terminal = "queued";
          stepIndex++;
          break;
        } else if (node.type === "waitUntil") {
          const schedule = parseWaitUntil(config);
          if (!schedule) throw new Error(`Wait step “${node.label}” needs a valid date and time.`);
          runAt = schedule.runAt;
          log.push(`Waiting until ${runAt}.`);
          terminal = "queued";
          stepIndex++;
          break;
        } else if (node.type === "end" || node.type === "stop") {
          log.push(`${node.type === "stop" ? "Workflow stopped" : "Workflow ended"} at “${node.label || node.type}”.`);
          stepIndex = nodes.length;
          break;
        } else if (node.type === "task") {
          if (!automation.client_id) throw new Error("Select a client on the automation before using a task step.");
          const title = config.slice(0, 180) || node.label || "Follow up on new enquiry";
          const taskId = `ma-${String(execution.id).replace(/-/g, "").slice(0, 20)}-${String(node.id).replace(/[^a-zA-Z0-9]/g, "").slice(0, 12)}`;
          const saved = await updateWorkspace(db, (current) => {
            if ((current.tasks || []).some((task) => task.id === taskId)) return null;
            if (!(current.clients || []).some((client) => client.id === automation.client_id)) throw new Error("The automation client is no longer available.");
            const task = { id: taskId, clientId: automation.client_id, projectId: "", title, assigneeId: current.ownerId || "", status: "To do", priority: "Normal", service: "Setup", estimate: 0, due: now.slice(0, 10), dueAt: now, createdById: "marketing-automation", notes: `Created by automation “${automation.name}” after form submission ${execution.trigger_key}.`, marketingExecutionId: execution.id };
            const client = (current.clients || []).find((item) => item.id === automation.client_id);
            const activity = { id: crypto.randomUUID(), title: "Automation created follow-up task", detail: `${title} · ${client?.name || "Client"} · ${automation.name}`, icon: "⚡", at: now, actor: "Marketing automation", clientId: automation.client_id, taskId, kind: "task", note: `Triggered by ${input.formSlug || "published form"}; submission ${execution.trigger_key}.` };
            return { ...current, tasks: [task, ...(current.tasks || [])], activity: [activity, ...(current.activity || [])].slice(0, 100) };
          });
          if (!saved) throw new Error("Could not safely save the follow-up task. The workspace changed repeatedly; retry the run.");
          log.push(`Created follow-up task: ${title}.`);
        } else if (node.type === "tag") {
          const contactId = input.data?.contactSync?.status === "synced" ? input.data.contactSync.contactId : "";
          if (!contactId || !input.clientId) throw new Error("This submission has no synced GoHighLevel contact to tag.");
          const match = /^(add|remove)\s*:\s*(.+)$/i.exec(config);
          if (!match) throw new Error(`Tag step “${node.label}” must use “add: Tag name” or “remove: Tag name”.`);
          if (!applyContactTag) throw new Error("The GoHighLevel tag integration is unavailable in this worker.");
          const operation = match[1].toLowerCase() === "add" ? "POST" : "DELETE";
          const tag = match[2].trim().slice(0, 100);
          await applyContactTag(String(execution.owner_id), input.clientId, contactId, operation, tag);
          log.push(`${match[1].toLowerCase() === "add" ? "Added" : "Removed"} GoHighLevel tag: ${tag}.`);
        } else if (node.type === "updateContact") {
          const contactId = input.data?.contactSync?.status === "synced" ? input.data.contactSync.contactId : "";
          if (!contactId || !input.clientId) throw new Error("This submission has no synced GoHighLevel contact to update.");
          if (!updateContact) throw new Error("The GoHighLevel contact update integration is unavailable in this worker.");
          const update = buildMarketingContactUpdate(config, input.fields || [], values);
          if ("error" in update) throw new Error(update.error);
          const payload = update.payload as Record<string, string>;
          await updateContact(String(execution.owner_id), input.clientId, contactId, payload);
          log.push(`Updated GoHighLevel contact fields: ${Object.keys(payload).join(", ")}.`);
        } else if (node.type === "email") {
          const emailConfig = parseStaffEmailConfig(config);
          if (!emailConfig) throw new Error(`Email step “${node.label}” has invalid internal-staff email settings.`);
          if (!sendStaffEmail) throw new Error("Internal email delivery is not configured in this worker.");
          const workspaceRow = await db.prepare("SELECT data FROM workspace_documents WHERE id = 'f2b-agency'").first<{ data: string }>();
          let workspace: Workspace;
          try { workspace = JSON.parse(workspaceRow?.data || "null") as Workspace; } catch { throw new Error("Could not load the workspace staff directory."); }
          const recipient = workspace?.staff?.find((member) => member.id === emailConfig.recipientStaffId && !member.isBot && typeof member.email === "string" && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(member.email));
          if (!recipient) throw new Error("Choose a current staff profile with a valid email address for this internal email step.");
          const clientName = String(workspace.clients?.find((client) => client.id === input.clientId)?.name || "");
          const subject = renderStaffEmailTemplate(emailConfig.subject, values, { clientName, formName: input.formSlug });
          const text = renderStaffEmailTemplate(emailConfig.body, values, { clientName, formName: input.formSlug });
          const safeSubject = subject.replace(/[\r\n]/g, " ").slice(0, 200);
          const idempotencyKey = `marketing-automation/${String(execution.id)}/${String(node.id)}`;
          await sendStaffEmail(String(execution.owner_id), String(recipient.email), safeSubject, text, idempotencyKey);
          log.push(`Sent internal email to ${recipient.name || "staff member"}.`);
        } else if (["customerEmail", "customerSms", "customerWhatsapp"].includes(node.type)) {
          const messageConfig = parseMarketingCustomerMessage(config, node.type);
          if (!messageConfig) throw new Error(`Customer message step “${node.label}” is missing valid consent or message settings.`);
          if (!marketingConsentGranted(messageConfig.consentFieldId, input.fields || [], values)) throw new Error(`Customer message step “${node.label}” was not sent because the required consent was not recorded.`);
          const contactId = input.data?.contactSync?.status === "synced" ? input.data.contactSync.contactId : "";
          if (!contactId || !input.clientId) throw new Error("Customer messages require a contact synced to this client’s GoHighLevel sub-account.");
          if (!sendCustomerMessage) throw new Error("GoHighLevel message delivery is not configured in this worker.");
          const priorDelivery = previous.externalMessages?.[node.id];
          if (priorDelivery?.status === "sent") {
            log.push(`Previously confirmed ${messageConfig.channel} message was not sent again.`);
            continue;
          }
          if (priorDelivery?.status === "sending" || priorDelivery?.status === "unknown") throw new Error("Delivery outcome is uncertain. Check the GoHighLevel conversation before manually retrying; this workflow did not resend it.");
          if (priorDelivery?.status === "blocked") throw new Error(`GoHighLevel blocked this ${messageConfig.channel} message: ${priorDelivery.detail || "review the contact and consent"}.`);
          previous.externalMessages ||= {};
          previous.externalMessages[node.id] = { status: "sending", channel: messageConfig.channel, contactId };
          await persistProgress();
          const clientName = String(input.clientId || "");
          const subject = renderMarketingMessageTemplate(messageConfig.subject || "", values).replace(/[\r\n]/g, " ").slice(0, 200);
          const message = renderMarketingMessageTemplate(messageConfig.message, values);
          let delivery: { status: "sent"; providerMessageId: string; channel: string } | { status: "blocked"; detail: string };
          try {
            delivery = await sendCustomerMessage(String(execution.owner_id), clientName, contactId, node.type, subject, message);
          } catch {
            previous.externalMessages[node.id] = { status: "unknown", detail: "Provider request may have been accepted." };
            await persistProgress();
            throw new Error("Delivery outcome is uncertain. Check the GoHighLevel conversation before manually retrying; this workflow will not resend it automatically.");
          }
          if (delivery.status === "blocked") {
            previous.externalMessages[node.id] = { status: "blocked", detail: String(delivery.detail || "Message was not sent.").slice(0, 300) };
            await persistProgress();
            throw new Error(`Customer message was not sent: ${previous.externalMessages[node.id].detail}`);
          }
          previous.externalMessages[node.id] = { status: "sent", channel: messageConfig.channel, contactId, providerMessageId: String(delivery.providerMessageId || "").slice(0, 160) };
          await persistProgress();
          log.push(`Sent ${messageConfig.channel} through GoHighLevel; provider message ID recorded.`);
        } else if (["email", "sms", "whatsapp"].includes(node.type)) {
          throw new Error("This legacy external-message step is disabled. Add a customer message step with an explicit required consent field.");
        } else {
          throw new Error(`Unsupported automation step: ${node.type}.`);
        }
      }
      if (terminal === "succeeded" && stepIndex < nodes.length) {
        terminal = "queued";
        runAt = now;
      }
      const finalStatus = terminal === "queued" ? "queued" : "succeeded";
      await db.prepare("UPDATE marketing_executions SET status = ?1, result = ?2, run_at = ?3, updated_at = ?4 WHERE id = ?5")
        .bind(finalStatus, JSON.stringify({ stepIndex, log, ...(previous.externalMessages ? { externalMessages: previous.externalMessages } : {}), ...(Number(previous.attempts) ? { attempts: Number(previous.attempts) } : {}), ...(Array.isArray(previous.errors) ? { errors: previous.errors } : {}), ...(finalStatus === "succeeded" ? { finishedAt: now, retrying: false } : {}) }), runAt, now, execution.id).run();
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Workflow step failed.";
      let previous: { attempts?: number; log?: string[]; errors?: Array<{ at: string; detail: string }>; externalMessages?: Record<string, { status?: string; providerMessageId?: string; detail?: string; channel?: string; contactId?: string; deliveryStatus?: string; checkedAt?: string }> } = {};
      try {
        // A provider request can have an ambiguous outcome after the runner has
        // persisted its at-most-once marker. Read the latest checkpoint here;
        // using the row selected before the run would erase that marker and
        // allow a later manual retry to send a duplicate customer message.
        const latest = await db.prepare("SELECT result FROM marketing_executions WHERE id = ?1").bind(execution.id).first<{ result: string }>();
        previous = JSON.parse(String(latest?.result || execution.result || "{}")) as typeof previous;
      } catch { /* A bad prior result must not prevent the failure being recorded. */ }
      const attempts = Math.max(0, Number(previous.attempts) || 0) + 1;
      const errors = [...(Array.isArray(previous.errors) ? previous.errors : []), { at: now, detail }].slice(-5);
      const shouldRetry = retryableAutomationError(error) && attempts < AUTOMATION_MAX_ATTEMPTS;
      const retryAt = shouldRetry ? new Date(nowDate.getTime() + AUTOMATION_RETRY_DELAYS_MS[attempts - 1]).toISOString() : null;
      const result = {
        ...previous,
        attempts,
        errors,
        detail,
        ...(shouldRetry ? { retryAt, retrying: true } : { retryAt: null, retrying: false, deadLetter: true, finishedAt: now }),
      };
      await db.prepare("UPDATE marketing_executions SET status = ?1, result = ?2, run_at = ?3, updated_at = ?4 WHERE id = ?5")
        .bind(shouldRetry ? "queued" : "failed", JSON.stringify(result), retryAt || now, now, execution.id).run();
    }
  }
}
