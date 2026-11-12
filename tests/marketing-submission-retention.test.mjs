import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { getMarketingSubmissionRetention, normalizeMarketingSubmissionRetentionDays, processExpiredMarketingSubmissions, saveMarketingSubmissionRetention } from "../lib/marketing-submission-retention.ts";

class TestD1 {
  db = new DatabaseSync(":memory:");
  constructor() {
    this.db.exec(`
      CREATE TABLE marketing_submission_retention (owner_id TEXT PRIMARY KEY, retention_days INTEGER, cursor_created_at TEXT NOT NULL DEFAULT '', cursor_submission_id TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL);
      CREATE TABLE marketing_submissions (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, asset_id TEXT NOT NULL, kind TEXT NOT NULL, data TEXT NOT NULL, created_at TEXT NOT NULL);
      CREATE TABLE marketing_executions (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, automation_id TEXT NOT NULL, input TEXT NOT NULL);
      CREATE TABLE marketing_daily_analytics (owner_id TEXT NOT NULL, asset_id TEXT NOT NULL, metric_date TEXT NOT NULL, submissions INTEGER NOT NULL);
    `);
  }
  prepare(sql) {
    const statement = this.db.prepare(sql);
    let params = [];
    const query = {
      bind: (...values) => { params = values; return query; },
      first: async () => statement.get(...params),
      all: async () => ({ results: statement.all(...params) }),
      run: async () => ({ meta: { changes: Number(statement.run(...params).changes) } }),
    };
    return query;
  }
  async batch(queries) { const results = []; for (const query of queries) results.push(await query.run()); return results; }
}

test("submission retention is disabled by default and accepts only supported periods", async () => {
  const db = new TestD1();
  assert.equal(await getMarketingSubmissionRetention(db, "owner-1"), null);
  assert.equal(normalizeMarketingSubmissionRetentionDays("never"), null);
  assert.equal(normalizeMarketingSubmissionRetentionDays(90), 90);
  assert.equal(normalizeMarketingSubmissionRetentionDays(45), undefined);
  assert.equal(normalizeMarketingSubmissionRetentionDays(undefined), undefined);
  await saveMarketingSubmissionRetention(db, "owner-1", 90, new Date("2026-10-27T12:00:00.000Z"));
  assert.equal(await getMarketingSubmissionRetention(db, "owner-1"), 90);
  await saveMarketingSubmissionRetention(db, "owner-1", null, new Date("2026-10-27T12:10:00.000Z"));
  assert.equal(await getMarketingSubmissionRetention(db, "owner-1"), null);
});

test("retention cleanup is owner-scoped, deletes old files only when storage is available, and preserves recent rows", async () => {
  const db = new TestD1();
  const now = new Date("2026-10-27T12:00:00.000Z");
  await saveMarketingSubmissionRetention(db, "owner-1", 30, now);
  await saveMarketingSubmissionRetention(db, "owner-2", null, now);
  db.db.prepare("INSERT INTO marketing_submissions VALUES (?, ?, ?, ?, ?, ?)").run("old", "owner-1", "asset-1", "form", "{}", "2026-09-01T12:00:00.000Z");
  db.db.prepare("INSERT INTO marketing_submissions VALUES (?, ?, ?, ?, ?, ?)").run("recent", "owner-1", "asset-1", "form", "{}", "2026-10-01T12:00:00.000Z");
  db.db.prepare("INSERT INTO marketing_submissions VALUES (?, ?, ?, ?, ?, ?)").run("other-owner", "owner-2", "asset-2", "form", "{}", "2026-09-01T12:00:00.000Z");
  db.db.prepare("INSERT INTO marketing_submissions VALUES (?, ?, ?, ?, ?, ?)").run("with-file", "owner-1", "asset-1", "form", JSON.stringify({ files: [{ id: "file-1", mime: "image/png" }] }), "2026-08-01T12:00:00.000Z");
  db.db.prepare("INSERT INTO marketing_executions VALUES (?, ?, ?, ?)").run("run-old", "owner-1", "automation-1", JSON.stringify({ submissionId: "old" }));
  db.db.prepare("INSERT INTO marketing_daily_analytics VALUES (?, ?, ?, ?)").run("owner-1", "asset-1", "2026-09-01", 1);
  const removedKeys = [];
  const bucket = { delete: async (key) => { removedKeys.push(key); } };

  const result = await processExpiredMarketingSubmissions(db, bucket, now, 10);
  assert.deepEqual(result, { deleted: 2, failed: 0, outcomes: [] });
  assert.deepEqual(removedKeys, ["marketing-submissions/owner-1/with-file/file-1.png"]);
  assert.equal(db.db.prepare("SELECT COUNT(*) AS count FROM marketing_submissions WHERE owner_id='owner-1' AND id='old'").get().count, 0);
  assert.equal(db.db.prepare("SELECT COUNT(*) AS count FROM marketing_submissions WHERE id='recent'").get().count, 1);
  assert.equal(db.db.prepare("SELECT COUNT(*) AS count FROM marketing_submissions WHERE id='other-owner'").get().count, 1);
  assert.equal(db.db.prepare("SELECT COUNT(*) AS count FROM marketing_submissions WHERE id='with-file'").get().count, 0);
  assert.equal(db.db.prepare("SELECT COUNT(*) AS count FROM marketing_executions WHERE id='run-old'").get().count, 0);
  assert.equal(db.db.prepare("SELECT submissions FROM marketing_daily_analytics WHERE owner_id='owner-1'").get().submissions, 0);
});

