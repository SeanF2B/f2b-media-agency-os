import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { BACKLINK_OUTREACH_STATUSES, isBacklinkOutreachStatus, isDateOnly, normalizePublicHttpUrl, validateBacklinkOutreachInput } from "../lib/backlink-outreach.ts";

test("backlink opportunity details accept public web URLs and trim saved notes", () => {
  const result = validateBacklinkOutreachInput({ sourceUrl: "https://partner.ie/page/#section", targetUrl: "https://client.ie/roofing/", anchor: " Roofing ", note: "  Check relevance  " });
  assert.deepEqual(result, { value: { sourceUrl: "https://partner.ie/page/", sourceDomain: "partner.ie", targetUrl: "https://client.ie/roofing/", anchor: "Roofing", note: "Check relevance" } });
});

test("backlink follow-ups reject invalid and local URLs", () => {
  for (const value of ["", "javascript:alert(1)", "http://localhost/path", "http://10.0.0.1/", "https://example.local/", "https://user:pass@example.ie/"]) assert.equal(normalizePublicHttpUrl(value), null, value);
  assert.equal("error" in validateBacklinkOutreachInput({ sourceUrl: "https://partner.ie", targetUrl: "" }), true);
});

test("backlink follow-up statuses are limited to the manual outreach stages", () => {
  assert.deepEqual(BACKLINK_OUTREACH_STATUSES, ["To review", "Shortlisted", "Contacted", "Replied", "Link live", "Not suitable"]);
  assert.equal(isBacklinkOutreachStatus("Contacted"), true);
  assert.equal(isBacklinkOutreachStatus("Sent email"), false);
});

test("follow-up dates must be real calendar dates", () => {
  assert.equal(isDateOnly("2026-10-27"), true);
  assert.equal(isDateOnly("2026-02-30"), false);
  assert.equal(isDateOnly("tomorrow"), false);
});

test("backlink follow-up migration creates client-scoped unique storage", () => {
  const db = new DatabaseSync(":memory:");
  db.exec(readFileSync(new URL("../drizzle/0031_seo_backlink_outreach.sql", import.meta.url), "utf8"));
  const insert = db.prepare("INSERT INTO seo_backlink_outreach (outreach_id, owner_id, client_id, source_url, source_domain, target_url, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)");
  const args = ["id-1", "owner-1", "client-1", "https://partner.ie/a", "partner.ie", "https://client.ie/", "now", "now"];
  insert.run(...args);
  assert.throws(() => insert.run("id-2", ...args.slice(1)), /UNIQUE constraint failed/);
  db.close();
});
