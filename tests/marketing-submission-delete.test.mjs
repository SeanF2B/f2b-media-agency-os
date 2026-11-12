import test from "node:test";
import assert from "node:assert/strict";
import { deleteMarketingSubmission } from "../lib/marketing-submission-delete.ts";

function mockDb(ownerId = "owner-1", submission = { id: "submission-1", assetId: "asset-1", data: JSON.stringify({ files: [{ id: "file-1", mime: "image/png" }] }), createdAt: "2026-10-27T12:00:00.000Z" }) {
  const queries = [];
  const batches = [];
  const db = {
    prepare(sql) {
      const query = {
        sql,
        params: [],
        bind(...params) { this.params = params; return this; },
        async first() { return this.params[0] === ownerId && this.params[1] === submission?.id ? submission : null; },
      };
      queries.push(query);
      return query;
    },
    async batch(statements) { batches.push(statements.map((statement) => ({ sql: statement.sql, params: statement.params }))); return []; },
  };
  return { db, queries, batches };
}

test("deletion removes only the owner's matching attachment, submission, runs and aggregate", async () => {
  const { db, batches } = mockDb();
  const deletedKeys = [];
  const result = await deleteMarketingSubmission(db, { async delete(key) { deletedKeys.push(key); } }, "owner-1", "submission-1");

  assert.deepEqual(result, { status: "deleted", submissionId: "submission-1", assetId: "asset-1" });
  assert.deepEqual(deletedKeys, ["marketing-submissions/owner-1/submission-1/file-1.png"]);
  assert.equal(batches.length, 1);
  assert.match(batches[0][0].sql, /owner_id = \?1/);
  assert.deepEqual(batches[0][0].params, ["owner-1", "submission-1"]);
  assert.match(batches[0][1].sql, /marketing_daily_analytics/);
  assert.deepEqual(batches[0][1].params, ["owner-1", "asset-1", "2026-10-27T12:00:00.000Z"]);
  assert.deepEqual(batches[0][2].params, ["owner-1", "submission-1"]);
});

test("a different owner's submission is not found and nothing is deleted", async () => {
  const { db, queries, batches } = mockDb("owner-2");
  const deletedKeys = [];
  const result = await deleteMarketingSubmission(db, { async delete(key) { deletedKeys.push(key); } }, "owner-1", "submission-1");

  assert.deepEqual(result, { status: "not_found" });
  assert.deepEqual(queries[0].params, ["owner-1", "submission-1"]);
  assert.deepEqual(deletedKeys, []);
  assert.deepEqual(batches, []);
});

test("attachment storage or attachment deletion failures preserve the submission", async () => {
  const noBucket = mockDb();
  assert.deepEqual(await deleteMarketingSubmission(noBucket.db, undefined, "owner-1", "submission-1"), { status: "storage_unavailable" });
  assert.deepEqual(noBucket.batches, []);

  const failedDelete = mockDb();
  assert.deepEqual(await deleteMarketingSubmission(failedDelete.db, { async delete() { throw new Error("R2 unavailable"); } }, "owner-1", "submission-1"), { status: "attachment_delete_failed" });
  assert.deepEqual(failedDelete.batches, []);
});
