import test from "node:test";
import assert from "node:assert/strict";
import { summarizeGoogleAdsConnectedAccounts } from "../lib/google-ads-accounts.ts";

test("Google Ads account mapping normalizes, de-duplicates and sorts Windsor accounts", () => {
  const accounts = summarizeGoogleAdsConnectedAccounts([
    { account_id: "customers/123-456-7890", account_name: "North" },
    { account_id: "1234567890", account_name: "Duplicate" },
    { customer_id: "9876543210", customer_name: "Alpha" },
    { account_id: "not-an-id", account_name: "Ignore" },
    { account_id: "12345", account_name: "Too short" },
  ]);
  assert.deepEqual(accounts, [
    { id: "9876543210", name: "Alpha" },
    { id: "1234567890", name: "North" },
  ]);
});
