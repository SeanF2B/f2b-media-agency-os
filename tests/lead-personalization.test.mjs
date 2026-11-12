import test from "node:test";
import assert from "node:assert/strict";
import { validateLeadPersonalLine } from "../lib/lead-personalization.mjs";

test("personal line requires an exact, whitespace-normalized website quote", () => {
  assert.deepEqual(validateLeadPersonalLine("I noticed you provide emergency roof repairs across Galway.", "emergency roof repairs across Galway", "Services include emergency\nroof repairs across Galway."), {
    status: "supported", line: "I noticed you provide emergency roof repairs across Galway.", evidence: "emergency roof repairs across Galway",
  });
});

test("personal line stays blank when the site has no useful supporting fact", () => {
  assert.deepEqual(validateLeadPersonalLine("", "", "We are a company."), { status: "needs_review", line: "", evidence: "" });
});

test("personal line rejects unsupported evidence and overly long copy", () => {
  assert.equal(validateLeadPersonalLine("I noticed your award-winning roofers provide many services today.", "award-winning roofers", "Roof repairs and gutters.").status, "invalid");
  assert.equal(validateLeadPersonalLine(`${"specific website fact ".repeat(11)}today`, "specific website fact", "specific website fact".repeat(4)).status, "invalid");
});
