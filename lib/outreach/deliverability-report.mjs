// Deliverability & spam report — pure logic. Every number comes from real data the caller passes in
// (DNS answers, our own send/reply records, seed placement tests, Postmaster when connected).
// Nothing is estimated: a check that couldn't run says so instead of guessing.

/** Free domain blocklists that answer over DNS. `refused` codes mean the list refused a public resolver. */
export const DOMAIN_BLOCKLISTS = [
  { id: "spamhaus-dbl", name: "Spamhaus DBL", zone: "dbl.spamhaus.org", listed: (ip) => /^127\.0\.1\.\d+$/.test(ip), refused: (ip) => /^127\.255\.255\.\d+$/.test(ip) },
  { id: "surbl", name: "SURBL", zone: "multi.surbl.org", listed: (ip) => /^127\.0\.0\.(?!1$)\d+$/.test(ip), refused: (ip) => ip === "127.0.0.1" },
  { id: "uribl", name: "URIBL", zone: "multi.uribl.com", listed: (ip) => /^127\.0\.0\.(2|4|8|14)$/.test(ip), refused: (ip) => ip === "127.0.0.1" || ip === "127.0.0.255" },
];

/** Result of one blocklist lookup from its A-record answers (empty / NXDOMAIN = not listed). */
export function interpretBlocklist(list, answers, error) {
  if (error) return { id: list.id, name: list.name, state: "unknown", note: "Lookup failed — try again later." };
  const ips = (answers || []).map((value) => String(value).trim());
  if (ips.some((ip) => list.refused(ip))) return { id: list.id, name: list.name, state: "unknown", note: "This list doesn't answer public DNS lookups, so it couldn't be checked from here." };
  if (ips.some((ip) => list.listed(ip))) return { id: list.id, name: list.name, state: "listed", note: `Listed (${ips.join(", ")}). Mail containing this domain is likely to be filtered.` };
  return { id: list.id, name: list.name, state: "clear", note: "Not listed." };
}

const rate = (part, whole) => (whole > 0 ? part / whole : null);
const pct = (value) => (value === null || value === undefined ? "—" : `${(value * 100).toFixed(value < 0.01 && value > 0 ? 2 : 1)}%`);

// Thresholds used by inbox providers' published sender guidelines (Gmail/Yahoo 2024: keep spam
// complaints under 0.3%, ideally under 0.1%) and common practice for bounces (under 2%).
export const LIMITS = { bounceWarn: 0.02, bounceBad: 0.05, complaintWarn: 0.001, complaintBad: 0.003, unsubWarn: 0.02, placementWarn: 0.8, placementBad: 0.5 };

/**
 * Build the report.
 * input: { mailbox: {email, status, band, limitToday, rampDay, pausedReason}, auth: {spf,dkim,dmarc,mx,details,checkedAt,dmarcPolicy?},
 *          blocklists: [interpretBlocklist results], stats: {days, sent, bounced, complaints, unsubscribes, replies, positive},
 *          placement: [{completedAt, inboxRate, results:[{provider, placement}]}], postmaster: {spamRate?, domainReputation?} | null, adaptive: [reasons] }
 */
