// Appointment follow-ups (Scheduling → booking calendar → Follow-ups).
// Each switched-on follow-up is a real automation in Operations → Automations (so it can be seen, tested and edited there):
//   Cancelled  → rebook nudges        No-show → "sorry we missed you" + rebook nudges
// You choose how many messages, how far apart, and by email, WhatsApp / SMS, or both.
import { ensureAutomationTables } from "../crm-automations/engine.ts";

type Db = Parameters<typeof ensureAutomationTables>[0];
import { FOLLOW_UP_KINDS, type FollowUp, type FollowUpKind } from "./followups-model.ts";
export { DEFAULT_FOLLOW_UP, FOLLOW_UP_KINDS, sanitizeFollowUps, type FollowUp, type FollowUpKind } from "./followups-model.ts";

const COPY: Record<FollowUpKind, Array<{ subject: string; text: string }>> = {
  cancelled: [
    { subject: "Would you like a new time, {{contact.first_name}}?", text: "Hi {{contact.first_name}}, sorry your {{appointment.calendar}} didn't work out. Whenever suits, you can pick a new time here: {{appointment.rebook_link}}" },
    { subject: "Still want to book your {{appointment.calendar}}?", text: "Hi {{contact.first_name}}, just checking in. Would you still like to book your {{appointment.calendar}}? Here's the link: {{appointment.rebook_link}}" },
    { subject: "We'd love to see you, {{contact.first_name}}", text: "Hi {{contact.first_name}}, a quick last note from {{business.name}}: if you'd still like your {{appointment.calendar}}, you can book any time here: {{appointment.rebook_link}}" },
  ],
  no_show: [
    { subject: "Sorry we missed you, {{contact.first_name}}", text: "Hi {{contact.first_name}}, sorry we missed you for your {{appointment.calendar}}. No problem at all, you can pick a new time here: {{appointment.rebook_link}}" },
    { subject: "Shall we find you a new time?", text: "Hi {{contact.first_name}}, would you like to rebook your {{appointment.calendar}}? Here's the link whenever suits: {{appointment.rebook_link}}" },
    { subject: "Still keen, {{contact.first_name}}?", text: "Hi {{contact.first_name}}, last check-in from {{business.name}}: if you'd still like your {{appointment.calendar}}, book here any time: {{appointment.rebook_link}}" },
  ],
};

export function followUpDefinition(kind: FollowUpKind, cal: { id: string; name: string }, f: FollowUp) {
  const meta = FOLLOW_UP_KINDS.find((k) => k.kind === kind)!;
  const nodes: Array<{ id: string; type: string; config: Record<string, unknown> }> = [{ id: "trigger", type: "trigger", config: { type: meta.trigger, calendarId: cal.id, calendarName: cal.name } }];
  let n = 0; const id = () => `n${++n}`;
  for (let i = 0; i < f.count; i++) {
    const wait = i === 0 ? (f.firstDelayHours ? { mode: "for", amount: f.firstDelayHours, unit: "hours" } : null) : { mode: "for", amount: f.gapDays, unit: "days" };
    if (wait) nodes.push({ id: id(), type: "wait", config: wait });
    const copy = COPY[kind][Math.min(i, COPY[kind].length - 1)];
    if (f.channel !== "email") nodes.push({ id: id(), type: "send_message", config: { channel: "auto", body: copy.text } });
    if (f.channel !== "message") nodes.push({ id: id(), type: "send_email", config: { to: "contact", subject: copy.subject, body: `${copy.text}\n\n{{business.name}}` } });
  }
  const edges = nodes.slice(1).map((node, i) => ({ id: `e${i + 1}`, source: nodes[i].id, target: node.id }));
  return { nodes, edges };
}

/** Create / update / switch off the automations behind a calendar's follow-ups. Returns follow-ups with their automation ids. */
export async function syncFollowUps(db: Db, ownerId: string, cal: { id: string; name: string; clientId: string }, next: Partial<Record<FollowUpKind, FollowUp>>, prev: Partial<Record<FollowUpKind, FollowUp>> = {}) {
  await ensureAutomationTables(db);
  const now = new Date().toISOString();
  const out: Partial<Record<FollowUpKind, FollowUp>> = {};
  for (const { kind, label, trigger } of FOLLOW_UP_KINDS) {
    const f = next[kind]; if (!f) continue;
    const before = prev[kind];
    let automationId = f.automationId || before?.automationId || "";
    const exists = automationId ? await db.prepare("SELECT id FROM crm_automations WHERE id=?1 AND owner_id=?2").bind(automationId, ownerId).first<{ id: string }>() : null;
    if (!exists) automationId = "";
    const changed = !before || JSON.stringify({ ...before, automationId: "" }) !== JSON.stringify({ ...f, automationId: "" });
    if (f.on) {
      const def = followUpDefinition(kind, cal, f);
      const name = `Follow-up · ${label.replace(/^After an? /, "").replace(/^./, (c) => c.toUpperCase())} · ${cal.name}`.slice(0, 120);
      const sendsEmail = f.channel !== "message" ? 1 : 0;
      if (!automationId) {
        automationId = crypto.randomUUID();
        await db.prepare("INSERT INTO crm_automations (id, owner_id, scope_id, name, status, trigger_type, definition, sends_email, enabled_by, enabled_at, created_at, updated_at) VALUES (?1,?2,?3,?4,'on',?5,?6,?7,'Scheduling follow-ups',?8,?8,?8)").bind(automationId, ownerId, cal.clientId || "", name, trigger, JSON.stringify(def), sendsEmail, now).run();
      } else if (changed) {
        await db.prepare("UPDATE crm_automations SET name=?3, status='on', trigger_type=?4, definition=?5, sends_email=?6, updated_at=?7 WHERE id=?1 AND owner_id=?2").bind(automationId, ownerId, name, trigger, JSON.stringify(def), sendsEmail, now).run();
      } else {
        await db.prepare("UPDATE crm_automations SET status='on', updated_at=?3 WHERE id=?1 AND owner_id=?2 AND status<>'on'").bind(automationId, ownerId, now).run();
      }
    } else if (automationId) {
      await db.prepare("UPDATE crm_automations SET status='off', updated_at=?3 WHERE id=?1 AND owner_id=?2").bind(automationId, ownerId, now).run();
    }
    out[kind] = { ...f, automationId: automationId || undefined };
  }
  return out;
}
