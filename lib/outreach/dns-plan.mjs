// Plans the DNS changes a sending domain needs, without ever touching unrelated records.
// Pure functions: the caller reads the zone, asks for a plan, shows it, and only then
// applies the actions through the Cloudflare DNS API (logging each one for rollback).
//
// Safety rules:
//  - Protected (primary business) domains get no actions at all.
//  - Only the apex SPF TXT, apex MX, <selector>._domainkey and _dmarc names are considered.
//  - An existing record the platform did not create is never overwritten or deleted;
//    a mismatch becomes a "conflict" for a human to resolve. SPF is the one exception:
//    missing includes are merged into the existing record, keeping every other mechanism.

const norm = (name) => String(name || "").toLowerCase().replace(/\.$/, "");
const unquote = (value) => String(value || "").replace(/^"|"$/g, "").replace(/"\s*"/g, "");

export function parseSpf(content) {
  const text = unquote(content).trim();
  if (!/^v=spf1(\s|$)/i.test(text)) return null;
  const terms = text.split(/\s+/).slice(1);
  const allIndex = terms.findIndex((term) => /^[+?~-]?all$/i.test(term) || /^redirect=/i.test(term));
  return { terms, allTerm: allIndex >= 0 ? terms[allIndex] : null };
}

/** DNS-querying mechanisms count towards SPF's limit of 10 lookups (RFC 7208 §4.6.4). */
export function spfLookupCount(content) {
  const spf = parseSpf(content);
  if (!spf) return 0;
  return spf.terms.filter((term) => /^[+?~-]?(include:|a(:|\/|$)|mx(:|\/|$)|ptr|exists:)/i.test(term) || /^redirect=/i.test(term)).length;
}

export function mergeSpf(existing, includes, defaultAll = "~all") {
  const wanted = includes.map((value) => `include:${value.replace(/^include:/i, "")}`);
  if (!existing) return `v=spf1 ${wanted.join(" ")} ${defaultAll}`.replace(/\s+/g, " ").trim();
  const spf = parseSpf(existing);
  const have = new Set(spf.terms.map((term) => term.toLowerCase().replace(/^\+/, "")));
  const missing = wanted.filter((term) => !have.has(term.toLowerCase()));
  if (!missing.length) return unquote(existing).trim();
  const body = spf.terms.filter((term) => term !== spf.allTerm);
  return ["v=spf1", ...body, ...missing, spf.allTerm || defaultAll].join(" ");
}

export function dmarcValue({ policy = "none", rua, pct = 100, aspf = "r", adkim = "r" } = {}) {
  const parts = ["v=DMARC1", `p=${policy}`];
  if (rua) parts.push(`rua=mailto:${rua}`);
  if (policy !== "none" && pct !== 100) parts.push(`pct=${pct}`);
  parts.push(`aspf=${aspf}`, `adkim=${adkim}`);
  return parts.join("; ");
}

/**
 * @param {object} p
 * @param {string} p.domain
 * @param {boolean} [p.protected]
 * @param {Array<{id:string,type:string,name:string,content:string,priority?:number}>} p.existing  records in the zone
 * @param {Set<string>|string[]} [p.managedRecordIds]  ids this platform created earlier
 * @param {{ mx?: Array<{host:string,priority:number}>, spfIncludes?: string[], dkim?: Array<{selector:string,type:"TXT"|"CNAME",value:string}>, dmarc?: {policy?:string, rua?:string} }} p.desired
 */
