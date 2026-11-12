import test from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import { consumeMarketingSubmissionRateLimit, MARKETING_SUBMISSION_RATE_LIMIT, MARKETING_SUBMISSION_RATE_WINDOW_MS } from "../lib/marketing-public-rate-limit.js";

class TestD1 {
  db = new DatabaseSync(":memory:");
  constructor() {
    this.db.exec(`CREATE TABLE marketing_submission_rate_limits (
      owner_id TEXT NOT NULL, asset_id TEXT NOT NULL, window_start INTEGER NOT NULL,
      request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0 AND request_count <= 60),
      PRIMARY KEY (owner_id, asset_id, window_start)
    )`);
  }
  prepare(sql) {
    const statement = this.db.prepare(sql);
    let params = [];
    const query = {
      bind: (...values) => { params = values; return query; },
      first: async () => statement.get(...params),
      run: async () => ({ meta: { changes: Number(statement.run(...params).changes) } }),
    };
    return query;
  }
}

test("public form limiter atomically caps one published page per minute without crossing tenants", async () => {
  const db = new TestD1();
  const start = Math.floor(1_798_000_000_000 / MARKETING_SUBMISSION_RATE_WINDOW_MS) * MARKETING_SUBMISSION_RATE_WINDOW_MS;
  for (let count = 0; count < MARKETING_SUBMISSION_RATE_LIMIT; count++) {
    assert.equal(await consumeMarketingSubmissionRateLimit(db, "owner-a", "form-a", start + count), true);
  }
  assert.equal(await consumeMarketingSubmissionRateLimit(db, "owner-a", "form-a", start + 59_999), false);
  assert.equal(await consumeMarketingSubmissionRateLimit(db, "owner-a", "form-b", start + 59_999), true);
  assert.equal(await consumeMarketingSubmissionRateLimit(db, "owner-b", "form-a", start + 59_999), true);
  assert.equal(await consumeMarketingSubmissionRateLimit(db, "owner-a", "form-a", start + MARKETING_SUBMISSION_RATE_WINDOW_MS), true);
  assert.equal(db.db.prepare("SELECT SUM(request_count) AS count FROM marketing_submission_rate_limits WHERE owner_id = 'owner-a' AND asset_id = 'form-a'").get().count, 1);
});
