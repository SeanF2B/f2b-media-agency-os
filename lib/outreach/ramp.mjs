// Compliant sending ramp-up (our "one-click warm-up"). No fake conversations, no
// engagement networks: a new mailbox simply sends real campaign email at a slowly rising
// daily volume, and the ramp halts or steps back when real health signals get worse.

export const DEFAULT_RAMP = Object.freeze({
  startDaily: 5,          // day 1
  stepPerDay: 3,          // added each sending day while healthy
  newDomainDays: 14,      // domains younger than this are held to newDomainCap
  newDomainCap: 15,
  hardMax: 50,            // never exceed per mailbox per day, whatever the target
});

const DAY = 86_400_000;
const utcDay = (date) => new Date(date).toISOString().slice(0, 10);

/**
 * Today's sending allowance for one mailbox.
 * @param {object} p
 * @param {string|null} p.rampStartedAt   ISO date the ramp began (null = not started)
 * @param {number} p.targetDaily          the owner's chosen steady-state volume
 * @param {string|null} [p.domainRegisteredAt]
 * @param {"green"|"amber"|"red"|"grey"} [p.healthBand]
 * @param {number} [p.sentToday]
 * @param {Date|string|number} [p.now]
 */
export function dailyAllowance({ rampStartedAt, targetDaily, domainRegisteredAt = null, healthBand = "grey", sentToday = 0, now = Date.now() }, ramp = DEFAULT_RAMP) {
  const target = Math.max(1, Math.min(ramp.hardMax, Math.floor(targetDaily || 0) || 1));
  if (!rampStartedAt) return { limit: 0, remaining: 0, phase: "not-started", reason: "Warm-up hasn't been started for this mailbox." };
  if (healthBand === "red") return { limit: 0, remaining: 0, phase: "paused", reason: "Sending is paused by a safety threshold." };
  const days = Math.max(0, Math.floor((new Date(now).getTime() - new Date(rampStartedAt).getTime()) / DAY));
  let limit = Math.min(target, ramp.startDaily + days * ramp.stepPerDay);
  let reason = limit >= target ? "Fully ramped." : `Ramping: day ${days + 1}, ${limit} of ${target} per day.`;
  if (domainRegisteredAt && new Date(now).getTime() - new Date(domainRegisteredAt).getTime() < ramp.newDomainDays * DAY && limit > ramp.newDomainCap) {
    limit = ramp.newDomainCap; reason = `New domain: held at ${ramp.newDomainCap}/day for its first ${ramp.newDomainDays} days.`;
  }
  if (healthBand === "amber") { limit = Math.max(1, Math.floor(limit * 0.5)); reason = "Needs attention: volume halved until health recovers."; }
  const phase = limit >= target ? "active" : "ramping";
  return { limit, remaining: Math.max(0, limit - sentToday), phase, reason, day: utcDay(now) };
}

/** Progress 0–1 for the flame indicator; based only on the real ramp position. */
export function rampProgress({ rampStartedAt, targetDaily, now = Date.now() }, ramp = DEFAULT_RAMP) {
  if (!rampStartedAt) return 0;
  const target = Math.max(1, Math.min(ramp.hardMax, targetDaily || 1));
  const days = Math.max(0, (new Date(now).getTime() - new Date(rampStartedAt).getTime()) / DAY);
  const daysNeeded = Math.max(1, Math.ceil((target - ramp.startDaily) / ramp.stepPerDay));
  return Math.min(1, days / daysNeeded);
}
