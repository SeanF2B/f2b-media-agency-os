import test from "node:test";
import assert from "node:assert/strict";
import { calculateMarketingDerivedValues, calculateMarketingQuote, calculateMarketingTotal, getMarketingSurveyPath, isMarketingFieldVisible, isMarketingRequiredValuePresent, parseMarketingFieldValue, validateMarketingCalculator, validateMarketingRules, validateMarketingSurvey } from "../lib/marketing-rules.ts";

test("public fields reject invalid select options and out-of-range numbers", () => {
  const select = { type: "select", options: [{ label: "Tarmac", value: "tarmac" }] };
  const number = { type: "number", min: 1, max: 10 };
  assert.equal(parseMarketingFieldValue(select, ["forged"]).error, "Choose one of the listed options.");
  assert.equal(parseMarketingFieldValue(number, ["11"]).error, "Enter a number within the allowed range.");
  assert.equal(parseMarketingFieldValue(number, ["5"]).value, "5");
});

test("address fields accept a plain-text address value", () => {
  assert.equal(parseMarketingFieldValue({ type: "address" }, ["14 Example Road, Dublin"]).value, "14 Example Road, Dublin");
});

test("calculator measurements are derived from earlier numeric inputs and priced server-side", () => {
  const fields = [
    { id: "width", label: "Width", type: "number", pricePerUnit: 0 },
    { id: "length", label: "Length", type: "number", pricePerUnit: 0 },
    { id: "area", label: "Area", type: "calculated", calculation: { operation: "multiply", fieldIds: ["width", "length"] }, unitLabel: "m²", pricePerUnit: 5 },
  ];
  assert.equal(validateMarketingCalculator(fields), null);
  assert.equal(parseMarketingFieldValue(fields[2], ["999999"]).value, undefined);
  assert.deepEqual(calculateMarketingDerivedValues(fields, { width: "4", length: "5", area: "999999" }), { width: "4", length: "5", area: "20" });
  const quote = calculateMarketingQuote(fields, { width: "4", length: "5", area: "999999" });
  assert.equal(quote.total, 100);
  assert.deepEqual(quote.lineItems.at(-1), { fieldId: "area", label: "Area", quantity: 20, unitLabel: "m²", amount: 100 });
});

test("calculator formulas reject forward, nonnumeric, repeated and unsupported inputs", () => {
  const number = { id: "width", type: "number" };
  assert.match(validateMarketingCalculator([number, { id: "area", label: "Area", type: "calculated", calculation: { operation: "multiply", fieldIds: ["width", "length"] } }, { id: "length", type: "number" }]), /earlier numeric fields/);
  assert.match(validateMarketingCalculator([{ id: "choice", type: "select" }, number, { id: "area", type: "calculated", calculation: { operation: "multiply", fieldIds: ["choice", "width"] } }]), /earlier numeric fields/);
  assert.match(validateMarketingCalculator([number, { id: "area", type: "calculated", calculation: { operation: "multiply", fieldIds: ["width", "width"] } }]), /repeat an input/);
  assert.match(validateMarketingCalculator([number, { id: "area", type: "calculated", calculation: { operation: "eval", fieldIds: ["width", "width2"] } }]), /earlier numeric fields/);
});

test("calculator addition and multiplication support up to eight prior inputs with chained server evaluation", () => {
  const fields = [
    { id: "width", type: "number" },
    { id: "length", type: "number" },
    { id: "height", type: "number" },
    { id: "volume", type: "calculated", calculation: { operation: "multiply", fieldIds: ["width", "length", "height"] } },
    { id: "combined", type: "calculated", calculation: { operation: "add", fieldIds: ["width", "length", "height", "volume"] } },
  ];
  assert.equal(validateMarketingCalculator(fields), null);
  assert.deepEqual(calculateMarketingDerivedValues(fields, { width: "2", length: "3", height: "4" }), { width: "2", length: "3", height: "4", volume: "24", combined: "33" });
  assert.match(validateMarketingCalculator([...fields.slice(0, 3), { id: "too-many", type: "calculated", calculation: { operation: "add", fieldIds: ["width", "length", "height", "width", "length", "height", "width", "length", "height"] } }]), /2–8 earlier numeric fields/);
  assert.match(validateMarketingCalculator([...fields.slice(0, 3), { id: "binary-only", type: "calculated", calculation: { operation: "divide", fieldIds: ["width", "length", "height"] } }]), /2–8 earlier numeric fields/);
});

