import test from "node:test";
import assert from "node:assert/strict";
import { buildMarketingRobots, buildMarketingSitemap } from "../lib/marketing-sitemap.js";

test("sitemap includes published indexable pages and escapes XML", () => {
  const xml = buildMarketingSitemap([
    { slug: "funnel-roofing", data: { heading: "Roof & gutter" } },
    { slug: "form-quote", data: JSON.stringify({ noIndex: false }) },
    { slug: "hidden", data: { noIndex: true } },
    { slug: "bad slug", data: { noIndex: false } },
    { slug: "broken", data: "{" },
  ], "https://agency.example");
  assert.match(xml, /<loc>https:\/\/agency\.example\/f\/funnel-roofing<\/loc>/);
  assert.match(xml, /<loc>https:\/\/agency\.example\/f\/form-quote<\/loc>/);
  assert.doesNotMatch(xml, /hidden|bad%20slug|broken/);
  assert.match(xml, /sitemaps.org\/schemas/);
});

test("sitemap uses only same-origin HTTPS canonical URLs and de-duplicates", () => {
  const xml = buildMarketingSitemap([
    { slug: "one", data: { canonicalUrl: "https://agency.example/roof/" } },
    { slug: "two", data: { canonicalUrl: "https://agency.example/roof/" } },
    { slug: "external", data: { canonicalUrl: "https://other.example/page" } },
    { slug: "query", data: { canonicalUrl: "https://agency.example/page?utm_source=bad" } },
  ], "https://agency.example");
  assert.equal((xml.match(/<loc>/g) || []).length, 3);
  assert.equal((xml.match(/https:\/\/agency\.example\/roof\//g) || []).length, 1);
  assert.match(xml, /https:\/\/agency\.example\/f\/external/);
  assert.match(xml, /https:\/\/agency\.example\/f\/query/);
  assert.doesNotMatch(xml, /other\.example|utm_source/);
});

test("robots excludes private CRM and API paths but permits published funnels", () => {
  const robots = buildMarketingRobots("https://agency.example");
  assert.match(robots, /Disallow: \/\nAllow: \/f\//);
  assert.match(robots, /Disallow: \/api\//);
  assert.match(robots, /Sitemap: https:\/\/agency\.example\/sitemap\.xml/);
});
