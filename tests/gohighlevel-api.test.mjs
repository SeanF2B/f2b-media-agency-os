import test from "node:test";
import assert from "node:assert/strict";
import { ghlFunnelPagesV4Path, ghlFunnelsV4Path, ghlProviderError, normalizeGhlFunnels, normalizeGhlPages } from "../lib/gohighlevel-api.mjs";

test("builds the documented v4 funnel-list path with location and pagination", () => {
  const url = new URL(ghlFunnelsV4Path("loc id", 20, 50), "https://example.test");
  assert.equal(url.pathname, "/funnels/funnel");
  assert.equal(url.searchParams.get("locationId"), "loc id");
  assert.equal(url.searchParams.get("limit"), "50");
  assert.equal(url.searchParams.get("skip"), "20");
});

test("builds the documented v4 funnel-page path and safely encodes IDs", () => {
  const url = new URL(ghlFunnelPagesV4Path("funnel/id", "location", 40, 20), "https://example.test");
  assert.equal(url.pathname, "/funnels/funnel/funnel%2Fid/pages");
  assert.equal(url.searchParams.get("locationId"), "location");
  assert.equal(url.searchParams.get("limit"), "20");
  assert.equal(url.searchParams.get("skip"), "40");
});

test("normalizes v4 arrays and the older single-funnel response shape", () => {
  assert.deepEqual(normalizeGhlFunnels({ funnels: [{ _id: "a" }] }), [{ _id: "a" }]);
  assert.deepEqual(normalizeGhlFunnels({ funnels: { _id: "a" } }), [{ _id: "a" }]);
  assert.deepEqual(normalizeGhlPages([{ _id: "p" }]), [{ _id: "p" }]);
  assert.deepEqual(normalizeGhlPages({ pages: [{ _id: "p" }] }), [{ _id: "p" }]);
});

test("surfaces bounded provider error details without multiline output", () => {
  assert.equal(ghlProviderError({ message: "Invalid location\nID" }, 422), "GHL returned HTTP 422: Invalid location ID");
});
