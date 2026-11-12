import test from "node:test";
import assert from "node:assert/strict";
import { verifyWordPressDraft } from "../lib/wordpress-draft-verification.ts";

const expected = { expectedTitle: "Roof repair Galway", expectedSlug: "roof-repair-galway", expectedContent: "<!-- wp:heading --><h1>Roof repair in Galway</h1><!-- /wp:heading --><p>Contact our team today.</p>", siteUrl: "https://example.ie" };

test("WordPress draft is verified only after reading back its draft status, title, slug and content", () => {
  const result = verifyWordPressDraft({ ...expected, saved: { id: 42, status: "draft", slug: expected.expectedSlug, title: { raw: expected.expectedTitle }, content: { raw: expected.expectedContent }, link: "https://example.ie/roof-repair-galway/" } });
  assert.equal(result.verified, true);
  assert.equal(result.pageId, 42);
  assert.equal(result.link, "https://example.ie/roof-repair-galway/");
  assert.deepEqual(result.issues, []);
});

test("published or mismatched WordPress pages are not reported as verified drafts", () => {
  const result = verifyWordPressDraft({ ...expected, saved: { id: 42, status: "publish", slug: "wrong-slug", title: { rendered: "Different page" }, content: "Different text", link: "https://example.ie/wrong-slug/" } });
  assert.equal(result.verified, false);
  assert.equal(result.issues.length, 4);
});

test("a published page update is verified against its live status and requested content", () => {
  const result = verifyWordPressDraft({ ...expected, expectedStatus: "publish", saved: { id: 42, status: "publish", slug: expected.expectedSlug, title: expected.expectedTitle, content: expected.expectedContent, link: "https://example.ie/roof-repair-galway/" } });
  assert.equal(result.verified, true);
  assert.equal(result.pageId, 42);
  assert.deepEqual(result.issues, []);
});

test("WordPress must not report a live-page update as verified if it remains a draft", () => {
  const result = verifyWordPressDraft({ ...expected, expectedStatus: "publish", saved: { id: 42, status: "draft", slug: expected.expectedSlug, title: expected.expectedTitle, content: expected.expectedContent } });
  assert.equal(result.verified, false);
  assert.match(result.issues[0], /did not confirm that the page status is “publish”/i);
});

test("an automatically generated WordPress slug is accepted only when a real slug is read back", () => {
  const result = verifyWordPressDraft({ ...expected, expectedSlug: "", saved: { id: 42, status: "draft", slug: "roof-repair-galway-2", title: expected.expectedTitle, content: expected.expectedContent } });
  assert.equal(result.verified, true);
  assert.equal(result.slug, "roof-repair-galway-2");
});

test("a missing preview URL falls back to this site's WordPress editor, never an external link", () => {
  const result = verifyWordPressDraft({ ...expected, siteUrl: "https://example.ie/wordpress", saved: { id: 7, status: "draft", slug: expected.expectedSlug, title: expected.expectedTitle, content: expected.expectedContent, link: "https://attacker.example/fake" } });
  assert.equal(result.verified, true);
  assert.equal(result.link, "https://example.ie/wordpress/wp-admin/post.php?post=7&action=edit");
});
