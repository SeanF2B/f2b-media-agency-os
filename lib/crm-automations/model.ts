// Shared model for native CRM Automations (used by the builder UI, the API and the runner).
// Only erasable TypeScript syntax is used so `node --test` can load this file directly.

export type TriggerType = "form_lead" | "tag_added" | "stage_changed" | "task_completed" | "schedule";
export type ActionType = "send_email" | "set_value" | "add_tag" | "remove_tag" | "move_stage" | "create_task" | "notify" | "wait" | "if_else";
export type NodeType = "trigger" | ActionType;
export type Branch = "yes" | "no";

export type AutomationNode = { id: string; type: NodeType; config: Record<string, unknown> };
export type AutomationEdge = { id: string; source: string; target: string; branch?: Branch };
export type AutomationDefinition = { nodes: AutomationNode[]; edges: AutomationEdge[] };

export type ConditionRule = { field: string; op: string; value?: string };
export type ConditionSet = { match: "all" | "any"; rules: ConditionRule[] };

export type ContactFacts = {
  id: string; first_name: string; last_name: string; email: string; phone: string; company: string; source: string; client_id: string | null;
  tags: string[]; stageIds: string[]; notes?: string; deal_value?: number;
};

export const TRIGGERS: Array<{ type: TriggerType; label: string; help: string; icon: string }> = [
  { type: "form_lead", label: "New lead from website form", help: "Starts when someone fills in one of your website forms.", icon: "FileInput" },
  { type: "tag_added", label: "Tag added", help: "Starts when a tag is added to a contact.", icon: "Tag" },
  { type: "stage_changed", label: "Pipeline stage changed", help: "Starts when a deal moves to a different stage.", icon: "Columns3" },
  { type: "task_completed", label: "Task completed", help: "Starts when a task is marked as done.", icon: "CircleCheck" },
  { type: "schedule", label: "Date / time", help: "Starts on a date you choose, once or on repeat.", icon: "CalendarClock" },
];

export const ACTIONS: Array<{ type: ActionType | "sms"; label: string; help: string; icon: string; comingSoon?: boolean }> = [
  { type: "send_email", label: "Send email", help: "Email the contact.", icon: "Mail" },
  { type: "set_value", label: "Update opportunity value", help: "Set the deal value from the form answers.", icon: "Euro" },
  { type: "add_tag", label: "Add tag", help: "Label the contact with a tag.", icon: "Tag" },
  { type: "remove_tag", label: "Remove tag", help: "Take a tag off the contact.", icon: "TagOff" },
  { type: "move_stage", label: "Move pipeline stage", help: "Move the contact's deal to a stage.", icon: "Columns3" },
  { type: "create_task", label: "Create task", help: "Add a task for a teammate or bot.", icon: "ListTodo" },
  { type: "notify", label: "Notify me", help: "Get an alert in the app and by email.", icon: "Bell" },
  { type: "wait", label: "Wait", help: "Pause before the next step.", icon: "Hourglass" },
  { type: "if_else", label: "If / Else", help: "Split into two paths based on a rule.", icon: "GitBranch" },
  { type: "sms", label: "Send SMS", help: "Text messages are coming soon.", icon: "MessageSquare", comingSoon: true },
];

export const CONDITION_FIELDS: Array<{ value: string; label: string; kind: "text" | "tag" | "stage" }> = [
  { value: "first_name", label: "First name", kind: "text" },
  { value: "last_name", label: "Last name", kind: "text" },
  { value: "email", label: "Email", kind: "text" },
  { value: "phone", label: "Phone", kind: "text" },
  { value: "company", label: "Company", kind: "text" },
  { value: "source", label: "Lead source", kind: "text" },
  { value: "tag", label: "Tags", kind: "tag" },
  { value: "stage", label: "Pipeline stage", kind: "stage" },
];

