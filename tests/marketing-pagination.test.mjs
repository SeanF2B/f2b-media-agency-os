import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildMarketingPageResult, normalizeMarketingPage } from "../lib/marketing-pagination.js";

const route = readFileSync(new URL("../app/api/marketing-studio/route.ts", import.meta.url), "utf8");

test("project pagination uses stable defaults and bounds", () => {
  assert.deepEqual(normalizeMarketingPage({ limit: null, offset: null }), { limit: 100, offset: 0 });
  assert.deepEqual(normalizeMarketingPage({ limit: "999", offset: "-5" }), { limit: 200, offset: 0 });
  assert.deepEqual(normalizeMarketingPage({ limit: "bad", offset: "99999999" }), { limit: 100, offset: 1_000_000 });
  assert.deepEqual(normalizeMarketingPage({ limit: "0", offset: "4.5" }), { limit: 1, offset: 0 });
});

test("project pagination returns the continuation offset only when another page exists", () => {
  const rows = [{ id: "a" }, { id: "b" }, { id: "c" }];
  assert.deepEqual(buildMarketingPageResult(rows, { limit: 2, offset: 20 }), { items: rows.slice(0, 2), hasMore: true, nextOffset: 22 });
  assert.deepEqual(buildMarketingPageResult(rows.slice(0, 2), { limit: 2, offset: 20 }), { items: rows.slice(0, 2), hasMore: false, nextOffset: null });
});

test("project-library page queries remain owner-scoped and deterministically ordered", () => {
  assert.match(route, /WHERE owner_id = \?1 .*ORDER BY updated_at DESC, id DESC LIMIT/);
  assert.match(route, /hasMoreAssets: assetPage\.hasMore, nextAssetOffset: assetPage\.nextOffset/);
});
