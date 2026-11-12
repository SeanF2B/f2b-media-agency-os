import assert from "node:assert/strict";
import test from "node:test";
import { localTaskDueAt, localTimeFromIso, nextRecurringTaskDate } from "../lib/task-recurrence.ts";

test("recurring dates advance by the selected frequency", () => {
  const today = new Date(2026, 9, 24, 12);
  assert.equal(nextRecurringTaskDate({ due: "2026-10-24", repeat: "Weekly" }, today), "2026-10-31");
  assert.equal(nextRecurringTaskDate({ due: "2026-10-24", repeat: "Fortnightly" }, today), "2026-11-07");
  assert.equal(nextRecurringTaskDate({ due: "2026-10-24", repeat: "Monthly" }, today), "2026-11-24");
});

test("monthly recurrence clamps to the final calendar day", () => {
  const today = new Date(2026, 0, 31, 12);
  assert.equal(nextRecurringTaskDate({ due: "2026-01-31", repeat: "Monthly" }, today), "2026-02-28");
});

test("selected arrival time is preserved and restored for editing", () => {
  const dueAt = localTaskDueAt("2026-11-02", "14:35");
  assert.ok(dueAt);
  assert.equal(localTimeFromIso(dueAt), "14:35");
});

test("missing dates fall back to the existing 9am default", () => {
  assert.equal(localTaskDueAt("", "09:00"), undefined);
  assert.equal(localTimeFromIso(undefined), "09:00");
});