export const TEXT_OPS = [
  { value: "is", label: "is" }, { value: "is_not", label: "is not" }, { value: "contains", label: "contains" },
  { value: "not_empty", label: "is filled in" }, { value: "is_empty", label: "is empty" },
];
export const TAG_OPS = [{ value: "has", label: "has tag" }, { value: "has_not", label: "doesn't have tag" }];
export const STAGE_OPS = [{ value: "is", label: "is in" }, { value: "is_not", label: "is not in" }];

export const MERGE_FIELDS = [
  { token: "{{contact.first_name}}", label: "First name" },
  { token: "{{contact.last_name}}", label: "Last name" },
  { token: "{{contact.full_name}}", label: "Full name" },
  { token: "{{contact.email}}", label: "Email" },
  { token: "{{contact.phone}}", label: "Phone" },
  { token: "{{contact.company}}", label: "Company" },
  { token: "{{contact.notes}}", label: "Form answers" },
  { token: "{{contact.deal_value}}", label: "Deal value" },
];

export const MAX_NODES = 60;
export const MAX_WAIT_DAYS = 365;

export function newId(prefix = "n") {
  const random = typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10);
  return `${prefix}_${random}`;
}

export function blankDefinition(): AutomationDefinition {
  return { nodes: [{ id: "trigger", type: "trigger", config: {} }], edges: [] };
}

const text = (value: unknown, max = 200) => (typeof value === "string" ? value.trim().slice(0, max) : "");

// ---------- tree helpers ----------
export function triggerOf(def: AutomationDefinition) { return def.nodes.find((node) => node.type === "trigger"); }
export function nodeById(def: AutomationDefinition, id: string) { return def.nodes.find((node) => node.id === id); }
export function outgoing(def: AutomationDefinition, id: string, branch?: Branch) {
  return def.edges.find((edge) => edge.source === id && (branch ? edge.branch === branch : !edge.branch));
}
export function incoming(def: AutomationDefinition, id: string) { return def.edges.find((edge) => edge.target === id); }

/** Next node after `id` (for if/else pass the branch that was taken). */
export function nextNodeId(def: AutomationDefinition, id: string, branch?: Branch) { return outgoing(def, id, branch)?.target || null; }

/** Insert a node after `afterId` (on `branch` when afterId is an If/Else). Downstream steps move under the new node (Yes path for If/Else). */
export function insertNode(def: AutomationDefinition, afterId: string, node: AutomationNode, branch?: Branch): AutomationDefinition {
  const existing = outgoing(def, afterId, branch);
  const edges = def.edges.filter((edge) => edge !== existing);
  edges.push({ id: newId("e"), source: afterId, target: node.id, ...(branch ? { branch } : {}) });
  if (existing) edges.push({ id: newId("e"), source: node.id, target: existing.target, ...(node.type === "if_else" ? { branch: "yes" as const } : {}) });
  return { nodes: [...def.nodes, node], edges };
}

/** All node ids below `id` (not including it). */
export function descendants(def: AutomationDefinition, id: string): string[] {
  const out: string[] = []; const stack = def.edges.filter((edge) => edge.source === id).map((edge) => edge.target);
  while (stack.length) { const next = stack.pop() as string; if (out.includes(next)) continue; out.push(next); def.edges.filter((edge) => edge.source === next).forEach((edge) => stack.push(edge.target)); }
  return out;
}

/** Remove a node. Regular steps are bridged; an If/Else removes both of its paths. */
export function removeNode(def: AutomationDefinition, id: string): AutomationDefinition {
  const node = nodeById(def, id);
  if (!node || node.type === "trigger") return def;
  const parentEdge = incoming(def, id);
  if (node.type === "if_else") {
    const gone = new Set([id, ...descendants(def, id)]);
    return { nodes: def.nodes.filter((item) => !gone.has(item.id)), edges: def.edges.filter((edge) => !gone.has(edge.source) && !gone.has(edge.target)) };
  }
  const child = outgoing(def, id);
  const edges = def.edges.filter((edge) => edge.source !== id && edge.target !== id);
  if (parentEdge && child) edges.push({ id: newId("e"), source: parentEdge.source, target: child.target, ...(parentEdge.branch ? { branch: parentEdge.branch } : {}) });
  return { nodes: def.nodes.filter((item) => item.id !== id), edges };
}

