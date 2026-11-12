import test from "node:test";
import assert from "node:assert/strict";
import { createMarketingQuoteSnapshot, stampMarketingPublicationVersion } from "../lib/marketing-quote-snapshot.js";

test("calculator quote snapshot stores calculator and pricing-rule versions with the full server total", () => {
  const snapshot = createMarketingQuoteSnapshot({
    quote: { lineItems: [{ fieldId: "area", amount: 250 }], subtotal: 250, tax: 50, discount: 0, total: 300 },
    calculatorVersion: 7,
    currency: "EUR",
    pricingRuleVersion: "0123456789abcdef",
  });
  assert.deepEqual(snapshot, {
    lineItems: [{ fieldId: "area", amount: 250 }], subtotal: 250, tax: 50, discount: 0, total: 300,
    calculatorVersion: 7, currency: "EUR", pricingRuleVersion: "0123456789abcdef",
  });
});

test("calculator quote snapshot safely defaults malformed metadata", () => {
  const snapshot = createMarketingQuoteSnapshot({ quote: { total: 0 }, calculatorVersion: "invalid", currency: "not-a-currency", pricingRuleVersion: "unsafe" });
  assert.equal(snapshot.calculatorVersion, 1);
  assert.equal(snapshot.currency, "EUR");
  assert.equal(snapshot.pricingRuleVersion, "");
});

test("published data snapshots the version that produced future calculator estimates", () => {
  const published = JSON.parse(stampMarketingPublicationVersion(JSON.stringify({ fields: [{ id: "area" }], currency: "EUR" }), 12));
  assert.equal(published._marketingPublicationVersion, 12);
  assert.deepEqual(published.fields, [{ id: "area" }]);
  assert.throws(() => stampMarketingPublicationVersion("[]", 12), /must be an object/);
  assert.throws(() => stampMarketingPublicationVersion("{}", 0), /positive integer/);
});
