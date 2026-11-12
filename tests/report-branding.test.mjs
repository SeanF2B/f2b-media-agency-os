import assert from "node:assert/strict";
import test from "node:test";
import { resolveAgencyLogoUrl } from "../lib/report-branding.ts";

test("PDF agency logo resolves against the app origin instead of the blank print document", () => {
  assert.equal(resolveAgencyLogoUrl("https://agency.example/reports/studio"), "https://agency.example/f2b-media-logo.png");
  assert.equal(resolveAgencyLogoUrl("http://localhost:3000/reports"), "http://localhost:3000/f2b-media-logo.png");
});

test("PDF agency logo rejects invalid and non-web page URLs", () => {
  assert.equal(resolveAgencyLogoUrl("data:text/html,invalid"), "");
  assert.equal(resolveAgencyLogoUrl("not a url"), "");
});
