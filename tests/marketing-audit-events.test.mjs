import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { listMarketingAuditEvents, marketingAuditInsert } from "../lib/marketing-audit-events.ts";

class TestD1 {
  db = new DatabaseSync(":memory:");
  constructor() {
    this.db.exec(readFileSync(new URL("../drizzle/0038_marketing_audit_events.sql", import.meta.url), "utf8"));
    this.db.exec(readFileSync(new URL("../drizzle/0039_marketing_audit_resource_labels.sql", import.meta.url), "utf8"));
    this.db.exec("CREATE TABLE marketing_assets (id TEXT NOT NULL, owner_id TEXT NOT NULL, name TEXT NOT NULL, PRIMARY KEY (owner_id, id));");
  }
  prepare(sql) {
    const statement = this.db.prepare(sql);
    let params = [];
    const query = {
      bind: (...values) => { params = values; return query; },
      all: async () => ({ results: statement.all(...params) }),
      run: async () => ({ meta: { changes: Number(statement.run(...params).changes) } }),
    };
    return query;
  }
}

function event(overrides = {}) {
  return { id: crypto.randomUUID(), ownerId: "owner-1", actorId: "staff-1", clientId: "client-1", resourceType: "project", resourceId: "project-1", projectKind: "funnel", action: "project_saved", createdAt: "2026-10-27T12:00:00.000Z", ...overrides };
}

test("marketing audit history is owner-scoped, ordered, and contains metadata only", async () => {
  const db = new TestD1();
  db.db.prepare("INSERT INTO marketing_assets VALUES (?, ?, ?)").run("project-1", "owner-1", "Roofing funnel");
  await marketingAuditInsert(db, event({ id: "saved-event" })).run();
  await marketingAuditInsert(db, event({ id: "other-owner-event", ownerId: "owner-2", actorId: "staff-2", resourceId: "project-2", createdAt: "2026-10-27T12:01:00.000Z" })).run();
  await marketingAuditInsert(db, event({ id: "deleted-event", resourceId: "gone-project", resourceLabel: "Old roofing page", action: "project_deleted", createdAt: "2026-10-27T12:02:00.000Z" })).run();

  const rows = await listMarketingAuditEvents(db, "owner-1", "funnel");
  assert.deepEqual(rows.map((row) => row.id), ["deleted-event", "saved-event"]);
  assert.equal(rows[1].projectName, "Roofing funnel");
  assert.equal(rows[0].projectName, "Old roofing page");
  assert.equal(rows.some((row) => row.id === "other-owner-event"), false);
  assert.equal(Object.hasOwn(rows[1], "data"), false);
  assert.equal(Object.hasOwn(rows[1], "submission_answers"), false);
});

test("audit schema rejects unsupported actions and records deletion and workspace settings", async () => {
  const db = new TestD1();
  await marketingAuditInsert(db, event({ action: "project_deleted" })).run();
  await marketingAuditInsert(db, event({ id: "retention", clientId: null, resourceType: "workspace", resourceId: "workspace", projectKind: "workspace", action: "retention_changed" })).run();
  assert.throws(() => db.db.prepare("INSERT INTO marketing_audit_events (id, owner_id, actor_id, resource_type, resource_id, project_kind, action, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").run("bad", "owner-1", "staff-1", "project", "project-1", "funnel", "customer_answer", "2026-10-27T12:00:00.000Z"));
  const rows = await listMarketingAuditEvents(db, "owner-1", "funnel");
  assert.deepEqual(rows.map((row) => row.action), ["retention_changed", "project_deleted"]);
});
