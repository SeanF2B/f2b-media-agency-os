import test from "node:test";
import assert from "node:assert/strict";
import { createApprovedWebsiteImageBlock, extractPublicWebsiteImages, selectApprovedWebsiteImage } from "../lib/public-website-assets.ts";

test("public website images are normalized, bounded and logo-first", () => {
  const html = `<img src="/assets/van.webp" alt="Service van"><img src="https://cdn.example.ie/brand-logo.png" alt="Company logo"><img src="javascript:alert(1)" alt="Bad"><img src="/assets/vector.svg" alt="Vector">`;
  const images = extractPublicWebsiteImages(html, "https://example.ie/roofing/");
  assert.deepEqual(images, [
    { url: "https://cdn.example.ie/brand-logo.png", alt: "Company logo" },
    { url: "https://example.ie/assets/van.webp", alt: "Service van" },
  ]);
});

test("draft image selection accepts only a listed HTTPS image URL", () => {
  const images = [{ url: "https://example.ie/uploads/roof.jpg", alt: "Roof work" }];
  assert.deepEqual(selectApprovedWebsiteImage("https://example.ie/uploads/roof.jpg", images), images[0]);
  assert.equal(selectApprovedWebsiteImage("https://attacker.example/roof.jpg", images), null);
  assert.equal(selectApprovedWebsiteImage("data:image/png;base64,AAAA", images), null);
  assert.match(createApprovedWebsiteImageBlock("https://example.ie/uploads/roof.jpg", images), /wp:image/);
  assert.match(createApprovedWebsiteImageBlock("https://example.ie/uploads/roof.jpg", images), /alt="Roof work"/);
  assert.equal(createApprovedWebsiteImageBlock("https://attacker.example/roof.jpg", images), "");
});
