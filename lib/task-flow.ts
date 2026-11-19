/**
 * Task flow — the single source of truth for where a task sits and how it moves.
 *
 *   To do        A scheduled task. Shows its date and frequency. Only one upcoming
 *                occurrence of a recurring series ever waits here.
 *   In progress  Only while the AI is actually acting (a live run, a run queued
 *                straight after approval, or an approved Ads change being applied).
 *                Staff tasks are In progress while the person works on them.
 *   Pending      The AI stopped, handed over, failed, was cancelled or needs a
 *                decision. Always carries a reason, and always sends an approval
 *                request to the owner (sean@f2bmedia.com).
 *   Done         Finished, or rejected by the owner. Lands in History with files.
 *
 * Owner decisions on a Pending task:
 *   Approve  → back to In progress (the AI resumes with any edits the owner made),
 *              then straight to Done. An approved run never asks for approval again.
 *   Reject   → Done (outcome "rejected").
 *
 * Recurring series: the next occurrence is added to To do at the moment the current
 * one leaves To do (when it starts), never earlier and never twice.
 *
 * This module is pure (no I/O) so the browser, API routes and the scheduled worker
 * all apply exactly the same rules, and the whole flow is unit-testable.
 */

export const OWNER_APPROVER_EMAIL = "sean@f2bmedia.com";

/** Stored status values. "Blocked" is the stored value for the Pending column. */
export const TASK_STATUS = { todo: "To do", inProgress: "In progress", pending: "Blocked", done: "Done" } as const;

export type BoardColumn = "todo" | "in_progress" | "pending" | "done";
export const BOARD_COLUMNS: Array<{ key: BoardColumn; label: string; status: string }> = [
  { key: "todo", label: "To do", status: TASK_STATUS.todo },
  { key: "in_progress", label: "In progress", status: TASK_STATUS.inProgress },
  { key: "pending", label: "Pending", status: TASK_STATUS.pending },
  { key: "done", label: "Done", status: TASK_STATUS.done },
];

export type TaskRepeat = "None" | "Daily" | "Weekly" | "Fortnightly" | "Monthly";

export type FlowAttachment = { id: string; name: string; type: string; size: number; uploadedAt: string; uploadedBy: string; storageKey?: string };

export type TaskApprovalRequest = {
  id: string;
  status: "awaiting" | "approved" | "rejected";
  /** Why the task stopped (always present). */
  reason: string;
  /** What the AI is asking to do or publish — e.g. the social post text. Fully editable by the owner. */
  request: string;
  /** The owner's edited version, sent back to the AI on approval. */
  editedRequest?: string;
  /** Optional extra instructions from the owner. */
  ownerNote?: string;
  to: string;
  requestedAt: string;
  requestedBy: string;
  emailStatus?: "queued" | "sent" | "failed" | "skipped";
  emailDetail?: string;
  decidedAt?: string;
  decidedBy?: string;
};

export type TaskHistoryEvent = {
  id: string;
  at: string;
  by: string;
  action: "scheduled" | "started" | "pending" | "approval_requested" | "approved" | "rejected" | "completed" | "cancelled" | "failed" | "sent_back" | "next_scheduled";
  note?: string;
  attachmentIds?: string[];
};

/** The fields this module reads and writes. Real task objects carry many more. */
export type FlowTask = {
  id: string;
  title?: string;
  clientId?: string;
  assigneeId?: string;
  status?: string;
  due?: string;
  dueAt?: string;
  repeat?: TaskRepeat | string;
  repeatTime?: string;
  seriesId?: string;
  occurrence?: number;
  createdAt?: string;
  completedAt?: string;
  pendingReason?: string;
  pendingReasonBy?: string;
  pendingReasonAt?: string;
  aiMode?: string;
  aiRunState?: string;
  aiRunStartedAt?: string;
  aiProgressText?: string;
  aiProgressAt?: string;
  aiRunAt?: string;
  aiRunAttempt?: number;
  aiStartNowRequestedAt?: string;
  aiCancelRequestedAt?: string;
  aiCancelRequestedBy?: string;
  aiDismissedAt?: string;
  aiFeedback?: string;
  aiApprovals?: Array<{ status: string; [key: string]: unknown }>;
  attachments?: FlowAttachment[];
  /** Agents post the thing they want approved here (id "agent-approval-…"). */
  aiRecommendations?: Array<{ id: string; title?: string; detail?: string; attachmentIds?: string[]; rejectedAt?: string; supersededAt?: string; followUpTaskId?: string; [key: string]: unknown }>;
  paused?: boolean;
  approvalRequest?: TaskApprovalRequest;
  /** Set when the owner approved: the next run finishes straight to Done. */
  approvalGrantedAt?: string;
  outcome?: "completed" | "rejected";
  flowHistory?: TaskHistoryEvent[];
};

