import test from "node:test";
import assert from "node:assert/strict";
import { DOMAIN_BLOCKLISTS, interpretBlocklist, buildDeliverabilityReport } from "../lib/outreach/deliverability-report.mjs";

const list = (id) => DOMAIN_BLOCKLISTS.find((item) => item.id === id);
const passAuth = { spf: "pass", dkim: "pass", dmarc: "pass", mx: "pass", details: [], checkedAt: "2026-11-16T00:00:00Z" };

test("blocklist answers: listed, clear, refused and failed lookups", () => {
  assert.equal(interpretBlocklist(list("spamhaus-dbl"), ["127.0.1.2"]).state, "listed");
  assert.equal(interpretBlocklist(list("spamhaus-dbl"), []).state, "clear");
  assert.equal(interpretBlocklist(list("spamhaus-dbl"), ["127.255.255.254"]).state, "unknown", "public-resolver refusal is never reported as clean");
  assert.equal(interpretBlocklist(list("surbl"), ["127.0.0.1"]).state, "unknown");
  assert.equal(interpretBlocklist(list("surbl"), ["127.0.0.8"]).state, "listed");
  assert.equal(interpretBlocklist(list("uribl"), null, new Error("timeout")).state, "unknown");
});

test("healthy mailbox with a good placement test is 'good'", () => {
  const report = buildDeliverabilityReport({ auth: passAuth, blocklists: [{ id: "x", name: "X", state: "clear" }], stats: { days: 30, sent: 400, bounced: 3, complaints: 0, unsubscribes: 2, replies: 20, positive: 6 }, placement: [{ completedAt: "2026-11-15", inboxRate: 0.92, results: [] }] });
  assert.equal(report.verdict, "good");
  assert.equal(report.rates.find((rate) => rate.key === "bounce").tone, "good");
  assert.equal(report.rates.find((rate) => rate.key === "reply").value, "5.0%");
});

test("high bounces, spam complaints, a listing or failing auth demand action", () => {
  const base = { auth: passAuth, placement: [{ inboxRate: 0.9, results: [] }] };
  assert.equal(buildDeliverabilityReport({ ...base, stats: { sent: 200, bounced: 14 } }).verdict, "act");
  assert.equal(buildDeliverabilityReport({ ...base, stats: { sent: 1000, complaints: 4 } }).verdict, "act");
  assert.equal(buildDeliverabilityReport({ ...base, stats: { sent: 1000, complaints: 2 } }).verdict, "watch");
  assert.equal(buildDeliverabilityReport({ ...base, stats: { sent: 100 }, blocklists: [{ id: "d", name: "Spamhaus DBL", state: "listed" }] }).verdict, "act");
  const auth = buildDeliverabilityReport({ ...base, auth: { ...passAuth, dkim: "missing", details: ["DKIM isn't published yet."] }, stats: { sent: 0 } });
  assert.equal(auth.verdict, "act"); assert.ok(auth.findings.some((item) => /DKIM/.test(item.text)));
});

test("small samples aren't judged on rates; low placement is", () => {
  const small = buildDeliverabilityReport({ auth: passAuth, stats: { sent: 5, bounced: 2 }, placement: [{ inboxRate: 0.9, results: [] }] });
  assert.equal(small.verdict, "good"); assert.ok(small.findings.some((item) => /Only 5 emails/.test(item.text)));
  assert.equal(buildDeliverabilityReport({ auth: passAuth, stats: { sent: 100 }, placement: [{ inboxRate: 0.4, results: [] }] }).verdict, "act");
  const none = buildDeliverabilityReport({ auth: passAuth, stats: { sent: 100 } });
  assert.ok(none.actions.some((text) => /Placement/.test(text)));
});
