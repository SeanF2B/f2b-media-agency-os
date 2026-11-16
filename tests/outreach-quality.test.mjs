import test from "node:test";
import assert from "node:assert/strict";
import { fingerprint, similarity, lintEmail, chooseFreshest, renderCandidates, serialiseFingerprint, parseFingerprint } from "../lib/outreach/copy-engine.mjs";
import { evaluateAuth, campaignAuthGate, adaptiveBand, dohAnswers } from "../lib/outreach/deliverability.mjs";
import { gmailPlacement, summarisePlacement, findPlacement, seedAuthorizeUrl, newPlacementToken } from "../lib/outreach/placement.mjs";
import { monthlyCosts } from "../lib/outreach/costs.mjs";

const json = (status, body) => new Response(JSON.stringify(body), { status });

// ---------- copy engine ----------
test("similar emails score high, different ones low; fingerprints round-trip", () => {
  const a = fingerprint("Hi Pat, we help roofers in Galway get more quote requests from Google every month.");
  const b = fingerprint("Hi Mary, we help roofers in Galway get more quote requests from Google every month.");
  const c = fingerprint("Saw your new extension project on Facebook — looked great. Are you taking on work in Salthill?");
  assert.ok(similarity(a, b) > 0.6);
  assert.ok(similarity(a, c) < 0.1);
  assert.equal(similarity(parseFingerprint(serialiseFingerprint(a)), a), 1);
});

test("lint blocks unfilled fields and flags clichés, spam phrases, links and shouting", () => {
  assert.equal(lintEmail({ subject: "Roofs", body: "Hi {{first_name}}" }).ok, false);
  const result = lintEmail({ subject: "Quick idea", body: "I hope this email finds you well. Guaranteed results!! FREE audit https://a.ie https://b.ie", step: 0 });
  const codes = result.issues.map((issue) => issue.code);
  for (const code of ["cliche", "spammy", "links", "exclaim", "caps"]) assert.ok(codes.includes(code), code);
  assert.equal(result.ok, true, "warnings don't block");
});

test("the freshest valid candidate wins and repetition is reported", () => {
  const recent = [fingerprint("Hi Pat, we help roofers get more quote requests every month from Google search.")];
  const candidates = [
    { variantId: "A", seed: "1", subject: "Roof leads", body: "Hi Pat, we help roofers get more quote requests every month from Google search." },
    { variantId: "B", seed: "2", subject: "Salthill jobs", body: "Hi Pat, noticed you cover Salthill. Are you taking on new roofing work before Christmas?" },
    { variantId: "C", seed: "3", subject: "x", body: "Hi {{first_name}}" },
  ];
  const { chosen, repetitive } = chooseFreshest(candidates, recent);
  assert.equal(chosen.variantId, "B");
  assert.equal(repetitive, false);
  assert.equal(chooseFreshest([candidates[2]], recent).chosen, null);
});

test("candidates mix variants, spintax seeds and openers; missing data blocks", () => {
  const variants = [{ id: "A", subject: "{Quick|Small} idea for {{company|you}}", body: "{{opener}}\n\nWe {help|work with} roofers." }];
  const out = renderCandidates({ variants, variables: { first_name: "Pat", company: "Pro Roofers" }, openers: ["Loved the Oranmore job.", "Saw your Google reviews."], enrollmentId: "e1", step: 0 });
  assert.equal(out.length, 6);
  assert.ok(new Set(out.map((candidate) => candidate.body)).size > 1);
  const missing = renderCandidates({ variants: [{ id: "A", subject: "Hi", body: "About {{custom_project}}" }], variables: {}, enrollmentId: "e1", step: 0 });
  assert.equal(lintEmail(missing[0]).ok, false);
});

// ---------- deliverability ----------
test("auth evaluation for Microsoft and Google, including duplicate SPF", () => {
  const ms = evaluateAuth({ host: "microsoft", apexTxt: ["v=spf1 include:spf.protection.outlook.com -all"], dmarcTxt: ["v=DMARC1; p=none; rua=mailto:d@x.ie"], mx: ["acme-com.mail.protection.outlook.com."], dkim: { selector1: ["selector1-acme-com._domainkey.acme.onmicrosoft.com."], selector2: ["selector2-acme-com._domainkey.acme.onmicrosoft.com."] } });
  assert.equal(ms.allPass, true);
  const dup = evaluateAuth({ host: "google", apexTxt: ["v=spf1 include:_spf.google.com ~all", "v=spf1 include:_spf.google.com -all"], dmarcTxt: ["v=DMARC1;p=none"], mx: ["1 aspmx.l.google.com."], dkim: { google: ["v=DKIM1; k=rsa; p=MIIB"] } });
  assert.equal(dup.spf, "fail");
  assert.match(dup.details[0], /More than one SPF/);
  assert.equal(evaluateAuth({ host: "google", apexTxt: [], dmarcTxt: [], mx: [], dkim: {} }).dkim, "missing");
  assert.deepEqual(dohAnswers({ Answer: [{ type: 16, data: '"v=spf1 " "-all"' }, { type: 15, data: "10 mx.x.ie." }] }, "TXT"), ["v=spf1 -all"]);
});

