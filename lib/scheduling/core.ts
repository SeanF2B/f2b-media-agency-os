// Scheduling engine: pure helpers shared by the API, the public booking page and tests.
// Only erasable TypeScript syntax is used so `node --test` can load this file directly.

export const DEFAULT_TZ = "Europe/Dublin";
export const DAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"] as const;
import { sanitizeFollowUps, type FollowUp, type FollowUpKind } from "./followups-model.ts";
export type DayKey = (typeof DAYS)[number];
export type Window = [string, string]; // ["09:00","17:00"] local time
export type WeeklyHours = Partial<Record<DayKey, Window[]>>;

export type AssignMode = "customer_pick" | "round_robin" | "collective";
export type LocationType = "onsite" | "phone" | "video" | "office";
export type Question = { id: string; label: string; required?: boolean; type?: "text" | "textarea" | "select"; options?: string[] };

export type CalendarConfig = {
  id: string; ownerId: string; clientId: string; name: string; slug: string; kind: "service" | "consultation";
  description: string; durationMin: number; bufferBefore: number; bufferAfter: number; slotInterval: number;
  minNoticeMin: number; maxDaysAhead: number; dailyLimit: number; locationType: LocationType; locationDetail: string;
  price: number; currency: string; color: string; assignMode: AssignMode; staffIds: string[]; questions: Question[];
  stageId: string; confirmationMessage: string; redirectUrl: string; active: boolean; timezone: string;
  /** Service picture shown on booking pages (Media Library or https). */
  image: string;
  /** Follow-up messages after a cancellation / no-show (each one is an automation). */
  followUps: Partial<Record<FollowUpKind, FollowUp>>;
};

export type StaffAvailability = { staffId: string; timezone: string; weekly: WeeklyHours; blocked: string[]; dailyLimit: number };
export type Busy = { start: number; end: number; staffId: string; source?: "booking" | "google" };

export const DEFAULT_WEEKLY: WeeklyHours = { mon: [["09:00", "17:00"]], tue: [["09:00", "17:00"]], wed: [["09:00", "17:00"]], thu: [["09:00", "17:00"]], fri: [["09:00", "17:00"]] };

const clampInt = (value: unknown, min: number, max: number, fallback: number) => {
  const n = Math.round(Number(value));
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
};
const text = (value: unknown, max = 200) => (typeof value === "string" ? value.replace(/[\u0000-\u0008\u000b-\u001f]/g, "").trim().slice(0, max) : "");
const timeRe = /^([01]\d|2[0-3]):[0-5]\d$/;

export function slugify(value: string) {
  return value.toLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "booking";
}

export function isValidTimeZone(tz: string) {
  try { new Intl.DateTimeFormat("en-GB", { timeZone: tz }); return true; } catch { return false; }
}

export function sanitizeWeekly(input: unknown): WeeklyHours {
  const out: WeeklyHours = {};
  if (!input || typeof input !== "object") return out;
  for (const day of DAYS) {
    const raw = (input as Record<string, unknown>)[day];
    if (!Array.isArray(raw)) continue;
    const windows = raw
      .filter((w): w is [string, string] => Array.isArray(w) && timeRe.test(String(w[0])) && timeRe.test(String(w[1])) && String(w[0]) < String(w[1]))
      .map((w) => [String(w[0]), String(w[1])] as Window)
      .sort((a, b) => a[0].localeCompare(b[0]))
      .slice(0, 4);
    if (windows.length) out[day] = windows;
  }
  return out;
}

