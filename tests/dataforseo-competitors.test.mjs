import test from "node:test";
import assert from "node:assert/strict";
import { competitorDomainIntersectionRequest, normalizePublicDomain, parseCompetitorKeywordIntersection } from "../lib/dataforseo-competitors.ts";

test("competitor inputs normalize to public domains and reject unsafe or non-domain values", () => {
  assert.equal(normalizePublicDomain("https://www.Roofing.ie/services/?x=1"), "roofing.ie");
  assert.equal(normalizePublicDomain("example.co.uk"), "example.co.uk");
  assert.equal(normalizePublicDomain("http://user:pass@example.ie"), null);
  assert.equal(normalizePublicDomain("localhost"), null);
  assert.equal(normalizePublicDomain("127.0.0.1"), null);
  assert.equal(normalizePublicDomain("roofing business in Galway"), null);
});

test("domain intersection asks for organic terms the competitor ranks for without client overlap", () => {
  assert.deepEqual(competitorDomainIntersectionRequest("client.ie", "rival.ie", "Galway, Ireland"), {
    target1: "rival.ie",
    target2: "client.ie",
    location_name: "Galway, Ireland",
    language_name: "English",
    intersections: false,
    item_types: ["organic"],
    limit: 100,
    order_by: ["keyword_data.keyword_info.search_volume,desc"],
  });
});

test("competitor keyword results retain volume, difficulty, rank, URL, and provider cost", () => {
  const parsed = parseCompetitorKeywordIntersection({ tasks: [{ status_code: 20000, cost: 0.02, result: [{ total_count: 2, items: [
    { keyword_data: { keyword: "roof repair galway", keyword_info: { search_volume: 90 }, keyword_properties: { keyword_difficulty: 42 } }, first_domain_serp_element: { organic: { rank_group: 3, url: "https://rival.ie/roof-repair/" } } },
    { keyword_data: { keyword: "roof leak help", keyword_info: { search_volume: 0 } } },
  ] }] }] }, "rival.ie");
  assert.equal(parsed.status, "connected");
  assert.equal(parsed.costUsd, 0.02);
  assert.equal(parsed.totalCount, 2);
  assert.deepEqual(parsed.keywords, [
    { keyword: "roof repair galway", monthlySearches: 90, difficulty: 42, competitorPosition: 3, competitorUrl: "https://rival.ie/roof-repair/" },
    { keyword: "roof leak help", monthlySearches: 0, difficulty: null, competitorPosition: null, competitorUrl: null },
  ]);
});

test("failed provider task stays unavailable and never fabricates cost or keyword data", () => {
  const parsed = parseCompetitorKeywordIntersection({ tasks: [{ status_code: 40501, status_message: "Insufficient balance" }] }, "rival.ie");
  assert.equal(parsed.status, "unavailable");
  assert.equal(parsed.costUsd, null);
  assert.deepEqual(parsed.keywords, []);
  assert.equal(parsed.message, "Insufficient balance");
});
