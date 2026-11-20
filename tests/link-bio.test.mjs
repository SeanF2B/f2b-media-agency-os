import assert from "node:assert/strict";
import test from "node:test";
import { defaultPage, renderLinkBioHtml, safeUrl, sanitizePage, slugify, socialUrl, validSlug } from "../lib/link-bio.ts";

const client = { id: "c1", name: "Pro Roofers Galway", color: "#C1121F", website: "proroofersgalway.ie", phone: "091 123 456", email: "info@proroofersgalway.ie" };

test("starter page uses only the client's own details", () => {
  const page = defaultPage(client);
  assert.equal(page.slug, "pro-roofers-galway");
  assert.deepEqual(page.links.map((l) => l.url), ["https://proroofersgalway.ie/", "tel:091123456", "mailto:info@proroofersgalway.ie"]);
  assert.equal(page.theme.brand, "#c1121f");
  assert.equal(defaultPage({ id: "x", name: "Bare" }).links.length, 0);
});

test("slugs and urls are validated", () => {
  assert.equal(slugify("Lea MUA & Co!"), "lea-mua-and-co");
  assert.ok(validSlug("apex-ink"));
  assert.ok(!validSlug("ab"));
  assert.ok(!validSlug("admin"));
  assert.equal(safeUrl("javascript:alert(1)"), "");
  assert.equal(safeUrl("data:text/html,hi"), "");
  assert.equal(safeUrl("https://user:pw@evil.com"), "");
  assert.equal(safeUrl("example.com/quote"), "https://example.com/quote");
  assert.equal(safeUrl("+353 87 123 4567"), "tel:+353871234567");
  assert.equal(safeUrl("hi@lea.ie"), "mailto:hi@lea.ie");
  assert.equal(safeUrl("tel:12"), "");
  assert.equal(socialUrl("instagram", "@apexink"), "https://www.instagram.com/apexink");
  assert.equal(socialUrl("tiktok", "proroofersgalway"), "https://www.tiktok.com/@proroofersgalway");
  assert.equal(socialUrl("whatsapp", "+353 87 123 4567"), "https://wa.me/353871234567");
});

test("sanitizePage rejects broken links and cleans input", () => {
  assert.throws(() => sanitizePage({ slug: "pro-roofers", links: [{ label: "Quote", url: "javascript:x" }] }, client), /valid web address/);
  assert.throws(() => sanitizePage({ slug: "x" }, client), /link name/);
  const page = sanitizePage({ slug: "Pro Roofers", title: "", links: [{ id: "abcd1234", label: " Free quote ", url: "proroofersgalway.ie/quote" }, { id: "abcd1234", label: "Call", url: "091 123 456" }], socials: [{ network: "instagram", url: "@pr" }, { network: "instagram", url: "@dup" }, { network: "bogus", url: "x" }], theme: { brand: "red", background: "brand", buttons: "weird" } }, client);
  assert.equal(page.slug, "pro-roofers");
  assert.equal(page.title, "Pro Roofers Galway");
  assert.equal(page.links[0].label, "Free quote");
  assert.notEqual(page.links[0].id, page.links[1].id);
  assert.equal(page.links[1].url, "tel:091123456");
  assert.equal(page.socials.length, 1);
  assert.equal(page.theme.brand, "#c1121f");
  assert.equal(page.theme.buttons, "solid");
});

test("public html escapes content and routes clicks", () => {
  const page = sanitizePage({ slug: "test-page", title: "<b>Hi</b>", links: [{ id: "abcd1234", label: "Go <now>", url: "https://example.com" }, { id: "hidden01", label: "Hidden", url: "https://h.com", enabled: false }] }, client);
  const html = renderLinkBioHtml(page, { hrefFor: (l) => `/f/bio/test-page?go=${l.id}` });
  assert.ok(html.includes("&lt;b&gt;Hi&lt;/b&gt;"));
  assert.ok(!html.includes("<b>Hi</b>"));
  assert.ok(html.includes('href="/f/bio/test-page?go=abcd1234"'));
  assert.ok(!html.includes("Hidden"));
});
