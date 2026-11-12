import test from "node:test";
import assert from "node:assert/strict";
import { mergeMarketingAiDraft } from "../lib/marketing-ai-merge.js";

test("AI edits preserve omitted fields, sections, conditions, and funnel metadata", () => {
  const current = {
    heading: "Current", description: "Old description", design: { brandColor: "#123456" },
    seoTitle: "SEO title", canonicalUrl: "https://example.test/page", allowedDomains: ["example.test"],
    sections: [{ type: "hero", heading: "Hero", body: "Intro", buttonUrl: "https://example.test", imageUrl: "https://example.test/hero.webp", videoUrl: "https://example.test/video", embeddedAssetId: "embed1234", style: { backgroundColor: "#123456", padding: "spacious" } }, { type: "faq", heading: "FAQ", body: "Answer" }],
    fields: [{ id: "name", label: "Name", type: "text", required: true, options: [], showWhen: { fieldId: "kind" } }, { id: "kind", label: "Type", type: "select", required: true, options: [{ label: "Home", value: "home" }] }],
    nodes: [{ id: "trigger", type: "trigger", label: "Scheduled", config: JSON.stringify({ event: "specific_date_time", runAt: "2026-11-02T09:30:00.000Z", timeZone: "Europe/Dublin" }) }],
    funnelSteps: [{ title: "Contact", heading: "Reach us", body: "Details" }],
  };
  const next = mergeMarketingAiDraft(current, { heading: "Updated", design: { brandColor: "#ffffff" }, sections: [{ type: "hero", heading: "New hero", body: "New intro", buttonUrl: "", imageUrl: "", style: { backgroundColor: "#aabbcc", alignment: "center" } }], fields: [{ id: "name", label: "Your name", type: "text", required: true, options: [] }], nodes: [] }, "funnel");
  assert.equal(next.heading, "Updated");
  assert.equal(next.sections[0].buttonUrl, "https://example.test");
  assert.equal(next.sections[0].imageUrl, "https://example.test/hero.webp");
  assert.equal(next.sections[0].videoUrl, "https://example.test/video");
  assert.equal(next.sections[0].embeddedAssetId, "embed1234");
  assert.deepEqual(next.sections[0].style, { backgroundColor: "#aabbcc", padding: "spacious", alignment: "center" });
  assert.equal(next.sections[1].heading, "FAQ");
  assert.equal(next.fields.find((field) => field.id === "name").showWhen.fieldId, "kind");
  assert.equal(next.fields.find((field) => field.id === "kind").label, "Type");
  assert.equal(JSON.parse(next.nodes[0].config).timeZone, "Europe/Dublin");
  assert.equal(next.seoTitle, "SEO title");
  assert.equal(next.design.brandColor, "#123456");
  assert.equal(next.allowedDomains[0], "example.test");
  assert.equal(next.funnelSteps[0].title, "Contact");
});

test("explicit visual references can update global design while normal AI edits preserve it", () => {
  const current = { design: { brandColor: "#123456", backgroundColor: "#ffffff" }, sections: [] };
  const proposal = { design: { brandColor: "#abcdef", backgroundColor: "#010203" }, sections: [] };
  assert.deepEqual(mergeMarketingAiDraft(current, proposal, "funnel", true).design, current.design);
  assert.deepEqual(mergeMarketingAiDraft(current, proposal, "funnel", true, true).design, proposal.design);
});

test("AI edits preserve approved calculator prices while adding editable fields", () => {
  const current = { heading: "Estimate", currency: "EUR", fixedFee: 120, minimumCharge: 250, percentageAdjustmentPercent: 12, discountPercent: 5, taxPercent: 23, fields: [{ id: "area", label: "Area", type: "number", required: true, pricePerUnit: 20, options: [] }] };
  const next = mergeMarketingAiDraft(current, { heading: "New estimate", currency: "USD", fixedFee: 0, minimumCharge: 0, percentageAdjustmentPercent: 90, fields: [{ id: "area", label: "Room area", type: "number", required: true, pricePerUnit: 0, options: [] }, { id: "finish", label: "Finish", type: "select", required: false, pricePerUnit: 0, options: [] }] }, "calculator");
  assert.equal(next.currency, "EUR");
  assert.equal(next.fixedFee, 120);
  assert.equal(next.minimumCharge, 250);
  assert.equal(next.percentageAdjustmentPercent, 12);
  assert.equal(next.discountPercent, 5);
  assert.equal(next.taxPercent, 23);
  assert.equal(next.fields.find((field) => field.id === "area").pricePerUnit, 20);
  assert.equal(next.fields.some((field) => field.id === "finish"), true);
});

test("new AI-created projects can replace starter fields and sections", () => {
  const current = { fields: [{ id: "starter", label: "Starter", options: [] }], sections: [{ type: "text", heading: "Starter" }] };
  const proposed = { fields: [{ id: "email", label: "Email", options: [] }], sections: [{ type: "hero", heading: "New page" }] };
  assert.deepEqual(mergeMarketingAiDraft(current, proposed, "funnel", false), { ...current, ...proposed });
});
