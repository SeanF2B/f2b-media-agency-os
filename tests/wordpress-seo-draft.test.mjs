import test from "node:test";
import assert from "node:assert/strict";
import { planWordPressSeoDescriptionWrite, verifyWordPressSeoDescription } from "../lib/wordpress-seo-draft.ts";

test("SEO description write uses only a plugin field exposed by the page REST response", () => {
  assert.deepEqual(planWordPressSeoDescriptionWrite({ rank_math_description: "" }, "A short page description."), {
    status: "ready",
    description: "A short page description.",
    metaKey: "rank_math_description",
  });
  assert.deepEqual(planWordPressSeoDescriptionWrite({}, "A short page description."), {
    status: "not_exposed",
    description: "A short page description.",
  });
});

test("SEO description is normalized, capped below 160 characters and verified by read-back", () => {
  const description = planWordPressSeoDescriptionWrite({ _yoast_wpseo_metadesc: "" }, `  ${"Useful service details ".repeat(12)}  `);
  assert.equal(description.status, "ready");
  assert.equal(description.description.length, 159);
  assert.equal(verifyWordPressSeoDescription({ _yoast_wpseo_metadesc: description.description }, "_yoast_wpseo_metadesc", description.description), true);
  assert.equal(verifyWordPressSeoDescription({ _yoast_wpseo_metadesc: "different" }, "_yoast_wpseo_metadesc", description.description), false);
});

test("blank generated descriptions are not written to WordPress", () => {
  assert.deepEqual(planWordPressSeoDescriptionWrite({ seopress_titles_desc: "" }, "  "), { status: "not_requested", description: "" });
});