test("multi-select values are de-duplicated and validated against saved options", () => {
  const field = { type: "multiselect", options: [{ value: "drainage" }, { value: "edging" }] };
  assert.deepEqual(parseMarketingFieldValue(field, ["drainage", "edging", "drainage"]).value, ["drainage", "edging"]);
  assert.equal(parseMarketingFieldValue(field, ["unknown"]).error, "Choose only listed options.");
});

test("required consent and conditional fields use submitted values", () => {
  const consent = { type: "consent", required: true };
  assert.equal(isMarketingRequiredValuePresent(parseMarketingFieldValue(consent, []).value), false);
  assert.equal(parseMarketingFieldValue(consent, ["yes"]).value, "yes");
  assert.equal(parseMarketingFieldValue(consent, ["anything"]).error, "Choose a valid checkbox value.");
  assert.equal(isMarketingFieldVisible({ showWhen: { fieldId: "service", equals: "commercial" } }, { service: "residential" }), false);
  assert.equal(isMarketingFieldVisible({ showWhen: { fieldId: "extras", equals: "edging" } }, { extras: ["drainage", "edging"] }), true);
});

test("conditional rules support comparisons and empty checks without eval", () => {
  const values = { service: "Commercial roof repair", size: "45", note: "", extras: ["drainage"] };
  assert.equal(isMarketingFieldVisible({ showWhen: { fieldId: "service", operator: "contains", value: "roof" } }, values), true);
  assert.equal(isMarketingFieldVisible({ showWhen: { fieldId: "service", operator: "notEquals", value: "residential" } }, values), true);
  assert.equal(isMarketingFieldVisible({ showWhen: { fieldId: "size", operator: "greaterThan", value: "40" } }, values), true);
  assert.equal(isMarketingFieldVisible({ showWhen: { fieldId: "size", operator: "lessThan", value: "40" } }, values), false);
  assert.equal(isMarketingFieldVisible({ showWhen: { fieldId: "note", operator: "isEmpty" } }, values), true);
  assert.equal(isMarketingFieldVisible({ showWhen: { fieldId: "extras", operator: "isNotEmpty" } }, values), true);
});

test("conditional rules support AND and OR groups and reject missing or circular references", () => {
  const field = { showWhen: { mode: "and", conditions: [{ fieldId: "service", value: "roofing" }, { fieldId: "size", operator: "greaterThan", value: "40" }] } };
  assert.equal(isMarketingFieldVisible(field, { service: "roofing", size: "50" }), true);
  assert.equal(isMarketingFieldVisible(field, { service: "roofing", size: "20" }), false);
  assert.equal(isMarketingFieldVisible({ showWhen: { mode: "or", conditions: [{ fieldId: "service", value: "roofing" }, { fieldId: "size", operator: "greaterThan", value: "40" }] } }, { service: "general", size: "50" }), true);
  assert.match(validateMarketingRules([{ id: "a", showWhen: { conditions: [{ fieldId: "missing" }] } }]), /missing or circular/);
  assert.match(validateMarketingRules([{ id: "a", showWhen: { conditions: [{ fieldId: "b" }] } }, { id: "b", showWhen: { fieldId: "a" } }]), /circular/);
  assert.match(validateMarketingRules([{ id: "same" }, { id: "same" }]), /unique ID/);
});

