import assert from "node:assert/strict";
import test from "node:test";
import { suggestInternalLinkOpportunities } from "../lib/seo-internal-links.ts";

test("suggests topic-matched links only between successfully crawled pages", () => {
  const result = suggestInternalLinkOpportunities([
    { url: "https://example.ie/services/roof-repair/", status: 200, title: "Roof Repair Service", description: "Roof repair and maintenance in Galway", internalLinks: [] },
    { url: "https://example.ie/guides/roof-maintenance/", status: 200, title: "Roof Repair and Maintenance Guide", description: "How to maintain a roof", internalLinks: [] },
    { url: "https://example.ie/contact/", status: 200, title: "Contact our team", description: "Get in touch", internalLinks: [] },
    { url: "https://example.ie/private/", status: null, title: "Roof Repairs", description: "", internalLinks: [] },
  ]);
  assert.ok(result.some((item) => item.sourceUrl.includes("roof-repair") && item.targetUrl.includes("roof-maintenance") && item.sharedTopics.includes("roof")));
  assert.equal(result.some((item) => item.targetUrl.includes("/private/")), false);
  assert.ok(result.every((item) => item.sharedTopics.length >= 2));
});

test("does not suggest existing links or self-links and normalizes trailing slashes", () => {
  const result = suggestInternalLinkOpportunities([
    { url: "https://example.ie/roof-repair/", status: 200, title: "Roof Repair Service", description: "Roof repairs", internalLinks: ["https://example.ie/roof-maintenance"] },
    { url: "https://example.ie/roof-maintenance/", status: 200, title: "Roof Repair and Maintenance Guide", description: "Roof maintenance", internalLinks: [] },
  ]);
  assert.equal(result.some((item) => item.sourceUrl.includes("roof-repair") && item.targetUrl.includes("roof-maintenance")), false);
  assert.equal(result.some((item) => item.sourceUrl === item.targetUrl), false);
});

test("returns no candidates for unrelated, failed, or underspecified pages", () => {
  assert.deepEqual(suggestInternalLinkOpportunities([
    { url: "https://example.ie/home/", status: 200, title: "Home", description: "Welcome", internalLinks: [] },
    { url: "https://example.ie/repairs/", status: 404, title: "Roof Repairs", description: "Roof repairs and maintenance", internalLinks: [] },
  ]), []);
});