export function sanitizeCalendar(input: Record<string, unknown>, base: Partial<CalendarConfig> = {}): Omit<CalendarConfig, "id" | "ownerId"> {
  const kind = input.kind === "consultation" ? "consultation" : "service";
  const assign = ["customer_pick", "round_robin", "collective"].includes(String(input.assignMode)) ? input.assignMode as AssignMode : "customer_pick";
  const location = ["onsite", "phone", "video", "office"].includes(String(input.locationType)) ? input.locationType as LocationType : kind === "consultation" ? "video" : "onsite";
  const name = text(input.name, 120) || base.name || "New booking calendar";
  const questions = Array.isArray(input.questions) ? (input.questions as unknown[]).slice(0, 12).map((q, i) => {
    const r = (q || {}) as Record<string, unknown>;
    const type = r.type === "textarea" || r.type === "select" ? r.type : "text";
    return { id: text(r.id, 40).replace(/[^\w-]/g, "") || `q${i + 1}`, label: text(r.label, 140), required: Boolean(r.required), type, options: type === "select" && Array.isArray(r.options) ? (r.options as unknown[]).map((o) => text(o, 80)).filter(Boolean).slice(0, 20) : undefined } as Question;
  }).filter((q) => q.label) : [];
  const redirect = text(input.redirectUrl, 500);
  const tz = text(input.timezone, 60);
  return {
    clientId: text(input.clientId, 120),
    name,
    slug: slugify(text(input.slug, 60) || name),
    kind,
    description: text(input.description, 1500),
    durationMin: clampInt(input.durationMin, 5, 720, 30),
    bufferBefore: clampInt(input.bufferBefore, 0, 240, 0),
    bufferAfter: clampInt(input.bufferAfter, 0, 240, 0),
    slotInterval: clampInt(input.slotInterval, 5, 240, 30),
    minNoticeMin: clampInt(input.minNoticeMin, 0, 60 * 24 * 30, 120),
    maxDaysAhead: clampInt(input.maxDaysAhead, 1, 365, 60),
    dailyLimit: clampInt(input.dailyLimit, 0, 100, 0),
    locationType: location,
    locationDetail: text(input.locationDetail, 300),
    price: Math.max(0, Math.min(1_000_000, Number(input.price) || 0)),
    currency: /^[A-Z]{3}$/.test(String(input.currency)) ? String(input.currency) : "EUR",
    color: /^#[0-9a-fA-F]{6}$/.test(String(input.color)) ? String(input.color) : "#2563eb",
    assignMode: assign,
    staffIds: Array.isArray(input.staffIds) ? [...new Set((input.staffIds as unknown[]).map((s) => text(s, 120)).filter(Boolean))].slice(0, 50) : [],
    questions,
    stageId: text(input.stageId, 120),
    confirmationMessage: text(input.confirmationMessage, 1000),
    redirectUrl: /^https:\/\//.test(redirect) ? redirect : "",
    active: input.active === undefined ? true : Boolean(input.active),
    timezone: tz && isValidTimeZone(tz) ? tz : DEFAULT_TZ,
    image: /^(https:\/\/|\/api\/marketing-public\/media\?f=)/.test(text(input.image, 600)) ? text(input.image, 600) : "",
    followUps: sanitizeFollowUps(input.followUps ?? base.followUps),
  };
}

// ---------- time zones ----------
function offsetAt(at: number, timeZone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(new Date(at)).map((p) => [p.type, p.value]));
  return Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second)) - Math.floor(at / 1000) * 1000;
}

/** Local wall-clock date + time in `timeZone` → UTC epoch ms. */
export function localToUtc(date: string, time: string, timeZone: string) {
  const [y, mo, d] = date.split("-").map(Number);
  const [h, mi] = time.split(":").map(Number);
  const guess = Date.UTC(y, mo - 1, d, h, mi);
  const first = guess - offsetAt(guess, timeZone);
  return guess - offsetAt(first, timeZone);
}

/** UTC epoch ms → { date: "YYYY-MM-DD", time: "HH:MM", day } in `timeZone`. */
export function utcToLocal(at: number, timeZone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", { timeZone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", weekday: "short" }).formatToParts(new Date(at)).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, time: `${parts.hour}:${parts.minute}`, day: String(parts.weekday).slice(0, 3).toLowerCase() as DayKey };
}

export function addDays(date: string, days: number) {
  const [y, m, d] = date.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return next.toISOString().slice(0, 10);
}