test("retention cleanup keeps file submissions when R2 is unavailable or deletion fails", async () => {
  const db = new TestD1();
  const now = new Date("2026-10-27T12:00:00.000Z");
  await saveMarketingSubmissionRetention(db, "owner-1", 30, now);
  const data = JSON.stringify({ files: [{ id: "file-1", mime: "application/pdf" }] });
  db.db.prepare("INSERT INTO marketing_submissions VALUES (?, ?, ?, ?, ?, ?)").run("submission-1", "owner-1", "asset-1", "form", data, "2026-09-01T12:00:00.000Z");
  const noBucket = await processExpiredMarketingSubmissions(db, undefined, now);
  assert.equal(noBucket.deleted, 0);
  assert.equal(noBucket.failed, 1);
  assert.equal(db.db.prepare("SELECT COUNT(*) AS count FROM marketing_submissions").get().count, 1);
  const failedBucket = { delete: async () => { throw new Error("R2 unavailable"); } };
  const failedDelete = await processExpiredMarketingSubmissions(db, failedBucket, now);
  assert.equal(failedDelete.deleted, 0);
  assert.equal(failedDelete.failed, 1);
  assert.equal(db.db.prepare("SELECT COUNT(*) AS count FROM marketing_submissions").get().count, 1);
});

test("retention cleanup pages past a repeatedly failing attachment instead of starving later submissions", async () => {
  const db = new TestD1();
  const now = new Date("2026-10-27T12:00:00.000Z");
  await saveMarketingSubmissionRetention(db, "owner-1", 30, now);
  db.db.prepare("INSERT INTO marketing_submissions VALUES (?, ?, ?, ?, ?, ?)").run("a-fails", "owner-1", "asset-1", "form", JSON.stringify({ files: [{ id: "file-a", mime: "image/png" }] }), "2026-08-01T12:00:00.000Z");
  db.db.prepare("INSERT INTO marketing_submissions VALUES (?, ?, ?, ?, ?, ?)").run("b-deletes", "owner-1", "asset-1", "form", "{}", "2026-08-02T12:00:00.000Z");
  db.db.prepare("INSERT INTO marketing_submissions VALUES (?, ?, ?, ?, ?, ?)").run("c-deletes", "owner-1", "asset-1", "form", "{}", "2026-08-03T12:00:00.000Z");
  const bucket = { delete: async (key) => { if (key.includes("file-a")) throw new Error("attachment unavailable"); } };
  const first = await processExpiredMarketingSubmissions(db, bucket, now, 2);
  assert.equal(first.deleted, 1);
  assert.equal(first.failed, 1);
  assert.equal(db.db.prepare("SELECT cursor_submission_id FROM marketing_submission_retention WHERE owner_id='owner-1'").get().cursor_submission_id, "b-deletes");
  const second = await processExpiredMarketingSubmissions(db, bucket, now, 2);
  assert.equal(second.deleted, 1);
  assert.equal(db.db.prepare("SELECT COUNT(*) AS count FROM marketing_submissions WHERE id='c-deletes'").get().count, 0);
  assert.equal(db.db.prepare("SELECT COUNT(*) AS count FROM marketing_submissions WHERE id='a-fails'").get().count, 1);
});