type Actor = { by: string; at: string };

const PENDING_STATUSES = new Set(["Blocked", "Pending"]);
const shortText = (value: unknown, limit: number) => String(value ?? "").replace(/\s+/g, " ").trim().slice(0, limit);
const newId = () => (globalThis.crypto?.randomUUID?.() || `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);

/** A run with no sign of life for this long has stopped, whatever its stored state says. */
export const ABANDONED_RUN_MS = 30 * 60_000;

/** True only while an AI run is genuinely alive (recent start or progress update). */
export function isLiveRun(task: Pick<FlowTask, "aiRunState" | "aiRunStartedAt" | "aiProgressAt">, now = Date.now()): boolean {
  if (task.aiRunState !== "running") return false;
  const lastSign = Math.max(Date.parse(task.aiProgressAt || "") || 0, Date.parse(task.aiRunStartedAt || "") || 0);
  return lastSign > 0 && now - lastSign < ABANDONED_RUN_MS;
}

/** A run marked "running" that has gone quiet — it belongs in Pending with its last progress as the reason. */
export function isAbandonedRun(task: FlowTask, now = Date.now()): boolean {
  return task.status !== TASK_STATUS.done && task.aiRunState === "running" && !isLiveRun(task, now);
}

export function isAiTask(task: Pick<FlowTask, "assigneeId" | "aiMode">, botIds?: ReadonlySet<string>): boolean {
  const id = String(task.assigneeId || "");
  if (botIds) return botIds.has(id);
  return id === "f2b-ai-agent" || id.startsWith("f2b-ai-agent-") || Boolean(task.aiMode);
}

function withEvent<T extends FlowTask>(task: T, event: Omit<TaskHistoryEvent, "id">): T {
  return { ...task, flowHistory: [...(task.flowHistory || []), { id: newId(), ...event }].slice(-60) };
}

/**
 * Where a task shows on the board. Strict: an AI task is only In progress while
 * the AI is acting. Anything that stopped without finishing is Pending.
 */
export function boardColumn(task: FlowTask, botIds?: ReadonlySet<string>, now = Date.now()): BoardColumn {
  if (task.status === TASK_STATUS.done) return "done";
  const ai = isAiTask(task, botIds);
  if (ai) {
    const applyingChange = (task.aiApprovals || []).some((item) => item.status === "applying");
    if (isLiveRun(task, now) || task.aiStartNowRequestedAt || applyingChange) return "in_progress";
    if (task.aiRunState === "running") return "pending"; // went quiet — stopped
    if (task.approvalRequest?.status === "awaiting" || PENDING_STATUSES.has(String(task.status))) return "pending";
    if (["failed", "needs_review", "needs_connection", "cancelled"].includes(String(task.aiRunState))) return "pending";
    // An AI task marked In progress with no live run has stopped — it is Pending.
    if (task.status === TASK_STATUS.inProgress) return "pending";
    return "todo"; // scheduled / paused / not started
  }
  if (task.approvalRequest?.status === "awaiting" || PENDING_STATUSES.has(String(task.status))) return "pending";
  if (task.status === TASK_STATUS.inProgress) return "in_progress";
  return "todo";
}

/** Tasks waiting on the owner's decision — the Approvals tab. */
export function needsOwnerDecision(task: FlowTask): boolean {
  return task.status !== TASK_STATUS.done && task.approvalRequest?.status === "awaiting";
}

/** "Weekly" / "Every 2 weeks" / "One-off". */
export function frequencyLabel(task: Pick<FlowTask, "repeat">): string {
  switch (task.repeat) {
    case "Daily": return "Daily";
    case "Weekly": return "Weekly";
    case "Fortnightly": return "Every 2 weeks";
    case "Monthly": return "Monthly";
    default: return "One-off";
  }
}

/** "Thu 26 Nov · 09:00" in Europe/Dublin, or "No date set". */
export function scheduleLabel(task: Pick<FlowTask, "due" | "dueAt" | "repeatTime">, timeZone = "Europe/Dublin"): string {
  const iso = task.dueAt || (task.due ? `${task.due}T${task.repeatTime || "09:00"}:00` : "");
  if (!iso) return "No date set";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "No date set";
  const day = new Intl.DateTimeFormat("en-IE", { timeZone, weekday: "short", day: "numeric", month: "short" }).format(date).replace(",", "");
  const time = new Intl.DateTimeFormat("en-IE", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).format(date);
  return `${day} · ${time}`;
}

/** Requests an agent posted for approval that are still open. */
export function openAgentRequests(task: Pick<FlowTask, "aiRecommendations">) {
  return (task.aiRecommendations || []).filter((item) => String(item.id).startsWith("agent-approval-") && !item.rejectedAt && !item.supersededAt && !item.followUpTaskId);
}

/** The actual thing the AI wants approved (post copy, plan, fix list), as editable text. */
export function requestTextFromTask(task: Pick<FlowTask, "aiRecommendations">): string {
  return openAgentRequests(task)
    .map((item) => [String(item.title || "").replace(/^Approval needed:\s*/i, "").trim(), String(item.detail || "").trim()].filter(Boolean).join("\n\n"))
    .filter(Boolean).join("\n\n———\n\n");
}

/** Once the owner decides, the agent's original request items are closed so they don't linger elsewhere. */
function closeAgentRequests<T extends FlowTask>(task: T, at: string): T {
  if (!openAgentRequests(task).length) return task;
  return { ...task, aiRecommendations: (task.aiRecommendations || []).map((item) => String(item.id).startsWith("agent-approval-") && !item.supersededAt ? { ...item, supersededAt: at } : item) };
}

// ---------------------------------------------------------------- transitions

/** The AI (or a person) starts working. To do → In progress. */
export function startTask<T extends FlowTask>(task: T, actor: Actor, ai: boolean): T {
  const started: T = {
    ...task,
    status: TASK_STATUS.inProgress,
    pendingReason: undefined,
    pendingReasonBy: undefined,
    pendingReasonAt: undefined,
    ...(ai ? { aiRunState: "running", aiRunStartedAt: actor.at, aiRunAt: undefined, aiStartNowRequestedAt: undefined, aiCancelRequestedAt: undefined, aiCancelRequestedBy: undefined } : {}),
  };
  return withEvent(started, { at: actor.at, by: actor.by, action: "started", note: task.approvalGrantedAt ? "Resumed after owner approval" : undefined });
}

/**
 * Anything that stops a task without finishing it: the AI stopped, handed over to
 * another agent, needs a decision, failed, or was cancelled. In progress → Pending,
 * with a required reason and an approval request addressed to the owner.
 */
export function moveToPending<T extends FlowTask>(task: T, input: Actor & { reason: string; request?: string; kind?: "stopped" | "handover" | "needs_approval" | "failed" | "cancelled"; aiRunState?: string }): { task: T; error: string } {
  const reason = shortText(input.reason, 300);
  if (!reason) return { task, error: "A reason is required before a task can move to Pending." };
  const given = String(input.request ?? "").trim();
  const request = (given && given !== reason ? given : requestTextFromTask(task) || given || reason).slice(0, 20_000);
  const approvalRequest: TaskApprovalRequest = {
    id: newId(),
    status: "awaiting",
    reason,
    request,
    to: OWNER_APPROVER_EMAIL,
    requestedAt: input.at,
    requestedBy: input.by,
    emailStatus: "queued",
  };
  let next: T = {
    ...task,
    status: TASK_STATUS.pending,
    pendingReason: shortText(reason, 150),
    pendingReasonBy: input.by,
    pendingReasonAt: input.at,
    approvalRequest,
    approvalGrantedAt: undefined,
    aiStartNowRequestedAt: undefined,
    aiCancelRequestedAt: undefined,
    aiCancelRequestedBy: undefined,
    ...(task.aiRunState === "running" || input.aiRunState ? { aiRunState: input.aiRunState || "needs_review", aiRunStartedAt: undefined, aiRunAt: input.at } : {}),
  };
  next = withEvent(next, { at: input.at, by: input.by, action: input.kind === "failed" ? "failed" : input.kind === "cancelled" ? "cancelled" : "pending", note: reason });
  next = withEvent(next, { at: input.at, by: input.by, action: "approval_requested", note: `Sent to ${OWNER_APPROVER_EMAIL}` });
  return { task: next, error: "" };
}

/**
 * Owner approves (optionally after editing exactly what the AI asked for).
 * Pending → In progress. AI tasks are queued to resume at once; that run finishes
 * straight to Done and never asks for approval again.
 */
export function approveTask<T extends FlowTask>(task: T, input: Actor & { editedRequest?: string; note?: string; ai: boolean }): { task: T; error: string } {
  if (!task.approvalRequest || task.approvalRequest.status !== "awaiting") return { task, error: "This task is not waiting for approval." };
  const edited = String(input.editedRequest ?? "").trim();
  const approvalRequest: TaskApprovalRequest = {
    ...task.approvalRequest,
    status: "approved",
    ...(edited && edited !== task.approvalRequest.request.trim() ? { editedRequest: edited.slice(0, 20_000) } : {}),
    ...(input.note?.trim() ? { ownerNote: input.note.trim().slice(0, 4000) } : {}),
    decidedAt: input.at,
    decidedBy: input.by,
  };
  let next: T = {
    ...closeAgentRequests(task, input.at),
    status: TASK_STATUS.inProgress,
    pendingReason: undefined,
    pendingReasonBy: undefined,
    pendingReasonAt: undefined,
    approvalRequest,
    approvalGrantedAt: input.at,
    ...(input.ai ? { aiRunState: "scheduled", aiStartNowRequestedAt: input.at, aiRunStartedAt: undefined, aiRunAttempt: (task.aiRunAttempt || 0) + 1 } : {}),
  };
  next = withEvent(next, { at: input.at, by: input.by, action: "approved", note: approvalRequest.editedRequest ? "Approved with edits — sent back to the AI" : "Approved — sent back to the AI" });
  return { task: next, error: "" };
}

/** Owner rejects. Pending → Done (outcome rejected). */
export function rejectTask<T extends FlowTask>(task: T, input: Actor & { note?: string }): { task: T; error: string } {
  if (!task.approvalRequest || task.approvalRequest.status !== "awaiting") return { task, error: "This task is not waiting for approval." };
  let next: T = {
    ...closeAgentRequests(task, input.at),
    status: TASK_STATUS.done,
    outcome: "rejected",
    completedAt: input.at,
    pendingReason: undefined,
    pendingReasonBy: undefined,
    pendingReasonAt: undefined,
    approvalGrantedAt: undefined,
    aiStartNowRequestedAt: undefined,
    ...(task.aiRunState ? { aiRunState: "completed" } : {}),
    approvalRequest: { ...task.approvalRequest, status: "rejected", ...(input.note?.trim() ? { ownerNote: input.note.trim().slice(0, 4000) } : {}), decidedAt: input.at, decidedBy: input.by },
  };
  next = withEvent(next, { at: input.at, by: input.by, action: "rejected", note: input.note?.trim() || "Rejected by the owner" });
  return { task: next, error: "" };
}

/** Mark finished. Merges any files the work produced so they show in History. */
export function completeTask<T extends FlowTask>(task: T, input: Actor & { attachments?: FlowAttachment[]; note?: string }): T {
  const files = input.attachments || [];
  const attachments = files.length
    ? [...(task.attachments || []).filter((item) => !files.some((file) => file.id === item.id)), ...files]
    : task.attachments;
  const done: T = {
    ...task,
    status: TASK_STATUS.done,
    outcome: "completed",
    completedAt: input.at,
    attachments,
    pendingReason: undefined,
    pendingReasonBy: undefined,
    pendingReasonAt: undefined,
    aiStartNowRequestedAt: undefined,
    ...(task.aiRunState ? { aiRunState: "completed", aiRunStartedAt: undefined, aiRunAt: input.at } : {}),
  };
  return withEvent(done, { at: input.at, by: input.by, action: "completed", note: input.note, attachmentIds: files.map((file) => file.id) });
}

/**
 * The single decision at the end of every AI run.
 * - Approved run (owner already said yes) → Done, no matter what. No more approvals.
 * - Otherwise finished cleanly → Done.
 * - Otherwise → Pending with the reason and request, and an approval request to the owner.
 */
export function finishAiRun<T extends FlowTask>(task: T, input: Actor & { finished: boolean; reason?: string; request?: string; attachments?: FlowAttachment[]; note?: string }): { task: T; column: BoardColumn } {
  if (task.approvalGrantedAt || input.finished) {
    return { task: completeTask(task, { at: input.at, by: input.by, attachments: input.attachments, note: input.note || (task.approvalGrantedAt ? "Completed after owner approval" : undefined) }), column: "done" };
  }
  const withFiles: T = input.attachments?.length ? { ...task, attachments: [...(task.attachments || []), ...input.attachments.filter((file) => !(task.attachments || []).some((item) => item.id === file.id))] } : task;
  const pending = moveToPending(withFiles, { at: input.at, by: input.by, reason: input.reason || "The AI stopped before finishing and needs a decision.", request: input.request, kind: "needs_approval", aiRunState: "needs_review" });
  return { task: pending.task, column: "pending" };
}

// ---------------------------------------------------------------- recurrence

export function seriesKey(task: Pick<FlowTask, "id" | "seriesId">): string {
  return task.seriesId || task.id;
}

/** True when a later occurrence of this series already exists (in any column). */
export function hasLaterOccurrence(task: FlowTask, allTasks: readonly FlowTask[]): boolean {
  const key = seriesKey(task);
  const occurrence = task.occurrence || 1;
  return allTasks.some((item) => item.id !== task.id && seriesKey(item) === key && (item.occurrence || 1) > occurrence);
}

/** Next calendar date for a simple repeat, in Europe/Dublin calendar days. */
export function nextRepeatDate(due: string, repeat: TaskRepeat | string | undefined): string | null {
  if (!due || !repeat || repeat === "None") return null;
  const [year, month, day] = due.slice(0, 10).split("-").map(Number);
  if (!year || !month || !day) return null;
  const date = new Date(Date.UTC(year, month - 1, day, 12));
  if (repeat === "Monthly") {
    const target = date.getUTCMonth() + 1;
    date.setUTCMonth(target);
    if (date.getUTCMonth() !== target % 12) date.setUTCDate(0); // 31 Jan → 28/29 Feb
  } else date.setUTCDate(date.getUTCDate() + (repeat === "Daily" ? 1 : repeat === "Fortnightly" ? 14 : 7));
  return date.toISOString().slice(0, 10);
}

/**
 * Called the moment a task leaves To do. Returns the next occurrence to add to To do,
 * or null (one-off, or the next one already exists). `schedule` lets callers supply
 * their own date rules (Google Ads templates, Dublin time zone conversion).
 */
export function nextOccurrenceOnStart<T extends FlowTask>(task: T, allTasks: readonly FlowTask[], schedule: { due: string; dueAt?: string; id?: string; at: string }): T | null {
  if (!task.repeat || task.repeat === "None") return null;
  if (hasLaterOccurrence(task, allTasks)) return null;
  const fresh: T = {
    ...task,
    id: schedule.id || newId(),
    seriesId: seriesKey(task),
    occurrence: (task.occurrence || 1) + 1,
    status: TASK_STATUS.todo,
    due: schedule.due,
    dueAt: schedule.dueAt,
    createdAt: schedule.at,
    completedAt: undefined,
    outcome: undefined,
    pendingReason: undefined,
    pendingReasonBy: undefined,
    pendingReasonAt: undefined,
    approvalRequest: undefined,
    approvalGrantedAt: undefined,
    aiRunStartedAt: undefined,
    aiRunAt: undefined,
    aiRunAttempt: 0,
    aiStartNowRequestedAt: undefined,
    aiCancelRequestedAt: undefined,
    aiCancelRequestedBy: undefined,
    aiFeedback: undefined,
    aiApprovals: [],
    attachments: [],
    flowHistory: [],
    ...(task.aiRunState !== undefined || task.aiMode ? { aiRunState: task.paused ? "paused" : "scheduled" } : {}),
  };
  return withEvent(fresh, { at: schedule.at, by: "Scheduler", action: "scheduled", note: `Occurrence ${fresh.occurrence} · ${frequencyLabel(task)}` });
}

// ---------------------------------------------------------------- history

export type HistoryItem = { task: FlowTask; finishedAt: string; outcome: "completed" | "rejected"; files: FlowAttachment[]; approval?: TaskApprovalRequest };

/** Done tasks, newest first, with every file the work produced. */
export function historyItems(tasks: readonly FlowTask[]): HistoryItem[] {
  return tasks
    .filter((task) => task.status === TASK_STATUS.done)
    .map((task) => ({
      task,
      finishedAt: task.completedAt || task.aiRunAt || task.createdAt || "",
      outcome: task.outcome || (task.approvalRequest?.status === "rejected" ? "rejected" : "completed") as "completed" | "rejected",
      files: task.attachments || [],
      approval: task.approvalRequest,
    }))
    .sort((a, b) => (Date.parse(b.finishedAt) || 0) - (Date.parse(a.finishedAt) || 0));
}

/** Re-open a finished task from History with the owner's edits. Sent straight back to the AI, pre-approved. */
export function sendBackFromHistory<T extends FlowTask>(task: T, input: Actor & { editedRequest: string; note?: string; ai: boolean }): { task: T; error: string } {
  if (task.status !== TASK_STATUS.done) return { task, error: "Only finished tasks can be sent back from History." };
  const edited = input.editedRequest.trim();
  if (!edited && !input.note?.trim()) return { task, error: "Add your edits or instructions before sending this back." };
  const approvalRequest: TaskApprovalRequest = {
    id: newId(), status: "approved", reason: "Sent back from History by the owner",
    request: task.approvalRequest?.editedRequest || task.approvalRequest?.request || "", editedRequest: edited || undefined,
    ownerNote: input.note?.trim() || undefined, to: OWNER_APPROVER_EMAIL, requestedAt: input.at, requestedBy: input.by, emailStatus: "skipped", decidedAt: input.at, decidedBy: input.by,
  };
  let next: T = {
    ...task, status: input.ai ? TASK_STATUS.inProgress : TASK_STATUS.todo, outcome: undefined, completedAt: undefined, approvalRequest, approvalGrantedAt: input.at,
    ...(input.ai ? { aiRunState: "scheduled", aiStartNowRequestedAt: input.at, aiRunAttempt: (task.aiRunAttempt || 0) + 1 } : {}),
  };
  next = withEvent(next, { at: input.at, by: input.by, action: "sent_back", note: "Edited and sent back to the AI" });
  return { task: next, error: "" };
}

// ---------------------------------------------------------------- approval email

const escapeHtml = (value: string) => value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/** The approval request email sent to the owner when a task enters Pending. */
export function approvalEmail(task: FlowTask, context: { clientName: string; agentName: string; appUrl: string }) {
  const request = task.approvalRequest;
  const link = new URL(context.appUrl);
  link.searchParams.set("page", "Tasks");
  link.searchParams.set("view", "approvals");
  link.searchParams.set("taskId", task.id);
  const subject = `Approval needed · ${context.clientName} · ${shortText(task.title, 80)}`;
  const reason = request?.reason || task.pendingReason || "Needs your decision.";
  const body = request?.request && request.request !== reason ? request.request : "";
  const text = `Hi Sean,\n\n${context.agentName} moved a task to Pending and needs your approval.\n\nClient: ${context.clientName}\nTask: ${task.title}\nReason: ${reason}${body ? `\n\nWhat they are asking for:\n${body}` : ""}\n\nApprove (you can edit it first) or reject: ${link.toString()}\n\nApprove → the AI finishes it and it goes straight to Done.\nReject → it goes to Done without further work.`;
  const html = `<p>Hi Sean,</p><p><strong>${escapeHtml(context.agentName)}</strong> moved a task to Pending and needs your approval.</p><p>Client: <strong>${escapeHtml(context.clientName)}</strong><br/>Task: <strong>${escapeHtml(String(task.title || ""))}</strong><br/>Reason: ${escapeHtml(reason)}</p>${body ? `<p><strong>What they are asking for</strong></p><pre style="white-space:pre-wrap;font-family:inherit;background:#f4f6f8;padding:12px;border-radius:8px">${escapeHtml(body.slice(0, 6000))}</pre>` : ""}<p><a href="${escapeHtml(link.toString())}" style="display:inline-block;background:#0f6fb4;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">Review &amp; approve</a></p><p style="color:#667">Approve → the AI finishes it and it goes straight to Done. Reject → it goes to Done without further work.</p>`;
  return { to: OWNER_APPROVER_EMAIL, subject, text, html };
}

/** Instructions handed to the AI when it resumes after approval. */
export function approvedRunInstructions(task: FlowTask): string {
  if (!task.approvalGrantedAt || !task.approvalRequest) return "";
  const request = task.approvalRequest;
  const approved = request.editedRequest || request.request;
  return ` OWNER APPROVAL GRANTED: the owner has approved this task${request.editedRequest ? " with edits" : ""}. Carry out exactly the approved version below and finish the task. Do not ask for approval again and do not propose further changes for approval. Approved version: ${JSON.stringify(approved.slice(0, 8000))}${request.ownerNote ? ` Owner instructions: ${JSON.stringify(request.ownerNote.slice(0, 2000))}` : ""}`;
}