export function duplicateNode(def: AutomationDefinition, id: string): AutomationDefinition {
  const node = nodeById(def, id);
  if (!node || node.type === "trigger" || node.type === "if_else") return def;
  return insertNode(def, id, { id: newId(), type: node.type, config: JSON.parse(JSON.stringify(node.config || {})) });
}

// ---------- validation ----------
/** Strict server-side check: one trigger, a tree (each node one parent), known types, size limits. */
export function sanitizeDefinition(raw: unknown): { ok: true; definition: AutomationDefinition } | { ok: false; error: string } {
  const value = raw as Partial<AutomationDefinition> | null;
  if (!value || !Array.isArray(value.nodes) || !Array.isArray(value.edges)) return { ok: false, error: "The automation steps could not be read." };
  if (value.nodes.length > MAX_NODES) return { ok: false, error: `An automation can have up to ${MAX_NODES} steps.` };
  const types = new Set<string>(["trigger", ...ACTIONS.filter((item) => !item.comingSoon).map((item) => item.type)]);
  const nodes: AutomationNode[] = [];
  for (const item of value.nodes) {
    const id = text((item as AutomationNode)?.id, 60), type = text((item as AutomationNode)?.type, 30);
    if (!id || !/^[\w-]+$/.test(id) || !types.has(type) || nodes.some((node) => node.id === id)) return { ok: false, error: "One of the steps is not valid." };
    const config = (item as AutomationNode).config && typeof (item as AutomationNode).config === "object" ? (item as AutomationNode).config : {};
    if (JSON.stringify(config).length > 20_000) return { ok: false, error: "One of the steps is too large." };
    nodes.push({ id, type: type as NodeType, config });
  }
  if (nodes.filter((node) => node.type === "trigger").length !== 1) return { ok: false, error: "An automation needs exactly one trigger." };
  const ids = new Set(nodes.map((node) => node.id));
  const edges: AutomationEdge[] = []; const parents = new Set<string>();
  for (const item of value.edges) {
    const source = text(item?.source, 60), target = text(item?.target, 60), branch = item?.branch === "yes" || item?.branch === "no" ? item.branch : undefined;
    if (!ids.has(source) || !ids.has(target) || source === target || parents.has(target)) return { ok: false, error: "The steps are not connected correctly." };
    const sourceNode = nodes.find((node) => node.id === source) as AutomationNode;
    if ((sourceNode.type === "if_else") !== Boolean(branch)) return { ok: false, error: "The If / Else paths are not connected correctly." };
    if (edges.some((edge) => edge.source === source && edge.branch === branch)) return { ok: false, error: "A step can only lead to one next step." };
    if (nodes.find((node) => node.id === target)?.type === "trigger") return { ok: false, error: "The trigger must be the first step." };
    parents.add(target); edges.push({ id: text(item?.id, 60) || newId("e"), source, target, ...(branch ? { branch } : {}) });
  }
  const trigger = nodes.find((node) => node.type === "trigger") as AutomationNode;
  const reachable = new Set([trigger.id, ...descendants({ nodes, edges }, trigger.id)]);
  if (reachable.size !== nodes.length) return { ok: false, error: "Some steps are not connected to the trigger." };
  return { ok: true, definition: { nodes, edges } };
}