test("calculator charges apply only when their saved answer condition matches", () => {
  const fields = [
    { id: "property", type: "select", options: [{ value: "home" }, { value: "business" }] },
    { id: "area", label: "Area", type: "number", pricePerUnit: 5, priceWhen: { fieldId: "property", operator: "equals", value: "business" } },
  ];
  assert.equal(validateMarketingCalculator(fields), null);
  assert.equal(validateMarketingRules(fields), null);
  assert.equal(calculateMarketingQuote(fields, { property: "business", area: "20" }).total, 100);
  assert.equal(calculateMarketingQuote(fields, { property: "home", area: "20" }).total, 0);
  assert.match(validateMarketingRules([{ ...fields[1], priceWhen: { fieldId: "missing", value: "x" } }]), /pricing refers to a missing condition question/);
});

test("survey answer branches skip unrelated steps and keep a valid forward path", () => {
  const fields = [
    { id: "property", type: "radio", step: 1, options: [{ value: "home", nextStep: 2 }, { value: "business", nextStep: 3 }] },
    { id: "bedrooms", type: "number", step: 2, showWhen: { fieldId: "property", value: "home" } },
    { id: "employees", type: "number", step: 3, showWhen: { fieldId: "property", value: "business" } },
    { id: "contact", type: "email", step: 4 },
  ];
  assert.deepEqual(getMarketingSurveyPath(fields, { property: "home" }), [1, 2, 4]);
  assert.deepEqual(getMarketingSurveyPath(fields, { property: "business" }), [1, 3, 4]);
  assert.deepEqual(getMarketingSurveyPath(fields, { property: "business", employees: "4" }), [1, 3, 4]);
  assert.equal(validateMarketingSurvey(fields), null);
  assert.match(validateMarketingSurvey([{ id: "type", step: 1, options: [{ value: "x", nextStep: 3 }] }, { id: "contact", step: 2 }]), /existing later step/);
  assert.match(validateMarketingSurvey([{ id: "type", step: 1, showWhen: { fieldId: "contact" } }, { id: "contact", step: 2 }]), /later survey step/);
  assert.match(validateMarketingSurvey([{ id: "a", step: 1, showWhen: { fieldId: "b" } }, { id: "b", step: 1, showWhen: { fieldId: "a" } }]), /circular/);
});

test("calculator totals are recomputed from approved server-side rules", () => {
  const fields = [
    { id: "units", type: "number", pricePerUnit: 25 },
    { id: "surface", type: "radio", options: [{ value: "concrete", price: 200 }] },
    { id: "extras", type: "multiselect", options: [{ value: "drainage", price: 10 }, { value: "edging", price: 20 }] },
  ];
  assert.equal(calculateMarketingTotal(fields, { units: "2", surface: "concrete", extras: ["drainage", "edging"] }), 280);
  assert.equal(calculateMarketingTotal(fields, { units: "2", surface: "concrete", extras: ["drainage", "edging"] }, { fixedFee: 20, minimumCharge: 0, discountPercent: 10, taxPercent: 23 }), 332.1);
  assert.equal(calculateMarketingTotal(fields, { units: "0", surface: "", extras: [] }, { minimumCharge: 50 }), 50);
  assert.equal(calculateMarketingTotal(fields, { units: "2", surface: "concrete", extras: [] }, { discountPercent: 200, taxPercent: 200 }), 0);
});

