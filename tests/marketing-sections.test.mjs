import test from "node:test";
import assert from "node:assert/strict";
import { flattenMarketingSections, normalizeMarketingSections, renderMarketingFaqStructuredData, renderMarketingSectionsHtml } from "../lib/marketing-sections.ts";
import { uploadedMarketingImageUrl } from "../lib/marketing-assets.ts";
import { marketingBlockImageCss, marketingBlockStyleCss } from "../lib/marketing-design.ts";
import { validateMarketingSectionRules } from "../lib/marketing-rules.ts";

test("section visibility rules survive normalization, render safely, and validate field references", () => {
  const sections = normalizeMarketingSections([{
    type: "container",
    showWhen: { mode: "or", conditions: [{ fieldId: "service", operator: "equals", value: "roofing" }, { fieldId: "budget", operator: "greaterThan", value: "1000" }] },
    children: [{ type: "text", heading: "Child block", showWhen: { fieldId: "service", operator: "contains", value: "roof" } }],
  }]);
  assert.deepEqual(sections[0].showWhen, { mode: "or", conditions: [{ fieldId: "service", operator: "equals", value: "roofing" }, { fieldId: "budget", operator: "greaterThan", value: "1000" }] });
  const html = renderMarketingSectionsHtml(sections, "conditional-funnel");
  assert.match(html, /data-section-show-rules="\[\{/);
  assert.match(html, /data-section-show-mode="or"/);
  assert.equal((html.match(/data-section-show-rules=/g) || []).length, 2);
  assert.equal(validateMarketingSectionRules([{ id: "service" }, { id: "budget" }], sections), null);
  assert.equal(validateMarketingSectionRules([{ id: "service" }], sections), "A section refers to a missing condition question.");
});

test("funnel section styles and image crop settings survive save normalization and reload", () => {
  const [saved] = normalizeMarketingSections([{
    type: "image",
    heading: "Kitchen project",
    imageUrl: "https://images.example/kitchen.webp",
    imageAlt: "A finished kitchen",
    style: {
      backgroundColor: "#AABBCC",
      textColor: "#112233",
      padding: "spacious",
      alignment: "center",
      imageFit: "cover",
      imageAspect: "landscape",
      imagePosition: "top right",
    },
  }]);

  assert.equal(saved.imageUrl, "https://images.example/kitchen.webp");
  assert.deepEqual(saved.style, {
    backgroundColor: "#aabbcc",
    textColor: "#112233",
    padding: "spacious",
    alignment: "center",
    imageFit: "cover",
    imageAspect: "landscape",
    imagePosition: "top right",
  });

  const reloaded = normalizeMarketingSections(JSON.parse(JSON.stringify([saved])))[0];
  assert.deepEqual(reloaded.style, saved.style);
  assert.equal(marketingBlockStyleCss(reloaded.style), "background-color:#aabbcc;color:#112233;padding:40px;text-align:center");
  assert.equal(marketingBlockImageCss(reloaded.style), "object-fit:cover;width:100%;height:auto;aspect-ratio:16 / 9;object-position:top right");
});

test("section save normalization drops unsafe styling and non-HTTPS image URLs", () => {
  const [section] = normalizeMarketingSections([{
    type: "image",
    imageUrl: "http://images.example/kitchen.webp",
    style: {
      backgroundColor: "red;position:fixed",
      imageFit: "cover;position:fixed",
      imageAspect: "calc(1)",
      imagePosition: "left;display:none",
    },
  }]);
  assert.equal(section.imageUrl, "");
  assert.deepEqual(section.style, {});
  assert.equal(marketingBlockStyleCss(section.style), "");
  assert.equal(marketingBlockImageCss(section.style), "");
});

test("funnel containers preserve bounded nested blocks and reject unsafe or recursive content", () => {
  const [container] = normalizeMarketingSections([{
    type: "container",
    heading: "Why choose us",
    layout: "three-column",
    children: [
      { type: "text", heading: "Local team", body: "Fast support." },
      { type: "image", heading: "Recent work", imageUrl: "javascript:alert(1)", buttonUrl: "javascript:alert(1)" },
      { type: "container", heading: "Nested attempt", children: [{ type: "text", heading: "Hidden" }] },
    ],
  }]);
  assert.equal(container.type, "container");
  assert.equal(container.layout, "three-column");
  assert.deepEqual(container.children?.map((child) => child.type), ["text", "image"]);
  assert.equal(container.children?.[1].imageUrl, "");
  assert.deepEqual(flattenMarketingSections([container]).map((section) => section.heading), ["Why choose us", "Local team", "Recent work"]);
  assert.equal(normalizeMarketingSections([{ type: "container", layout: "grid;position:fixed", children: Array.from({ length: 15 }, (_, index) => ({ type: "text", heading: `Block ${index}` })) }])[0].children?.length, 12);
});

test("public section renderer outputs nested responsive-ready HTML with escaped text and safe links", () => {
  const uploadedImage = uploadedMarketingImageUrl(`marketing-studio/${"a".repeat(64)}/123e4567-e89b-12d3-a456-426614174000.webp`);
  const sections = normalizeMarketingSections([{
    type: "container",
    layout: "two-column",
    heading: "<script>unsafe</script>",
    children: [
      { type: "image", heading: "Work", imageUrl: uploadedImage, imageAlt: "Example & safe" },
      { type: "button", heading: "Contact", body: "Ask us <today>", buttonLabel: "Get a quote", buttonUrl: "https://example.com/quote" },
    ],
  }]);
  const html = renderMarketingSectionsHtml(sections, "example-funnel");
  assert.match(html, /container-layout-two/);
  assert.match(html, /marketing-published-block-0/);
  assert.match(html, /marketing-published-block-1/);
  assert.match(html, /marketing-published-block-2/);
  assert.match(html, /&lt;script&gt;unsafe&lt;\/script&gt;/);
  assert.match(html, /&lt;today&gt;/);
  assert.match(html, /\/api\/marketing-public\?slug=example-funnel&amp;asset=marketing-studio/);
  assert.match(html, /href="https:\/\/example\.com\/quote"/);
  assert.doesNotMatch(html, /javascript:/i);
});

test("embedded projects render only when a published safe source is supplied", () => {
  const [section] = normalizeMarketingSections([{ type: "embed", heading: 'Get a "quote"', embeddedAssetId: "form_asset_12345678" }]);
  assert.equal(section.embeddedAssetId, "form_asset_12345678");
  const available = renderMarketingSectionsHtml([section], "main-page", new Map([[section.embeddedAssetId, { slug: "quote-form", kind: "form" }]]));
  assert.match(available, /src="\/f\/quote-form\?embed=1"/);
  assert.match(available, /data-f2b-marketing-slug="quote-form"/);
  assert.match(available, /title="Get a &quot;quote&quot;"/);
  assert.doesNotMatch(available, /form_asset_12345678/);

  const unavailable = renderMarketingSectionsHtml([section], "main-page", new Map([[section.embeddedAssetId, { slug: "automation", kind: "automation" }]]));
  assert.match(unavailable, /This embedded form is currently unavailable/);
  assert.doesNotMatch(unavailable, /<iframe/);
  const invalid = normalizeMarketingSections([{ type: "embed", embeddedAssetId: "bad id" }])[0];
  assert.equal(invalid.embeddedAssetId, undefined);
});

test("FAQ structured data is generated only from visible text and script-safe JSON", () => {
  const sections = normalizeMarketingSections([
    { type: "faq", heading: "How fast?", body: "Usually within <two> days & nights." },
    { type: "container", children: [{ type: "faq", heading: "Price?", body: "Ask our team." }] },
    { type: "faq", heading: "", body: "No question" },
  ]);
  const jsonLd = renderMarketingFaqStructuredData(sections);
  assert.match(jsonLd, /^<script type="application\/ld\+json">/);
  assert.match(jsonLd, /\\u003ctwo\\u003e days \\u0026 nights/);
  assert.ok(jsonLd.includes('"name":"Price?"'));
  assert.doesNotMatch(jsonLd, /<two>/);
  assert.equal(renderMarketingFaqStructuredData([{ ...sections[2], type: "text" }]), "");
});
