import { isMarketingGhlContactTrigger, isValidMarketingTriggerDateTime, MARKETING_SUBMISSION_TRIGGERS, parseMarketingTrigger } from "./marketing-trigger.js";
import { parseMarketingContactUpdate } from "./marketing-contact-update.js";
import { isValidMarketingTimeZone } from "./marketing-time-zone.js";
import { parseMarketingCustomerMessage } from "./marketing-automation-message.js";

const MARKETING_AUTOMATION_NODE_TYPES = new Set(["trigger", "condition", "wait", "waitUntil", "tag", "task", "updateContact", "email", "sms", "whatsapp", "customerEmail", "customerSms", "customerWhatsapp", "end", "stop"]);

export function normalizeMarketingAutomationNodeType(type) {
  const value = String(type || "");
  return MARKETING_AUTOMATION_NODE_TYPES.has(value) ? value : "task";
}

export function parseWaitDuration(config) {
  let amount;
  let unit = "minutes";
  try {
    const parsed = JSON.parse(config);
    if (parsed && typeof parsed === "object") { amount = Number(parsed.amount); unit = String(parsed.unit || "minutes"); }
    else amount = Number(config);
  } catch { amount = Number(config); }
  const unitMinutes = { minutes: 1, hours: 60, days: 1440 };
  const multiplier = unitMinutes[unit];
  if (!Number.isInteger(amount) || amount < 1 || !multiplier || amount * multiplier > 10_080) return null;
  return { amount, unit, milliseconds: amount * multiplier * 60_000 };
}

export function parseWaitUntil(config) {
  let value = config;
  let timeZone;
  try {
    const parsed = JSON.parse(config);
    if (parsed && typeof parsed === "object") { value = parsed.dateTime; timeZone = parsed.timeZone; }
    else if (typeof parsed === "string") value = parsed;
  } catch { /* A raw ISO timestamp is also accepted for older drafts. */ }
  if (timeZone !== undefined && !isValidMarketingTimeZone(timeZone)) return null;
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value.trim())) return null;
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return null;
  return { runAt: new Date(timestamp).toISOString() };
}

export function conditionPasses(config, values) {
  let condition;
  try {
    const parsed = JSON.parse(config);
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) condition = parsed;
  } catch { /* Legacy field=value conditions remain supported. */ }
  if (condition) {
    const conditions = Array.isArray(condition.conditions) && condition.conditions.length ? condition.conditions : [condition];
    if (conditions.length > 8) return false;
    const results = conditions.map((rule) => {
    const key = String(rule?.fieldId || "").trim();
    if (!key || !Object.hasOwn(values, key)) return false;
    const raw = values[key];
    const actual = Array.isArray(raw) ? raw.join(", ") : String(raw ?? "");
    const expected = String(rule.value ?? rule.equals ?? "");
    switch (rule.operator || "equals") {
      case "notEquals": return actual.toLowerCase() !== expected.toLowerCase();
      case "contains": return actual.toLowerCase().includes(expected.toLowerCase());
      case "greaterThan": return actual !== "" && Number.isFinite(Number(actual)) && Number.isFinite(Number(expected)) && Number(actual) > Number(expected);
      case "lessThan": return actual !== "" && Number.isFinite(Number(actual)) && Number.isFinite(Number(expected)) && Number(actual) < Number(expected);
      case "isEmpty": return Array.isArray(raw) ? raw.length === 0 : actual.trim() === "";
      case "isNotEmpty": return Array.isArray(raw) ? raw.length > 0 : actual.trim() !== "";
      case "equals": return actual.toLowerCase() === expected.toLowerCase();
      default: return false;
    }
    });
    return condition.mode === "or" ? results.some(Boolean) : results.every(Boolean);
  }
  const split = config.indexOf("=");
  if (split <= 0) return false;
  const key = config.slice(0, split).trim();
  const expected = config.slice(split + 1).trim();
  if (!key || !Object.hasOwn(values, key)) return false;
  const actual = values[key];
  return (Array.isArray(actual) ? actual.join(",") : String(actual ?? "")).toLowerCase() === expected.toLowerCase();
}

