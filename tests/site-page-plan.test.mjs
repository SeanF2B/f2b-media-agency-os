import test from "node:test";
import assert from "node:assert/strict";
import { buildSitePageMetadata, landingHostnameForWebsite, normalizeSitePagePlan } from "../lib/site-page-plan.ts";

test("normalizes selected landing page campaign and conversion context", () => {
  const plan = normalizeSitePagePlan({ purpose: "Paid Ads", campaignPlatform: "Google Ads", campaignId: "123", campaignName: "Roofing Search", service: "Roof repairs", targetLocation: "Galway", conversionGoal: "Quote request", templateStyle: "local-service" });
  assert.deepEqual(plan, { purpose: "Paid Ads", campaignPlatform: "Google Ads", campaignId: "123", campaignName: "Roofing Search", service: "Roof repairs", targetLocation: "Galway", conversionGoal: "Quote request", templateStyle: "local-service" });
  assert.deepEqual(buildSitePageMetadata(plan, "client-1", 42, "2026-10-26T10:00:00.000Z"), { ...plan, clientId: "client-1", pageId: 42, updatedAt: "2026-10-26T10:00:00.000Z" });
});

test("keeps a selected WordPress source page identity in an AI Sites task", () => {
  assert.equal(normalizeSitePagePlan({ purpose: "SEO", sourcePageId: 42 }).sourcePageId, 42);
  assert.equal(normalizeSitePagePlan({ purpose: "SEO", sourcePageId: 0 }).sourcePageId, undefined);
  assert.equal(normalizeSitePagePlan({ purpose: "SEO", sourcePageId: "42" }).sourcePageId, undefined);
  assert.equal(normalizeSitePagePlan({ purpose: "SEO", sourcePageId: Number.MAX_SAFE_INTEGER + 1 }).sourcePageId, undefined);
});

test("rejects invalid purposes and page identities", () => {
  assert.equal(normalizeSitePagePlan({ purpose: "publish" }), null);
  const plan = normalizeSitePagePlan({ purpose: "SEO" });
  assert.ok(plan);
  assert.equal(buildSitePageMetadata(plan, "client-1", 0, "2026-10-26T10:00:00.000Z"), null);
  assert.equal(buildSitePageMetadata(plan, "client-1", 42, "not-a-date"), null);
});

test("landing domain setup uses a client-owned domain and rejects WordPress.com hosted addresses", () => {
  assert.equal(landingHostnameForWebsite("https://www.example.ie/services"), "go.example.ie");
  assert.equal(landingHostnameForWebsite("https://aldohandyman.wordpress.com"), null);
  assert.equal(landingHostnameForWebsite("https://wordpress.com"), null);
  assert.equal(landingHostnameForWebsite("not a URL"), null);
});
