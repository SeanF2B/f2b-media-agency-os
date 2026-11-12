import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { deleteMarketingReusableBlock, listMarketingReusableBlocks, saveMarketingReusableBlock } from "../lib/marketing-reusable-blocks.ts";

class TestD1 {
  db = new DatabaseSync(":memory:");
  constructor() { this.db.exec(readFileSync(new URL("../drizzle/0029_marketing_reusable_blocks.sql", import.meta.url), "utf8")); }
  prepare(sql) {
    const statement = this.db.prepare(sql); let params = [];
    const query = {
      bind: (...values) => { params = values; return query; },
      all: async () => ({ results: statement.all(...params) }),
      run: async () => ({ meta: { changes: Number(statement.run(...params).changes) } }),
    };
    return query;
  }
}

test("reusable funnel sections persist per owner and can be inserted into other funnels", async () => {
  const db = new TestD1();
  const saved = await saveMarketingReusableBlock(db, "owner-a", "  Roofing   benefits ", {
    type: "columns", heading: "Benefits", body: "Choose us", columns: [
      { heading: "Fast", body: "Quick response", buttonUrl: "javascript:alert(1)" },
      { heading: "Clear", body: "Upfront pricing", buttonUrl: "https://example.com" },
    ],
  }, "2026-10-27T12:00:00.000Z");
  assert.equal(saved.name, "Roofing benefits");
  assert.equal(saved.section.type, "columns");
  assert.equal(saved.section.columns[0].buttonUrl, "");
  assert.equal(saved.section.columns[1].buttonUrl, "https://example.com/");
  assert.deepEqual(await listMarketingReusableBlocks(db, "owner-a"), [saved]);
  assert.deepEqual(await listMarketingReusableBlocks(db, "owner-b"), []);
  assert.equal(await deleteMarketingReusableBlock(db, "owner-b", saved.id), false);
  assert.equal((await listMarketingReusableBlocks(db, "owner-a")).length, 1);
  assert.equal(await deleteMarketingReusableBlock(db, "owner-a", saved.id), true);
  assert.deepEqual(await listMarketingReusableBlocks(db, "owner-a"), []);
});

test("reusable sections reject unknown block types and truncate content", async () => {
  const db = new TestD1();
  const saved = await saveMarketingReusableBlock(db, "owner-a", "x".repeat(150), { type: "script", heading: "h".repeat(200), body: "b".repeat(5000) });
  assert.equal(saved.name.length, 100);
  assert.equal(saved.section.type, "text");
  assert.equal(saved.section.heading.length, 160);
  assert.equal(saved.section.body.length, 4000);
});
