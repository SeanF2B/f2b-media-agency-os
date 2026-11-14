// Decides which emails go out on each 5-minute tick. Pure: the cron loads the due rows,
// calls planTick, claims each planned send with its idempotency key, then sends.

const DAY = 86_400_000;

/** Local weekday (1=Mon…7=Sun) and minutes after midnight in an IANA time zone. */
export function localClock(now, timeZone) {
  let parts;
  try { parts = new Intl.DateTimeFormat("en-GB", { timeZone, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(now)); }
  catch { parts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Dublin", weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(now)); }
  const get = (type) => parts.find((part) => part.type === type)?.value || "";
  const weekday = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 }[get("weekday")] || 1;
  return { weekday, minutes: Number(get("hour")) * 60 + Number(get("minute")) };
}

const toMinutes = (hhmm, fallback) => { const match = /^(\d{1,2}):(\d{2})$/.exec(String(hhmm || "")); return match ? Number(match[1]) * 60 + Number(match[2]) : fallback; };

export function inSendWindow(now, schedule = {}, recipientTimeZone = "") {
  const timeZone = schedule.tz && schedule.tz !== "recipient" ? schedule.tz : recipientTimeZone || schedule.fallbackTz || "Europe/Dublin";
  const { weekday, minutes } = localClock(now, timeZone);
  const days = Array.isArray(schedule.days) && schedule.days.length ? schedule.days : [1, 2, 3, 4, 5];
  return days.includes(weekday) && minutes >= toMinutes(schedule.start, 9 * 60) && minutes < toMinutes(schedule.end, 17 * 60);
}

export function isSuppressed(email, suppressed) {
  const value = String(email || "").toLowerCase();
  return suppressed.has(value) || suppressed.has(`@${value.split("@")[1] || ""}`);
}

/** Weighted, deterministic variant choice so retries and reports stay consistent. */
export function pickVariant(variants, seed) {
  const list = (variants || []).filter((variant) => (variant.weight ?? 1) > 0);
  if (!list.length) return null;
  const total = list.reduce((sum, variant) => sum + (variant.weight ?? 1), 0);
  let hash = 0;
  for (const char of String(seed)) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  let point = (hash % 10_000) / 10_000 * total;
  for (const variant of list) { point -= variant.weight ?? 1; if (point < 0) return variant; }
  return list[list.length - 1];
}

/**
 * @param {object} input
 * @param {Date|number|string} input.now
 * @param {Array<{id:string,campaignId:string,email:string,step:number,nextSendAt:string|null,mailboxId?:string|null,timeZone?:string}>} input.due
 * @param {Record<string,{status:string,schedule?:object,mailboxIds:string[],dailyCap?:number,sentToday?:number,steps:Array<{variants:any[]}>}>} input.campaigns
 * @param {Record<string,{id:string,status:string,remaining:number,lastSentAt?:string|null,minGapSeconds?:number}>} input.mailboxes
 * @param {Set<string>} input.suppressed
 * @param {number} [input.maxPerCompanyPerTick]
 */
export function planTick({ now, due, campaigns, mailboxes, suppressed, maxPerCompanyPerTick = 1 }) {
  const at = new Date(now).getTime();
  const sends = []; const skipped = []; const stops = [];
  const capacity = Object.fromEntries(Object.values(mailboxes).map((mailbox) => [mailbox.id, mailbox.remaining]));
  const usedThisTick = new Set();
  const companyCount = new Map();
  const campaignSent = new Map();
  const ready = (mailbox) => mailbox && ["active", "ramping"].includes(mailbox.status) && capacity[mailbox.id] > 0 && !usedThisTick.has(mailbox.id)
    && (!mailbox.lastSentAt || at - new Date(mailbox.lastSentAt).getTime() >= (mailbox.minGapSeconds ?? 240) * 1000);

  for (const item of [...due].sort((a, b) => String(a.nextSendAt).localeCompare(String(b.nextSendAt)))) {
    const campaign = campaigns[item.campaignId];
    if (!campaign || campaign.status !== "active") { skipped.push({ id: item.id, reason: "campaign-not-active" }); continue; }
    if (item.nextSendAt && new Date(item.nextSendAt).getTime() > at) continue;
    if (isSuppressed(item.email, suppressed)) { stops.push({ id: item.id, reason: "suppressed" }); continue; }
    const step = campaign.steps[item.step];
    if (!step) { stops.push({ id: item.id, reason: "completed" }); continue; }
    if (!inSendWindow(at, campaign.schedule, item.timeZone)) { skipped.push({ id: item.id, reason: "outside-window" }); continue; }
    const sentForCampaign = (campaign.sentToday || 0) + (campaignSent.get(item.campaignId) || 0);
    if (campaign.dailyCap && sentForCampaign >= campaign.dailyCap) { skipped.push({ id: item.id, reason: "campaign-cap" }); continue; }
    const company = String(item.email).split("@")[1] || "";
    if ((companyCount.get(company) || 0) >= maxPerCompanyPerTick) { skipped.push({ id: item.id, reason: "company-spacing" }); continue; }

    let mailbox = null;
    if (item.mailboxId) {
      // Follow-ups stay on the same mailbox so the thread is consistent; wait rather than switch.
      mailbox = ready(mailboxes[item.mailboxId]) ? mailboxes[item.mailboxId] : null;
      if (!mailbox) { skipped.push({ id: item.id, reason: "mailbox-busy" }); continue; }
    } else {
      mailbox = campaign.mailboxIds.map((id) => mailboxes[id]).filter(ready).sort((a, b) => capacity[b.id] - capacity[a.id])[0] || null;
      if (!mailbox) { skipped.push({ id: item.id, reason: "no-capacity" }); continue; }
    }
    const variant = pickVariant(step.variants, `${item.id}:${item.step}`);
    if (!variant) { skipped.push({ id: item.id, reason: "no-variant" }); continue; }
    capacity[mailbox.id] -= 1;
    usedThisTick.add(mailbox.id);
    companyCount.set(company, (companyCount.get(company) || 0) + 1);
    campaignSent.set(item.campaignId, (campaignSent.get(item.campaignId) || 0) + 1);
    sends.push({ enrollmentId: item.id, campaignId: item.campaignId, mailboxId: mailbox.id, step: item.step, variantId: variant.id, idempotencyKey: `${item.id}:${item.step}` });
  }
  return { sends, skipped, stops };
}

/** After a successful send: next step and when it is due. Small jitter avoids robotic timing. */
export function nextAfterSend({ step, steps, sentAt, jitterMinutes = 0 }) {
  const next = step + 1;
  if (next >= steps.length) return { nextStep: next, nextSendAt: null, status: "completed" };
  const delay = Math.max(1, Number(steps[next].delayDays ?? steps[next].delay_days ?? 2));
  return { nextStep: next, nextSendAt: new Date(new Date(sentAt).getTime() + delay * DAY + jitterMinutes * 60_000).toISOString(), status: "active" };
}