test("campaigns can't launch until SPF, DKIM and DMARC pass on every sending domain", () => {
  const now = new Date().toISOString();
  const mailboxes = [{ domain: "a.com" }, { domain: "b.com" }];
  const gate = campaignAuthGate(mailboxes, { "a.com": { spf: "pass", dkim: "pass", dmarc: "pass", checkedAt: now }, "b.com": { spf: "pass", dkim: "missing", dmarc: "pass", checkedAt: now, details: ["DKIM isn't published yet."] } });
  assert.equal(gate.ok, false);
  assert.deepEqual(gate.blocking.map((item) => item.domain), ["b.com"]);
  assert.equal(campaignAuthGate([{ domain: "a.com" }], { "a.com": { spf: "pass", dkim: "pass", dmarc: "pass", checkedAt: "2020-01-01" } }).ok, false, "stale checks block");
});

test("adaptive volume only reacts to real signals", () => {
  assert.equal(adaptiveBand({ healthBand: "green" }).band, "green");
  assert.equal(adaptiveBand({ healthBand: "green", placementInboxRate: 0.5 }).band, "amber");
  assert.equal(adaptiveBand({ healthBand: "green", placementInboxRate: 0.1 }).band, "red");
  assert.equal(adaptiveBand({ healthBand: "green", gmailSpamRate: 0.004 }).band, "red");
  assert.equal(adaptiveBand({ healthBand: "green", authAllPass: false }).band, "red");
  assert.equal(adaptiveBand({ healthBand: "amber", placementInboxRate: 0.9 }).band, "amber", "never improves on the health score");
});

// ---------- placement ----------
test("Gmail labels map to placements and summaries count primary inbox only", () => {
  assert.equal(gmailPlacement(["INBOX", "CATEGORY_PERSONAL"]), "inbox");
  assert.equal(gmailPlacement(["INBOX", "CATEGORY_PROMOTIONS"]), "promotions");
  assert.equal(gmailPlacement(["SPAM"]), "spam");
  const summary = summarisePlacement([{ placement: "inbox" }, { placement: "spam" }, { placement: "promotions" }, { placement: "missing" }]);
  assert.deepEqual([summary.inboxRate, summary.reachedRate, summary.spam], [0.25, 0.5, 1]);
  assert.match(newPlacementToken(), /^F2B-[A-F0-9]{12}$/);
  assert.match(seedAuthorizeUrl("outlook", { clientId: "c", redirectUri: "https://os/cb", state: "s" }), /consumers\/oauth2\/v2\.0\/authorize.*Mail\.Read/);
});

test("seed lookups: Gmail spam and Outlook junk folder", async () => {
  const gmailFetch = async (url) => String(url).includes("/messages?") ? json(200, { messages: [{ id: "m1" }] }) : json(200, { labelIds: ["SPAM"] });
  assert.equal(await findPlacement("gmail", "t", "F2B-X", { fetchImpl: gmailFetch }), "spam");
  const outlookFetch = async (url) => String(url).includes("$search") ? json(200, { value: [{ id: "m", parentFolderId: "J", inferenceClassification: "focused" }] }) : json(200, { id: "J" });
  assert.equal(await findPlacement("outlook", "t", "F2B-X", { fetchImpl: outlookFetch }), "spam");
  assert.equal(await findPlacement("gmail", "t", "F2B-X", { fetchImpl: async () => json(200, {}) }), "missing");
});

// ---------- costs ----------
test("monthly costs use real records and say when something is unpriced", () => {
  const result = monthlyCosts({ mailboxes: [{ monthly_cost_cents: 400, status: "active" }, { monthly_cost_cents: null, status: "active" }], domains: [{ annual_cost_cents: 1117 }, { annual_cost_cents: 1200, protected: 1 }], aiUsage: [{ cost_usd: 0.42, tokens_in: 1000, tokens_out: 500, calls: 12 }], workersPlanCents: 500 });
  assert.equal(result.lines.find((line) => line.key === "domains").cents, 93);
  assert.equal(result.lines.find((line) => line.key === "ai").cents, 42);
  assert.equal(result.totalCents, 400 + 93 + 42 + 500);
  assert.equal(result.complete, false);
});
