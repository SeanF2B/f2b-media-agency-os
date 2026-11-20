// Follow-up settings for booking calendars (pure: no database, safe for the browser and tests).
export type FollowUpKind = "cancelled" | "no_show";
export type FollowUp = { on: boolean; channel: "email" | "message" | "both"; count: number; firstDelayHours: number; gapDays: number; automationId?: string };
export const FOLLOW_UP_KINDS: Array<{ kind: FollowUpKind; label: string; trigger: string; help: string }> = [
  { kind: "cancelled", label: "After a cancellation", trigger: "appointment_cancelled", help: "Offer a new time after someone cancels (the cancellation email itself is already sent)." },
  { kind: "no_show", label: "After a no-show", trigger: "appointment_no_show", help: "When you mark someone as a no-show: a friendly message with a link to rebook." },
];
export const DEFAULT_FOLLOW_UP: FollowUp = { on: false, channel: "both", count: 2, firstDelayHours: 1, gapDays: 3 };

export function sanitizeFollowUps(input: unknown): Partial<Record<FollowUpKind, FollowUp>> {
  const v = (input && typeof input === "object" ? input : {}) as Record<string, any>;
  const out: Partial<Record<FollowUpKind, FollowUp>> = {};
  for (const { kind } of FOLLOW_UP_KINDS) {
    const f = v[kind];
    if (!f || typeof f !== "object") continue;
    out[kind] = {
      on: f.on === true,
      channel: f.channel === "email" || f.channel === "message" ? f.channel : "both",
      count: Math.max(1, Math.min(5, Math.round(Number(f.count) || 1))),
      firstDelayHours: Math.max(0, Math.min(72, Math.round(Number(f.firstDelayHours) || 0))),
      gapDays: Math.max(1, Math.min(30, Math.round(Number(f.gapDays) || 3))),
      automationId: typeof f.automationId === "string" ? f.automationId.slice(0, 80) : undefined,
    };
  }
  return out;
}

