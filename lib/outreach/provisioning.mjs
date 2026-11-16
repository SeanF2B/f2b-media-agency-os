// Provisioning orders: domains → DNS → mailboxes → connection → send/receive test → ramp-up.
// Pure planning + step state machine. The cron runs one step at a time per job, so a crash or
// timeout simply resumes from the last finished step. Step keys are stable, which makes every
// step idempotent (a purchase step that already succeeded is never run again).

export const STEP_LABELS = Object.freeze({
  purchase: "Buy domain", zone: "Connect to Cloudflare", "host-domain": "Add domain to mail host", "host-verify": "Verify domain ownership",
  "mail-dns": "MX, SPF & DMARC records", dkim: "DKIM signing", propagation: "DNS propagation check", mailbox: "Create mailbox",
  license: "Assign mailbox licence", connect: "Connect mailbox", test: "Send & receive test", ramp: "Start warm-up",
});
const BACKOFF_MINUTES = [1, 2, 5, 10, 20, 30, 60, 120];
export const MAX_ATTEMPTS = BACKOFF_MINUTES.length;

/**
 * @param {object} order
 * @param {"microsoft"|"google"} order.host
 * @param {Array<{domain:string, buy:boolean}>} order.domains
 * @param {Array<{firstName:string, lastName:string, local:string}>} order.identities  one per inbox per domain
 * @param {number} order.inboxesPerDomain
 */
export function planProvisioning(order) {
  const host = order.host === "google" ? "google" : "microsoft";
  const domains = [...new Map((order.domains || []).map((item) => [String(item.domain).toLowerCase(), { domain: String(item.domain).toLowerCase(), buy: Boolean(item.buy) }])).values()];
  const perDomain = Math.max(1, Math.min(5, Math.floor(order.inboxesPerDomain || 1)));
  const identities = (order.identities || []).slice(0, perDomain);
  if (identities.length < perDomain) throw new Error(`Add ${perDomain} sender identities (one per inbox on each domain).`);
  const steps = []; let position = 0;
  const add = (kind, domain, extra = {}) => steps.push({ key: `${kind}:${extra.email || domain}`, kind, label: STEP_LABELS[kind], domain, position: position++, status: "pending", attempts: 0, manual: false, ...extra });
  for (const { domain, buy } of domains) {
    if (buy) add("purchase", domain, { chargeable: true });
    add("zone", domain);
    add("host-domain", domain);
    add("host-verify", domain);
    add("mail-dns", domain);
    add("dkim", domain, { manual: true, note: host === "microsoft" ? "Microsoft has no API to switch DKIM on: one toggle in the Defender portal, or the bulk script." : "Google has no API for DKIM keys: generate the key in the Admin console (24–72 h after Gmail is enabled)." });
    add("propagation", domain);
    identities.forEach((identity) => {
      const email = `${String(identity.local).toLowerCase().replace(/[^a-z0-9._-]/g, "")}@${domain}`;
      add("mailbox", domain, { email, identity });
      if (host === "microsoft") add("license", domain, { email });
      add("connect", domain, { email });
    });
  }
  // One real send/receive test per domain (first inbox → a second inbox of the order), then ramp.
  const emails = steps.filter((step) => step.kind === "connect").map((step) => step.email);
  for (const domain of domains.map((item) => item.domain)) {
    const from = emails.find((email) => email.endsWith(`@${domain}`));
    const to = emails.find((email) => !email.endsWith(`@${domain}`)) || emails.find((email) => email !== from) || from;
    if (from) add("test", domain, { email: from, to });
  }
  emails.forEach((email) => add("ramp", email.split("@")[1], { email }));
  return { host, steps, domains: domains.length, mailboxes: emails.length };
}

/** Steps whose earlier steps (same domain / same mailbox) are done. DKIM (manual) doesn't block sending. */
export function runnableSteps(steps, now = Date.now()) {
  const doneOrSkipped = (step) => step.status === "done" || step.status === "skipped" || (step.manual && step.status === "waiting");
  return steps.filter((step) => {
    if (!["pending", "retry"].includes(step.status)) return false;
    if (step.nextAttemptAt && new Date(step.nextAttemptAt).getTime() > now) return false;
    const before = steps.filter((other) => other.position < step.position && (other.domain === step.domain || (step.kind === "ramp" && other.kind === "test") || (step.kind === "test" && other.kind === "connect")));
    if (step.kind === "test") return steps.filter((other) => other.kind === "connect" && (other.email === step.email || other.email === step.to)).every(doneOrSkipped) && before.filter((other) => other.domain === step.domain).every(doneOrSkipped);
    if (step.kind === "ramp") return steps.filter((other) => other.kind === "connect" && other.email === step.email).every(doneOrSkipped) && steps.filter((other) => other.kind === "test" && other.domain === step.domain).every((other) => other.status === "done" || other.status === "skipped");
    return before.filter((other) => other.domain === step.domain).every(doneOrSkipped);
  });
}

/** Apply an outcome to a step: done / waiting (manual or slow external) / retry with backoff / failed. */
export function applyOutcome(step, outcome, now = Date.now()) {
  const attempts = step.attempts + 1;
  if (outcome.ok) return { ...step, attempts, status: "done", message: outcome.message || "", result: outcome.result || {}, nextAttemptAt: null };
  if (outcome.waiting) return { ...step, attempts, status: step.manual ? "waiting" : "retry", message: outcome.message || "Waiting…", nextAttemptAt: new Date(now + (outcome.retryInMinutes || 10) * 60_000).toISOString() };
  if (outcome.permanent || attempts >= MAX_ATTEMPTS || step.chargeable) {
    // Chargeable steps are never retried automatically: a timeout might mean it went through.
    return { ...step, attempts, status: "failed", message: outcome.message || "Failed.", nextAttemptAt: null };
  }
  return { ...step, attempts, status: "retry", message: outcome.message || "Retrying…", nextAttemptAt: new Date(now + BACKOFF_MINUTES[Math.min(attempts - 1, BACKOFF_MINUTES.length - 1)] * 60_000).toISOString() };
}

export function jobProgress(steps) {
  const counted = steps.filter((step) => !step.manual);
  const done = counted.filter((step) => step.status === "done" || step.status === "skipped").length;
  const failed = steps.filter((step) => step.status === "failed");
  const waitingManual = steps.filter((step) => step.manual && step.status !== "done");
  return { done, total: counted.length, percent: counted.length ? Math.round((done / counted.length) * 100) : 0, failed: failed.length, waitingManual: waitingManual.length, state: failed.length ? "needs-attention" : done === counted.length ? (waitingManual.length ? "ready-dkim-pending" : "complete") : "running" };
}

/** Upfront and recurring costs shown before approval. Prices in cents. */
export function estimateCosts({ domains, mailboxCount, mailboxMonthlyCents }) {
  const buying = domains.filter((domain) => domain.buy);
  const firstYearDomains = buying.reduce((sum, domain) => sum + (domain.registrationCents || 0), 0);
  const renewalYear = buying.reduce((sum, domain) => sum + (domain.renewalCents || 0), 0);
  const monthlyMailboxes = mailboxCount * (mailboxMonthlyCents || 0);
  return { upfrontCents: firstYearDomains, monthlyCents: monthlyMailboxes + Math.round(renewalYear / 12), domainRenewalYearlyCents: renewalYear, mailboxMonthlyCents: monthlyMailboxes, currency: buying[0]?.currency || "USD" };
}
