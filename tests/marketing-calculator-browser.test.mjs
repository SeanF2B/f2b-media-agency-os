import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../app/api/marketing-public/route.ts", import.meta.url), "utf8");
const start = source.indexOf("const priceEnabled=el=>{");
const end = source.indexOf("\n    const conditions=()=>", start);
assert.notEqual(start, -1, "calculator refresh script exists");
assert.notEqual(end, -1, "calculator refresh script has a stable end");
const testPricing = { fixedFee: 0, minimumCharge: 0, percentageAdjustmentPercent: 0, discountPercent: 0, taxPercent: 0 };
const recalcSource = source.slice(start, end)
  .replaceAll("${JSON.stringify(pricing)}", JSON.stringify(testPricing))
  .replaceAll("${JSON.stringify(currency)}", JSON.stringify("EUR"));

test("published calculator script updates a measurement and total as its inputs change", () => {
  const outputs = new Map();
  const area = {
    name: "area",
    value: "0",
    disabled: false,
    dataset: { calculation: JSON.stringify({ operation: "multiply", fieldIds: ["width", "length"] }), unitPrice: "5" },
    closest: () => null,
  };
  const controls = { width: { value: "4" }, length: { value: "5" }, area };
  const form = {
    elements: { namedItem: (name) => controls[name] },
    querySelectorAll: (selector) => selector === "[data-calculation]" || selector === "[data-unit-price]" ? [area] : [],
  };
  const document = { getElementById: (id) => outputs.get(id) || (outputs.set(id, { textContent: "" }), outputs.get(id)) };
  const recalc = new Function("f", "document", `${recalcSource}; return recalc;`)(form, document);
  recalc();
  assert.equal(area.value, "20");
  assert.equal(outputs.get("calculated-area").textContent, "20");
  assert.match(outputs.get("total").textContent, /100/);
});


test("published calculator displays percentage adjustments in its quote breakdown", () => {
  const outputs = new Map();
  const area = { name: "area", value: "2", disabled: false, dataset: { unitPrice: "100" }, closest: () => null };
  const form = { querySelectorAll: (selector) => selector === "[data-unit-price]" ? [area] : [] };
  const document = { getElementById: (id) => outputs.get(id) || (outputs.set(id, { textContent: "" }), outputs.get(id)) };
  const adjustedSource = recalcSource.replace('"percentageAdjustmentPercent":0', '"percentageAdjustmentPercent":10');
  const recalc = new Function("f", "document", `${adjustedSource}; return recalc;`)(form, document);
  recalc();
  assert.match(outputs.get("percentage-adjustment").textContent, /20/);
  assert.match(outputs.get("total").textContent, /220/);
});

test("published funnel script shows and hides conditional page sections from answers", () => {
  const rulesStart = source.indexOf("const matchesRule=rule=>");
  const rulesEnd = source.indexOf("const visibleStep=s=>", rulesStart);
  const conditionsStart = source.indexOf("const conditions=()=>", rulesEnd);
  const conditionsEnd = source.indexOf("\n    f.querySelectorAll('[data-survey-step] input", conditionsStart);
  assert.notEqual(rulesStart, -1);
  assert.notEqual(rulesEnd, -1);
  assert.notEqual(conditionsStart, -1);
  assert.notEqual(conditionsEnd, -1);
  const field = { value: "" };
  const section = { dataset: { sectionShowRules: JSON.stringify([{ fieldId: "service", operator: "equals", value: "roofing" }]), sectionShowMode: "and" }, hidden: false, style: {} };
  const form = { elements: { namedItem: (name) => name === "service" ? field : null }, querySelectorAll: () => [] };
  const document = { querySelectorAll: (selector) => selector === "[data-section-show-rules]" ? [section] : [] };
  const script = `${source.slice(rulesStart, rulesEnd)};${source.slice(conditionsStart, conditionsEnd)};return conditions;`;
  const conditions = new Function("f", "document", "step", "RadioNodeList", script)(form, document, 1, class RadioNodeList {});
  conditions();
  assert.equal(section.hidden, true);
  assert.equal(section.style.display, "none");
  field.value = "roofing";
  conditions();
  assert.equal(section.hidden, false);
  assert.equal(section.style.display, "");
});

test("published calculator script sums and multiplies three selected measurements", () => {
  const outputs = new Map();
  const area = {
    name: "area",
    value: "0",
    disabled: false,
    dataset: { calculation: JSON.stringify({ operation: "multiply", fieldIds: ["width", "length", "factor"] }), unitPrice: "1" },
    closest: () => null,
  };
  const controls = { width: { value: "2" }, length: { value: "3" }, factor: { value: "4" }, area };
  const form = {
    elements: { namedItem: (name) => controls[name] },
    querySelectorAll: (selector) => selector === "[data-calculation]" || selector === "[data-unit-price]" ? [area] : [],
  };
  const document = { getElementById: (id) => outputs.get(id) || (outputs.set(id, { textContent: "" }), outputs.get(id)) };
  const recalc = new Function("f", "document", `${recalcSource}; return recalc;`)(form, document);
  recalc();
  assert.equal(area.value, "24");
  assert.match(outputs.get("total").textContent, /24/);
  area.dataset.calculation = JSON.stringify({ operation: "add", fieldIds: ["width", "length", "factor"] });
  recalc();
  assert.equal(area.value, "9");
  assert.match(outputs.get("total").textContent, /9/);
});

test("published calculator applies conditional option prices from the selected answer", () => {
  const outputs = new Map();
  const property = { value: "business", type: "select", disabled: false };
  const option = { value: "premium", dataset: { price: "75", priceWhen: JSON.stringify({ fieldId: "property", operator: "equals", value: "business" }) }, disabled: false, closest: (selector) => selector === "[data-price-when]" ? option : null };
  const form = {
    querySelectorAll: (selector) => selector === "[data-calculation]" || selector === "[data-unit-price]" ? [] : selector === 'select option:checked,input[type=radio]:checked,input[type=checkbox]:checked' ? [option] : selector === '[name="property"]' ? [property] : [],
  };
  const document = { getElementById: (id) => outputs.get(id) || (outputs.set(id, { textContent: "" }), outputs.get(id)) };
  const recalc = new Function("f", "document", `${recalcSource}; return recalc;`)(form, document);
  recalc();
  assert.match(outputs.get("total").textContent, /75/);
  property.value = "home";
  recalc();
  assert.match(outputs.get("total").textContent, /0/);
});