/** Plain-English problems that stop an automation from being switched on. */
export function readinessProblems(def: AutomationDefinition): string[] {
  const problems: string[] = [];
  const trigger = triggerOf(def);
  const t = trigger?.config || {};
  if (!t.type) problems.push("Choose what starts this automation.");
  if (t.type === "tag_added" && !text(t.tag)) problems.push("Choose which tag starts this automation.");
  if (t.type === "stage_changed" && !text(t.pipelineId)) problems.push("Choose a pipeline for the trigger.");
  if (t.type === "schedule" && t.mode !== "recurring" && !text(t.at)) problems.push("Choose the date and time for the trigger.");
  if (def.nodes.length < 2) problems.push("Add at least one step after the trigger.");
  for (const node of def.nodes) {
    const c = node.config || {}; const name = actionLabel(node.type);
    if (node.type === "send_email" && (!text(c.subject) || !text(c.body, 20000))) problems.push(`${name}: add a subject and a message.`);
    if (node.type === "send_email" && c.to === "custom" && !parseEmailList(String(c.toEmails || "")).length) problems.push(`${name}: add the email address to send to.`);
    if (node.type === "set_value" && !parsePriceTable(String(c.table || "")).prices.length) problems.push(`${name}: add at least one price.`);
    if ((node.type === "add_tag" || node.type === "remove_tag") && !text(c.tag)) problems.push(`${name}: choose a tag.`);
    if (node.type === "move_stage" && (!text(c.pipelineId) || !text(c.stageId))) problems.push(`${name}: choose a pipeline and stage.`);
    if (node.type === "create_task" && !text(c.title)) problems.push(`${name}: give the task a title.`);
    if (node.type === "wait" && c.mode !== "until" && !(Number(c.amount) > 0)) problems.push(`${name}: choose how long to wait.`);
    if (node.type === "wait" && c.mode === "until" && !text(c.until)) problems.push(`${name}: choose a date to wait until.`);
    if (node.type === "if_else" && !(Array.isArray((c.conditions as ConditionSet)?.rules) && (c.conditions as ConditionSet).rules.length)) problems.push(`${name}: add at least one rule.`);
  }
  return [...new Set(problems)];
}

export function sendsEmail(def: AutomationDefinition) { return def.nodes.some((node) => node.type === "send_email"); }

// ---------- labels ----------
export function actionLabel(type: string) {
  if (type === "trigger") return "Trigger";
  return ACTIONS.find((item) => item.type === type)?.label || "Step";
}
export function triggerLabel(type: unknown) { return TRIGGERS.find((item) => item.type === type)?.label || "Choose a trigger"; }

type Lookup = { stageName?: (id: string) => string; pipelineName?: (id: string) => string; staffName?: (id: string) => string };

export function nodeTitle(node: AutomationNode) {
  return node.type === "trigger" ? triggerLabel(node.config?.type) : actionLabel(node.type);
}

export function nodeSummary(node: AutomationNode, lookup: Lookup = {}): string {
  const c = node.config || {};
  const stage = (id: unknown) => (id ? lookup.stageName?.(String(id)) || "a stage" : "");
  switch (node.type) {
    case "trigger":
      if (c.type === "form_lead") return text(c.formName) ? `Form · ${text(c.formName)}` : "Any website form";
      if (c.type === "tag_added") return text(c.tag) ? `Tag · ${text(c.tag)}` : "Choose a tag";
      if (c.type === "stage_changed") return c.pipelineId ? `${c.fromStageId ? stage(c.fromStageId) : "Any stage"} → ${c.toStageId ? stage(c.toStageId) : "any stage"}` : "Choose a pipeline";
      if (c.type === "task_completed") return c.match === "automation" ? "Tasks made by automations" : c.match === "title" && text(c.titleContains) ? `Title contains "${text(c.titleContains, 40)}"` : "Any task";
      if (c.type === "schedule") return c.mode === "recurring" ? `Every ${c.repeat === "weekly" ? "week" : c.repeat === "monthly" ? "month" : "day"} at ${text(c.time) || "09:00"}` : text(c.at) ? `Once · ${text(c.at).replace("T", " at ")}` : "Choose a date and time";
      return "Click to choose what starts this automation";
    case "send_email": return text(c.subject) ? `${c.to === "custom" && text(c.toEmails) ? `Email ${text(c.toEmails, 40)}` : "Send email"} · ${text(c.subject, 60)}` : "Write the email";
    case "set_value": { const n = parsePriceTable(String(c.table || "")).prices.length; return n ? `Set value from ${n} price${n === 1 ? "" : "s"}` : "Add prices"; }
    case "add_tag": return text(c.tag) ? `Add tag · ${text(c.tag)}` : "Choose a tag";
    case "remove_tag": return text(c.tag) ? `Remove tag · ${text(c.tag)}` : "Choose a tag";
    case "move_stage": return c.stageId ? `Move to · ${stage(c.stageId)}` : "Choose a stage";
    case "create_task": return text(c.title) ? `Task · ${text(c.title, 60)}${c.assigneeId && lookup.staffName ? ` for ${lookup.staffName(String(c.assigneeId))}` : ""}` : "Describe the task";
    case "notify": return text(c.message) ? `Notify · ${text(c.message, 60)}` : "Write the alert";
    case "wait":
      if (c.mode === "until") return text(c.until) ? `Wait until ${text(c.until).replace("T", " at ")}` : "Choose a date";
      return Number(c.amount) > 0 ? `Wait ${Number(c.amount)} ${unitLabel(String(c.unit || "days"), Number(c.amount))}` : "Choose how long";
    case "if_else": {
      const rules = ((c.conditions as ConditionSet)?.rules || []).length;
      return rules ? `${rules} rule${rules === 1 ? "" : "s"} · ${(c.conditions as ConditionSet)?.match === "any" ? "any match" : "all must match"}` : "Add a rule";
    }
    default: return "";
  }
}

