import assert from "node:assert/strict";
import test from "node:test";
import { completedTasksForReport, previousReportWindow } from "../lib/report-evidence.ts";

test("report comparison window is the immediately preceding equal-length period", () => {
  assert.deepEqual(previousReportWindow("2026-10-01", "2026-10-30"), { start: "2026-09-01", end: "2026-09-30" });
  assert.deepEqual(previousReportWindow("2024-03-01", "2024-03-01"), { start: "2024-02-29", end: "2024-02-29" });
  assert.throws(() => previousReportWindow("2026-10-31", "2026-10-01"), /valid report dates/);
});

test("client reports include only completed tasks dated inside the selected reporting period", () => {
  const tasks = [
    { id: "new", clientId: "c1", title: "Recent work", service: "SEO", status: "Done", completedAt: "2026-10-26T12:00:00.000Z" },
    { id: "legacy", clientId: "c1", title: "Older dated work", service: "Ads", status: "Done", aiReviewedAt: "2026-09-30T10:00:00.000Z" },
    { id: "activity", clientId: "c1", title: "Activity tracked", service: "SEO", status: "Done" },
    { id: "undated", clientId: "c1", title: "No date", status: "Done" },
    { id: "open", clientId: "c1", title: "Still pending", status: "Blocked", completedAt: "2026-10-26T12:00:00.000Z" },
    { id: "other-client", clientId: "c2", title: "Other client", status: "Done", completedAt: "2026-10-26T12:00:00.000Z" },
  ];
  const activity = [{ taskId: "activity", clientId: "c1", kind: "task", title: "Task completed", at: "2026-10-25T22:30:00.000Z" }];
  const result = completedTasksForReport(tasks, activity, "c1", "2026-10-01", "2026-10-31");
  assert.deepEqual(result.tasks.map((task) => task.id), ["new", "activity"]);
  assert.equal(result.missingCompletionDate, 1);
});
