export type AiEvidenceStep = { text?: string; done: boolean; evidence?: string };
export type AiEvidenceApproval = {
  checklistIndex?: number;
  evidence?: string;
  actionType?: string;
  campaignId?: string;
  adGroupId?: string;
  keyword?: string;
  matchType?: string;
  dailyBudget?: number;
  status: string;
  verification?: string;
  resultDetail?: string;
};

export function approvalEvidenceBlockReason(approval: AiEvidenceApproval, checklist: AiEvidenceStep[] = []) {
  if (!String(approval.evidence || "").trim()) return "This change has no saved supporting evidence. Continue with Connors to gather it before approving.";
  const index = approval.checklistIndex;
  if (!Number.isInteger(index) || Number(index) < 0 || Number(index) >= checklist.length) {
    return "This change is not linked to a saved checklist step. Continue with Connors to rebuild the evidence link before approving.";
  }
  const step = checklist[Number(index)];
  const label = `Checklist step ${Number(index) + 1}${step.text ? ` (“${step.text}”)` : ""}`;
  if (!step.done) return `${label} still needs evidence. Continue with Connors to retry that step before approving.`;
  if (!String(step.evidence || "").trim()) return `${label} is marked verified but has no saved evidence. Continue with Connors to record it before approving.`;
  return "";
}

export function isApprovalReady(approval: AiEvidenceApproval, checklist: AiEvidenceStep[] = []) {
  return !approvalEvidenceBlockReason(approval, checklist);
}

export function hasRunnablePendingApproval(approvals: AiEvidenceApproval[] = [], checklist: AiEvidenceStep[] = []) {
  return approvals.some((approval) => approval.status === "pending" && isApprovalReady(approval, checklist));
}

export function canResumeAiTaskRun(aiRunState: string | undefined, approvals: AiEvidenceApproval[] = [], checklist: AiEvidenceStep[] = []) {
  const incompleteChecklist = checklist.some((step) => !step.done || !String(step.evidence || "").trim());
  const stateCanResume = ["needs_review", "failed", "needs_connection", "cancelled"].includes(aiRunState || "") || aiRunState === "completed" && incompleteChecklist;
  if (!stateCanResume) return false;
  const unresolved = approvals.filter((approval) => approval.status === "pending" || approval.status === "applying");
  const pending = unresolved.filter((approval) => approval.status === "pending");
  const allPendingNeedEvidence = pending.length > 0 && unresolved.length === pending.length && !hasRunnablePendingApproval(pending, checklist);
  return unresolved.length === 0 || allPendingNeedEvidence;
}

export function canCloseAiTask(checklist: AiEvidenceStep[] = [], approvals: AiEvidenceApproval[] = []) {
  const checklistVerified = checklist.every((step) => Boolean(step.done && String(step.evidence || "").trim()));
  const decisionsResolved = approvals.every((approval) => approval.status === "rejected" || (
    approval.status === "applied" && approval.verification === "verified" &&
    !/could not verify the final live state|not verified/i.test(approval.resultDetail || "")
  ));
  return checklistVerified && decisionsResolved;
}

export function sameApprovalAction(a: Pick<AiEvidenceApproval, "actionType" | "campaignId" | "adGroupId" | "keyword" | "matchType" | "dailyBudget">, b: Pick<AiEvidenceApproval, "actionType" | "campaignId" | "adGroupId" | "keyword" | "matchType" | "dailyBudget">) {
  const normalize = (value: unknown) => String(value || "").trim().toLocaleLowerCase();
  return normalize(a.actionType) === normalize(b.actionType) &&
    normalize(a.campaignId) === normalize(b.campaignId) &&
    normalize(a.adGroupId) === normalize(b.adGroupId) &&
    normalize(a.keyword) === normalize(b.keyword) &&
    normalize(a.matchType) === normalize(b.matchType) &&
    Number(a.dailyBudget || 0) === Number(b.dailyBudget || 0);
}