export function buildDeliverabilityReport(input) {
  const { mailbox = {}, auth = {}, blocklists = [], stats = {}, placement = [], postmaster = null, adaptive = [], externalWarmup = null } = input;
  const actions = [];
  const findings = [];
  let level = 0; // 0 good, 1 watch, 2 act
  const raise = (to) => { level = Math.max(level, to); };

  // Authentication
  const authItems = ["spf", "dkim", "dmarc", "mx"].map((key) => ({ key, label: key.toUpperCase(), state: auth[key] || "unknown" }));
  if (!auth.checkedAt) { raise(1); findings.push({ tone: "warn", text: "Authentication hasn't been checked yet." }); actions.push("Run a DNS check from the Domains tab."); }
  else if (authItems.some((item) => item.state !== "pass")) {
    raise(2);
    findings.push({ tone: "bad", text: `Authentication failing: ${(auth.details || []).join(" ") || authItems.filter((item) => item.state !== "pass").map((item) => item.label).join(", ")}` });
    actions.push("Click the flame (or Fix DNS on the domain) so Outreach repairs the records; DKIM may need switching on in your mail admin.");
  }
  if (auth.dmarcPolicy === "none") findings.push({ tone: "info", text: "DMARC is in monitoring mode (p=none). Fine while warming; tighten to quarantine once reports are clean." });

  // Blocklists
  const listed = blocklists.filter((item) => item.state === "listed");
  if (listed.length) { raise(2); findings.push({ tone: "bad", text: `Domain is on ${listed.map((item) => item.name).join(", ")}.` }); actions.push("Pause sending from this domain and request delisting from each list (links in the list's website); check for compromised content or purchased lists."); }

  // Sending signals
  const sent = Number(stats.sent || 0);
  const bounceRate = rate(Number(stats.bounced || 0), sent);
  const complaintRate = rate(Number(stats.complaints || 0), sent);
  const unsubRate = rate(Number(stats.unsubscribes || 0), sent);
  const replyRate = rate(Number(stats.replies || 0), sent);
  const positiveRate = rate(Number(stats.positive || 0), sent);
  if (sent < 20) findings.push({ tone: "info", text: `Only ${sent} emails sent in the last ${stats.days || 30} days — rates become meaningful after about 50.` });
  if (bounceRate !== null && sent >= 20) {
    if (bounceRate >= LIMITS.bounceBad) { raise(2); findings.push({ tone: "bad", text: `Bounce rate ${pct(bounceRate)} — far above the 2% safe line.` }); actions.push("Verify the lead list before importing more; remove role and catch-all addresses."); }
    else if (bounceRate >= LIMITS.bounceWarn) { raise(1); findings.push({ tone: "warn", text: `Bounce rate ${pct(bounceRate)} — keep it under 2%.` }); actions.push("Clean the next list before importing."); }
  }
  if (complaintRate !== null && sent >= 20) {
    if (complaintRate >= LIMITS.complaintBad) { raise(2); findings.push({ tone: "bad", text: `Spam complaints ${pct(complaintRate)} — above Gmail's 0.3% limit.` }); actions.push("Narrow targeting and make the first email more relevant; slow the ramp."); }
    else if (complaintRate >= LIMITS.complaintWarn) { raise(1); findings.push({ tone: "warn", text: `Spam complaints ${pct(complaintRate)} — aim for under 0.1%.` }); }
  }
  if (unsubRate !== null && sent >= 50 && unsubRate >= LIMITS.unsubWarn) { raise(1); findings.push({ tone: "warn", text: `Unsubscribes ${pct(unsubRate)} — the offer may not fit this list.` }); }
  if (postmaster?.spamRate !== undefined && postmaster.spamRate !== null && postmaster.spamRate >= LIMITS.complaintBad) { raise(2); findings.push({ tone: "bad", text: `Google Postmaster spam rate ${pct(postmaster.spamRate)}.` }); }

  // Placement (free seed tests)
  const latest = placement[0] || null;
  if (!latest) { raise(Math.max(level, 0)); findings.push({ tone: "info", text: "No inbox placement test yet." }); actions.push("Connect a free Gmail and Outlook.com test inbox under Placement and run a test."); }
  else if (latest.inboxRate !== null && latest.inboxRate !== undefined) {
    if (latest.inboxRate < LIMITS.placementBad) { raise(2); findings.push({ tone: "bad", text: `Only ${pct(latest.inboxRate)} of test emails reached the inbox.` }); actions.push("Lower the daily target, remove links/images from step 1, and re-test in a few days."); }
    else if (latest.inboxRate < LIMITS.placementWarn) { raise(1); findings.push({ tone: "warn", text: `${pct(latest.inboxRate)} of test emails reached the inbox.` }); }
    else findings.push({ tone: "good", text: `${pct(latest.inboxRate)} of test emails landed in the inbox.` });
  }

  if (externalWarmup) {
    const warm = externalWarmup.stats;
    if (["banned", "suspended"].includes(externalWarmup.warmupState) || ["connection-error", "sending-error"].includes(externalWarmup.accountState)) { raise(2); findings.push({ tone: "bad", text: `${externalWarmup.provider} reports a problem: warm-up ${externalWarmup.warmupState || "unknown"}, account ${externalWarmup.accountState || "unknown"}.` }); actions.push(`Open the mailbox in ${externalWarmup.provider} and reconnect it.`); }
    else if (warm && warm.inboxRate !== null && warm.inboxRate !== undefined && warm.inbox + warm.spam >= 20) {
      if (warm.inboxRate < LIMITS.placementBad) { raise(2); findings.push({ tone: "bad", text: `Warm-up emails reach the inbox only ${pct(warm.inboxRate)} of the time.` }); }
      else if (warm.inboxRate < LIMITS.placementWarn) { raise(1); findings.push({ tone: "warn", text: `Warm-up emails reach the inbox ${pct(warm.inboxRate)} of the time — keep warming before scaling.` }); }
      else findings.push({ tone: "good", text: `Warm-up emails reach the inbox ${pct(warm.inboxRate)} of the time.` });
    }
  }
  if (mailbox.status === "paused" && mailbox.pausedReason) { raise(2); findings.push({ tone: "bad", text: `Sending is paused: ${mailbox.pausedReason}` }); }
  for (const reason of adaptive || []) findings.push({ tone: "warn", text: reason });

  const verdict = level === 2 ? "act" : level === 1 ? "watch" : "good";
  const headline = verdict === "good" ? "Healthy — keep going." : verdict === "watch" ? "Mostly fine — a few things to watch." : "Action needed before sending more.";
  return {
    verdict, headline,
    auth: authItems, blocklists,
    rates: [
      { key: "sent", label: `Sent (${stats.days || 30} days)`, value: String(sent) },
      { key: "bounce", label: "Bounce rate", value: pct(bounceRate), tone: bounceRate === null || sent < 20 ? "" : bounceRate >= LIMITS.bounceBad ? "bad" : bounceRate >= LIMITS.bounceWarn ? "warn" : "good" },
      { key: "complaints", label: "Spam complaints", value: pct(complaintRate), tone: complaintRate === null || sent < 20 ? "" : complaintRate >= LIMITS.complaintBad ? "bad" : complaintRate >= LIMITS.complaintWarn ? "warn" : "good" },
      { key: "unsub", label: "Unsubscribes", value: pct(unsubRate) },
      { key: "reply", label: "Reply rate", value: pct(replyRate) },
      { key: "positive", label: "Positive replies", value: pct(positiveRate) },
    ],
    placement: latest ? { completedAt: latest.completedAt, inboxRate: latest.inboxRate, results: latest.results || [] } : null,
    throttle: { band: mailbox.band || "unknown", limitToday: mailbox.limitToday ?? null, rampDay: mailbox.rampDay ?? null },
    externalWarmup: externalWarmup ? { provider: externalWarmup.provider, day: externalWarmup.day, days: externalWarmup.days, ready: externalWarmup.ready, paused: externalWarmup.paused, stats: externalWarmup.stats || null } : null,
    findings, actions: [...new Set(actions)],
  };
}
