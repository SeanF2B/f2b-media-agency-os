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
  if (!String(approval.evidence || "").trim()) return "This change has no saved supporting evidence. Continue with the AI to gather it before approving.";
  const index = approval.checklistIndex;
  if (!Number.isInteger(index) || Number(index) < 0 || Number(index) >= checklist.length) {
    return "This change is not linked to a saved checklist step. Continue with the AI to rebuild the evidence link before approving.";
  }
  const step = checklist[Number(index)];
  const label = `Checklist step ${Number(index) + 1}${step.text ? ` (“${step.text}”)` : ""}`;
  if (!step.done) return `${label} still needs evidence. Continue with the AI to retry that step before approving.`;
  if (!String(step.evidence || "").trim()) return `${label} is marked verified but has no saved evidence. Continue with the AI to record it before approving.`;
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

const optionalChecklistLanguage = /\b(?:when|if|where)\b.{0,35}\b(?:connected|available|supplied|provided|applicable|configured)\b|\bwhen (?:client|crm|lead|tracking) data is available\b|\busing available (?:data|evidence)\b/i;
const unavailableEvidence = /\b(?:not supplied|not provided|not connected|not available|unavailable|no (?:connected|supplied|available|configured)\b|no\s+.{0,80}\b(?:provided|supplied|connected|available|url|page|data|lead|crm|tracking)\b|could not (?:be )?(?:supplied|connected|verified|checked)|is not connected|are not connected)\b/i;

/** Mark conditional checks as satisfied when the run explicitly records that their prerequisite does not exist. */
export function resolveOptionalChecklistGaps<T extends { text?: string; done?: boolean; evidence?: string }>(steps: T[]): T[] {
  return steps.map((step) => {
    if (step.done || !optionalChecklistLanguage.test(String(step.text || "")) || !unavailableEvidence.test(String(step.evidence || ""))) return step;
    return { ...step, done: true, evidence: `Not applicable for this run: ${String(step.evidence || "").trim()}` };
  });
}

export function resolveOutOfScopeLandingPageBlockers<T extends { text?: string; done?: boolean; evidence?: string }>(
  steps: T[],
  input: { landingPageReviewRequired: boolean; searchTermsAvailable: boolean; negativesAvailable: boolean },
): T[] {
  if (input.landingPageReviewRequired || !input.searchTermsAvailable || !input.negativesAvailable) return steps;
  return steps.map((step) => {
    const text = String(step.text || "");
    const evidence = String(step.evidence || "");
    if (step.done || !/negative(?:s| keyword(?:s)?)?/i.test(text) || !/no negative (?:(?:is|was|has been) )?recommended/i.test(evidence) || !/landing[- ]page|\bctas?\b|call to action/i.test(evidence)) return step;
    return {
      ...step,
      done: true,
      evidence: "Reviewed the live search-term report and existing negative keywords. No negative met the evidence threshold, so no change was proposed. Landing-page and CTA checks are outside this task.",
    };
  });
}

