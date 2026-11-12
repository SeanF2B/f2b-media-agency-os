import test from "node:test";
import assert from "node:assert/strict";
import { marketingEmbedSnippet } from "../lib/marketing-embed.ts";

test("responsive embed uses HTTPS, escapes attributes and checks the responding frame", () => {
  const snippet = marketingEmbedSnippet("https://crm.example/f/roofing", "asset-123", "roofing", `Roofing "quote"`);
  assert.match(snippet, /data-src="https:\/\/crm\.example\/f\/roofing"/);
  assert.match(snippet, /title="Roofing &quot;quote&quot;"/);
  assert.match(snippet, /f2b-marketing-asset-123/);
  assert.match(snippet, /e\.origin!==origin\|\|e\.source!==f\.contentWindow/);
  assert.match(snippet, /f2b-marketing-ready/);
  assert.match(snippet, /Math\.min\(20000/);
  assert.match(snippet, /utm_source.*utm_medium.*utm_campaign.*utm_content.*utm_term/);
  assert.match(snippet, /frameUrl\.searchParams\.set\(key,value\.slice\(0,160\)\)/);
});

test("responsive embed refuses non-HTTPS URLs or missing asset identifiers", () => {
  assert.equal(marketingEmbedSnippet("http://crm.example/f/roofing", "asset-123", "roofing", "Roofing"), "");
  assert.equal(marketingEmbedSnippet("https://crm.example/f/roofing", "!!!", "roofing", "Roofing"), "");
});
