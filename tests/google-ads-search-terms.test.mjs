import test from "node:test";
import assert from "node:assert/strict";
import { googleAdsSearchTermsQuery } from "../lib/google-ads-search-terms.mjs";

test("direct Google Ads search terms honor the selected campaign and report dates", () => {
  const query = googleAdsSearchTermsQuery({ startDate: "2026-10-01", endDate: "2026-10-26", label: "selected" }, "123456");
  assert.match(query, /segments\.date BETWEEN '2026-10-01' AND '2026-10-26'/);
  assert.match(query, /campaign\.id = 123456/);
  assert.match(query, /metrics\.impressions > 0/);
});

test("all-campaign search terms remain unfiltered by campaign", () => {
  const query = googleAdsSearchTermsQuery(undefined, undefined);
  assert.match(query, /segments\.date DURING LAST_30_DAYS/);
  assert.doesNotMatch(query, /campaign\.id =/);
});

test("campaign IDs are validated before they enter the GAQL query", () => {
  assert.throws(() => googleAdsSearchTermsQuery(undefined, "7 OR campaign.id > 0"), /campaign ID is not valid/);
});
