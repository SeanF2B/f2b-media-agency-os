import test from "node:test";
import assert from "node:assert/strict";
import { normalizeMarketingColumns, renderMarketingColumnsHtml } from "../lib/marketing-columns.ts";

test("marketing columns are bounded, normalized and preserve editable copy", () => {
  const result = normalizeMarketingColumns([
    { heading: "First", body: "One", buttonLabel: "Read", buttonUrl: "https://example.com/one" },
    { heading: "Second", body: "Two" },
    { heading: "Third", body: "Three" },
    { heading: "Fourth", body: "Four" },
    { heading: "Ignored", body: "Over the limit" },
  ]);
  assert.equal(result.length, 4);
  assert.deepEqual(result[0], { heading: "First", body: "One", buttonLabel: "Read", buttonUrl: "https://example.com/one" });
  assert.equal(result[1].buttonUrl, "");
});

test("marketing columns reject unsafe links and bound text", () => {
  const result = normalizeMarketingColumns([{ heading: "h".repeat(300), body: "b".repeat(2500), buttonLabel: "go", buttonUrl: "javascript:alert(1)" }]);
  assert.equal(result[0].heading.length, 160);
  assert.equal(result[0].body.length, 2000);
  assert.equal(result[0].buttonUrl, "");
  assert.deepEqual(normalizeMarketingColumns(null), []);
});

test("published column HTML escapes content and uses a responsive column count", () => {
  const html = renderMarketingColumnsHtml([
    { heading: "<img src=x onerror=alert(1)>", body: "A & B", buttonLabel: "Go", buttonUrl: "https://example.com" },
    { heading: "Second", body: "Details" },
    { heading: "Third", body: "More" },
  ]);
  assert.match(html, /columns-grid-3/);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /A &amp; B/);
  assert.match(html, /href="https:\/\/example\.com\/"/);
  assert.doesNotMatch(html, /<img src=x/);
});
