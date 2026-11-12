import test from "node:test";
import assert from "node:assert/strict";
import { mergeDataForSeoDifficulty, parseDataForSeoDifficulty, parseDataForSeoIdeas } from "../lib/dataforseo-keywords.ts";
import { parseGoogleMapsLocalRank } from "../lib/dataforseo-local-maps.ts";

test("DataForSEO keyword ideas preserve paid competition and search volume as separate estimates", () => {
  const parsed = parseDataForSeoIdeas({ tasks: [{ status_code: 20000, status_message: "Ok.", cost: 0.0105, result: [{ items: [
    { keyword: "roof repair galway", keyword_info: { search_volume: 90, competition_level: "MEDIUM", low_top_of_page_bid: 0.4, high_top_of_page_bid: 1.2 } },
    { keyword: "roof leak repair", keyword_info: { search_volume: 0, competition_level: null } },
    { keyword: "missing info" },
  ] }] }] });
  assert.equal(parsed.statusCode, 20000);
  assert.equal(parsed.cost, 0.0105);
  assert.deepEqual(parsed.ideas, [
    { keyword: "roof repair galway", avgMonthlySearches: 90, paidCompetition: "MEDIUM", difficulty: null, lowTopOfPageBid: 0.4, highTopOfPageBid: 1.2 },
    { keyword: "roof leak repair", avgMonthlySearches: 0, paidCompetition: null, difficulty: null, lowTopOfPageBid: null, highTopOfPageBid: null },
  ]);
});

test("organic difficulty merges by keyword and remains unavailable when the provider omits it", () => {
  const ideas = parseDataForSeoIdeas({ tasks: [{ status_code: 20000, result: [{ items: [
    { keyword: "roof repair Galway", keyword_info: { search_volume: 90 } },
    { keyword: "roof leak", keyword_info: { search_volume: 30 } },
  ] }] }] }).ideas;
  const difficulty = parseDataForSeoDifficulty({ tasks: [{ status_code: 20000, cost: 0.0103, result: [{ items: [
    { keyword: "ROOF REPAIR GALWAY", keyword_difficulty: 43 },
  ] }] }] });
  assert.equal(difficulty.cost, 0.0103);
  assert.deepEqual(mergeDataForSeoDifficulty(ideas, difficulty.difficulty).map((row) => row.difficulty), [43, null]);
});

test("Google Maps rank checks match the client domain first and return nearby competitors", () => {
  const parsed = parseGoogleMapsLocalRank({ tasks: [{ status_code: 20000, status_message: "Ok", cost: 0.004, result: [{ items: [
    { type: "maps_search", rank_absolute: 1, title: "Rival Roofing", domain: "rival.ie", rating: { value: 4.8, votes_count: 30 } },
    { type: "maps_search", rank_absolute: 4, title: "Example Roofing Galway", domain: "www.example.ie", place_id: "place-123", rating: { value: 4.6, votes_count: 12 } },
  ] }] }] }, { keyword: "roofing Galway", location: "Galway, Ireland", businessName: "Example Roofing", domain: "https://example.ie" });
  assert.equal(parsed.statusCode, 20000);
  assert.equal(parsed.cost, 0.004);
  assert.equal(parsed.result?.rank, 4);
  assert.equal(parsed.result?.matchedBy, "domain");
  assert.equal(parsed.result?.placeId, "place-123");
  assert.deepEqual(parsed.result?.competitors.map((item) => item.rank), [1]);
});

test("Google Maps rank checks leave unknown positions blank when the listing is not found", () => {
  const parsed = parseGoogleMapsLocalRank({ tasks: [{ status_code: 20000, result: [{ items: [{ type: "maps_search", rank_absolute: 1, title: "Another roofer", domain: "other.ie" }] }] }] }, { keyword: "roofing Galway", location: "Galway, Ireland", businessName: "Example Roofing", domain: "example.ie" });
  assert.equal(parsed.result?.rank, null);
  assert.equal(parsed.result?.matchedBy, null);
});
