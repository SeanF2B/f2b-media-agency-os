// Staff pay for a period, worked out the same way as the Dashboard's "Staff hours & earnings" panel:
// commission = % of finished appointment value, hourly = hours (clock-ins → task timer → appointments), salary = pro rata.
export type PayRuleLite = { payType: "none" | "hourly" | "commission" | "salary"; payRate: number };
type BookingLite = { calendarId: string; start: string; end: string; status: string; staffIds: string[]; answers: Array<{ label: string; value: string }> };
type StaffLite = { id: string; name: string; profile?: { payType?: string; payRate?: number } | null };
type EntryLite = { staffId: string; taskId: string; startAt: string; seconds: number };

export function staffPayForPeriod(input: { staff: StaffLite[]; bookings: BookingLite[]; calendars: Array<{ id: string; price?: number }>; std: PayRuleLite; entries?: EntryLite[]; from: Date; to: Date; now?: number }) {
  const now = input.now ?? Date.now();
  const a = input.from.getTime(), b = input.to.getTime();
  const price = new Map(input.calendars.map((c) => [c.id, c.price || 0]));
  const valueOf = (bk: BookingLite) => { const n = Number((bk.answers.find((x) => /^price$/i.test(x.label))?.value || "").replace(/[^0-9.]/g, "")); return n > 0 ? n : price.get(bk.calendarId) || 0; };
  return input.staff.map((p) => {
    const rule: PayRuleLite = p.profile?.payType && p.profile.payType !== "none" ? { payType: p.profile.payType as PayRuleLite["payType"], payRate: Number(p.profile.payRate) || 0 } : input.std;
    const done = input.bookings.filter((bk) => bk.staffIds.includes(p.id) && Date.parse(bk.start) >= a && Date.parse(bk.start) < b && (bk.status === "completed" || (bk.status === "booked" && Date.parse(bk.end) < now)));
    let value = 0, apptH = 0;
    for (const bk of done) { const share = 1 / Math.max(1, bk.staffIds.length); value += valueOf(bk) * share; apptH += (Date.parse(bk.end) - Date.parse(bk.start)) / 3_600_000 * share; }
    const mine = (input.entries || []).filter((e) => e.staffId === p.id && Date.parse(e.startAt) >= a && Date.parse(e.startAt) < b);
    const clockH = mine.filter((e) => e.taskId === "clock").reduce((n, e) => n + e.seconds / 3600, 0);
    const timerH = mine.filter((e) => e.taskId !== "clock").reduce((n, e) => n + e.seconds / 3600, 0);
    const hours = clockH > 0 ? clockH : timerH > 0 ? timerH : apptH;
    const elapsed = Math.max(0, Math.min(b, now) - a);
    const amount = rule.payType === "commission" ? value * rule.payRate / 100
      : rule.payType === "hourly" ? hours * rule.payRate
        : rule.payType === "salary" ? rule.payRate * elapsed / (365 * 86_400_000) : 0;
    const basis = rule.payType === "commission" ? `${done.length} appointment${done.length === 1 ? "" : "s"} @ ${rule.payRate}%` : rule.payType === "hourly" ? `${hours.toFixed(1)}h @ €${rule.payRate}/h` : rule.payType === "salary" ? "salary (pro rata)" : "no pay set";
    return { staffId: p.id, name: String(p.name || "").split("|")[0].trim(), amount: Math.round(amount * 100) / 100, basis };
  });
}
