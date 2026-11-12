import test from "node:test";
import assert from "node:assert/strict";
import { resolveMarketingPublication } from "../lib/marketing-publication.js";

test("saving a draft preserves its current published snapshot", () => {
  assert.deepEqual(resolveMarketingPublication({ status: "draft", nextData: "draft-v2", existingPublishedData: "published-v1" }), {
    status: "draft",
    publishedData: "published-v1",
  });
});

test("publishing replaces the snapshot with the reviewed version", () => {
  assert.deepEqual(resolveMarketingPublication({ status: "published", nextData: "published-v2", existingPublishedData: "published-v1" }), {
    status: "published",
    publishedData: "published-v2",
  });
});

test("unpublishing removes public data while keeping the saved draft", () => {
  assert.deepEqual(resolveMarketingPublication({ status: "published", nextData: "saved-draft", existingPublishedData: "live-version", unpublish: true }), {
    status: "draft",
    publishedData: null,
  });
});