export function simulateMarketingAutomation(nodes, values = {}) {
  if (!Array.isArray(nodes) || nodes.length < 2 || nodes[0]?.type !== "trigger") return { steps: [], outcome: "invalid", error: "Add a trigger and at least one workflow step before running a test." };
  const steps = [];
  let index = 1;
  for (let visited = 0; index < nodes.length && visited < 60; visited++) {
    const node = nodes[index];
    if (!node || typeof node !== "object") return { steps, outcome: "invalid", error: "A workflow step is malformed." };
    const type = String(node.type || "task");
    const label = String(node.label || type);
    const config = String(node.config || "").trim();
    if (type === "condition") {
      const matched = conditionPasses(config, values);
      let rule = {};
      try { rule = JSON.parse(config); } catch { /* Legacy conditions have no explicit routes. */ }
      const route = matched ? rule.thenNodeId : rule.elseNodeId;
      steps.push({ id: String(node.id || index), label, type, detail: `${matched ? "Yes" : "No"} branch${route ? ` → ${nodes.find((candidate) => candidate.id === route)?.label || "selected step"}` : matched ? " → next step" : " → workflow ends"}.` });
      if (route) {
        const destination = nodes.findIndex((candidate) => candidate.id === route);
        if (destination <= index) return { steps, outcome: "invalid", error: `The branch from “${label}” does not point to a later step.` };
        index = destination;
        continue;
      }
      if (!matched) return { steps, outcome: "ended", error: "" };
    } else if (type === "wait" || type === "waitUntil") {
      let detail;
      if (type === "wait") {
        const duration = parseWaitDuration(config);
        detail = duration ? `Would pause for ${duration.amount} ${duration.unit}, then continue.` : "Would pause for the configured wait duration, then continue.";
      } else {
        const schedule = parseWaitUntil(config);
        detail = schedule ? `Would wait until ${schedule.runAt}, then continue.` : "Would wait until the configured date and time, then continue.";
      }
      steps.push({ id: String(node.id || index), label, type, detail });
      return { steps, outcome: "paused", error: "" };
    } else if (type === "end" || type === "stop") {
      steps.push({ id: String(node.id || index), label, type, detail: type === "stop" ? "Would stop the workflow here." : "Would finish the workflow here." });
      return { steps, outcome: type === "stop" ? "stopped" : "ended", error: "" };
    } else {
      const detail = type === "task" ? `Would create task: ${config || label}.`
        : type === "tag" ? `Would apply contact tag action “${config || label}”.`
          : type === "updateContact" ? "Would update only the explicitly mapped GoHighLevel contact fields."
            : type === "email" ? "Would send the configured internal staff email."
              : ["customerEmail", "customerSms", "customerWhatsapp"].includes(type) ? `Would attempt the configured customer ${type === "customerEmail" ? "email" : type === "customerSms" ? "SMS" : "WhatsApp"}; live consent and do-not-contact checks still apply.`
                : `Would run the configured ${type} action.`;
      steps.push({ id: String(node.id || index), label, type, detail });
    }
    index++;
  }
  if (index < nodes.length) return { steps, outcome: "limit", error: "The test stopped at the 60-step safety limit." };
  return { steps, outcome: "completed", error: "" };
}

export function buildMarketingAutomationMap(nodes) {
  if (!Array.isArray(nodes)) return { nodes: [], edges: [] };
  const mappedNodes = nodes.filter((node) => node && typeof node === "object").map((node, index) => ({
    id: String(node.id || `step-${index + 1}`),
    index,
    label: String(node.label || node.type || `Step ${index + 1}`).slice(0, 120),
    type: normalizeMarketingAutomationNodeType(node.type),
    position: normalizeMarketingAutomationPosition(node.position) || { x: 40 + (index % 3) * 320, y: 40 + Math.floor(index / 3) * 170 },
  }));
  const indexes = new Map(mappedNodes.map((node) => [node.id, node.index]));
  const edges = [];
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index];
    if (!node || typeof node !== "object" || ["end", "stop"].includes(node.type)) continue;
    const sourceId = mappedNodes.find((item) => item.index === index)?.id;
    if (!sourceId) continue;
    if (node.type === "condition") {
      let config = {};
      try { config = JSON.parse(String(node.config || "{}")); } catch { /* Invalid drafts have no explicit branch routes yet. */ }
      for (const [branch, routeId, fallback] of [["Yes", config.thenNodeId, index + 1], ["No", config.elseNodeId, null]]) {
        const destination = routeId ? indexes.get(String(routeId)) : fallback;
        const targetId = Number.isInteger(destination) ? mappedNodes.find((item) => item.index === destination)?.id : undefined;
        if (targetId && destination > index && destination < nodes.length) edges.push({ from: sourceId, to: targetId, branch });
        else if (branch === "No" && !routeId) edges.push({ from: sourceId, to: null, branch });
      }
      continue;
    }
    const targetId = mappedNodes.find((item) => item.index === index + 1)?.id;
    if (targetId) edges.push({ from: sourceId, to: targetId, branch: "Next" });
  }
  return { nodes: mappedNodes, edges };
}

