import test from "node:test";
import assert from "node:assert/strict";
import { normalizeSearchConsoleProperties, normalizeSearchConsoleRows } from "../lib/google-search-console-normalize.mjs";

test("Search Console properties keep the exact site URL and access level", () => {
  assert.deepEqual(normalizeSearchConsoleProperties({ siteEntry: [
    { siteUrl: "sc-domain:example.ie", permissionLevel: "siteOwner" },
    { siteUrl: "https://www.example.ie/", permissionLevel: "siteFullUser" },
    { siteUrl: "", permissionLevel: "siteUnverifiedUser" },
  ] }), [
    { id: "sc-domain:example.ie", name: "sc-domain:example.ie", permissionLevel: "siteOwner" },
    { id: "https://www.example.ie/", name: "https://www.example.ie/", permissionLevel: "siteFullUser" },
  ]);
});

test("Search Console rows preserve date, query and page dimensions with numeric metrics", () => {
  assert.deepEqual(normalizeSearchConsoleRows([
    { keys: ["2026-10-22", "roofer galway", "https://example.ie/roofing"], clicks: 8, impressions: 120, ctr: 0.066, position: 4.2 },
    { keys: ["not-a-date", "bad row"], clicks: 1 },
  ], "sc-domain:example.ie"), [{
    date: "2026-10-22", query: "roofer galway", page: "https://example.ie/roofing", clicks: 8, impressions: 120, ctr: 0.066, position: 4.2,
  }]);
});
