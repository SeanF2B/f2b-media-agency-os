// Personalisation: {{first_name}}, {{company|your team}} (fallback after the pipe) and
// {a|b|c} spintax. A message with an unfilled variable and no fallback is never sent —
// renderTemplate reports it so the send is skipped and flagged, not shipped as "Hi {{first_name}}".

const VAR = /\{\{\s*([a-z0-9_]+)\s*(?:\|\s*([^}]*?))?\s*\}\}/gi;
const SPIN = /\{([^{}]*\|[^{}]*)\}/g;

/** Deterministic pick so a retry renders the same text. */
function hashPick(seed, count) {
  let hash = 2166136261;
  for (const char of String(seed)) { hash ^= char.charCodeAt(0); hash = Math.imul(hash, 16777619); }
  return Math.abs(hash) % count;
}

export function contactVariables(contact = {}, extra = {}) {
  const firstName = String(contact.first_name ?? contact.firstName ?? "").trim();
  const lastName = String(contact.last_name ?? contact.lastName ?? "").trim();
  return {
    first_name: firstName,
    last_name: lastName,
    full_name: [firstName, lastName].filter(Boolean).join(" "),
    company: String(contact.company ?? "").trim(),
    email: String(contact.email ?? "").trim(),
    ...Object.fromEntries(Object.entries(extra).map(([key, value]) => [key.toLowerCase(), String(value ?? "").trim()])),
  };
}

export function renderTemplate(template, variables, seed = "") {
  const missing = new Set();
  let index = 0;
  // Variables first ({{x|fallback}} would otherwise look like spintax); values are protected
  // from spintax by swapping them for placeholders until the end.
  const values = [];
  const withVars = String(template || "").replace(VAR, (_match, name, fallback) => {
    let value = variables[name.toLowerCase()];
    if (!value && fallback !== undefined) value = fallback;
    if (!value) { missing.add(name.toLowerCase()); value = ""; }
    values.push(value);
    return `\u0000${values.length - 1}\u0000`;
  });
  const spun = withVars.replace(SPIN, (_match, options) => { const list = options.split("|"); index += 1; return list[hashPick(`${seed}:${index}`, list.length)]; });
  const text = spun.replace(/\u0000(\d+)\u0000/g, (_match, position) => values[Number(position)]);
  return { text, missing: [...missing], ok: missing.size === 0 };
}

export function templateVariables(template) {
  return [...new Set([...String(template || "").matchAll(VAR)].filter((match) => match[2] === undefined).map((match) => match[1].toLowerCase()))];
}
