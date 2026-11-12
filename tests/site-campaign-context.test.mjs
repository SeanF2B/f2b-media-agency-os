import test from "node:test";
import assert from "node:assert/strict";
import { campaignChecklistStepVerified, siteCampaignEvidenceText, summarizeSiteCampaignEvidence } from "../lib/site-campaign-context.ts";

test("Google Ads campaign evidence uses only returned keywords, ad assets and final URLs", () => {
  const result = summarizeSiteCampaignEvidence({
    platform: "Google Ads",
    campaignId: "123456789",
    campaignName: "Roof repair",
    keywordRows: [{ keyword_text: "roof leak repair", keyword_status: "ENABLED" }, { keyword_text: "roof leak repair" }, { keyword_text: "emergency roofer" }],
    creativeRows: [{
      ad_group_ad_ad_responsive_search_ad_headlines: '["Emergency Roof Repair","Call Our Team"]',
      ad_group_ad_ad_responsive_search_ad_descriptions: "Fast help for roof leaks; Talk to our team today",
      ad_group_ad_ad_final_urls: "https://example.ie/roof-repair/;javascript:alert(1)",
    }],
  });
  assert.equal(result.status, "retrieved");
  assert.deepEqual(result.keywords, ["roof leak repair", "emergency roofer"]);
  assert.deepEqual(result.headlines, ["Emergency Roof Repair", "Call Our Team"]);
  assert.deepEqual(result.descriptions, ["Fast help for roof leaks", "Talk to our team today"]);
  assert.deepEqual(result.destinationUrls, ["https://example.ie/roof-repair/"]);
  assert.match(siteCampaignEvidenceText(result), /Existing keywords: roof leak repair; emergency roofer/);
});

test("Meta campaign evidence summarizes targeting and ad copy without inventing keyword data", () => {
  const result = summarizeSiteCampaignEvidence({
    platform: "Meta Ads",
    campaignId: "987654321",
    campaignName: "Local leads",
    creativeRows: [{ title: "Book a quote", body: "Speak with our team", link_url: "https://example.ie/quote" }],
    targetingRows: [{ adset_targeting: JSON.stringify({ age_min: 25, age_max: 54, genders: [1, 2], geo_locations: { countries: ["IE"], regions: [{ name: "Leinster" }] } }) }],
  });
  assert.equal(result.status, "retrieved");
  assert.deepEqual(result.keywords, []);
  assert.deepEqual(result.headlines, ["Book a quote"]);
  assert.deepEqual(result.audienceTargeting, ["age 25–54", "genders: men, women", "countries: IE", "regions: Leinster"]);
  assert.match(siteCampaignEvidenceText(result), /Existing keywords: not supplied by the connected source/);
});

test("missing campaign reads stay unverified and block campaign checklist completion", () => {
  const noData = summarizeSiteCampaignEvidence({ platform: "Google Ads", campaignId: "123456789", campaignName: "Empty" });
  const unavailable = summarizeSiteCampaignEvidence({ platform: "Meta Ads", campaignId: "987654321", campaignName: "Offline", unavailableNote: "Account is not mapped." });
  assert.equal(noData.status, "no_data");
  assert.equal(unavailable.status, "unavailable");
  assert.equal(campaignChecklistStepVerified("Use campaign keywords", true, "no_data"), false);
  assert.equal(campaignChecklistStepVerified("Use campaign keywords", true, "retrieved"), true);
  assert.equal(campaignChecklistStepVerified("Create a WordPress draft", true, "unavailable"), true);
});
