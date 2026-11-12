import test from "node:test";
import assert from "node:assert/strict";
import { createMarketingFunnelTemplate, getMarketingFunnelTemplateIds } from "../lib/marketing-funnel-templates.js";

test("all built-in funnel templates create editable multi-step drafts with lead capture", () => {
  const ids = getMarketingFunnelTemplateIds();
  assert.deepEqual(ids, ["service_enquiry", "quote_request", "appointment_enquiry"]);
  for (const id of ids) {
    const draft = createMarketingFunnelTemplate(id);
    assert.ok(draft);
    assert.ok(draft.sections.length >= 2);
    assert.equal(draft.funnelSteps.length, 2);
    assert.ok(draft.fields.some((field) => field.type === "email" && field.required));
    assert.equal(draft.noIndex, false);
  }
});

test("templates do not invent prices, testimonials or business outcome claims", () => {
  for (const id of getMarketingFunnelTemplateIds()) {
    const draft = createMarketingFunnelTemplate(id);
    assert.equal(draft.sections.some((section) => section.type === "testimonial"), false);
    assert.equal(draft.sections.some((section) => section.type === "pricing"), false);
    assert.equal(draft.fields.some((field) => field.options.some((option) => Number(option.price) > 0)), false);
  }
});

test("template instances are independent editable copies", () => {
  const first = createMarketingFunnelTemplate("service_enquiry");
  const second = createMarketingFunnelTemplate("service_enquiry");
  first.sections[0].heading = "Changed locally";
  assert.notEqual(second.sections[0].heading, "Changed locally");
  assert.equal(createMarketingFunnelTemplate("missing"), null);
});