test("calculator quote breakdown reconciles with the saved estimate and includes only selected priced items", () => {
  const fields = [
    { id: "area", label: "Driveway area", type: "number", unitLabel: "m²", pricePerUnit: 25 },
    { id: "surface", label: "Surface", type: "radio", options: [{ value: "resin", label: "Resin", price: 200 }, { value: "tarmac", label: "Tarmac", price: 100 }] },
    { id: "extras", label: "Extras", type: "multiselect", options: [{ value: "drainage", label: "Drainage", price: 10 }, { value: "edging", label: "Edging", price: 20 }] },
  ];
  const quote = calculateMarketingQuote(fields, { area: "2", surface: "resin", extras: ["edging"] }, { fixedFee: 20, discountPercent: 10, taxPercent: 23 });
  assert.deepEqual(quote, {
    lineItems: [
      { fieldId: "area", label: "Driveway area", quantity: 2, unitLabel: "m²", amount: 50 },
      { fieldId: "surface", label: "Surface: Resin", amount: 200 },
      { fieldId: "extras", label: "Extras: Edging", amount: 20 },
    ],
    subtotal: 270,
    fixedFee: 20,
    minimumChargeAdjustment: 0,
    percentageAdjustmentPercent: 0,
    percentageAdjustment: 0,
    discountPercent: 10,
    discount: 29,
    taxableSubtotal: 261,
    taxPercent: 23,
    tax: 60.03,
    total: 321.03,
  });
  assert.equal(quote.total, calculateMarketingTotal(fields, { area: "2", surface: "resin", extras: ["edging"] }, { fixedFee: 20, discountPercent: 10, taxPercent: 23 }));
});

test("calculator quote breakdown records the minimum-charge adjustment", () => {
  const quote = calculateMarketingQuote([{ id: "area", label: "Area", type: "number", pricePerUnit: 10 }], { area: "1" }, { fixedFee: 5, minimumCharge: 50 });
  assert.equal(quote.subtotal, 10);
  assert.equal(quote.fixedFee, 5);
  assert.equal(quote.minimumChargeAdjustment, 35);
  assert.equal(quote.total, 50);
});

test("calculator percentage adjustments apply before discount and tax and are bounded", () => {
  const fields = [{ id: "area", label: "Area", type: "number", pricePerUnit: 100 }];
  const surcharge = calculateMarketingQuote(fields, { area: "2" }, { percentageAdjustmentPercent: 10, discountPercent: 5, taxPercent: 20 });
  assert.equal(surcharge.percentageAdjustment, 20);
  assert.equal(surcharge.taxableSubtotal, 209);
  assert.equal(surcharge.total, 250.8);

  const reduction = calculateMarketingQuote(fields, { area: "2" }, { percentageAdjustmentPercent: -25 });
  assert.equal(reduction.percentageAdjustment, -50);
  assert.equal(reduction.total, 150);

  const bounded = calculateMarketingQuote(fields, { area: "2" }, { percentageAdjustmentPercent: 5000 });
  assert.equal(bounded.percentageAdjustmentPercent, 1000);
  assert.equal(bounded.total, 2200);
});

test("calculator progressive rates apply each price only to its quantity band", () => {
  const fields = [{ id: "area", type: "number", unitLabel: "m²", rateTiers: [{ upTo: 10, pricePerUnit: 100 }, { upTo: 20, pricePerUnit: 80 }, { pricePerUnit: 60 }] }];
  assert.equal(calculateMarketingTotal(fields, { area: "5" }), 500);
  assert.equal(calculateMarketingTotal(fields, { area: "15" }), 1400);
  assert.equal(calculateMarketingTotal(fields, { area: "25" }), 2100);
  assert.equal(calculateMarketingTotal(fields, { area: "25" }, { fixedFee: 20, discountPercent: 10, taxPercent: 23 }), 2346.84);
  assert.equal(validateMarketingCalculator(fields), null);
  assert.match(validateMarketingCalculator([{ id: "area", type: "number", rateTiers: [{ upTo: 20, pricePerUnit: 100 }, { upTo: 10, pricePerUnit: 90 }, { pricePerUnit: 80 }] }]) || "", /limits must increase/);
  assert.match(validateMarketingCalculator([{ id: "area", type: "number", rateTiers: [{ upTo: 10, pricePerUnit: -1 }, { pricePerUnit: 0 }] }]) || "", /between zero/);
});
