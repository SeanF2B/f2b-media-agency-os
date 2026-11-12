import test from "node:test";
import assert from "node:assert/strict";
import { readMarketingAttribution, renderMarketingAttributionFields, readSubmittedMarketingAttribution } from "../lib/marketing-attribution.js";

test("keeps supported UTM values, removes control characters, and ignores unrelated parameters", () => {
  const params = new URLSearchParams("utm_source=google%0Aads&utm_medium=cpc&utm_campaign=spring&gclid=click-id&email=person%40example.com");
  assert.deepEqual(readMarketingAttribution(params), { utm_source: "googleads", utm_medium: "cpc", utm_campaign: "spring" });
});

test("caps UTM values and ignores blank parameters", () => {
  const params = new URLSearchParams({ utm_source: "x".repeat(200), utm_term: "  ", utm_content: "hero" });
  assert.deepEqual(readMarketingAttribution(params), { utm_source: "x".repeat(160), utm_content: "hero" });
});

test("renders escaped hidden fields and reads them back from the form", () => {
  const fields = renderMarketingAttributionFields({ utm_campaign: `spring"><script>alert(1)</script>` });
  assert.match(fields, /name="__f2b_utm_campaign"/);
  assert.doesNotMatch(fields, /<script>/);
  assert.deepEqual(readSubmittedMarketingAttribution(new URLSearchParams({ __f2b_utm_source: "google", __f2b_utm_campaign: "spring" })), { utm_source: "google", utm_campaign: "spring" });
});
