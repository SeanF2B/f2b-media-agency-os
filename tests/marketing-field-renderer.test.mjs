import test from "node:test";
import assert from "node:assert/strict";
import { renderMarketingDisplayField } from "../lib/marketing-field-renderer.ts";

test("display-only field renderer escapes text and retains conditional/survey wrappers", () => {
  const condition = ' data-show-rules="&quot;service&quot;" data-survey-step="2"';
  assert.equal(renderMarketingDisplayField({ type: "heading", label: "Roofing <offers>", description: "Safe & clear" }, condition), '<section class="field-content field-heading" data-show-rules="&quot;service&quot;" data-survey-step="2"><h2>Roofing &lt;offers&gt;</h2><p>Safe &amp; clear</p></section>');
  assert.equal(renderMarketingDisplayField({ type: "description", label: "Details", description: 'We use "email" only' }), '<section class="field-content field-description"><p>We use &quot;email&quot; only</p></section>');
  assert.equal(renderMarketingDisplayField({ type: "divider" }), '<hr class="field-divider" aria-hidden="true">');
  assert.equal(renderMarketingDisplayField({ type: "progress", label: "Step <x>" }), '<div class="field-progress" aria-live="polite" data-survey-progress>Step &lt;x&gt;</div>');
  assert.equal(renderMarketingDisplayField({ type: "email", label: "Email" }), null);
});
