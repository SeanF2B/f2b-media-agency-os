import test from "node:test";
import assert from "node:assert/strict";
import { addDays, canonicalText, clauses, cleanSignatureImage, defaultData, renderContractBody, sanitizeData, scopeFor, sha256Hex, STANDARD, totals } from "../lib/contracts/core.ts";

const sample = () => sanitizeData({
  title: "Marketing Services Agreement",
  services: [{ name: "Google Ads", monthlyFee: 450, setupFee: 300, notes: "" }, { name: "SEO", monthlyFee: 350, setupFee: 0, notes: "2 advice posts a month" }],
  terms: { startDate: "2026-12-01", currency: "EUR", subscriptionDiscountPct: 5, extraTerms: "" },
  parties: { providerName: "F2B Media", clientName: "Pro Roofers Galway", signerName: "Patrick McDonagh", signerEmail: "PAT@Example.ie", governingLaw: "Ireland" },
}, defaultData("2026-11-20"));

test("standard terms are fixed and cannot be overridden from the browser", () => {
  const d = sanitizeData({ terms: { minimumTermDays: 7, noticeDays: 1, overdueDays: 90, billingDay: 15, startDate: "2026-12-01" } });
  assert.equal(d.terms.minimumTermDays, STANDARD.minimumTermDays);
  assert.equal(d.terms.noticeDays, 30);
  assert.equal(d.terms.overdueDays, 14);
  assert.equal(d.terms.billingDay, 1);
});

test("sanitize cleans emails, discounts, dates and junk services", () => {
  const d = sanitizeData({ services: [{ name: "" }, { name: "SEO", monthlyFee: -5 }, { name: "SEO", monthlyFee: -5 }], terms: { startDate: "nope", subscriptionDiscountPct: 99 }, parties: { signerEmail: "bad", governingLaw: "Mars" } }, defaultData("2026-11-20"));
  assert.equal(d.services.length, 1);
  assert.equal(d.services[0].monthlyFee, 0);
  assert.equal(d.terms.startDate, "2026-11-20");
  assert.equal(d.terms.subscriptionDiscountPct, 50);
  assert.equal(d.parties.signerEmail, "");
  assert.equal(d.parties.governingLaw, "Ireland");
  assert.equal(sample().parties.signerEmail, "pat@example.ie");
});

test("totals include the subscription discount", () => {
  assert.deepEqual(totals(sample()), { monthly: 800, setup: 300, discounted: 760, saving: 40 });
});

test("clauses carry every term Sean asked for", () => {
  const text = canonicalText(sample());
  assert.match(text, /minimum term of 90 days, ending on 28 February 2027/);
  assert.match(text, /at least 30 days' written notice/);
  assert.match(text, /billed in advance on the 1st of every month/);
  assert.match(text, /reduced by 5% \(€800 becomes €760 per month\)/);
  assert.match(text, /unpaid 14 days after its due date, all services will be paused until every overdue invoice is paid in full/);
  assert.match(text, /responsibility to resolve/);
  assert.match(text, /fees are still charged in full during any such downtime/i);
  assert.match(text, /General Data Protection Regulation/);
  assert.match(text, /processor/);
  assert.match(text, /governed by the law of Ireland/);
});

test("scope follows the selected services only", () => {
  const text = canonicalText(sample());
  assert.ok(text.includes(scopeFor("Google Ads").summary));
  assert.ok(text.includes(scopeFor("SEO").summary));
  assert.ok(!text.includes(scopeFor("Meta Ads").summary));
  assert.match(text, /2 advice posts a month/);
  assert.match(scopeFor("Something custom").summary, /Something custom/);
});

test("no discount wording when discount is zero; extra terms appended", () => {
  const d = sanitizeData({ terms: { subscriptionDiscountPct: 0, extraTerms: "Client supplies photos." } }, sample());
  const list = clauses(d);
  assert.ok(!canonicalText(d).includes("Subscription discount"));
  assert.equal(list.at(-2).heading, "Additional terms");
});

test("rendered HTML escapes input and shows signature audit", async () => {
  const d = sanitizeData({ parties: { clientName: "<script>x</script>" } }, sample());
  const img = `data:image/png;base64,${"A".repeat(400)}`;
  const html = renderContractBody(d, { signature: { name: "Pat", image: img, signedAt: "2026-12-01T10:00:00Z", ip: "1.2.3.4", country: "IE", userAgent: "x", hash: await sha256Hex(canonicalText(d)) } });
  assert.ok(!html.includes("<script>x"));
  assert.match(html, /SHA-256/);
  assert.match(html, /1\.2\.3\.4/);
});

test("signature image must be a sensible PNG data URL", () => {
  assert.equal(cleanSignatureImage("javascript:alert(1)"), "");
  assert.equal(cleanSignatureImage("data:image/png;base64,AAAA"), "");
  assert.equal(cleanSignatureImage(`data:image/svg+xml;base64,${"A".repeat(400)}`), "");
  assert.ok(cleanSignatureImage(`data:image/png;base64,${"A".repeat(400)}`));
});

test("hash changes when the terms change", async () => {
  const a = await sha256Hex(canonicalText(sample()));
  const b = await sha256Hex(canonicalText(sanitizeData({ services: [{ name: "SEO", monthlyFee: 351 }] }, sample())));
  assert.notEqual(a, b);
  assert.equal(addDays("2026-12-01", 89), "2027-02-28");
});