export function unitLabel(unit: string, amount: number) {
  const base = unit === "minutes" ? "minute" : unit === "hours" ? "hour" : "day";
  return amount === 1 ? base : `${base}s`;
}

// ---------- pure runtime helpers ----------
export function renderMerge(template: string, contact: Partial<ContactFacts>) {
  const fields: Record<string, string> = {
    first_name: contact.first_name || "", last_name: contact.last_name || "",
    full_name: [contact.first_name, contact.last_name].filter(Boolean).join(" "),
    email: contact.email || "", phone: contact.phone || "", company: contact.company || "",
    notes: contact.notes || "", deal_value: contact.deal_value ? `€${Math.round(contact.deal_value).toLocaleString("en-IE")}` : "",
  };
  return String(template || "").replace(/\{\{\s*contact\.(\w+)\s*\}\}/g, (_match, key: string) => fields[key] ?? "");
}

export function normalizeTag(value: unknown) { return text(value, 60).replace(/\s+/g, " ").toLowerCase(); }

export function evaluateConditions(conditions: ConditionSet | undefined, contact: ContactFacts): boolean {
  const rules = Array.isArray(conditions?.rules) ? conditions.rules : [];
  if (!rules.length) return false;
  const check = (rule: ConditionRule) => {
    const wanted = String(rule.value || "").trim().toLowerCase();
    if (rule.field === "tag") { const has = contact.tags.includes(normalizeTag(rule.value)); return rule.op === "has_not" ? !has : has; }
    if (rule.field === "stage") { const has = contact.stageIds.includes(String(rule.value || "")); return rule.op === "is_not" ? !has : has; }
    const actual = String((contact as unknown as Record<string, unknown>)[rule.field] ?? "").trim().toLowerCase();
    if (rule.op === "is") return actual === wanted;
    if (rule.op === "is_not") return actual !== wanted;
    if (rule.op === "contains") return Boolean(wanted) && actual.includes(wanted);
    if (rule.op === "is_empty") return !actual;
    if (rule.op === "not_empty") return Boolean(actual);
    return false;
  };
  return conditions?.match === "any" ? rules.some(check) : rules.every(check);
}

export const AUTOMATION_TIMEZONE = "Europe/Dublin";

/** Convert a wall-clock time in `timeZone` ("YYYY-MM-DDTHH:mm") to a UTC Date. */
export function zonedToUtc(local: string, timeZone = AUTOMATION_TIMEZONE): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(local);
  if (!match) return null;
  const [, y, mo, d, h, mi] = match.map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const offset = (at: number) => {
    const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).formatToParts(new Date(at)).map((part) => [part.type, part.value]));
    return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute)) - at;
  };
  const first = guess - offset(guess);
  return new Date(guess - offset(first));
}

function localParts(at: Date, timeZone = AUTOMATION_TIMEZONE) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", weekday: "short" }).formatToParts(at).map((part) => [part.type, part.value]));
  return { y: Number(parts.year), m: Number(parts.month), d: Number(parts.day), weekday: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(String(parts.weekday)) };
}

