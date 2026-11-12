import assert from "node:assert/strict";
import test from "node:test";
import { googleAdsDateSelectionFromMessage, resolveGoogleAdsDateSelection } from "../lib/google-ads-date-range.ts";

const now = new Date("2026-10-23T12:00:00.000Z");

test("month-only Ads questions resolve to the most recent month", () => {
  assert.deepEqual(googleAdsDateSelectionFromMessage("How did the ads perform in July?", now), {
    range: "custom", from: "2026-07-01", to: "2026-07-31",
  });
});

test("a short retry carries the latest explicit period from this chat", () => {
  const resolved = resolveGoogleAdsDateSelection(
    "now tryt",
    ["Can you review July performance?", "How are ads doing?"],
    now,
  );
  assert.equal(resolved.carriedForward, true);
  assert.equal(resolved.sourceMessage, "Can you review July performance?");
  assert.deepEqual(resolved.selection, { range: "custom", from: "2026-07-01", to: "2026-07-31" });
});

test("an explicit new date overrides an older requested period", () => {
  const resolved = resolveGoogleAdsDateSelection(
    "Review August 2026",
    ["Review July 2026"],
    now,
  );
  assert.equal(resolved.carriedForward, false);
  assert.deepEqual(resolved.selection, { range: "custom", from: "2026-08-01", to: "2026-08-31" });
});

test("ordinary questions do not inherit an old period", () => {
  const resolved = resolveGoogleAdsDateSelection("What is the campaign status?", ["Review July 2026"], now);
  assert.equal(resolved.selection, null);
  assert.equal(resolved.carriedForward, false);
});