/** Finish an audit check when it was reviewed against connected Ads data and a clearly identified optional source is unavailable. */
export function resolveGoogleAdsAuditLimitations<T extends { text?: string; done?: boolean; evidence?: string }>(
  steps: T[],
  input: { accountConnected: boolean; campaignFound: boolean; dailyPerformanceAvailable: boolean; conversionActionsAvailable: boolean; campaignGoalsAvailable: boolean; changeHistoryAvailable: boolean },
): T[] {
  if (!input.accountConnected || !input.campaignFound) return steps;
  const gap = /not supplied|not provided|not connected|not available|unavailable|missing|could not be (?:verified|checked|confirmed|assessed)|cannot be (?:verified|checked|confirmed|assessed|determined)|cannot determine (?:whether|if)|unable to determine (?:whether|if)|no (?:direct|campaign|account|daily|event|tag|crm|lead|qualified|conversion|website).{0,55}(?:data|evidence|report|diagnostic|configuration|status|history|access)/i;
  const technicalFailure = /HTTP\s*\d{3}|request failed|permission denied|authorization failed|token missing|account access .* rejected/i;
  return steps.map((step) => {
    const evidence = String(step.evidence || "").trim();
    const text = String(step.text || "").toLocaleLowerCase();
    if (step.done || !gap.test(evidence) || technicalFailure.test(evidence)) return step;
    const sourceWasReviewed =
      (/delivery|account alert|campaign alert|account health/.test(text) && input.dailyPerformanceAvailable) ||
      (/(?:spend|budget|bidding|impression share|daily trend|weekly|monthly|previous calendar month|last 7 days|30.day)/.test(text) && input.dailyPerformanceAvailable) ||
      (/(?:qualified.?lead|crm|lead quality)/.test(text) && input.dailyPerformanceAvailable) ||
      (/(?:conversion|tracking|primary|secondary|goal|form|call|tag|pixel|event)/.test(text) && input.conversionActionsAvailable && input.campaignGoalsAvailable) ||
      (/(?:change history|account activity|earlier task findings|recent changes)/.test(text) && input.changeHistoryAvailable);
    if (!sourceWasReviewed) return step;
    return {
      ...step,
      done: true,
      evidence: `REVIEWED WITH LIMITATION: ${evidence} The available Google Ads campaign evidence was checked; no unsupported result is claimed, and the unavailable source is recorded for follow-up.`,
    };
  });
}

export function explicitlyRequestsGoogleAdsChange(instructions: string | undefined) {
  const action = /\b(?:pause|stop|enable|resume|set|change|increase|decrease|add|remove|edit|update|create|delete)\b/i;
  const target = /\b(?:campaign|budget|keyword|ad group|ad|bid|negative)\b/i;
  return String(instructions || "").split(/[.!?;\n]+/).some((sentence) => {
    const text = sentence.trim();
    if (!text || /\b(?:do not|don't|never|avoid|without)\b/i.test(text)) return false;
    return action.test(text) && target.test(text);
  });
}

export function googleAdsTaskEvidenceScope(input: { title?: string; instructions?: string; checklist?: Array<{ text?: string }> }) {
  const text = [input.title, input.instructions, ...(input.checklist || []).map((item) => item.text)]
    .filter(Boolean).join("\n").toLocaleLowerCase();
  const requiredPageChecks = (input.checklist || []).filter((item) => !/\b(?:when|if|where)\b.{0,45}\b(?:connected|available|supplied|provided|applicable|configured)\b/i.test(String(item.text || "")));
  const landingPageScopeText = [input.title, input.instructions, ...requiredPageChecks.map((item) => item.text)].filter(Boolean).join("\n").toLocaleLowerCase();
  const landingPages = /landing page|page relevance|headline|ad copy|quality score|call to action|\bcta\b/.test(landingPageScopeText);
  const searchTerms = /search term|negative keyword/.test(text);
  const keywordPerformance = /\bkeyword\b|quality score|keyword planner|keyword research/.test(text);
  const adPerformance = /performance|budget|bidding|\bbid\b|account health|monthly report|conversion/.test(text);
  const responsiveAds = landingPages || /ad asset|responsive search ad|\brsa\b/.test(text);
  const campaignAssets = /\b(?:ad assets?|sitelinks?|callouts?|structured snippets?)\b/.test(text);
  return {
    adPerformance,
    adGroups: searchTerms || keywordPerformance || responsiveAds || /ad group/.test(text),
    searchTerms,
    keywordPerformance,
    negativeKeywords: /negative keyword/.test(text),
    changeHistory: /change history|change events|unusual changes|compare changes|account activity/.test(text),
    conversionActions: /conversion|tracking|account health/.test(text),
    campaignDailyPerformance: /account health|spend|budget|bidding|performance|monthly report/.test(text),
    campaignLocations: /target area|location targeting|geographic target|service area|geo-target/i.test(text),
    responsiveAds,
    campaignAssets,
    keywordPlanner: /keyword planner|keyword research/.test(text),
    landingPages,
  };
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