/** Next time a Date/time trigger should fire strictly after `after` (null = never again). */
export function nextScheduleFire(config: Record<string, unknown>, after: Date): Date | null {
  if (config.mode !== "recurring") {
    const at = zonedToUtc(text(config.at, 16));
    return at && at.getTime() > after.getTime() ? at : null;
  }
  const time = /^\d{2}:\d{2}$/.test(text(config.time)) ? text(config.time) : "09:00";
  const repeat = config.repeat === "weekly" || config.repeat === "monthly" ? config.repeat : "daily";
  const start = localParts(after);
  for (let offset = 0; offset < 400; offset++) {
    const day = new Date(Date.UTC(start.y, start.m - 1, start.d + offset));
    const ymd = `${day.getUTCFullYear()}-${String(day.getUTCMonth() + 1).padStart(2, "0")}-${String(day.getUTCDate()).padStart(2, "0")}`;
    if (repeat === "weekly" && day.getUTCDay() !== Number(config.weekday ?? 1)) continue;
    if (repeat === "monthly" && day.getUTCDate() !== Math.min(28, Math.max(1, Number(config.monthDay ?? 1)))) continue;
    const candidate = zonedToUtc(`${ymd}T${time}`);
    if (candidate && candidate.getTime() > after.getTime()) return candidate;
  }
  return null;
}

export function waitUntil(config: Record<string, unknown>, from: Date): Date | null {
  if (config.mode === "until") return zonedToUtc(text(config.until, 16));
  const amount = Math.max(0, Number(config.amount) || 0);
  const unit = String(config.unit || "days");
  const ms = unit === "minutes" ? 60_000 : unit === "hours" ? 3_600_000 : 86_400_000;
  const capped = Math.min(amount * ms, MAX_WAIT_DAYS * 86_400_000);
  return capped > 0 ? new Date(from.getTime() + capped) : null;
}

// ---------- opportunity value from form answers ----------
/** Price table, one rule per line: "Design only = 3000" sets the base; "Need trades sourced = +15%" adjusts it. */
export function parsePriceTable(table: string) {
  const prices: Array<{ answer: string; amount: number }> = [], factors: Array<{ answer: string; percent: number }> = [];
  for (const raw of String(table || "").split("\n")) {
    const m = raw.match(/^\s*(.+?)\s*=\s*([+-]?)\s*€?\s*([\d.,]+)\s*(%?)\s*$/);
    if (!m) continue;
    const answer = m[1].trim(), n = Number(m[3].replace(/,/g, ""));
    if (!answer || !Number.isFinite(n)) continue;
    if (m[4] === "%") factors.push({ answer, percent: (m[2] === "-" ? -1 : 1) * n });
    else prices.push({ answer, amount: n });
  }
  return { prices, factors };
}
/** Estimate from the lead's answers ("Question? Answer" lines). First matching price is the base; % rules adjust it. Rounded to €100. */
export function estimateFromTable(table: string, answersText: string) {
  const { prices, factors } = parsePriceTable(table);
  const lines = String(answersText || "").split("\n").map((line) => line.trim()).filter(Boolean);
  const hit = (answer: string) => lines.some((line) => line === answer || line.endsWith(` ${answer}`) || line.endsWith(`: ${answer}`));
  let base = 0;
  for (const line of lines) {
    const p = prices.filter((item) => line === item.answer || line.endsWith(` ${item.answer}`)).sort((a, b) => b.answer.length - a.answer.length)[0];
    if (p) { base = p.amount; break; }
  }
  if (!base) return 0;
  const total = factors.filter((f) => hit(f.answer)).reduce((sum, f) => sum * (1 + f.percent / 100), base);
  return Math.max(0, Math.round(total / 100) * 100);
}
export function parseEmailList(value: string) {
  return String(value || "").split(/[,;\s]+/).map((item) => item.trim().toLowerCase()).filter((item) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(item)).slice(0, 10);
}
