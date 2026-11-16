// Transparent 0–100 deliverability health score for a mailbox or domain.
//
// Rules:
//  - Only measured signals count. A signal that is null/undefined is "not available"
//    and is shown as such — it never scores as good or bad.
//  - The score is the points earned divided by the points available, so missing data
//    shrinks the denominator instead of inventing a value.
//  - If too little is measured the band is grey ("Insufficient data") and no number is shown.
//  - Safety thresholds trigger a pause recommendation (red) regardless of the score.

export const DEFAULT_THRESHOLDS = Object.freeze({
  minSendsForRates: 50,      // bounce/complaint rates are noise below this
  maxBounceRate: 0.03,       // pause above 3% bounces
  warnBounceRate: 0.02,
  maxComplaintRate: 0.003,   // Google's bulk-sender guidance: stay below 0.3%
  warnComplaintRate: 0.001,
  maxSendErrorRate: 0.05,
  minAvailableWeight: 40,    // need at least 40 of 100 weight measured to show a score
  greenFrom: 80,
});

const AUTH_LABEL = { spf: "SPF", dkim: "DKIM", dmarc: "DMARC", mx: "MX" };

function rate(part, whole) { return whole > 0 ? part / whole : 0; }
function pct(value) { return `${(value * 100).toFixed(value < 0.01 ? 2 : 1)}%`; }
const known = (value) => value !== null && value !== undefined;

/**
 * @param {object} input
 * @param {{spf?:string|null,dkim?:string|null,dmarc?:string|null,mx?:string|null}} [input.auth]  "pass" | "fail" | "missing"
 * @param {"ok"|"error"|null} [input.connection]
 * @param {number|null} [input.sent]         emails sent in the window
 * @param {number|null} [input.bounced]      hard bounces in the window
 * @param {number|null} [input.complaints]   spam complaints (null when the provider doesn't report them)
 * @param {number|null} [input.sendErrors]
 * @param {boolean|null} [input.providerRestricted]
 * @param {number|null} [input.inboxPlacementRate]  0–1 from a real placement test
 * @param {boolean|null} [input.blocklisted]
 * @param {Partial<typeof DEFAULT_THRESHOLDS>} [thresholds]
 */