export function planDomainDns({ domain, protected: isProtected = false, existing = [], managedRecordIds = [], desired = {} }) {
  const apex = norm(domain);
  const managed = new Set(managedRecordIds);
  const actions = []; const conflicts = []; const warnings = []; const ok = [];
  if (isProtected) return { actions, conflicts, warnings: [`${apex} is marked as a protected business domain, so no DNS changes are planned.`], ok };
  const at = (name, type) => existing.filter((record) => norm(record.name) === norm(name) && record.type.toUpperCase() === type);

  // MX
  if (desired.mx?.length) {
    const current = at(apex, "MX");
    const want = desired.mx.map((mx) => ({ host: norm(mx.host), priority: mx.priority }));
    if (!current.length) for (const mx of want) actions.push({ op: "create", type: "MX", name: apex, content: mx.host, priority: mx.priority, reason: "Mail delivery for the mailboxes." });
    else {
      const matches = want.every((mx) => current.some((record) => norm(record.content) === mx.host));
      const foreign = current.filter((record) => !want.some((mx) => mx.host === norm(record.content)));
      if (matches && !foreign.length) ok.push("MX");
      else if (foreign.every((record) => managed.has(record.id))) {
        for (const record of foreign) actions.push({ op: "delete", type: "MX", name: apex, recordId: record.id, before: record, reason: "Replace an MX record this platform created earlier." });
        for (const mx of want.filter((mx) => !current.some((record) => norm(record.content) === mx.host))) actions.push({ op: "create", type: "MX", name: apex, content: mx.host, priority: mx.priority, reason: "Mail delivery for the mailboxes." });
      } else conflicts.push({ type: "MX", name: apex, found: foreign.map((record) => record.content), expected: want.map((mx) => mx.host), message: "This domain already receives mail somewhere else. It won't be changed automatically — use a fresh sending domain, or confirm the switch." });
    }
  }

  // SPF
  if (desired.spfIncludes?.length) {
    const spfRecords = at(apex, "TXT").filter((record) => parseSpf(record.content));
    if (spfRecords.length > 1) conflicts.push({ type: "TXT", name: apex, found: spfRecords.map((record) => record.content), message: "The domain has more than one SPF record, which makes SPF fail. Merge them into one first." });
    else {
      const current = spfRecords[0];
      const merged = mergeSpf(current?.content, desired.spfIncludes);
      if (!current) actions.push({ op: "create", type: "TXT", name: apex, content: merged, reason: "SPF authorises the mail provider to send for this domain." });
      else if (merged !== unquote(current.content).trim()) actions.push({ op: "update", type: "TXT", name: apex, recordId: current.id, before: current, content: merged, reason: "Add the mail provider to the existing SPF record, keeping everything already in it." });
      else ok.push("SPF");
      if (spfLookupCount(merged) > 10) warnings.push(`SPF would need ${spfLookupCount(merged)} DNS lookups; the limit is 10, so receivers may treat it as failing.`);
    }
  }

  // DKIM
  for (const key of desired.dkim || []) {
    const name = `${key.selector}._domainkey.${apex}`;
    const type = key.type.toUpperCase();
    const current = [...at(name, "TXT"), ...at(name, "CNAME")];
    const same = current.find((record) => record.type.toUpperCase() === type && norm(unquote(record.content)) === norm(key.value));
    if (same && current.length === 1) { ok.push(`DKIM ${key.selector}`); continue; }
    if (!current.length) { actions.push({ op: "create", type, name, content: key.value, reason: "DKIM signs outgoing mail so receivers can verify it." }); continue; }
    if (current.every((record) => managed.has(record.id))) {
      for (const record of current) actions.push({ op: "delete", type: record.type, name, recordId: record.id, before: record, reason: "Replace an outdated DKIM key this platform created." });
      actions.push({ op: "create", type, name, content: key.value, reason: "DKIM signs outgoing mail so receivers can verify it." });
    } else conflicts.push({ type, name, found: current.map((record) => record.content), expected: [key.value], message: `A different DKIM key already exists for selector "${key.selector}". It won't be overwritten.` });
  }

  // DMARC
  if (desired.dmarc) {
    const name = `_dmarc.${apex}`;
    const current = at(name, "TXT");
    const value = dmarcValue(desired.dmarc);
    if (!current.length) actions.push({ op: "create", type: "TXT", name, content: value, reason: "DMARC tells receivers how to treat unauthenticated mail and sends you reports." });
    else if (current.length > 1) conflicts.push({ type: "TXT", name, found: current.map((record) => record.content), message: "More than one DMARC record exists, so receivers ignore both." });
    else if (unquote(current[0].content).trim() === value) ok.push("DMARC");
    else if (managed.has(current[0].id)) actions.push({ op: "update", type: "TXT", name, recordId: current[0].id, before: current[0], content: value, reason: "Update the DMARC record this platform manages." });
    else conflicts.push({ type: "TXT", name, found: [current[0].content], expected: [value], message: "A DMARC record you set up already exists. It is kept as it is." });
  }
  return { actions, conflicts, warnings, ok };
}

/**
 * DMARC may only tighten after legitimate senders are verified from aggregate reports.
 * @param {"none"|"quarantine"|"reject"} current
 * @param {"none"|"quarantine"|"reject"} target
 * @param {{ reportDays:number, messagesSeen:number, legitimateUnalignedSources:number }} evidence
 */
export function canTightenDmarc(current, target, evidence, { minDays = 14, minMessages = 100 } = {}) {
  const order = { none: 0, quarantine: 1, reject: 2 };
  if (order[target] <= order[current]) return { allowed: true, reason: "Loosening or keeping the policy is always allowed." };
  if (order[target] - order[current] > 1) return { allowed: false, reason: "Move one step at a time: none → quarantine → reject." };
  if (!evidence || evidence.reportDays < minDays) return { allowed: false, reason: `Need at least ${minDays} days of DMARC aggregate reports first.` };
  if (evidence.messagesSeen < minMessages) return { allowed: false, reason: `Reports cover only ${evidence.messagesSeen} messages; need ${minMessages}.` };
  if (evidence.legitimateUnalignedSources > 0) return { allowed: false, reason: `${evidence.legitimateUnalignedSources} legitimate sending source(s) still fail alignment. Fix them first.` };
  return { allowed: true, reason: "All legitimate sources pass alignment in the reports." };
}
