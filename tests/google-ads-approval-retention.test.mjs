import assert from "node:assert/strict";
import test from "node:test";
import { canDecideGoogleAdsApproval, GOOGLE_ADS_APPROVAL_NEVER_EXPIRES_AT } from "../lib/google-ads-approval-retention.ts";

test("a pending Google Ads approval remains actionable after its legacy expiry timestamp", () => {
  const oldExpiry = "2026-10-23T16:09:56.980Z";
  assert.ok(Date.parse(oldExpiry) < Date.now());
  assert.equal(canDecideGoogleAdsApproval("pending"), true);
});

test("only a pending Google Ads approval can be decided", () => {
  for (const status of ["applying", "applied", "rejected", "cancelled", "expired"]) {
    assert.equal(canDecideGoogleAdsApproval(status), false, status);
  }
});

test("new approvals use the non-expiring compatibility value required by the existing D1 schema", () => {
  assert.equal(GOOGLE_ADS_APPROVAL_NEVER_EXPIRES_AT, "9999-12-31T23:59:59.999Z");
});