export function scoreHealth(input = {}, thresholds = {}) {
  const t = { ...DEFAULT_THRESHOLDS, ...thresholds };
  const factors = [];
  const pauseReasons = [];
  const attention = []; // problems that cap the band at amber even with a high score
  const add = (key, label, max, points, detail) => factors.push({ key, label, max, points: points === null ? null : Math.max(0, Math.min(max, points)), available: points !== null, detail });

  // Authentication (25)
  const auth = input.auth || {};
  const authKeys = ["spf", "dkim", "dmarc", "mx"].filter((key) => known(auth[key]));
  if (authKeys.length) {
    const passing = authKeys.filter((key) => auth[key] === "pass");
    const failing = authKeys.filter((key) => auth[key] !== "pass").map((key) => AUTH_LABEL[key]);
    // Only checked records count towards the maximum, so an unchecked record can't inflate or sink the score.
    const max = Math.round((25 * authKeys.length) / 4);
    const note = authKeys.length < 4 ? " Some records not yet checked." : "";
    add("auth", "Authentication", max, Math.round((25 * passing.length) / 4), failing.length ? `Not passing: ${failing.join(", ")}.${note}` : authKeys.length < 4 ? `Checked records pass.${note}` : "SPF, DKIM, DMARC and MX all pass.");
    if (failing.length) attention.push(`${failing.join(", ")} not passing.`);
    if (auth.spf === "missing" || auth.dkim === "missing") pauseReasons.push("SPF or DKIM is missing, so mail will fail authentication.");
  } else add("auth", "Authentication", 25, null, "DNS records not checked yet.");

  // Connectivity (15)
  if (known(input.connection)) {
    add("connection", "Mailbox connection", 15, input.connection === "ok" ? 15 : 0, input.connection === "ok" ? "Connected." : "The sending platform reports a connection error.");
    if (input.connection === "error") pauseReasons.push("Mailbox connection error.");
  } else add("connection", "Mailbox connection", 15, null, "Connection status not reported yet.");

  const sent = Number(input.sent) || 0;
  const enoughVolume = known(input.sent) && sent >= t.minSendsForRates;

  // Bounces (20)
  if (enoughVolume && known(input.bounced)) {
    const r = rate(Number(input.bounced), sent);
    const points = r >= t.maxBounceRate ? 0 : r >= t.warnBounceRate ? 10 : 20 - Math.round((r / t.warnBounceRate) * 5);
    add("bounces", "Bounce rate", 20, points, `${pct(r)} of ${sent} sent bounced.`);
    if (r >= t.maxBounceRate) pauseReasons.push(`Bounce rate ${pct(r)} is above the ${pct(t.maxBounceRate)} safety limit.`);
  } else add("bounces", "Bounce rate", 20, null, known(input.sent) ? `Only ${sent} sent — need ${t.minSendsForRates} before the rate means anything.` : "No sending history yet.");

  // Complaints (15)
  if (enoughVolume && known(input.complaints)) {
    const r = rate(Number(input.complaints), sent);
    const points = r >= t.maxComplaintRate ? 0 : r >= t.warnComplaintRate ? 7 : 15;
    add("complaints", "Spam complaints", 15, points, `${pct(r)} complaint rate.`);
    if (r >= t.maxComplaintRate) pauseReasons.push(`Spam complaint rate ${pct(r)} is above ${pct(t.maxComplaintRate)}.`);
  } else add("complaints", "Spam complaints", 15, null, "Complaint data isn't available from the sending platform for this mailbox.");

  // Sending errors (10)
  if (enoughVolume && known(input.sendErrors)) {
    const r = rate(Number(input.sendErrors), sent);
    add("errors", "Sending errors", 10, r >= t.maxSendErrorRate ? 0 : 10 - Math.round((r / t.maxSendErrorRate) * 10), `${pct(r)} of sends failed.`);
    if (r >= t.maxSendErrorRate) pauseReasons.push(`Sending error rate ${pct(r)} is too high.`);
  } else add("errors", "Sending errors", 10, null, "Not enough sends to measure errors.");

  // Provider restrictions / blocklists (10)
  if (known(input.providerRestricted) || known(input.blocklisted)) {
    const bad = input.providerRestricted === true || input.blocklisted === true;
    add("reputation", "Restrictions & blocklists", 10, bad ? 0 : 10, input.providerRestricted ? "The mail provider has restricted this mailbox." : input.blocklisted ? "Listed on a checked blocklist." : "No restrictions or listings found.");
    if (input.providerRestricted === true) pauseReasons.push("Mail provider restriction.");
  } else add("reputation", "Restrictions & blocklists", 10, null, "Not checked yet.");

  // Inbox placement (5) — only from a real placement test
  if (known(input.inboxPlacementRate)) {
    const r = Math.max(0, Math.min(1, Number(input.inboxPlacementRate)));
    add("placement", "Inbox placement test", 5, Math.round(r * 5), `${pct(r)} landed in the inbox in the last test.`);
  } else add("placement", "Inbox placement test", 5, null, "No placement test run.");

  const availableWeight = factors.filter((factor) => factor.available).reduce((sum, factor) => sum + factor.max, 0);
  const earned = factors.filter((factor) => factor.available).reduce((sum, factor) => sum + factor.points, 0);
  const pause = pauseReasons.length > 0;
  const enough = availableWeight >= t.minAvailableWeight;
  const score = enough && availableWeight > 0 ? Math.round((earned / availableWeight) * 100) : null;
  const band = pause ? "red" : score === null ? "grey" : score >= t.greenFrom && !attention.length ? "green" : "amber";
  const label = { green: "Healthy", amber: "Needs attention", red: "Sending paused", grey: "Insufficient data" }[band];
  return { score, band, label, measuredWeight: availableWeight, factors, attention, pause: { required: pause, reasons: pauseReasons } };
}
