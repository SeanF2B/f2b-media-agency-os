import test from "node:test";
import assert from "node:assert/strict";
import { extractMetaAdPreviewUrl, trustedMetaAdPreviewUrl } from "../lib/meta-ad-preview.ts";

test("Meta preview URLs require HTTPS and a Meta-owned host", () => {
  assert.equal(trustedMetaAdPreviewUrl("https://www.facebook.com/preview"), "https://www.facebook.com/preview");
  assert.equal(trustedMetaAdPreviewUrl("https://instagram.com/preview"), "https://instagram.com/preview");
  assert.equal(trustedMetaAdPreviewUrl("http://facebook.com/preview"), null);
  assert.equal(trustedMetaAdPreviewUrl("https://facebook.com.attacker.example/preview"), null);
  assert.equal(trustedMetaAdPreviewUrl("javascript:alert(1)"), null);
});

test("Meta ad previews extract an approved Facebook or Instagram iframe URL", () => {
  assert.equal(
    extractMetaAdPreviewUrl({ data: [{ body: '<iframe src="https://www.facebook.com/ads/api/preview?x=1&amp;y=2"></iframe>' }] }),
    "https://www.facebook.com/ads/api/preview?x=1&y=2",
  );
  assert.equal(
    extractMetaAdPreviewUrl({ data: [{ body: "<iframe src='https://www.instagram.com/preview'></iframe>" }] }),
    "https://www.instagram.com/preview",
  );
});

test("Meta ad previews reject non-HTTPS and unrelated iframe hosts", () => {
  assert.equal(extractMetaAdPreviewUrl({ data: [{ body: '<iframe src="http://facebook.com/preview"></iframe>' }] }), null);
  assert.equal(extractMetaAdPreviewUrl({ data: [{ body: '<iframe src="https://facebook.com.attacker.example/preview"></iframe>' }] }), null);
  assert.equal(extractMetaAdPreviewUrl({ data: [{ body: '<iframe src="javascript:alert(1)"></iframe>' }] }), null);
});

test("Meta ad previews reject malformed or missing preview payloads", () => {
  assert.equal(extractMetaAdPreviewUrl(null), null);
  assert.equal(extractMetaAdPreviewUrl({ data: "not a list" }), null);
  assert.equal(extractMetaAdPreviewUrl({ data: [{ body: "no iframe here" }] }), null);
});
