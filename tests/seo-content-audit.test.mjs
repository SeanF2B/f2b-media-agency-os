import assert from "node:assert/strict";
import test from "node:test";
import { inspectSeoContentPage } from "../lib/seo-content-audit.ts";

test("SEO content audit reports only fields that were actually checked", () => {
  assert.deepEqual(inspectSeoContentPage({ title: "Roof repairs", status: "publish", seoChecked: false }), {
    issues: [], unavailable: ["SEO title could not be checked", "Meta description could not be checked"], status: "unknown",
  });
  assert.deepEqual(inspectSeoContentPage({ title: "Roof repairs", status: "publish", seoTitle: "Roof repairs in Dublin", metaDescription: "Repairs and inspections.", seoChecked: true }), {
    issues: [], unavailable: [], status: "checked",
  });
  assert.deepEqual(inspectSeoContentPage({ title: "Roof repairs", status: "publish", seoCapabilities: { title: true, description: true }, robots: "index, noindex" }), {
    issues: ["SEO title is missing", "Meta description is missing", "Published page is marked noindex"], unavailable: [], status: "review",
  });
});
