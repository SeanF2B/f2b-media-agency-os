export type ReplyLabel = "positive" | "negative" | "question" | "objection" | "out-of-office" | "referral" | "unsubscribe" | "bounce" | "spam" | "needs-review" | "meeting-booked";
export type Classification = { label: ReplyLabel; confidence: number; reason: string; source: "ai" | "rule" | "human" };
export const LABELS: readonly ReplyLabel[];
export const REVIEW_THRESHOLD: number;
export const NOTIFY_LABELS: Set<ReplyLabel>;
export function ruleClassify(email: { from?: string; subject?: string; text?: string; headers?: Record<string, string> }): Classification | null;
export function buildClassifierMessages(email: { subject?: string; text?: string }, context?: { campaignName?: string; ourLastMessage?: string }): Array<{ role: "system" | "user"; content: string }>;
export function parseClassifierOutput(raw: string): Classification | null;
export function decide(result: Classification | null): Classification & { needsReview: boolean; notify: boolean; stopsSequence: boolean };
