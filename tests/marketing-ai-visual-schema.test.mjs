import test from "node:test";
import assert from "node:assert/strict";
import { marketingAiVisualSchema } from "../lib/marketing-ai-visual-schema.js";

test("AI visual drafts use only editable, allowlisted block and page design properties", () => {
  const block = marketingAiVisualSchema.blockStyle;
  assert.equal(block.additionalProperties, false);
  assert.deepEqual(block.properties.padding.enum, ["compact", "comfortable", "spacious"]);
  assert.deepEqual(block.properties.alignment.enum, ["left", "center", "right"]);
  assert.deepEqual(block.properties.imageFit.enum, ["cover", "contain"]);
  assert.deepEqual(block.required, Object.keys(block.properties));

  const design = marketingAiVisualSchema.design;
  assert.equal(design.additionalProperties, false);
  assert.deepEqual(design.properties.fontFamily.enum, ["system", "sans", "serif", "rounded"]);
  assert.deepEqual(design.required, Object.keys(design.properties));
});
