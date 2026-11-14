// What happens after a reply is classified. Only positive replies interrupt you; everything
// else is handled silently in the background.

export const PERMANENT_SUPPRESSION = new Set(["unsubscribe", "complaint"]);

/**
 * @param {{label:string, confidence:number, needsReview:boolean}} decision  from reply-classifier.decide()
 * @param {{alreadyNotified?: boolean}} [state]
 */
export function replyActions(decision, state = {}) {
  const label = decision?.label || "needs-review";
  const base = { notify: false, stopSequence: label !== "out-of-office", suppress: null, opportunity: false, review: Boolean(decision?.needsReview), pauseUntil: null, silent: true };
  switch (label) {
    case "positive":
      return { ...base, notify: !decision.needsReview && !state.alreadyNotified, opportunity: !decision.needsReview, silent: false, draftReply: true };
    case "question": case "objection": case "referral":
      return { ...base, draftReply: true };              // drafted for you in the Inbox, no ping
    case "negative":
      return { ...base };                                 // sequence stops; contact stays in CRM
    case "unsubscribe":
      return { ...base, suppress: "unsubscribe" };        // permanent, global
    case "spam":
      return { ...base, suppress: "complaint" };          // treat abuse as a complaint: permanent
    case "bounce":
      return { ...base, suppress: "bounce" };
    case "out-of-office":
      return { ...base, stopSequence: false, pauseUntil: "+7d" }; // follow-ups wait a week, no ping
    default:
      return { ...base, review: true };                   // needs-review queue
  }
}

/** Unsubscribes and complaints can never be lifted from the UI or API. */
export function canRemoveSuppression(reason) {
  return !PERMANENT_SUPPRESSION.has(String(reason || ""));
}

/** Re-contact rule: configurable cooldown (0 = off). Permanent suppressions always win. */
export function recontactAllowed({ suppressionReason = null, lastContactedAt = null, cooldownDays = 90, now = Date.now() }) {
  if (suppressionReason && PERMANENT_SUPPRESSION.has(suppressionReason)) return { allowed: false, reason: "Unsubscribed or complained — never contacted again." };
  if (suppressionReason) return { allowed: false, reason: `Suppressed (${suppressionReason}).` };
  const days = Math.max(0, Math.floor(Number(cooldownDays) || 0));
  if (!days || !lastContactedAt) return { allowed: true, reason: "" };
  const elapsed = (new Date(now).getTime() - new Date(lastContactedAt).getTime()) / 86_400_000;
  return elapsed >= days ? { allowed: true, reason: "" } : { allowed: false, reason: `Contacted ${Math.floor(elapsed)} days ago; your re-contact gap is ${days} days.` };
}
