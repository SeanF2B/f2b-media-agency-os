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
  assert.equal(boardColumn(task, bot, Date.parse(at(3))), "in_progress");
  assert.equal(finishAiRun(startTask(task, { by: "Bot", at: at(3) }, true), { by: "Bot", at: at(4), finished: false, reason: "x" }).column, "done");
});

test("a run marked running that went quiet is Pending, not In progress", () => {
  const now = Date.parse("2026-11-19T19:00:00Z");
  const stuck = { ...base, status: "In progress", aiRunState: "running", aiRunStartedAt: "2026-11-17T13:42:00Z", aiProgressText: "Waiting for Sean’s approval" };
  assert.equal(boardColumn(stuck, bot, now), "pending");
  assert.equal(boardColumn({ ...stuck, aiProgressAt: "2026-11-19T18:55:00Z" }, bot, now), "in_progress", "recent progress = genuinely running");
});

test("the approval shows the agent's actual draft, and deciding closes the agent's request item", async () => {
  const { requestTextFromTask, openAgentRequests } = await import("../lib/task-flow.ts");
  const stuck = { ...base, status: "In progress", aiRunState: "running", aiRecommendations: [{ id: "agent-approval-1", title: "Approval needed: GBP post – Roof Replacement", detail: "Is your roof ready for winter? Book a free check." }, { id: "rec-x", title: "Other", detail: "x" }] };
  assert.match(requestTextFromTask(stuck), /^GBP post – Roof Replacement\n\nIs your roof ready for winter/);
  const pending = moveToPending(stuck, { by: "Scheduler", at: at(1), reason: "Stopped: Waiting for Sean’s approval" }).task;
  assert.match(pending.approvalRequest.request, /Is your roof ready for winter/);
  const approved = approveTask(pending, { by: "Sean", at: at(2), ai: true }).task;
  assert.equal(openAgentRequests(approved).length, 0);
  assert.equal(approved.aiRecommendations.find((item) => item.id === "rec-x").supersededAt, undefined, "other suggestions untouched");
});

test("parking a task that is already waiting on the owner keeps the same approval request (no second email)", () => {
  const first = moveToPending({ ...base, status: "In progress", aiRunState: "running" }, { by: "Bot", at: at(1), reason: "Waiting" }).task;
  const sent = { ...first, approvalRequest: { ...first.approvalRequest, emailStatus: "sent" }, status: "In progress", aiRunState: "running" };
  const again = moveToPending(sent, { by: "Scheduler", at: at(5), reason: "Stopped: Waiting" }).task;
  assert.equal(again.approvalRequest.id, first.approvalRequest.id);
  assert.equal(again.approvalRequest.emailStatus, "sent");
  assert.equal(again.status, "Blocked");
});

test("a task waiting on the owner shows Pending even if another process marks it running", () => {
  const p = moveToPending({ ...base, status: "In progress", aiRunState: "running" }, { by: "Bot", at: at(1), reason: "Waiting" }).task;
  const reopened = { ...p, status: "In progress", aiRunState: "running", aiRunStartedAt: new Date().toISOString(), aiProgressAt: new Date().toISOString() };
  assert.equal(boardColumn(reopened, bot), "pending");
});

test("approve/reject are recorded on the agent's request in the agent API's own format", () => {
  const stuck = { ...base, status: "In progress", aiRunState: "running", aiRecommendations: [{ id: "agent-approval-1", title: "Post", detail: "caption" }] };
  const pending = moveToPending(stuck, { by: "S", at: at(1), reason: "Waiting" }).task;
  const ok = approveTask(pending, { by: "Sean", at: at(2), editedRequest: "new caption", ai: true }).task.aiRecommendations[0];
  assert.equal(ok.approvedAt, at(2)); assert.match(ok.approvalNote, /new caption/);
  const no = rejectTask(pending, { by: "Sean", at: at(2), note: "no" }).task.aiRecommendations[0];
  assert.equal(no.rejectedAt, at(2)); assert.equal(no.ownerFeedback, "no");
});

test("approved but never started → Pending with a reason after 30 min; queued before that", async () => {
  const { isStalledStart, flowPendingReason } = await import("../lib/task-flow.ts");
  const pending = moveToPending({ ...base, status: "In progress", aiRunState: "running" }, { by: "B", at: at(0), reason: "Waiting" }).task;
  const approved = approveTask(pending, { by: "Sean", at: at(1), ai: true }).task;
  assert.equal(boardColumn(approved, bot, Date.parse(at(20))), "in_progress", "within 30 min: waiting for the agent");
  assert.equal(boardColumn(approved, bot, Date.parse(at(40))), "pending", "30+ min and nobody started it");
  assert.equal(isStalledStart(approved, Date.parse(at(40))), true);
  assert.match(flowPendingReason(approved, "Google ADS Specialist", Date.parse(at(40))), /Approved at .*Google ADS Specialist hasn't started it/);
});

test("active time: recorded per run, live while running, shown after completion", async () => {
  const { activeTimeMs, formatDuration } = await import("../lib/task-flow.ts");
  const running = startTask(base, { by: "B", at: at(0) }, true);
  assert.equal(activeTimeMs(running, Date.parse(at(3))), 3 * 60_000, "live timer counts up");
  const parked = moveToPending({ ...running, aiProgressAt: at(4) }, { by: "B", at: at(4), reason: "needs input" }).task;
  assert.equal(parked.aiActiveMs, 4 * 60_000);
  const again = startTask(approveTask(parked, { by: "S", at: at(10), ai: true }).task, { by: "B", at: at(11) }, true);
  const done = finishAiRun(again, { by: "B", at: at(13), finished: true, runStartedAt: at(11) }).task;
  assert.equal(done.aiActiveMs, 6 * 60_000, "4 min + 2 min, idle/approval time not counted");
  assert.equal(formatDuration(done.aiActiveMs), "6m 00s");
  // abandoned run only counts until its last progress
  const abandoned = moveToPending({ ...startTask(base, { by: "B", at: at(0) }, true), aiProgressAt: at(5) }, { by: "Scheduler", at: at(50), reason: "quiet" }).task;
  assert.equal(abandoned.aiActiveMs, 5 * 60_000);
});
