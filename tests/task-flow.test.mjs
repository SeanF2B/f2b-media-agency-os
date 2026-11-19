// Unit tests for the task flow rules (lib/task-flow.ts).
// Run: node --experimental-transform-types --test tests/task-flow.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import {
  OWNER_APPROVER_EMAIL, boardColumn, frequencyLabel, scheduleLabel, startTask, moveToPending, approveTask, rejectTask,
  finishAiRun, nextOccurrenceOnStart, nextRepeatDate, historyItems, needsOwnerDecision, approvalEmail, approvedRunInstructions, sendBackFromHistory,
} from "../lib/task-flow.ts";

const at = (n) => new Date(Date.UTC(2026, 10, 19, 9, n)).toISOString();
const bot = new Set(["bot-1"]);
const base = { id: "t1", title: "Weekly Instagram post", clientId: "c1", assigneeId: "bot-1", aiMode: "Research", status: "To do", aiRunState: "scheduled", due: "2026-11-26", dueAt: "2026-11-26T09:00:00.000Z", repeat: "Weekly", repeatTime: "09:00" };

test("To do shows the date and frequency", () => {
  assert.equal(boardColumn(base, bot), "todo");
  assert.equal(frequencyLabel(base), "Weekly");
  assert.equal(frequencyLabel({ repeat: "Fortnightly" }), "Every 2 weeks");
  assert.equal(frequencyLabel({ repeat: "None" }), "One-off");
  assert.equal(scheduleLabel(base), "Thu 26 Nov · 09:00");
});

test("In progress only while the AI is acting", () => {
  const running = startTask(base, { by: "Bot", at: at(0) }, true);
  assert.equal(boardColumn(running, bot, Date.parse(at(1))), "in_progress");
  // Status says In progress but no live run → it has stopped → Pending.
  assert.equal(boardColumn({ ...running, aiRunState: "needs_review" }, bot), "pending");
  assert.equal(boardColumn({ ...base, status: "In progress", aiRunState: "scheduled" }, bot), "pending");
  // Staff tasks are In progress while the person works on them.
  assert.equal(boardColumn({ ...base, assigneeId: "sean", aiMode: undefined, aiRunState: undefined, status: "In progress" }, bot), "in_progress");
});

test("stopping always needs a reason and sends an approval request to Sean", () => {
  const running = startTask(base, { by: "Bot", at: at(0) }, true);
  assert.match(moveToPending(running, { by: "Bot", at: at(1), reason: "  " }).error, /reason is required/);
  const { task, error } = moveToPending(running, { by: "Bot", at: at(1), reason: "Handing over to the Creatives agent", request: "Post: Winter roof check — book now", kind: "handover" });
  assert.equal(error, "");
  assert.equal(boardColumn(task, bot), "pending");
  assert.equal(task.status, "Blocked");
  assert.equal(task.pendingReason, "Handing over to the Creatives agent");
  assert.equal(task.approvalRequest.to, OWNER_APPROVER_EMAIL);
  assert.equal(task.approvalRequest.status, "awaiting");
  assert.equal(needsOwnerDecision(task), true);
  const mail = approvalEmail(task, { clientName: "Pro Roofers", agentName: "Bot", appUrl: "https://os.test/" });
  assert.equal(mail.to, "sean@f2bmedia.com");
  assert.match(mail.text, /Winter roof check/);
  assert.match(mail.text, /view=approvals/);
});

test("approve → back In progress → AI finishes → straight to Done, never asks again", () => {
  const pending = moveToPending(startTask(base, { by: "Bot", at: at(0) }, true), { by: "Bot", at: at(1), reason: "Post ready to publish", request: "Original caption" }).task;
  const approved = approveTask(pending, { by: "Sean", at: at(2), editedRequest: "Sean's edited caption", ai: true }).task;
  assert.equal(boardColumn(approved, bot, Date.parse(at(2))), "in_progress");
  assert.equal(approved.approvalRequest.editedRequest, "Sean's edited caption");
  assert.match(approvedRunInstructions(approved), /Sean's edited caption/);
  const resumed = startTask(approved, { by: "Bot", at: at(3) }, true);
  // Even if the AI says it needs review again, an approved run goes to Done.
  const { task, column } = finishAiRun(resumed, { by: "Bot", at: at(4), finished: false, reason: "Wants another approval", attachments: [{ id: "f1", name: "post.png", type: "image/png", size: 10, uploadedAt: at(4), uploadedBy: "Bot" }] });
  assert.equal(column, "done");
  assert.equal(task.status, "Done");
  assert.equal(task.outcome, "completed");
  assert.equal(task.approvalRequest.status, "approved");
  assert.equal(needsOwnerDecision(task), false);
  const [item] = historyItems([task]);
  assert.equal(item.files[0].name, "post.png");
});

test("reject → Done", () => {
  const pending = moveToPending(startTask(base, { by: "Bot", at: at(0) }, true), { by: "Bot", at: at(1), reason: "Budget change needs approval" }).task;
  const { task } = rejectTask(pending, { by: "Sean", at: at(2), note: "Not this month" });
  assert.equal(boardColumn(task, bot), "done");
  assert.equal(task.outcome, "rejected");
  assert.equal(historyItems([task])[0].outcome, "rejected");
  assert.match(approveTask(task, { by: "Sean", at: at(3), ai: true }).error, /not waiting/);
});

test("next occurrence is added only when the current one leaves To do, and only once", () => {
  const next = nextOccurrenceOnStart(base, [base], { due: nextRepeatDate(base.due, base.repeat), at: at(0) });
  assert.equal(next.status, "To do");
  assert.equal(next.due, "2026-12-03");
  assert.equal(next.occurrence, 2);
  assert.equal(next.seriesId, "t1");
  assert.equal(next.aiRunState, "scheduled");
  assert.equal(nextOccurrenceOnStart(base, [base, next], { due: "2026-12-03", at: at(1) }), null, "never twice");
  assert.equal(nextOccurrenceOnStart({ ...base, repeat: "None" }, [base], { due: "x", at: at(1) }), null, "one-off tasks never repeat");
  assert.equal(nextRepeatDate("2026-01-31", "Monthly"), "2026-02-28");
  assert.equal(nextRepeatDate("2026-11-19", "Daily"), "2026-11-20");
  assert.equal(nextRepeatDate("2026-11-19", "Fortnightly"), "2026-12-03");
});

test("History can send a finished task back to the AI with edits (pre-approved)", () => {
  const done = finishAiRun(startTask(base, { by: "Bot", at: at(0) }, true), { by: "Bot", at: at(1), finished: true }).task;
  const { task, error } = sendBackFromHistory(done, { by: "Sean", at: at(2), editedRequest: "Use the blue logo", ai: true });
  assert.equal(error, "");
  assert.equal(boardColumn(task, bot), "in_progress");
  assert.equal(finishAiRun(startTask(task, { by: "Bot", at: at(3) }, true), { by: "Bot", at: at(4), finished: false, reason: "x" }).column, "done");
});

test("a run marked running that went quiet is Pending, not In progress", () => {
  const now = Date.parse("2026-11-19T19:00:00Z");
  const stuck = { ...base, status: "In progress", aiRunState: "running", aiRunStartedAt: "2026-11-17T13:42:00Z", aiProgressText: "Waiting for Sean’s approval" };
  assert.equal(boardColumn(stuck, bot, now), "pending");
  assert.equal(boardColumn({ ...stuck, aiProgressAt: "2026-11-19T18:55:00Z" }, bot, now), "in_progress", "recent progress = genuinely running");
});