export function normalizeMarketingAutomationPosition(position) {
  if (!position || typeof position !== "object") return null;
  const x = Number(position.x);
  const y = Number(position.y);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
  return { x: Math.max(0, Math.min(6000, Math.round(x))), y: Math.max(0, Math.min(6000, Math.round(y))) };
}

export function connectMarketingAutomationBranch(nodes, sourceId, branch, targetId) {
  if (!Array.isArray(nodes)) return { nodes, error: "The workflow steps could not be loaded." };
  if (branch !== "yes" && branch !== "no") return { nodes, error: "Choose a yes or no condition branch." };
  const sourceIndex = nodes.findIndex((node) => String(node?.id) === String(sourceId));
  const targetIndex = nodes.findIndex((node) => String(node?.id) === String(targetId));
  if (sourceIndex < 1 || nodes[sourceIndex]?.type !== "condition") return { nodes, error: "Choose a condition step to connect." };
  if (targetIndex <= sourceIndex) return { nodes, error: "A branch must connect to a later workflow step." };
  let config = {};
  try {
    const parsed = JSON.parse(String(nodes[sourceIndex].config || "{}"));
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) config = parsed;
  } catch {
    const raw = String(nodes[sourceIndex].config || "");
    const split = raw.indexOf("=");
    if (split > 0) config = { fieldId: raw.slice(0, split).trim(), operator: "equals", value: raw.slice(split + 1).trim() };
  }
  const nextConfig = { ...config, [branch === "yes" ? "thenNodeId" : "elseNodeId"]: String(targetId) };
  const nextNodes = [...nodes];
  nextNodes[sourceIndex] = { ...nodes[sourceIndex], config: JSON.stringify(nextConfig) };
  return { nodes: nextNodes, error: "" };
}

export function reorderMarketingAutomationNodes(nodes, fromIndex, toIndex) {
  if (!Array.isArray(nodes) || !Number.isInteger(fromIndex) || !Number.isInteger(toIndex) || fromIndex < 1 || toIndex < 1 || fromIndex >= nodes.length || toIndex >= nodes.length) return { nodes, error: "Choose a workflow step after the trigger." };
  if (fromIndex === toIndex) return { nodes, error: "" };
  const reordered = [...nodes];
  const [moved] = reordered.splice(fromIndex, 1);
  reordered.splice(toIndex, 0, moved);
  const indexes = new Map(reordered.map((node, index) => [String(node.id), index]));
  for (let index = 1; index < reordered.length; index++) {
    const node = reordered[index];
    if (node.type !== "condition") continue;
    try {
      const config = JSON.parse(node.config || "{}");
      for (const targetId of [config.thenNodeId, config.elseNodeId]) {
        if (!targetId) continue;
        const targetIndex = indexes.get(String(targetId));
        if (targetIndex === undefined || targetIndex <= index) return { nodes, error: "That move would send a condition branch backward. Keep each yes/no destination after its condition." };
      }
    } catch { /* Invalid drafts remain editable and are rejected on activation. */ }
  }
  return { nodes: reordered, error: "" };
}

export function duplicateMarketingAutomationNode(nodes, index, createId = () => crypto.randomUUID().slice(0, 12)) {
  if (!Array.isArray(nodes) || !Number.isInteger(index) || index < 1 || index >= nodes.length) return { nodes, error: "Choose a workflow step after the trigger." };
  const original = nodes[index];
  let config = original.config;
  if (original.type === "condition") {
    try {
      const rule = JSON.parse(original.config || "{}");
      if (rule && typeof rule === "object" && !Array.isArray(rule)) config = JSON.stringify(rule);
    } catch { /* Preserve legacy conditions without rewriting their syntax. */ }
  }
  const position = normalizeMarketingAutomationPosition(original.position);
  const copy = { ...structuredClone(original), id: createId(), label: `${original.label || original.type} (copy)`, config };
  if (position) copy.position = { x: Math.min(6000, position.x + 40), y: Math.min(6000, position.y + 40) };
  else delete copy.position;
  if (!copy.id || nodes.some((node) => String(node.id) === String(copy.id))) return { nodes, error: "A unique ID could not be created for that step." };
  const result = [...nodes];
  result.splice(index + 1, 0, copy);
  return { nodes: result, error: "", nodeId: copy.id };
}

