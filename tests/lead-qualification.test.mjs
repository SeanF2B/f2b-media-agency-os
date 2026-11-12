import test from "node:test";
import assert from "node:assert/strict";
import { explicitExclusion } from "../lib/lead-qualification.mjs";

test("configured exclusions deterministically override an AI keep decision", () => {
  assert.equal(explicitExclusion({ category: "Roofing supplier and wholesaler" }, "suppliers, wholesalers, etc"), "suppliers");
  assert.equal(explicitExclusion({ name: "Independent Roofing Ltd", category: "Roofing contractor" }, "suppliers, franchises"), "");
});

test("exclusion matching ignores case and punctuation and skips vague etc rules", () => {
  assert.equal(explicitExclusion({ description: "A national-chain franchise" }, "suppliers; national chains, etc"), "national chains");
  assert.equal(explicitExclusion({ description: "Owner-operated local company" }, "etc"), "");
});
