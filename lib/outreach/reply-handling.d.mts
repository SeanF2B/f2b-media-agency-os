export const PERMANENT_SUPPRESSION: Set<string>;
export function replyActions(decision: { label: string; confidence: number; needsReview?: boolean } | null, state?: { alreadyNotified?: boolean }): { notify: boolean; stopSequence: boolean; suppress: "unsubscribe" | "complaint" | "bounce" | null; opportunity: boolean; review: boolean; pauseUntil: string | null; silent: boolean; draftReply?: boolean };
export function canRemoveSuppression(reason: string): boolean;
export function recontactAllowed(p: { suppressionReason?: string | null; lastContactedAt?: string | null; cooldownDays?: number; now?: number }): { allowed: boolean; reason: string };