export function validateMarketingAutomationNodes(nodes, clientId) {
  if (!Array.isArray(nodes) || nodes.length < 2 || nodes[0]?.type !== "trigger") return "Start the workflow with a trigger linked to a published conversion tool.";
  const trigger = parseMarketingTrigger(String(nodes[0]?.config || ""));
  const definition = MARKETING_SUBMISSION_TRIGGERS.find((item) => item.id === trigger.event);
  if (!definition) return "Choose a supported workflow trigger.";
  if (trigger.event === "specific_date_time" ? !isValidMarketingTriggerDateTime(trigger.runAt) || (trigger.timeZone !== undefined && !isValidMarketingTimeZone(trigger.timeZone)) : isMarketingGhlContactTrigger(trigger.event) && !trigger.assetSlug ? !clientId : !trigger.assetSlug) return trigger.event === "specific_date_time" ? "Choose a valid date, time and time zone for this scheduled workflow." : isMarketingGhlContactTrigger(trigger.event) && !trigger.assetSlug ? "Choose a client linked to a GoHighLevel location for this trigger." : "Choose a published conversion tool for this trigger.";
  if (trigger.event === "birthday" && (!isValidMarketingTimeZone(trigger.timeZone || "Europe/Dublin") || !/^([01]\d|2[0-3]):[0-5]\d$/.test(trigger.birthdayTime || "09:00"))) return "Choose a valid local time and time zone for the birthday reminder.";
  if (trigger.event === "date_field" && (!/^[A-Za-z0-9_-]{8,120}$/.test(trigger.customFieldId || "") || !["DATE", "DATE_TIME"].includes(trigger.customFieldType || "") || !isValidMarketingTimeZone(trigger.timeZone || "Europe/Dublin") || !/^([01]\d|2[0-3]):[0-5]\d$/.test(trigger.dateFieldTime || "09:00"))) return "Choose a valid GoHighLevel date field, local time and time zone.";
  const indexesById = new Map();
  for (let index = 0; index < nodes.length; index++) {
    const id = String(nodes[index]?.id || "").trim();
    if (!id) continue;
    if (indexesById.has(id)) return "Workflow step IDs must be unique before branches can be activated.";
    indexesById.set(id, index);
  }
  for (const node of nodes.slice(1)) {
    const config = String(node.config || "").trim();
    if (node.type === "task" && (!clientId || !config)) return "Task steps need a selected client and a task title.";
    if (node.type === "wait" && !parseWaitDuration(config)) return "Wait steps need a whole number of minutes, hours or days up to seven days.";
    if (node.type === "waitUntil" && !parseWaitUntil(config)) return "Choose a valid date and time for this wait step.";
    if (node.type === "condition") {
      let valid = /^[-\w]+\s*=/.test(config);
      try {
        const rule = JSON.parse(config);
        const rules = Array.isArray(rule?.conditions) && rule.conditions.length ? rule.conditions : [rule];
        const validRules = rules.length <= 8 && rules.length > 0 && rules.every((item) => item && typeof item.fieldId === "string" && item.fieldId.trim() && ["equals", "notEquals", "contains", "greaterThan", "lessThan", "isEmpty", "isNotEmpty"].includes(item.operator || "equals") && (item.value !== undefined || ["isEmpty", "isNotEmpty"].includes(item.operator)));
        valid ||= Boolean(rule && typeof rule === "object" && !Array.isArray(rule) && validRules && [undefined, "and", "or"].includes(rule.mode));
        if (rule && typeof rule === "object") {
          const sourceIndex = nodes.indexOf(node);
          for (const route of [rule.thenNodeId, rule.elseNodeId]) {
            if (route === undefined || route === "") continue;
            const targetIndex = indexesById.get(String(route));
            if (targetIndex === undefined) return "Choose an existing step for each condition branch.";
            if (targetIndex <= sourceIndex) return "Condition branches must point to a later step to prevent loops.";
          }
        }
      } catch { /* Legacy field=value syntax is handled above. */ }
      if (!valid) return "Conditions need a field and supported comparison.";
    }
    if (node.type === "tag" && (!clientId || !/^(add|remove)\s*:\s*\S.{0,98}$/i.test(config))) return "Tag steps need a selected client and a tag action such as add: New Lead.";
    if (node.type === "updateContact") {
      if (!clientId) return "Update contact steps need a selected client.";
      let sourceFields = [];
      try { sourceFields = (JSON.parse(config).mappings || []).map((mapping) => ({ id: mapping.fieldId, type: "text" })); } catch { /* The contact mapping parser returns the user-facing error. */ }
      const mapping = parseMarketingContactUpdate(config, sourceFields);
      if (mapping.error) return mapping.error;
    }
    if (["customerEmail", "customerSms", "customerWhatsapp"].includes(String(node.type)) && !parseMarketingCustomerMessage(config, String(node.type))) return `The ${node.type} step needs valid channel message settings and an explicit required consent field.`;
    if (!["condition", "wait", "waitUntil", "task", "tag", "updateContact", "email", "customerEmail", "customerSms", "customerWhatsapp", "end", "stop"].includes(String(node.type))) return `The ${node.type} step is not available for activation yet.`;
  }
  return null;
}

