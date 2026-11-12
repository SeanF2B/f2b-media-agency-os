import type { TeamPermissions } from "@/lib/access-permissions";

type AiTaskVisibilityRecord = {
  assigneeId?: string;
  status?: string;
  aiRunState?: string;
  aiCancelRequestedAt?: string;
  aiDismissedAt?: string;
  aiMode?: string;
  service?: string;
  checklist?: Array<{ text?: string; done?: boolean; evidence?: string }>;
  aiApprovals?: Array<{ status: string; verification?: string; resultDetail?: string; checklistIndex?: number; evidence?: string }>;
};

export function isAiAssignedTask(task: AiTaskVisibilityRecord): boolean {
  return task.assigneeId === "f2b-ai-agent" || Boolean(task.assigneeId?.startsWith("f2b-ai-agent-"));
}

export function isCompletedAiTask(task: AiTaskVisibilityRecord): boolean {
  return isAiAssignedTask(task)
    && task.status === "Done"
    && task.aiRunState === "completed"
    && (task.checklist || []).every((step) => step.done && String(step.evidence || "").trim())
    && (task.aiApprovals || []).every((item) => item.status === "rejected" || (item.status === "applied" && item.verification === "verified" && !/could not verify the final live state|not verified/i.test(item.resultDetail || "")));
}

export type AiTaskStage = "approvals" | "pending" | "scheduled" | "doing" | "completed" | "dismissed" | "cancelled";

function isDecisionReady(approval: NonNullable<AiTaskVisibilityRecord["aiApprovals"]>[number], checklist: NonNullable<AiTaskVisibilityRecord["checklist"]>) {
  const index = approval.checklistIndex;
  if (!String(approval.evidence || "").trim() || !Number.isInteger(index) || Number(index) < 0 || Number(index) >= checklist.length) return false;
  const step = checklist[Number(index)];
  return Boolean(step.done && String(step.evidence || "").trim());
}

/** Put every AI task in exactly one tab, keeping scheduled runs separate from review queues. */
export function getAiTaskStage(task: AiTaskVisibilityRecord): AiTaskStage {
  if (task.aiDismissedAt) return "dismissed";
  if (task.aiRunState === "cancelled") return "cancelled";
  if (isCompletedAiTask(task)) return "completed";
  if (task.aiRunState === "running" || (task.aiApprovals || []).some((item) => item.status === "applying")) return "doing";
  const pendingApprovals = (task.aiApprovals || []).filter((item) => item.status === "pending");
  if (pendingApprovals.some((item) => isDecisionReady(item, task.checklist || []))) return "approvals";
  // A proposal without its linked evidence is still Connors' work to finish,
  // not a decision the owner can act on. Keep it in Pending until it is ready.
  if (pendingApprovals.length) return "pending";
  if (task.aiRunState === "scheduled") return "scheduled";
  return "pending";
}

export function canViewAiAssignedTask(
  task: AiTaskVisibilityRecord,
  permissions: Pick<TeamPermissions, "aiTasks" | "aiCompletedTasks">,
  allowedAiModes: readonly string[],
): boolean {
  if (!isAiAssignedTask(task) || !permissions.aiTasks) return false;
  if (!allowedAiModes.includes(task.aiMode || task.service || "Setup")) return false;
  return !isCompletedAiTask(task) || permissions.aiCompletedTasks;
}
