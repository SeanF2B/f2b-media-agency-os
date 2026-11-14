// Lead import for Outreach: CSV → validated, de-duplicated rows matched against existing
// CRM contacts, so imports update the CRM instead of creating duplicates.
// Validation here is the free, local part (syntax, MX is checked separately via DNS);
// mailbox-level verification needs port 25, which Cloudflare Workers can't open.

const FREE_MAIL = new Set(["gmail.com", "googlemail.com", "outlook.com", "hotmail.com", "live.com", "msn.com", "yahoo.com", "yahoo.co.uk", "icloud.com", "me.com", "aol.com", "eircom.net", "proton.me", "protonmail.com", "gmx.com"]);
const DISPOSABLE = new Set(["mailinator.com", "guerrillamail.com", "10minutemail.com", "tempmail.com", "yopmail.com", "trashmail.com", "sharklasers.com", "getnada.com"]);
const ROLE = /^(info|sales|admin|office|contact|hello|support|enquiries|enquiry|accounts|billing|reception|team|marketing|hr|jobs|careers|noreply|no-reply|postmaster|abuse|webmaster)@/i;
const EMAIL = /^[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i;

export function parseCsv(text) {
  const rows = []; let row = []; let field = ""; let quoted = false;
  const input = String(text || "").replace(/^﻿/, "");
  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') { field += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") { row.push(field); field = ""; }
    else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[index + 1] === "\n") index += 1;
      row.push(field); field = "";
      if (row.some((cell) => cell.trim())) rows.push(row);
      row = [];
    } else field += char;
  }
  row.push(field);
  if (row.some((cell) => cell.trim())) rows.push(row);
  return rows;
}

const ALIASES = {
  email: ["email", "email address", "e-mail", "work email", "email_1", "emails"],
  first_name: ["first name", "firstname", "first_name", "given name"],
  last_name: ["last name", "lastname", "last_name", "surname", "family name"],
  full_name: ["name", "full name", "contact name", "full_name"],
  company: ["company", "company name", "business", "business name", "organisation", "organization"],
  website: ["website", "site", "domain", "url"],
  phone: ["phone", "phone number", "telephone", "mobile"],
  time_zone: ["time zone", "timezone", "tz"],
  city: ["city", "town", "location"],
};

export function mapColumns(header) {
  const lower = header.map((cell) => String(cell).trim().toLowerCase());
  const map = {};
  for (const [field, names] of Object.entries(ALIASES)) { const index = lower.findIndex((cell) => names.includes(cell)); if (index >= 0) map[field] = index; }
  lower.forEach((cell, index) => { if (!Object.values(map).includes(index) && cell) map[`custom_${cell.replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")}`] = index; });
  return map;
}

export function checkEmail(raw) {
  const email = String(raw || "").trim().toLowerCase().replace(/^mailto:/, "");
  const domain = email.split("@")[1] || "";
  const flags = [];
  if (!EMAIL.test(email)) return { email, domain, valid: false, flags: ["invalid-syntax"] };
  if (DISPOSABLE.has(domain)) return { email, domain, valid: false, flags: ["disposable"] };
  if (FREE_MAIL.has(domain)) flags.push("personal-mailbox");
  if (ROLE.test(email)) flags.push("role-address");
  return { email, domain, valid: true, flags };
}

/**
 * @param {string} csvText
 * @param {object} ctx
 * @param {Map<string,{id:string,client_id?:string|null}>} ctx.existingContacts  lower-cased email → CRM contact
 * @param {Set<string>} ctx.suppressed            emails and @domains
 * @param {Map<string,string>} [ctx.lastContacted] email → ISO date of the last outreach send
 * @param {Set<string>} [ctx.activeEnrolled]      emails in an active sequence anywhere
 * @param {number} [ctx.cooldownDays]
 * @param {boolean} [ctx.allowPersonalMailboxes]  default false: personal addresses need consent under ePrivacy rules
 * @param {Date} [ctx.now]
 */
export function prepareImport(csvText, ctx) {
  const rows = parseCsv(csvText);
  if (rows.length < 2) return { rows: [], summary: { total: 0 }, columns: {} };
  const columns = mapColumns(rows[0]);
  if (columns.email === undefined) throw new Error("The CSV needs an email column.");
  const now = (ctx.now || new Date()).getTime();
  const cooldown = (ctx.cooldownDays ?? 90) * 86_400_000;
  const seen = new Set();
  const out = [];
  for (const cells of rows.slice(1)) {
    const value = (field) => (columns[field] === undefined ? "" : String(cells[columns[field]] ?? "").trim());
    const check = checkEmail(value("email"));
    let firstName = value("first_name"); let lastName = value("last_name");
    if (!firstName && value("full_name")) { const parts = value("full_name").split(/\s+/); firstName = parts[0]; lastName = lastName || parts.slice(1).join(" "); }
    const custom = Object.fromEntries(Object.keys(columns).filter((key) => key.startsWith("custom_")).map((key) => [key.slice(7), value(key)]).filter(([, cell]) => cell));
    const record = { email: check.email, first_name: firstName, last_name: lastName, company: value("company"), website: value("website"), phone: value("phone"), time_zone: value("time_zone"), city: value("city"), custom, flags: check.flags };
    let action = "create"; let reason = "";
    const existing = ctx.existingContacts.get(check.email);
    if (!check.valid) { action = "skip"; reason = check.flags[0]; }
    else if (seen.has(check.email)) { action = "skip"; reason = "duplicate-in-file"; }
    else if (ctx.suppressed.has(check.email) || ctx.suppressed.has(`@${check.domain}`)) { action = "skip"; reason = "suppressed"; }
    else if (check.flags.includes("personal-mailbox") && !ctx.allowPersonalMailboxes) { action = "skip"; reason = "personal-mailbox"; }
    else if (ctx.activeEnrolled?.has(check.email)) { action = "skip"; reason = "already-in-a-sequence"; }
    else if (ctx.lastContacted?.get(check.email) && now - new Date(ctx.lastContacted.get(check.email)).getTime() < cooldown) { action = "skip"; reason = "contacted-recently"; }
    else if (existing) { action = "link"; reason = "existing-crm-contact"; record.contact_id = existing.id; }
    if (check.valid) seen.add(check.email);
    out.push({ ...record, action, reason });
  }
  const count = (predicate) => out.filter(predicate).length;
  return {
    columns,
    rows: out,
    summary: { total: out.length, create: count((row) => row.action === "create"), link: count((row) => row.action === "link"), skip: count((row) => row.action === "skip"), reasons: out.filter((row) => row.action === "skip").reduce((acc, row) => ({ ...acc, [row.reason]: (acc[row.reason] || 0) + 1 }), {}) },
  };
}
