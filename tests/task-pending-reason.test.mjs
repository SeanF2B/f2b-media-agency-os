import assert from "node:assert/strict";
import test from "node:test";
import { applyPendingReason } from "../lib/task-pending-reason.ts";

test("human tasks require and record a short reason when entering Pending", () => {
  const task = { id: "human-task", status: "Blocked", pendingReason: "Waiting for client photos" };
  const result = applyPendingReason(task, { id: task.id, status: "In progress" }, "Sean", "2026-10-29T12:00:00.000Z");

  assert.equal(result.error, "");
  assert.equal(result.task.pendingReason, "Waiting for client photos");
  assert.equal(result.task.pendingReasonBy, "Sean");
  assert.equal(result.task.pendingReasonAt, "2026-10-29T12:00:00.000Z");
});

test("a task cannot enter Pending without a reason", () => {
  const result = applyPendingReason({ id: "human-task", status: "Pending" }, { id: "human-task", status: "To do" }, "Sean", "2026-10-29T12:00:00.000Z");

  assert.match(result.error, /short reason/);
});

test("pending reasons are capped at 150 characters and legacy Pending tasks remain readable", () => {
  const result = applyPendingReason({ id: "task", status: "Blocked", pendingReason: "x".repeat(180) }, { id: "task", status: "To do" }, "Connors", "2026-10-29T12:00:00.000Z");
  const legacy = applyPendingReason({ id: "legacy", status: "Blocked" }, { id: "legacy", status: "Blocked" }, "Sean", "2026-10-29T12:00:00.000Z");

  assert.equal(result.task.pendingReason.length, 150);
  assert.equal(result.task.pendingReasonBy, "Connors");
  assert.equal(legacy.error, "");
  assert.equal(legacy.task.pendingReason, undefined);
});
