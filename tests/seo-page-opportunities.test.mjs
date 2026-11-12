import assert from "node:assert/strict";
import test from "node:test";
import { suggestSeoPageOpportunities } from "../lib/seo-page-opportunities.ts";

test("service and location candidates are compared with loaded page titles and slugs", () => {
  const results = suggestSeoPageOpportunities(
    ["Boiler servicing", "Heat pump installation"],
    ["Galway", "Oranmore"],
    [{ title: "Boiler servicing in Galway", slug: "boiler-servicing-galway" }],
  );
  assert.equal(results.length, 4);
  assert.equal(results.find((item) => item.suggestedTitle === "Boiler servicing in Galway")?.matchedPage, "Boiler servicing in Galway");
  assert.equal(results.find((item) => item.suggestedTitle === "Heat pump installation in Oranmore")?.matchedPage, undefined);
});

test("comparison normalizes accents and returns no candidates without both inputs", () => {
  const results = suggestSeoPageOpportunities(["Café repairs"], ["Dún Laoghaire"], [{ slug: "cafe-repairs-dun-laoghaire" }]);
  assert.equal(results[0]?.matchedPage, "cafe-repairs-dun-laoghaire");
  assert.deepEqual(suggestSeoPageOpportunities(["Boiler servicing"], [], []), []);
  assert.deepEqual(suggestSeoPageOpportunities([], ["Galway"], []), []);
});
