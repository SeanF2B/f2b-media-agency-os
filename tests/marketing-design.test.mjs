import test from "node:test";
import assert from "node:assert/strict";
import { DEFAULT_MARKETING_DESIGN, MARKETING_EDITABLE_TEXT_CSS, marketingBlockImageCss, marketingBlockImageProperties, marketingBlockStyleCss, marketingBlockStyleForDevice, marketingBlockStyleProperties, marketingFontStack, marketingResponsiveBlockCss, normalizeMarketingBlockStyle, normalizeMarketingDesign } from "../lib/marketing-design.ts";

test("published editable copy preserves line breaks", () => {
  assert.match(MARKETING_EDITABLE_TEXT_CSS, /\.block p/);
  assert.match(MARKETING_EDITABLE_TEXT_CSS, /white-space:pre-line/);
  assert.match(MARKETING_EDITABLE_TEXT_CSS, /\.wrap h1/);
});

test("marketing design preserves valid brand settings", () => {
  const design = normalizeMarketingDesign({ brandColor: "#AABBCC", backgroundColor: "#010203", textColor: "#fff999", fontFamily: "serif", contentWidth: 920 });
  assert.deepEqual(design, { brandColor: "#aabbcc", backgroundColor: "#010203", textColor: "#fff999", fontFamily: "serif", contentWidth: 920 });
  assert.match(marketingFontStack(design.fontFamily), /Georgia/);
});

test("marketing design rejects unsafe values and clamps content width", () => {
  const design = normalizeMarketingDesign({ brandColor: "red;}</style>", backgroundColor: "url(javascript:alert(1))", textColor: "#123", fontFamily: "custom", contentWidth: 5000 });
  assert.equal(design.brandColor, DEFAULT_MARKETING_DESIGN.brandColor);
  assert.equal(design.backgroundColor, DEFAULT_MARKETING_DESIGN.backgroundColor);
  assert.equal(design.textColor, DEFAULT_MARKETING_DESIGN.textColor);
  assert.equal(design.fontFamily, "system");
  assert.equal(design.contentWidth, 1200);
  assert.equal(normalizeMarketingDesign({ contentWidth: 100 }).contentWidth, 560);
});

test("marketing block styles allow safe responsive section styling and reject CSS injection", () => {
  assert.deepEqual(normalizeMarketingBlockStyle({ backgroundColor: "#AABBCC", textColor: "#112233", padding: "spacious", alignment: "center", fontFamily: "unsafe" }), {
    backgroundColor: "#aabbcc", textColor: "#112233", padding: "spacious", alignment: "center",
  });
  assert.equal(marketingBlockStyleCss({ backgroundColor: "red;}</style>", textColor: "url(javascript:alert(1))", padding: "99px;position:fixed", alignment: "center;display:none" }), "");
  assert.equal(marketingBlockStyleCss({ backgroundColor: "#010203", padding: "compact", alignment: "right" }), "background-color:#010203;padding:12px;text-align:right");
  assert.deepEqual(marketingBlockStyleProperties({ backgroundColor: "#010203", padding: "spacious", alignment: "center" }), { backgroundColor: "#010203", padding: "40px", textAlign: "center" });
});

test("funnel image crop settings are allowlisted and shared by preview and published HTML", () => {
  const crop = { imageFit: "cover", imageAspect: "landscape", imagePosition: "top right" };
  assert.deepEqual(normalizeMarketingBlockStyle(crop), crop);
  assert.deepEqual(marketingBlockImageProperties(crop), { objectFit: "cover", width: "100%", height: "auto", aspectRatio: "16 / 9", objectPosition: "top right" });
  assert.equal(marketingBlockImageCss(crop), "object-fit:cover;width:100%;height:auto;aspect-ratio:16 / 9;object-position:top right");
  assert.deepEqual(normalizeMarketingBlockStyle({ imageFit: "cover;position:fixed", imageAspect: "calc(1)", imagePosition: "left;display:none" }), {});
  assert.equal(marketingBlockImageCss({ imageFit: "cover;position:fixed", imageAspect: "calc(1)", imagePosition: "left;display:none" }), "");
});

test("funnel block responsive styles are normalized and rendered as scoped tablet and mobile rules", () => {
  const style = normalizeMarketingBlockStyle({
    backgroundColor: "#112233",
    padding: "spacious",
    imageFit: "cover",
    responsive: {
      tablet: { backgroundColor: "#223344", alignment: "center" },
      mobile: { padding: "compact", alignment: "right", imageFit: "contain", textColor: "red;position:fixed" },
      desktop: { backgroundColor: "red;position:fixed" },
    },
  });
  assert.deepEqual(style, {
    backgroundColor: "#112233",
    padding: "spacious",
    imageFit: "cover",
    responsive: {
      tablet: { backgroundColor: "#223344", alignment: "center" },
      mobile: { padding: "compact", alignment: "right", imageFit: "contain" },
    },
  });
  assert.deepEqual(marketingBlockStyleForDevice(style, "desktop"), { backgroundColor: "#112233", padding: "spacious", imageFit: "cover" });
  assert.deepEqual(marketingBlockStyleForDevice(style, "mobile"), { backgroundColor: "#112233", padding: "compact", alignment: "right", imageFit: "contain" });
  assert.equal(marketingResponsiveBlockCss([{ style }]), ".block.marketing-published-block-0{background-color:#112233;padding:40px}.block.marketing-published-block-0 img{object-fit:cover}@media(max-width:900px){.block.marketing-published-block-0{background-color:#223344;text-align:center}}@media(max-width:640px){.block.marketing-published-block-0{padding:12px;text-align:right}.block.marketing-published-block-0 img{object-fit:contain}}");
});
