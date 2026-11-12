import assert from "node:assert/strict";
import test from "node:test";
import { getTeamPermissions } from "../lib/access-permissions.ts";
import { canViewAiAssignedTask, getAiTaskStage } from "../lib/ai-task-access.ts";

test("AI tasks are hidden from staff unless the owner enables the AI task view", () => {
  const permissions = getTeamPermissions("Staff");
  const task = { assigneeId: "f2b-ai-agent", status: "To do", aiMode: "Google Ads" };
  assert.equal(canViewAiAssignedTask(task, permissions, ["Google Ads"]), false);
});

test("active AI tasks can be visible without granting access to completed AI results", () => {
  const permissions = getTeamPermissions("Staff", { aiTasks: true, aiCompletedTasks: false });
  assert.equal(canViewAiAssignedTask({ assigneeId: "f2b-ai-agent", status: "In progress", aiMode: "SEO" }, permissions, ["SEO"]), true);
  assert.equal(canViewAiAssignedTask({ assigneeId: "f2b-ai-agent", status: "Done", aiRunState: "completed", aiMode: "SEO", checklist: [{ done: true, evidence: "Report saved." }] }, permissions, ["SEO"]), false);
  assert.equal(canViewAiAssignedTask({ assigneeId: "f2b-ai-agent", status: "Blocked", aiRunState: "needs_review", aiMode: "SEO" }, permissions, ["SEO"]), true);
  assert.equal(canViewAiAssignedTask({ assigneeId: "f2b-ai-agent", status: "Done", aiRunState: "needs_review", aiMode: "SEO" }, permissions, ["SEO"]), true);
  assert.equal(canViewAiAssignedTask({ assigneeId: "f2b-ai-agent", status: "Done", aiRunState: "completed", aiMode: "SEO", checklist: [{ done: false }] }, permissions, ["SEO"]), true);
});

test("completed AI results require both task visibility permissions and an allowed AI mode", () => {
  const permissions = getTeamPermissions("Staff", { aiTasks: true, aiCompletedTasks: true });
  const completed = { assigneeId: "f2b-ai-agent", status: "Done", aiRunState: "completed", service: "Google Ads", checklist: [{ done: true, evidence: "Report saved." }] };
  assert.equal(canViewAiAssignedTask(completed, permissions, ["Google Ads"]), true);
  assert.equal(canViewAiAssignedTask(completed, permissions, ["SEO"]), false);
  assert.equal(canViewAiAssignedTask({ ...completed, assigneeId: "staff-1" }, permissions, ["Google Ads"]), false);
  assert.equal(canViewAiAssignedTask({ ...completed, aiApprovals: [{ status: "applied", verification: "unverified" }] }, getTeamPermissions("Staff", { aiTasks: true, aiCompletedTasks: false }), ["Google Ads"]), true);
  assert.equal(canViewAiAssignedTask({ ...completed, aiApprovals: [{ status: "applied", verification: "verified" }] }, getTeamPermissions("Staff", { aiTasks: true, aiCompletedTasks: false }), ["Google Ads"]), false);
});

test("completed AI access cannot remain enabled when AI task access is disabled", () => {
  const permissions = getTeamPermissions("Staff", { aiTasks: false, aiCompletedTasks: true });
  assert.equal(permissions.aiCompletedTasks, false);
});

test("AI task tabs are mutually exclusive while a proposed Ads change is applying", () => {
  const task = { assigneeId: "f2b-ai-agent", status: "In progress", aiRunState: "needs_review", aiMode: "Google Ads", aiApprovals: [{ status: "applying" }] };
  assert.equal(getAiTaskStage(task), "doing");
});

