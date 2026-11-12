import assert from "node:assert/strict";
import test from "node:test";
import { assessGoogleAdsReviewPrerequisite, buildGoogleAdsLandingPageTargets } from "../lib/google-ads-review.ts";

const ad = {
  campaignId: "campaign-1", campaignName: "Dublin Painters", adGroupId: "group-1", adGroupName: "Painting",
  adId: "ad-1", status: "ENABLED", finalUrls: ["https://example.com/dublin-painters"],
  headlines: [{ text: "Dublin Painters" }, { text: "Request a Quote" }],
};

test("Google Ads landing pages are matched to the selected campaign and carry its headlines", () => {
  const result = buildGoogleAdsLandingPageTargets([
    { name: "Google Ads", campaignName: "Dublin Painters", landingPageUrl: "https://example.com/dublin-painters", landingPagePlatform: "WordPress" },
    { name: "Google Ads", campaignName: "Roof Repair", landingPageUrl: "https://example.com/roof-repair" },
  ], [ad, { ...ad, campaignId: "campaign-2", campaignName: "Roof Repair", finalUrls: ["https://example.com/roof-repair"] }], "campaign-1", "Dublin Painters");

  assert.equal(result.targets.length, 1);
  assert.equal(result.targets[0].url, "https://example.com/dublin-painters");
  assert.deepEqual(result.targets[0].headlines, ["Dublin Painters", "Request a Quote"]);
  assert.deepEqual(result.targets[0].adIds, ["ad-1"]);
});

test("Google Ads audit includes all five campaign landing pages without silently omitting the fifth", () => {
  const services = Array.from({ length: 5 }, (_, index) => ({
    name: "Google Ads",
    campaignName: "Dublin Painters",
    landingPageUrl: `https://example.com/page-${index + 1}`,
  }));
  const result = buildGoogleAdsLandingPageTargets(services, [], "campaign-1", "Dublin Painters", 5);

  assert.equal(result.targets.length, 5);
  assert.deepEqual(result.omittedUrls, []);
});

test("recommendation preflight requires readable headlines and every enabled ad destination", () => {
  const target = buildGoogleAdsLandingPageTargets([], [ad], "campaign-1", "Dublin Painters").targets;
  const ready = assessGoogleAdsReviewPrerequisite({ adsStatus: "connected", activeAds: [ad], pageTargets: target, landingPages: [{ url: ad.finalUrls[0], status: "connected" }] });
  assert.equal(ready.status, "ready");

  const incomplete = assessGoogleAdsReviewPrerequisite({
    adsStatus: "connected",
    activeAds: [{ ...ad, finalUrls: [], headlines: [] }],
    pageTargets: [],
    landingPages: [],
  });
  assert.equal(incomplete.status, "incomplete");
  assert.match(incomplete.message, /no readable headline assets/);
  assert.match(incomplete.message, /no destination URL to inspect/);
  assert.match(incomplete.message, /No destination landing page URL/);
});
