import test from "node:test";
import assert from "node:assert/strict";
import { googleAdsAssetQueries, normalizeGoogleAdsAssetRows } from "../lib/google-ads-assets.mjs";

test("campaign and ad group asset queries scope to the selected campaign", () => {
  const queries = googleAdsAssetQueries("123-456-7890");
  assert.match(queries.campaign, /FROM campaign_asset WHERE campaign\.id = 1234567890/);
  assert.match(queries.adGroup, /FROM ad_group_asset WHERE campaign\.id = 1234567890/);
  assert.match(queries.campaign, /campaign_asset\.status != 'REMOVED'/);
  assert.match(queries.adGroup, /ad_group_asset\.status != 'REMOVED'/);
});

test("asset queries reject malformed campaign identifiers", () => {
  assert.throws(() => googleAdsAssetQueries("123 OR campaign.status = ENABLED"), /campaign ID is not valid/);
});

test("asset rows preserve scope, link status, copy and destination URLs", () => {
  const [asset] = normalizeGoogleAdsAssetRows([{
    campaign: { id: "123", name: "Roof repairs" },
    adGroup: { id: "456", name: "Emergency repairs" },
    adGroupAsset: { fieldType: "SITELINK", status: "ENABLED" },
    asset: {
      id: "789", name: "Emergency page", type: "SITELINK",
      sitelinkAsset: { linkText: "Emergency roof repair", description1: "Call our team", description2: "Same-day help" },
      finalUrls: ["https://example.test/emergency"],
    },
  }], "Ad group");
  assert.equal(asset.scope, "Ad group");
  assert.equal(asset.campaignName, "Roof repairs");
  assert.equal(asset.adGroupName, "Emergency repairs");
  assert.equal(asset.fieldType, "SITELINK");
  assert.equal(asset.status, "ENABLED");
  assert.deepEqual(asset.text, ["Emergency roof repair", "Call our team", "Same-day help"]);
  assert.deepEqual(asset.finalUrls, ["https://example.test/emergency"]);
});

test("asset normalization skips invalid rows and removes repeated copy", () => {
  const assets = normalizeGoogleAdsAssetRows([
    { asset: { textAsset: { text: "Call now" } } },
    { campaignAsset: { fieldType: "CALLOUT", status: "ENABLED" }, asset: { id: "1", calloutAsset: { calloutText: "Call now" } } },
  ], "Campaign");
  assert.equal(assets.length, 1);
  assert.deepEqual(assets[0].text, ["Call now"]);
  assert.equal(assets[0].status, "ENABLED");
});
