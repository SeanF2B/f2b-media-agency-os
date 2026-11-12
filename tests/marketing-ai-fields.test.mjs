import test from "node:test";
import assert from "node:assert/strict";
import { normalizeMarketingAiFields } from "../lib/marketing-ai-fields.js";

test("AI calculator fields retain valid calculated measurements without invented rates", () => {
  const result = normalizeMarketingAiFields([
    { id: "width", label: "Width", type: "number", required: true, options: [], pricePerUnit: 0, contactField: "auto", unitLabel: "m" },
    { id: "length", label: "Length", type: "number", required: true, options: [], pricePerUnit: 0, contactField: "auto", unitLabel: "m" },
    { id: "height", label: "Height", type: "number", required: true, options: [], pricePerUnit: 0, contactField: "auto", unitLabel: "m" },
    { id: "volume", label: "Volume", type: "calculated", required: false, options: [], pricePerUnit: 0, contactField: "none", unitLabel: "m³", calculation: { operation: "multiply", fieldIds: ["width", "length", "height"] } },
  ]);
  assert.deepEqual(result.invalidCalculations, []);
  assert.equal(result.fields[3].type, "calculated");
  assert.deepEqual(result.fields[3].calculation, { operation: "multiply", fieldIds: ["width", "length", "height"] });
  assert.equal(result.fields[3].unitLabel, "m³");
  assert.equal(result.fields[3].pricePerUnit, 0);
});

test("AI calculated fields reject unsupported, repeated and forward references", () => {
  const result = normalizeMarketingAiFields([
    { id: "area", label: "Area", type: "calculated", options: [], calculation: { operation: "divide", fieldIds: ["width", "width"] } },
    { id: "width", label: "Width", type: "number", options: [] },
    { id: "bad", label: "Bad", type: "calculated", options: [], calculation: { operation: "power", fieldIds: ["width", "length"] } },
    { id: "length", label: "Length", type: "number", options: [] },
  ]);
  assert.deepEqual(result.invalidCalculations, ["area", "bad"]);
});

test("AI output cannot add prices to calculator choices or map content fields as required", () => {
  const { fields } = normalizeMarketingAiFields([
    { id: "choice", label: "Finish", type: "select", required: true, options: [{ label: "Premium", value: "premium", price: 999 }], pricePerUnit: 100, contactField: "email" },
    { id: "intro", label: "Introduction", type: "heading", required: true, options: [], pricePerUnit: 25, contactField: "email" },
  ]);
  assert.equal(fields[0].options[0].price, 0);
  assert.equal(fields[0].pricePerUnit, 0);
  assert.equal(fields[1].required, false);
});

test("AI survey drafts retain safe steps, conditional questions and answer branches", () => {
  const { fields } = normalizeMarketingAiFields([
    { id: "property", label: "Property type", type: "radio", step: 1, required: true, options: [{ label: "Home", value: "home", price: 900, nextStep: 2 }, { label: "Business", value: "business", price: 1200, nextStep: 3 }] },
    { id: "bedrooms", label: "Bedrooms", type: "number", step: 2, showWhen: { mode: "and", conditions: [{ fieldId: "property", operator: "equals", value: "home" }] } },
    { id: "employees", label: "Employees", type: "number", step: 3, showWhen: { fieldId: "property", operator: "equals", value: "business" } },
  ], "survey");

  assert.equal(fields[0].step, 1);
  assert.equal(fields[0].options[0].nextStep, 2);
  assert.equal(fields[0].options[1].nextStep, 3);
  assert.equal(fields[0].options[0].price, 0);
  assert.deepEqual(fields[1].showWhen, { mode: "and", conditions: [{ fieldId: "property", operator: "equals", value: "home" }] });
  assert.deepEqual(fields[2].showWhen, { mode: "and", conditions: [{ fieldId: "property", operator: "equals", value: "business" }] });
});

test("AI calculator drafts retain progressive and conditional pricing rules at zero rates", () => {
  const { fields } = normalizeMarketingAiFields([
    { id: "service", label: "Service", type: "select", options: [{ label: "Standard", value: "standard", price: 500 }] },
    { id: "area", label: "Area", type: "number", pricePerUnit: 100, rateTiers: [{ upTo: 10, pricePerUnit: 75 }, { upTo: null, pricePerUnit: 50 }], priceWhen: { mode: "or", conditions: [{ fieldId: "service", operator: "equals", value: "standard" }] } },
  ], "calculator");

  assert.equal(fields[0].options[0].price, 0);
  assert.equal(fields[1].pricePerUnit, 0);
  assert.deepEqual(fields[1].rateTiers, [{ upTo: 10, pricePerUnit: 0 }, { pricePerUnit: 0 }]);
  assert.deepEqual(fields[1].priceWhen, { mode: "or", conditions: [{ fieldId: "service", operator: "equals", value: "standard" }] });
});
