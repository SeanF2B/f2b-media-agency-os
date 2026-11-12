import test from "node:test";
import assert from "node:assert/strict";
import { createMarketingBlankProject, createMarketingProjectTemplate, getMarketingProjectTemplateIds, getMarketingProjectTemplateName } from "../lib/marketing-project-templates.js";
import { buildMarketingAutomationMap } from "../lib/marketing-automation.js";

for (const kind of ["form", "survey", "calculator", "automation"]) {
  test(`${kind} templates are available and cloned independently`, () => {
    const ids = getMarketingProjectTemplateIds(kind);
    assert.ok(ids.length >= 2);
    assert.ok(getMarketingProjectTemplateName(kind, ids[0]));
    const first = createMarketingProjectTemplate(kind, ids[0]);
    const second = createMarketingProjectTemplate(kind, ids[0]);
    assert.ok(first);
    assert.notEqual(first, second);
    if (first.fields) assert.notEqual(first.fields, second.fields);
  });
}

test("calculator templates never introduce unapproved nonzero rates", () => {
  for (const id of getMarketingProjectTemplateIds("calculator")) {
    const draft = createMarketingProjectTemplate("calculator", id);
    assert.equal(draft.fixedFee || 0, 0);
    assert.equal(draft.minimumCharge || 0, 0);
    assert.ok(draft.fields.every((field) => (field.pricePerUnit || 0) === 0 && field.options.every((option) => (option.price || 0) === 0)));
  }
});

test("automation templates contain internal task actions and a connected visual path", () => {
  for (const id of getMarketingProjectTemplateIds("automation")) {
    const draft = createMarketingProjectTemplate("automation", id);
    assert.equal(draft.nodes[0].type, "trigger");
    assert.equal(draft.nodes[1].type, "task");
    assert.deepEqual(buildMarketingAutomationMap(draft.nodes).edges, [{ from: "trigger", to: "task", branch: "Next" }]);
    assert.doesNotMatch(JSON.stringify(draft.nodes), /customerEmail|customerSms|customerWhatsapp/);
  }
});

test("template factories return null for an unknown template", () => {
  assert.equal(createMarketingProjectTemplate("form", "missing"), null);
});

test("blank drafts clear project content while preserving brand and embed settings", () => {
  const source = { heading: "Existing", description: "Copy", design: { brandColor: "#123456" }, allowedDomains: ["example.com"], fields: [{ id: "name" }], sections: [{ heading: "Hero" }], funnelSteps: [{ title: "First" }], nodes: [{ id: "task" }], fixedFee: 10 };
  const blank = createMarketingBlankProject("form", source);
  assert.equal(blank.heading, "");
  assert.deepEqual(blank.fields, []);
  assert.deepEqual(blank.sections, []);
  assert.deepEqual(blank.funnelSteps, []);
  assert.deepEqual(blank.nodes, []);
  assert.equal(blank.fixedFee, 0);
  assert.deepEqual(blank.design, source.design);
  assert.deepEqual(blank.allowedDomains, source.allowedDomains);
  assert.deepEqual(source.fields, [{ id: "name" }]);
});

test("blank automation retains only an unconfigured trigger", () => {
  const blank = createMarketingBlankProject("automation", { nodes: [{ id: "old", type: "task" }], fields: [] });
  assert.deepEqual(blank.nodes, [{ id: "trigger", type: "trigger", label: "Choose a trigger", config: "" }]);
});