test("scheduled AI runs have a separate stage unless work is active or approval is waiting", () => {
  const scheduled = { assigneeId: "f2b-ai-agent", status: "To do", aiRunState: "scheduled", aiMode: "Google Ads" };
  assert.equal(getAiTaskStage(scheduled), "scheduled");
  assert.equal(getAiTaskStage({ ...scheduled, checklist: [{ done: true, evidence: "Checked." }], aiApprovals: [{ status: "pending", checklistIndex: 0, evidence: "Checked." }] }), "approvals");
  assert.equal(getAiTaskStage({ ...scheduled, checklist: [{ done: false }], aiApprovals: [{ status: "pending", checklistIndex: 0, evidence: "" }] }), "pending");
  assert.equal(getAiTaskStage({ ...scheduled, aiRunState: "running" }), "doing");
  assert.equal(getAiTaskStage({ ...scheduled, aiRunState: "cancelled" }), "cancelled", "a stopped run has a clear separate stage instead of being shown as evidence-blocked");
});

test("approval proposals with missing linked evidence stay with Pending work until actionable", () => {
  const task = {
    assigneeId: "f2b-ai-agent", status: "Blocked", aiRunState: "needs_review", aiMode: "Google Ads",
    checklist: [{ text: "Verify keyword opportunity", done: false }, { text: "Check conversion tracking", done: false }],
    aiApprovals: [{ status: "pending", checklistIndex: 0, evidence: "Potential search term opportunity." }],
  };
  assert.equal(getAiTaskStage(task), "pending");
  assert.equal(getAiTaskStage({ ...task, checklist: [{ ...task.checklist[0], done: true, evidence: "Search term report supports it." }, task.checklist[1]] }), "approvals");
});

test("incomplete results stay in pending while only fully verified tasks count as completed", () => {
  const incomplete = { assigneeId: "f2b-ai-agent", status: "Done", aiRunState: "completed", aiMode: "Google Ads", checklist: [{ done: true }, { done: false }] };
  const finished = { ...incomplete, checklist: [{ done: true, evidence: "Step one verified." }, { done: true, evidence: "Step two verified." }] };
  assert.equal(getAiTaskStage(incomplete), "pending");
  assert.equal(getAiTaskStage(finished), "completed");
  assert.equal(getAiTaskStage({ ...incomplete, checklist: [{ done: true, evidence: "" }] }), "pending", "a completed checkbox without saved evidence is not a completed task");
});

test("dismissed AI tasks leave active queues without becoming completed", () => {
  const task = { assigneeId: "f2b-ai-agent", status: "Cancelled", aiRunState: "needs_review", aiMode: "Google Ads", aiDismissedAt: "2026-10-25T10:00:00.000Z", checklist: [{ done: false }] };
  assert.equal(getAiTaskStage(task), "dismissed");
  assert.notEqual(getAiTaskStage(task), "completed");
  assert.equal(getAiTaskStage({ ...task, aiDismissedAt: undefined }), "pending", "restoring removes it from Dismissed and returns it to Pending");
});

test("AI task stage counts partition tasks instead of counting change items as extra tasks", () => {
  const tasks = [
    { assigneeId: "f2b-ai-agent", status: "Blocked", aiRunState: "needs_review", aiMode: "Google Ads", checklist: [{ done: false }] },
    { assigneeId: "f2b-ai-agent", status: "To do", aiRunState: "scheduled", aiMode: "Google Ads" },
    { assigneeId: "f2b-ai-agent", status: "In progress", aiRunState: "running", aiMode: "Google Ads" },
    { assigneeId: "f2b-ai-agent", status: "Done", aiRunState: "completed", aiMode: "Google Ads", checklist: [{ done: true, evidence: "Complete." }], aiApprovals: [{ status: "applied", verification: "verified" }, { status: "rejected" }] },
  ];
  const counts = Object.fromEntries(["approvals", "pending", "scheduled", "doing", "completed", "dismissed", "cancelled"].map((stage) => [stage, tasks.filter((task) => getAiTaskStage(task) === stage).length]));
  assert.deepEqual(counts, { approvals: 0, pending: 1, scheduled: 1, doing: 1, completed: 1, dismissed: 0, cancelled: 0 });
  assert.equal(Object.values(counts).reduce((total, count) => total + count, 0), tasks.length);
});
