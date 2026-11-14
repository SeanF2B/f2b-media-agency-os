// Free deliverability monitoring: DNS authentication checks over DNS-over-HTTPS, the
// campaign authentication gate, and adaptive volume from genuine signals only.

export const HOST_EXPECTATIONS = Object.freeze({
  microsoft: { spfInclude: "spf.protection.outlook.com", mx: /\.mail\.protection\.outlook\.com\.?$/i, dkimSelectors: ["selector1", "selector2"] },
  google: { spfInclude: "_spf.google.com", mx: /(^|\.)(smtp\.google\.com|aspmx\.l\.google\.com|googlemail\.com)\.?$/i, dkimSelectors: ["google"] },
  smtp: { spfInclude: "", mx: /./, dkimSelectors: [] },
});

/** Parse a DNS-over-HTTPS JSON answer (dns.google / cloudflare-dns) into record strings. */
export function dohAnswers(json, type) {
  const code = { TXT: 16, MX: 15, CNAME: 5 }[type];
  return (json?.Answer || []).filter((answer) => answer.type === code).map((answer) => String(answer.data || "").replace(/^"|"$/g, "").replace(/"\s*"/g, "").replace(/^\d+\s+/, type === "MX" ? "" : "$&"));
}

/**
 * @param {{host:"microsoft"|"google"|"smtp", apexTxt:string[], dmarcTxt:string[], mx:string[], dkim:Record<string,string[]>, customDkimSelector?:string}} p
 */
export function evaluateAuth({ host = "microsoft", apexTxt = [], dmarcTxt = [], mx = [], dkim = {}, customDkimSelector = "" }) {
  const expect = HOST_EXPECTATIONS[host] || HOST_EXPECTATIONS.smtp;
  const spfRecords = apexTxt.filter((value) => /^v=spf1(\s|$)/i.test(value));
  const spf = spfRecords.length === 0 ? "missing" : spfRecords.length > 1 ? "fail" : !expect.spfInclude || spfRecords[0].toLowerCase().includes(`include:${expect.spfInclude}`) ? "pass" : "fail";
  const dmarcRecords = dmarcTxt.filter((value) => /^v=DMARC1/i.test(value));
  const dmarc = dmarcRecords.length === 0 ? "missing" : dmarcRecords.length > 1 || !/;\s*p=(none|quarantine|reject)/i.test(dmarcRecords[0]) ? "fail" : "pass";
  const mxOk = mx.length > 0 && mx.every((value) => expect.mx.test(value.replace(/^\d+\s+/, "")));
  const selectors = customDkimSelector ? [customDkimSelector] : expect.dkimSelectors;
  const dkimFound = selectors.filter((selector) => (dkim[selector] || []).some((value) => /p=|domainkey|dkim/i.test(value)));
  const dkimState = !selectors.length ? "pass" : dkimFound.length === selectors.length ? "pass" : dkimFound.length ? "fail" : "missing";
  const details = [];
  if (spf === "missing") details.push("No SPF record.");
  if (spf === "fail") details.push(spfRecords.length > 1 ? "More than one SPF record — SPF fails until they are merged." : `SPF doesn't include ${expect.spfInclude}.`);
  if (dmarc !== "pass") details.push(dmarc === "missing" ? "No DMARC record." : "DMARC record is invalid or duplicated.");
  if (!mxOk) details.push(mx.length ? "MX doesn't point at the mail host." : "No MX record.");
  if (dkimState !== "pass") details.push(dkimState === "missing" ? "DKIM isn't published yet." : "DKIM is only partly published.");
  return { spf, dkim: dkimState, dmarc, mx: mxOk ? "pass" : mx.length ? "fail" : "missing", details, allPass: spf === "pass" && dkimState === "pass" && dmarc === "pass" && mxOk };
}

/** Campaigns can't be activated until every sending domain passes SPF, DKIM and DMARC. */
export function campaignAuthGate(mailboxes, domainChecks) {
  const blocking = [];
  for (const domain of [...new Set(mailboxes.map((mailbox) => mailbox.domain))]) {
    const check = domainChecks[domain];
    if (!check) { blocking.push({ domain, reason: "Not checked yet." }); continue; }
    const fresh = check.checkedAt && Date.now() - new Date(check.checkedAt).getTime() < 24 * 3_600_000;
    if (!fresh) blocking.push({ domain, reason: "Last check is older than 24 hours — re-checking." });
    else if (!(check.spf === "pass" && check.dkim === "pass" && check.dmarc === "pass")) blocking.push({ domain, reason: check.details?.join(" ") || "Authentication not verified." });
  }
  return { ok: blocking.length === 0, blocking };
}

/**
 * Turn genuine signals into a volume decision for one mailbox. Feeds ramp.dailyAllowance(healthBand).
 * @param {{healthBand:"green"|"amber"|"red"|"grey", placementInboxRate?:number|null, gmailSpamRate?:number|null, authAllPass?:boolean, recentBounceRate?:number|null}} s
 */
export function adaptiveBand(s) {
  const reasons = [];
  let band = s.healthBand || "grey";
  const worsen = (to, reason) => { const order = { green: 0, grey: 1, amber: 2, red: 3 }; if (order[to] > order[band]) band = to; reasons.push(reason); };
  if (s.authAllPass === false) worsen("red", "Authentication failing — sending paused until DNS is fixed.");
  if (typeof s.gmailSpamRate === "number") { if (s.gmailSpamRate >= 0.003) worsen("red", `Gmail spam rate ${(s.gmailSpamRate * 100).toFixed(2)}% (Postmaster).`); else if (s.gmailSpamRate >= 0.001) worsen("amber", `Gmail spam rate ${(s.gmailSpamRate * 100).toFixed(2)}% — volume halved.`); }
  if (typeof s.placementInboxRate === "number") { if (s.placementInboxRate < 0.25) worsen("red", `Only ${Math.round(s.placementInboxRate * 100)}% reached the inbox in the last placement test.`); else if (s.placementInboxRate < 0.6) worsen("amber", `${Math.round(s.placementInboxRate * 100)}% inbox placement — volume halved.`); }
  if (typeof s.recentBounceRate === "number" && s.recentBounceRate >= 0.03) worsen("red", `Bounce rate ${(s.recentBounceRate * 100).toFixed(1)}%.`);
  return { band, reasons };
}