function dayOf(date: string): DayKey {
  const [y, m, d] = date.split("-").map(Number);
  return DAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

// ---------- availability ----------
export type Slot = { start: string; end: string; staffIds: string[] };

const overlaps = (aStart: number, aEnd: number, bStart: number, bEnd: number) => aStart < bEnd && bStart < aEnd;

/** Is `staffId` free for an appointment [start,end) including this calendar's buffers? */
export function staffFree(staffId: string, start: number, end: number, cal: Pick<CalendarConfig, "bufferBefore" | "bufferAfter">, busy: Busy[]) {
  const s = start - cal.bufferBefore * 60_000, e = end + cal.bufferAfter * 60_000;
  return !busy.some((b) => b.staffId === staffId && overlaps(s, e, b.start, b.end));
}

function withinHours(av: StaffAvailability, start: number, end: number) {
  const tz = av.timezone || DEFAULT_TZ;
  const a = utcToLocal(start, tz), b = utcToLocal(end - 1, tz);
  if (a.date !== b.date) return false;
  if (av.blocked.includes(a.date)) return false;
  const windows = av.weekly[a.day] || [];
  const endLocal = utcToLocal(end, tz);
  const endTime = endLocal.date === a.date ? endLocal.time : "24:00";
  return windows.some(([from, to]) => a.time >= from && endTime <= to);
}

export function countOnDay(staffId: string, date: string, tz: string, bookings: Array<{ start: number; staffId: string }>) {
  return bookings.filter((b) => b.staffId === staffId && utcToLocal(b.start, tz).date === date).length;
}

/**
 * Free slots for a calendar between `fromDate` and `toDate` (inclusive, calendar time zone).
 * `onlyStaffId` restricts to one person (customer picked them). Collective needs everyone free.
 */
export function computeSlots(input: {
  cal: CalendarConfig; availability: StaffAvailability[]; busy: Busy[]; bookingsForLimits: Array<{ start: number; staffId: string }>;
  fromDate: string; toDate: string; now: number; onlyStaffId?: string; calendarDayCounts?: Record<string, number>;
}): Slot[] {
  const { cal, now } = input;
  const tz = cal.timezone || DEFAULT_TZ;
  const team = (input.onlyStaffId ? [input.onlyStaffId] : cal.staffIds).filter((id) => cal.staffIds.includes(id));
  if (!team.length) return [];
  const avById = new Map(input.availability.map((a) => [a.staffId, a]));
  const earliest = now + cal.minNoticeMin * 60_000;
  const latest = now + cal.maxDaysAhead * 86_400_000;
  const slots: Slot[] = [];
  const duration = cal.durationMin * 60_000;
  for (let date = input.fromDate; date <= input.toDate; date = addDays(date, 1)) {
    if (cal.dailyLimit && (input.calendarDayCounts?.[date] || 0) >= cal.dailyLimit) continue;
    // Candidate start times: every interval across the union of the team's windows that day.
    const day = dayOf(date);
    const starts = new Set<number>();
    for (const id of team) {
      const av = avById.get(id);
      if (!av) continue;
      const staffTz = av.timezone || DEFAULT_TZ;
      for (const [from, to] of av.weekly[day] || []) {
        let t = localToUtc(date, from, staffTz);
        const stop = localToUtc(date, to, staffTz);
        // Align to the calendar's interval from the window start.
        for (; t + duration <= stop; t += cal.slotInterval * 60_000) starts.add(t);
      }
    }
    for (const start of [...starts].sort((a, b) => a - b)) {
      const end = start + duration;
      if (start < earliest || start > latest) continue;
      if (utcToLocal(start, tz).date !== date) continue;
      const free = team.filter((id) => {
        const av = avById.get(id);
        if (!av || !withinHours(av, start, end)) return false;
        if (av.dailyLimit && countOnDay(id, utcToLocal(start, av.timezone || DEFAULT_TZ).date, av.timezone || DEFAULT_TZ, input.bookingsForLimits) >= av.dailyLimit) return false;
        return staffFree(id, start, end, cal, input.busy);
      });
      if (cal.assignMode === "collective" && !input.onlyStaffId ? free.length === team.length : free.length > 0) {
        slots.push({ start: new Date(start).toISOString(), end: new Date(end).toISOString(), staffIds: free });
      }
    }
  }
  return slots;
}

/** Who gets the booking: collective = everyone; picked person; else least busy that day, then calendar order. */
export function chooseStaff(cal: Pick<CalendarConfig, "assignMode" | "staffIds" | "timezone">, slot: Slot, requestedStaffId: string, bookings: Array<{ start: number; staffId: string }>) {
  if (cal.assignMode === "collective" && !requestedStaffId) return slot.staffIds.length === cal.staffIds.length ? [...cal.staffIds] : [];
  if (requestedStaffId) return slot.staffIds.includes(requestedStaffId) ? [requestedStaffId] : [];
  const date = utcToLocal(Date.parse(slot.start), cal.timezone || DEFAULT_TZ).date;
  const ranked = [...slot.staffIds].sort((a, b) => countOnDay(a, date, cal.timezone || DEFAULT_TZ, bookings) - countOnDay(b, date, cal.timezone || DEFAULT_TZ, bookings) || cal.staffIds.indexOf(a) - cal.staffIds.indexOf(b));
  return ranked.slice(0, 1);
}

// ---------- iCal feed ----------
const icsEscape = (value: string) => value.replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
const icsDate = (iso: string) => iso.replace(/[-:]/g, "").replace(/\.\d{3}/, "");
function fold(line: string) {
  const out: string[] = [];
  let rest = line;
  while (rest.length > 74) { out.push(rest.slice(0, 74)); rest = " " + rest.slice(74); }
  out.push(rest);
  return out.join("\r\n");
}

export function buildIcs(name: string, events: Array<{ id: string; start: string; end: string; summary: string; description?: string; location?: string; status?: string; updatedAt?: string }>) {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//F2B Media//Agency OS Scheduling//EN", "CALSCALE:GREGORIAN", "METHOD:PUBLISH", `X-WR-CALNAME:${icsEscape(name)}`, "REFRESH-INTERVAL;VALUE=DURATION:PT15M", "X-PUBLISHED-TTL:PT15M"];
  for (const e of events) {
    lines.push("BEGIN:VEVENT", `UID:${e.id}@f2b-agency-os`, `DTSTAMP:${icsDate(e.updatedAt || new Date().toISOString())}`, `DTSTART:${icsDate(e.start)}`, `DTEND:${icsDate(e.end)}`, `SUMMARY:${icsEscape(e.summary)}`);
    if (e.description) lines.push(`DESCRIPTION:${icsEscape(e.description)}`);
    if (e.location) lines.push(`LOCATION:${icsEscape(e.location)}`);
    lines.push(`STATUS:${e.status === "cancelled" ? "CANCELLED" : "CONFIRMED"}`, "END:VEVENT");
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

export function locationLabel(type: LocationType, detail: string) {
  const base = type === "onsite" ? "On-site visit" : type === "phone" ? "Phone call" : type === "video" ? "Video call (Google Meet)" : "At our office";
  return detail ? `${base} · ${detail}` : base;
}
