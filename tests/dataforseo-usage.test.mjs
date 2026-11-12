import test from "node:test";
import assert from "node:assert/strict";
import { summarizeDataForSeoUsage } from "../lib/dataforseo-usage.ts";

test("DataForSEO usage totals known provider costs and preserves unknown-cost coverage", () => {
  const summary = summarizeDataForSeoUsage({
    periodStart: "2026-09-27T12:00:00.000Z",
    keywordResearch: { requestCount: 3, knownCostUsd: 0.031, unknownCostCount: 1 },
    competitorResearch: { requestCount: 2, knownCostUsd: 0.04, unknownCostCount: 0 },
    localMaps: { requestCount: 2, knownCostUsd: 0.02, unknownCostCount: 0 },
    backlinks: { requestCount: 1, knownCostUsd: null, unknownCostCount: 1 },
  });

  assert.equal(summary.requestCount, 8);
  assert.equal(Number(summary.knownCostUsd?.toFixed(5)), 0.091);
  assert.equal(summary.unknownCostCount, 2);
  assert.deepEqual(summary.byService.backlinks, { requestCount: 1, knownCostUsd: null, unknownCostCount: 1 });
  assert.deepEqual(summary.byService.competitorResearch, { requestCount: 2, knownCostUsd: 0.04, unknownCostCount: 0 });
});

test("DataForSEO usage reports no known total when no provider cost was returned", () => {
  const summary = summarizeDataForSeoUsage({
    periodStart: "2026-09-27T12:00:00.000Z",
    keywordResearch: { requestCount: 0, knownCostUsd: null, unknownCostCount: 0 },
    localMaps: { requestCount: 2, knownCostUsd: null, unknownCostCount: 2 },
    backlinks: { requestCount: 0, knownCostUsd: null, unknownCostCount: 0 },
  });

  assert.equal(summary.requestCount, 2);
  assert.equal(summary.knownCostUsd, null);
  assert.equal(summary.unknownCostCount, 2);
});
