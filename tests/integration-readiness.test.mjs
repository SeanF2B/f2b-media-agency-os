import test from "node:test";
import assert from "node:assert/strict";
import { gohighlevelSetupConfigured, integrationReadiness } from "../lib/integration-readiness.mjs";

test("direct integration setup is ready", () => {
  assert.equal(integrationReadiness({ sourceConfigured: false, directConfigured: true }), "ready");
});

test("read-only fallback is labelled partial instead of implying edit access", () => {
  assert.equal(integrationReadiness({ sourceConfigured: true, readOnlyFallback: true }), "partial");
});

test("configured data source with a client mapping is ready for reporting", () => {
  assert.equal(integrationReadiness({ sourceConfigured: true, mappedCount: 2 }), "ready");
});

test("unmapped configured source is labelled partial", () => {
  assert.equal(integrationReadiness({ sourceConfigured: true, mappedCount: 0 }), "partial");
});

test("missing integration credentials remain setup needed", () => {
  assert.equal(integrationReadiness({ sourceConfigured: false, mappedCount: 3 }), "needs_setup");
});

test("HighLevel setup does not require the optional install URL when a computed OAuth URL is available", () => {
  assert.equal(gohighlevelSetupConfigured({ clientId: "id", clientSecret: "secret", appId: "app", redirectUri: "https://example.test/callback", encryptionKey: "key" }), true);
});

test("HighLevel setup remains incomplete without a required OAuth or encryption setting", () => {
  assert.equal(gohighlevelSetupConfigured({ clientId: "id", clientSecret: "secret", appId: "app", redirectUri: "https://example.test/callback", encryptionKey: "" }), false);
});
