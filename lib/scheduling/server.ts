// Scheduling data layer. Takes its database / email / Google helpers as arguments (no `cloudflare:workers`
// import) so the API routes, the cron job and `node --test` all share the same code.
import { ensureSchedulingTables } from "./schema.ts";
import {
  DEFAULT_TZ, DEFAULT_WEEKLY, buildIcs, chooseStaff, computeSlots, locationLabel, sanitizeCalendar, sanitizeWeekly, utcToLocal, addDays, isValidTimeZone,
  type Busy, type CalendarConfig, type Slot, type StaffAvailability,
} from "./core.ts";
import { emitAutomationEvent } from "../crm-automations/engine.ts";
import { logSystemEmail } from "../email-log.ts";

type Stmt = { bind(...values: unknown[]): Stmt; first<T = Record<string, unknown>>(): Promise<T | null>; all<T = Record<string, unknown>>(): Promise<{ results?: T[] }>; run(): Promise<unknown> };
export type Db = { prepare(sql: string): Stmt; batch(statements: unknown[]): Promise<unknown> };

export type Mail = { to: string[]; subject: string; html: string; text: string; replyTo?: string; fromName?: string; idempotencyKey: string };
export type GoogleEvent = { summary: string; description: string; location: string; start: string; end: string; video: boolean; requestId: string };
export type GoogleOps = {
  connected(ownerId: string, staffIds: string[]): Promise<Record<string, string>>;
  busy(ownerId: string, staffId: string, fromIso: string, toIso: string): Promise<Array<{ start: number; end: number }>>;
  create(ownerId: string, staffId: string, event: GoogleEvent): Promise<{ id: string; meetLink?: string } | null>;
  patch(ownerId: string, staffId: string, eventId: string, event: Partial<GoogleEvent> & { cancelled?: boolean }): Promise<void>;
  remove(ownerId: string, staffId: string, eventId: string): Promise<void>;
};
export type Deps = { db: Db; sendEmail?: (mail: Mail) => Promise<void>; google?: GoogleOps; baseUrl: string; now?: () => number };

export type StaffLite = { id: string; name: string; email?: string; role?: string; avatar?: string; isBot?: boolean; title?: string };
export type ClientLite = { id: string; name: string; seoServices?: string[]; seoLocations?: string[]; website?: string; logo?: string; phone?: string; email?: string; branding?: { primary?: string; secondary?: string } };
export type WorkspaceLite = { ownerId: string; staff: StaffLite[]; clients: ClientLite[]; agencyName?: string };

export type BookingRow = {
  id: string; owner_id: string; client_id: string; calendar_id: string; start_at: string; end_at: string; status: "booked" | "cancelled" | "completed" | "no_show";
  staff_ids: string; contact_id: string | null; opportunity_id: string | null; name: string; email: string; phone: string; answers: string; notes: string;
  source: string; channel: string; manage_token: string; google_events: string; meet_link: string; created_by: string; created_at: string; updated_at: string;
};
export type Booking = ReturnType<typeof bookingView>;

const parse = <T>(value: unknown, fallback: T): T => { try { return value == null ? fallback : JSON.parse(String(value)) as T; } catch { return fallback; } };
const token = () => crypto.randomUUID().replace(/-/g, "") + crypto.randomUUID().replace(/-/g, "").slice(0, 16);
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
const nowMs = (deps: Pick<Deps, "now">) => (deps.now ? deps.now() : Date.now());

export class SchedulingError extends Error { status: number; constructor(message: string, status = 400) { super(message); this.status = status; } }

// ---------- calendars ----------
type CalendarRow = { id: string; owner_id: string; client_id: string; slug: string; name: string; active: number; config: string; created_at: string; updated_at: string };
export function rowToCalendar(row: CalendarRow): CalendarConfig {
  const cfg = sanitizeCalendar(parse<Record<string, unknown>>(row.config, {}));
  return { ...cfg, id: row.id, ownerId: row.owner_id, clientId: row.client_id || "", slug: row.slug, name: row.name, active: Boolean(row.active) };
}

export async function listCalendars(db: Db, ownerId: string, clientId: string | null) {
  await ensureSchedulingTables(db);
  const rows = clientId === null
    ? (await db.prepare("SELECT * FROM sched_calendars WHERE owner_id=?1 ORDER BY updated_at DESC LIMIT 300").bind(ownerId).all<CalendarRow>()).results || []
    : (await db.prepare("SELECT * FROM sched_calendars WHERE owner_id=?1 AND client_id=?2 ORDER BY updated_at DESC LIMIT 200").bind(ownerId, clientId).all<CalendarRow>()).results || [];
  return rows.map(rowToCalendar);
}

export async function getCalendar(db: Db, ownerId: string, id: string) {
  await ensureSchedulingTables(db);
  const row = await db.prepare("SELECT * FROM sched_calendars WHERE owner_id=?1 AND id=?2").bind(ownerId, id).first<CalendarRow>();
  return row ? rowToCalendar(row) : null;
}

export async function getCalendarBySlug(db: Db, slug: string) {
  await ensureSchedulingTables(db);
  const row = await db.prepare("SELECT * FROM sched_calendars WHERE slug=?1").bind(slug).first<CalendarRow>();
  return row ? rowToCalendar(row) : null;
}

export async function saveCalendar(db: Db, ownerId: string, input: Record<string, unknown>, now = new Date().toISOString()) {
  await ensureSchedulingTables(db);
  const id = typeof input.id === "string" && input.id ? input.id.slice(0, 80) : `cal_${crypto.randomUUID()}`;
  const existing = typeof input.id === "string" && input.id ? await getCalendar(db, ownerId, id) : null;
  if (input.id && !existing) throw new SchedulingError("That booking calendar no longer exists.", 404);
  const cfg = sanitizeCalendar(input, existing || {});
  if (existing) cfg.clientId = existing.clientId; // a calendar never moves between sub-accounts
  let slug = cfg.slug;
  for (let n = 2; n < 50; n++) {
    const clash = await db.prepare("SELECT id FROM sched_calendars WHERE slug=?1").bind(slug).first<{ id: string }>();
    if (!clash || clash.id === id) break;
    slug = `${cfg.slug.slice(0, 54)}-${n}`;
  }
  cfg.slug = slug;
  await db.prepare("INSERT INTO sched_calendars (id, owner_id, client_id, slug, name, active, config, created_at, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?8) ON CONFLICT(id) DO UPDATE SET slug=excluded.slug, name=excluded.name, active=excluded.active, config=excluded.config, updated_at=excluded.updated_at WHERE sched_calendars.owner_id=excluded.owner_id")
    .bind(id, ownerId, cfg.clientId, cfg.slug, cfg.name, cfg.active ? 1 : 0, JSON.stringify(cfg), now).run();
  return (await getCalendar(db, ownerId, id)) as CalendarConfig;
}

export async function deleteCalendar(db: Db, ownerId: string, id: string) {
  await ensureSchedulingTables(db);
  const upcoming = await db.prepare("SELECT COUNT(*) AS n FROM sched_bookings WHERE calendar_id=?1 AND start_at>=?2 AND status='booked'").bind(id, new Date().toISOString()).first<{ n: number }>();
  if (Number(upcoming?.n) > 0) throw new SchedulingError(`This calendar still has ${upcoming?.n} upcoming appointment(s). Cancel or move them first, or switch the calendar off instead.`, 409);
  await db.prepare("DELETE FROM sched_calendars WHERE owner_id=?1 AND id=?2").bind(ownerId, id).run();
}

// ---------- staff availability ----------
type StaffRow = { staff_id: string; timezone: string; weekly: string; blocked: string; daily_limit: number; ics_token: string };
export async function getStaffSettings(db: Db, ownerId: string, staffIds: string[]) {
  await ensureSchedulingTables(db);
  const ids = [...new Set(staffIds)].slice(0, 100);
  if (!ids.length) return [] as Array<StaffAvailability & { icsToken: string }>;
  const rows = (await db.prepare(`SELECT staff_id, timezone, weekly, blocked, daily_limit, ics_token FROM sched_staff_settings WHERE owner_id=?1 AND staff_id IN (${ids.map((_, i) => `?${i + 2}`).join(",")})`).bind(ownerId, ...ids).all<StaffRow>()).results || [];
  const byId = new Map(rows.map((r) => [r.staff_id, r]));
  return ids.map((staffId) => {
    const r = byId.get(staffId);
    const weekly = r ? sanitizeWeekly(parse(r.weekly, {})) : DEFAULT_WEEKLY;
    return { staffId, timezone: r?.timezone || DEFAULT_TZ, weekly, blocked: r ? parse<string[]>(r.blocked, []).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)) : [], dailyLimit: Number(r?.daily_limit) || 0, icsToken: r?.ics_token || "" };
  });
}

export async function saveStaffSettings(db: Db, ownerId: string, staffId: string, input: Record<string, unknown>) {
  await ensureSchedulingTables(db);
  const tz = typeof input.timezone === "string" && isValidTimeZone(input.timezone) ? input.timezone : DEFAULT_TZ;
  const blocked = Array.isArray(input.blocked) ? [...new Set((input.blocked as unknown[]).map(String).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)))].sort().slice(-400) : [];
  const limit = Math.max(0, Math.min(100, Math.round(Number(input.dailyLimit) || 0)));
  await db.prepare("INSERT INTO sched_staff_settings (owner_id, staff_id, timezone, weekly, blocked, daily_limit, ics_token, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8) ON CONFLICT(owner_id, staff_id) DO UPDATE SET timezone=excluded.timezone, weekly=excluded.weekly, blocked=excluded.blocked, daily_limit=excluded.daily_limit, updated_at=excluded.updated_at")
    .bind(ownerId, staffId, tz, JSON.stringify(sanitizeWeekly(input.weekly)), JSON.stringify(blocked), limit, token(), new Date().toISOString()).run();
  return (await getStaffSettings(db, ownerId, [staffId]))[0];
}

/** Creates the staff row if needed and returns the private calendar-feed token (rotate=true issues a new one). */
export async function staffFeedToken(db: Db, ownerId: string, staffId: string, rotate = false) {
  await ensureSchedulingTables(db);
  const fresh = token();
  await db.prepare("INSERT INTO sched_staff_settings (owner_id, staff_id, timezone, weekly, blocked, daily_limit, ics_token, updated_at) VALUES (?1,?2,?3,?4,'[]',0,?5,?6) ON CONFLICT(owner_id, staff_id) DO NOTHING")
    .bind(ownerId, staffId, DEFAULT_TZ, JSON.stringify(DEFAULT_WEEKLY), fresh, new Date().toISOString()).run();
  if (rotate) await db.prepare("UPDATE sched_staff_settings SET ics_token=?3, updated_at=?4 WHERE owner_id=?1 AND staff_id=?2").bind(ownerId, staffId, fresh, new Date().toISOString()).run();
  const row = await db.prepare("SELECT ics_token FROM sched_staff_settings WHERE owner_id=?1 AND staff_id=?2").bind(ownerId, staffId).first<{ ics_token: string }>();
  return row?.ics_token || fresh;
}

// ---------- busy times ----------
async function bookedBusy(db: Db, ownerId: string, staffIds: string[], fromMs: number, toMs: number, excludeBookingId = "") {
  if (!staffIds.length) return [] as Array<Busy & { bookingId: string }>;
  const rows = (await db.prepare(`SELECT booking_id, staff_id, start_at, end_at FROM sched_booking_staff WHERE owner_id=?1 AND active=1 AND staff_id IN (${staffIds.map((_, i) => `?${i + 4}`).join(",")}) AND start_at>=?2 AND start_at<?3`)
    .bind(ownerId, new Date(fromMs - 86_400_000).toISOString(), new Date(toMs).toISOString(), ...staffIds).all<{ booking_id: string; staff_id: string; start_at: string; end_at: string }>()).results || [];
  return rows.filter((r) => r.booking_id !== excludeBookingId).map((r) => ({ bookingId: r.booking_id, staffId: r.staff_id, start: Date.parse(r.start_at), end: Date.parse(r.end_at), source: "booking" as const })).filter((b) => b.end > fromMs);
}

async function googleBusy(deps: Deps, ownerId: string, staffIds: string[], fromMs: number, toMs: number) {
  if (!deps.google) return [] as Busy[];
  const out: Busy[] = [];
  await Promise.all(staffIds.map(async (staffId) => {
    try {
      for (const b of await deps.google!.busy(ownerId, staffId, new Date(fromMs).toISOString(), new Date(toMs).toISOString())) out.push({ ...b, staffId, source: "google" });
    } catch (error) { console.error("Google busy lookup failed", staffId, error instanceof Error ? error.message : error); }
  }));
  return out;
}

async function calendarDayCounts(db: Db, cal: CalendarConfig, fromMs: number, toMs: number) {
  if (!cal.dailyLimit) return {};
  const rows = (await db.prepare("SELECT start_at FROM sched_bookings WHERE calendar_id=?1 AND start_at>=?2 AND start_at<?3 AND status IN ('booked','completed')").bind(cal.id, new Date(fromMs).toISOString(), new Date(toMs).toISOString()).all<{ start_at: string }>()).results || [];
  const counts: Record<string, number> = {};
  for (const r of rows) { const d = utcToLocal(Date.parse(r.start_at), cal.timezone).date; counts[d] = (counts[d] || 0) + 1; }
  return counts;
}

export async function availableSlots(deps: Deps, cal: CalendarConfig, opts: { fromDate: string; days?: number; staffId?: string; excludeBookingId?: string }) {
  await ensureSchedulingTables(deps.db);
  const days = Math.max(1, Math.min(opts.days || 7, 31));
  const toDate = addDays(opts.fromDate, days - 1);
  const team = opts.staffId ? [opts.staffId] : cal.staffIds;
  const availability = await getStaffSettings(deps.db, cal.ownerId, team);
  const fromMs = Date.parse(`${addDays(opts.fromDate, -1)}T00:00:00Z`), toMs = Date.parse(`${addDays(toDate, 2)}T00:00:00Z`);
  const booked = await bookedBusy(deps.db, cal.ownerId, team, fromMs, toMs, opts.excludeBookingId);
  const busy = [...booked, ...await googleBusy(deps, cal.ownerId, team, fromMs, toMs)];
  return computeSlots({ cal, availability, busy, bookingsForLimits: booked, fromDate: opts.fromDate, toDate, now: nowMs(deps), onlyStaffId: opts.staffId, calendarDayCounts: await calendarDayCounts(deps.db, cal, fromMs, toMs) });
}

// ---------- bookings ----------
export function bookingView(row: BookingRow) {
  return {
    id: row.id, clientId: row.client_id || "", calendarId: row.calendar_id, start: row.start_at, end: row.end_at, status: row.status,
    staffIds: parse<string[]>(row.staff_ids, []), contactId: row.contact_id, opportunityId: row.opportunity_id, name: row.name, email: row.email, phone: row.phone,
    answers: parse<Array<{ label: string; value: string }>>(row.answers, []), notes: row.notes, source: row.source, channel: row.channel, meetLink: row.meet_link,
    createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export async function listBookings(db: Db, ownerId: string, clientId: string | null, fromIso: string, toIso: string) {
  await ensureSchedulingTables(db);
  const rows = clientId === null
    ? (await db.prepare("SELECT * FROM sched_bookings WHERE owner_id=?1 AND start_at>=?2 AND start_at<?3 ORDER BY start_at LIMIT 1500").bind(ownerId, fromIso, toIso).all<BookingRow>()).results || []
    : (await db.prepare("SELECT * FROM sched_bookings WHERE owner_id=?1 AND client_id=?4 AND start_at>=?2 AND start_at<?3 ORDER BY start_at LIMIT 1500").bind(ownerId, fromIso, toIso, clientId).all<BookingRow>()).results || [];
  return rows.map(bookingView);
}

export async function getBooking(db: Db, ownerId: string, id: string) {
  await ensureSchedulingTables(db);
  return db.prepare("SELECT * FROM sched_bookings WHERE owner_id=?1 AND id=?2").bind(ownerId, id).first<BookingRow>();
}
export async function getBookingByToken(db: Db, manageToken: string) {
  await ensureSchedulingTables(db);
  if (!/^[a-f0-9]{40,64}$/.test(manageToken)) return null;
  return db.prepare("SELECT * FROM sched_bookings WHERE manage_token=?1").bind(manageToken).first<BookingRow>();
}

const clean = (v: unknown, n: number) => String(v ?? "").replace(/[\u0000-\u0008\u000b-\u001f]/g, "").trim().slice(0, n);
function normPhone(v: string) {
  let d = v.replace(/[^\d+]/g, "");
  if (d.startsWith("00")) d = "+" + d.slice(2);
  if (/^0\d{8,10}$/.test(d)) d = "+353" + d.slice(1);
  return d;
}

export type BookInput = {
  cal: CalendarConfig; start: string; staffId?: string; staffIds?: string[]; name: string; email?: string; phone?: string;
  answers?: Record<string, unknown>; location?: string; extraAnswers?: Array<{ label: string; value: string }>; notes?: string; source: "public" | "internal"; createdBy?: string; workspace: WorkspaceLite;
  attribution?: Record<string, string>; pageUrl?: string; skipAvailability?: boolean; notifyCustomer?: boolean;
};

export async function createBooking(deps: Deps, input: BookInput) {
  const { db } = deps;
  const { cal } = input;
  await ensureSchedulingTables(db);
  if (!cal.active && input.source === "public") throw new SchedulingError("This booking calendar isn't taking bookings right now.", 409);
  const name = clean(input.name, 120), email = clean(input.email, 160).toLowerCase(), phone = normPhone(clean(input.phone, 40));
  if (name.length < 2) throw new SchedulingError("Please enter a name.");
  if (input.source === "public" && !email && phone.replace(/\D/g, "").length < 7) throw new SchedulingError("Please enter an email address or phone number so we can confirm.");
  if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new SchedulingError("That email address doesn't look right.");
  const startMs = Date.parse(input.start);
  if (!Number.isFinite(startMs)) throw new SchedulingError("Choose a time.");
  const endMs = startMs + cal.durationMin * 60_000;
  const answers = cal.questions.map((q) => ({ label: q.label, value: clean(input.answers?.[q.id], 1000) }));
  const location = clean(input.location, 300);
  if (location && !answers.some((a) => /address|eircode|location/i.test(a.label) && a.value)) answers.push({ label: "Location", value: location });
  for (const extra of (input.extraAnswers || []).slice(0, 4)) { const value = clean(extra.value, 600); if (value) answers.push({ label: clean(extra.label, 40), value }); }
  if (input.source === "public") { const missing = cal.questions.find((q, i) => q.required && !answers[i].value); if (missing) throw new SchedulingError(`Please answer: ${missing.label}`); }

  // Re-check the slot on the server: never trust the time the browser sent.
  let staffIds: string[];
  if (input.skipAvailability && input.staffIds?.length) staffIds = input.staffIds.filter((id) => input.workspace.staff.some((s) => s.id === id));
  else {
    const day = utcToLocal(startMs, cal.timezone).date;
    const slots = await availableSlots(deps, cal, { fromDate: day, days: 1, staffId: input.staffId || undefined });
    const slot = slots.find((s) => Date.parse(s.start) === startMs) as Slot | undefined;
    if (!slot) throw new SchedulingError("Sorry, that time has just been taken. Please pick another.", 409);
    const booked = await bookedBusy(db, cal.ownerId, cal.staffIds, startMs - 86_400_000, startMs + 86_400_000);
    staffIds = chooseStaff(cal, slot, input.staffId || "", booked);
  }
  if (!staffIds.length) throw new SchedulingError("Nobody is free at that time. Please pick another.", 409);

  const now = new Date(nowMs(deps)).toISOString();
  const id = `bk_${crypto.randomUUID()}`, manage = token();
  const client = input.workspace.clients.find((c) => c.id === cal.clientId);
  const clientId = cal.clientId || null;
  const t = (k: string) => clean(input.attribution?.[k], 300);
  const channel = t("gclid") || t("gbraid") || t("wbraid") || /cpc|ppc|paid/i.test(t("utm_medium")) ? "Google Ads" : /google|bing|duckduckgo/i.test(t("referrer")) ? "Google search" : t("utm_source") || (t("referrer") ? "Referral" : input.source === "public" ? "Direct" : "Added in OS");

  // Clash guard right before writing (covers two people booking the same slot at once).
  const clash = await bookedBusy(db, cal.ownerId, staffIds, startMs - cal.bufferBefore * 60_000, endMs + cal.bufferAfter * 60_000);
  if (!input.skipAvailability && clash.some((b) => b.start < endMs + cal.bufferAfter * 60_000 && b.end > startMs - cal.bufferBefore * 60_000)) throw new SchedulingError("Sorry, that time has just been taken. Please pick another.", 409);

  // CRM: reuse the contact (same sub-account, same email/phone) or create one.
  const [first, ...rest] = name.split(/\s+/);
  const existing = await db.prepare(`SELECT id FROM crm_contacts WHERE owner_id=?1 AND ${clientId ? "client_id=?2" : "client_id IS NULL AND ?2 IS NULL"} AND ((?3<>'' AND lower(email)=?3) OR (?4<>'' AND phone=?4)) ORDER BY updated_at DESC LIMIT 1`).bind(cal.ownerId, clientId, email, phone).first<{ id: string }>().catch(() => null);
  const contactId = existing?.id || crypto.randomUUID();
  const staffNames = staffIds.map((sid) => input.workspace.staff.find((s) => s.id === sid)?.name || "Team").join(", ");
  const when = new Date(startMs).toLocaleString("en-IE", { timeZone: cal.timezone, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const note = [`📅 ${cal.name} booked for ${when}`, `With: ${staffNames}`, locationLabel(cal.locationType, cal.locationDetail), ...answers.filter((a) => a.value).map((a) => `${a.label}: ${a.value}`), input.notes ? `Notes: ${clean(input.notes, 1500)}` : "", `Source: ${channel}`].filter(Boolean).join("\n");

  const stmts: unknown[] = [
    db.prepare("INSERT INTO crm_contacts (id, owner_id, client_id, first_name, last_name, email, phone, company, source, notes, created_at, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,'',?8,'',?9,?9) ON CONFLICT(id) DO UPDATE SET email=CASE WHEN excluded.email<>'' THEN excluded.email ELSE crm_contacts.email END, phone=CASE WHEN excluded.phone<>'' THEN excluded.phone ELSE crm_contacts.phone END, updated_at=excluded.updated_at WHERE crm_contacts.owner_id=excluded.owner_id")
      .bind(contactId, cal.ownerId, clientId, first || name, rest.join(" "), email, phone, `Booking · ${cal.name}`.slice(0, 80), now),
  ];
  const stage = await bookingStage(db, cal);
  let opportunityId: string | null = null;
  if (stage) {
    const open = existing ? await db.prepare("SELECT o.id FROM crm_opportunities o JOIN crm_pipeline_stages s ON s.id=o.stage_id WHERE o.owner_id=?1 AND o.contact_id=?2 AND o.pipeline_id=?3 AND s.category='open' ORDER BY o.updated_at DESC LIMIT 1").bind(cal.ownerId, contactId, stage.pipelineId).first<{ id: string }>().catch(() => null) : null;
    opportunityId = open?.id || crypto.randomUUID();
    if (open) stmts.push(db.prepare("UPDATE crm_opportunities SET stage_id=?3, assigned_to=COALESCE(assigned_to, ?4), updated_at=?5 WHERE owner_id=?1 AND id=?2").bind(cal.ownerId, open.id, stage.stageId, staffIds[0], now));
    else stmts.push(db.prepare("INSERT INTO crm_opportunities (id, owner_id, pipeline_id, stage_id, contact_id, client_id, title, value, currency, assigned_to, expected_close_date, source, source_submission_id, notes, created_at, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,NULL,?11,?12,?13,?14,?14)")
      .bind(opportunityId, cal.ownerId, stage.pipelineId, stage.stageId, contactId, clientId, `${cal.name} · ${name}`.slice(0, 200), cal.price || 0, cal.currency, staffIds[0], `Booking · ${cal.name}`.slice(0, 80), `booking:${id}`, note.slice(0, 4000), now));
    stmts.push(db.prepare("INSERT INTO crm_activities (id, owner_id, opportunity_id, contact_id, activity_type, body, created_by, created_at) VALUES (?1,?2,?3,?4,'note',?5,?6,?7)").bind(crypto.randomUUID(), cal.ownerId, opportunityId, contactId, note.slice(0, 4000), input.source === "public" ? "Online booking" : input.createdBy || "Scheduling", now));
  }
  stmts.push(db.prepare("INSERT INTO sched_bookings (id, owner_id, client_id, calendar_id, start_at, end_at, status, staff_ids, contact_id, opportunity_id, name, email, phone, answers, notes, source, channel, manage_token, google_events, meet_link, created_by, created_at, updated_at) VALUES (?1,?2,?3,?4,?5,?6,'booked',?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,'{}','',?18,?19,?19)")
    .bind(id, cal.ownerId, cal.clientId, cal.id, new Date(startMs).toISOString(), new Date(endMs).toISOString(), JSON.stringify(staffIds), contactId, opportunityId, name, email, phone, JSON.stringify(answers), clean(input.notes, 2000), input.source, channel, manage, clean(input.createdBy, 160), now));
  // Staff rows hold the busy window *including* this calendar's buffers, so the next booking respects them.
  const busyStart = new Date(startMs - cal.bufferBefore * 60_000).toISOString(), busyEnd = new Date(endMs + cal.bufferAfter * 60_000).toISOString();
  for (const sid of staffIds) stmts.push(db.prepare("INSERT INTO sched_booking_staff (booking_id, owner_id, staff_id, start_at, end_at, active) VALUES (?1,?2,?3,?4,?5,1)").bind(id, cal.ownerId, sid, busyStart, busyEnd));
  for (const [kind, before] of [["24h", 86_400_000], ["1h", 3_600_000]] as const) if (startMs - before > nowMs(deps) + 10 * 60_000) stmts.push(db.prepare("INSERT OR IGNORE INTO sched_reminders (booking_id, kind, due_at) VALUES (?1,?2,?3)").bind(id, kind, new Date(startMs - before).toISOString()));
  await db.batch(stmts);
  await db.batch(["Appointment booked", cal.name].map((tag) => db.prepare("INSERT OR IGNORE INTO crm_contact_tags (owner_id, contact_id, tag, created_at) VALUES (?1,?2,?3,?4)").bind(cal.ownerId, contactId, tag.slice(0, 60), now))).catch(() => undefined);

  // Everything below is best-effort: the booking is already saved.
  if (input.source === "public") await import("../form-submission-log").then(({ logFormSubmission }) => logFormSubmission(db as never, { id: `booking-${id}`, ownerId: cal.ownerId, clientId, source: "os-form", formKey: `booking:${cal.id}`, formName: `Booking · ${cal.name}`, pageUrl: clean(input.pageUrl, 500), name, email, phone, message: note, contactId, touch: { gclid: t("gclid"), gbraid: t("gbraid"), wbraid: t("wbraid"), utm_source: t("utm_source"), utm_medium: t("utm_medium"), utm_campaign: t("utm_campaign"), referrer: t("referrer") } as never, createdAt: now })).catch(() => undefined);
  await emitAutomationEvent(db as never, { ownerId: cal.ownerId, scopeId: cal.clientId, type: "appointment_booked", contactId, payload: { calendarId: cal.id, calendarName: cal.name, bookingId: id, start: new Date(startMs).toISOString(), staffIds }, dedupeKey: `appt:${id}:booked` }).catch((e) => console.error("appointment_booked event", e));
  const row = (await getBooking(db, cal.ownerId, id)) as BookingRow;
  await syncGoogle(deps, cal, row, input.workspace, "create");
  const saved = (await getBooking(db, cal.ownerId, id)) as BookingRow;
  await sendBookingEmails(deps, cal, saved, input.workspace, client, "booked", input.notifyCustomer !== false);
  return { booking: bookingView(saved), manageToken: manage };
}

async function bookingStage(db: Db, cal: CalendarConfig) {
  try {
    if (cal.stageId) {
      const s = await db.prepare("SELECT s.id, s.pipeline_id FROM crm_pipeline_stages s JOIN crm_pipelines p ON p.id=s.pipeline_id AND p.owner_id=s.owner_id WHERE s.owner_id=?1 AND s.id=?2 AND p.archived=0").bind(cal.ownerId, cal.stageId).first<{ id: string; pipeline_id: string }>();
      if (s) return { stageId: s.id, pipelineId: s.pipeline_id };
    }
    const pipe = await db.prepare(`SELECT id FROM crm_pipelines WHERE owner_id=?1 AND ${cal.clientId ? "client_id=?2" : "client_id IS NULL AND ?2 = ''"} AND archived=0 ORDER BY created_at LIMIT 1`).bind(cal.ownerId, cal.clientId).first<{ id: string }>();
    if (!pipe) return null;
    const stages = (await db.prepare("SELECT id, name, category FROM crm_pipeline_stages WHERE owner_id=?1 AND pipeline_id=?2 ORDER BY position").bind(cal.ownerId, pipe.id).all<{ id: string; name: string; category: string }>()).results || [];
    const pick = stages.find((s) => /appointment|booked|survey|consult/i.test(s.name) && s.category === "open") || stages.find((s) => s.category === "open");
    return pick ? { stageId: pick.id, pipelineId: pipe.id } : null;
  } catch { return null; }
}

function eventFor(cal: CalendarConfig, row: BookingRow, workspace: WorkspaceLite): GoogleEvent {
  const answers = parse<Array<{ label: string; value: string }>>(row.answers, []).filter((a) => a.value);
  const staff = parse<string[]>(row.staff_ids, []).map((id) => workspace.staff.find((s) => s.id === id)?.name).filter(Boolean).join(", ");
  const client = workspace.clients.find((c) => c.id === cal.clientId)?.name;
  return {
    summary: `${cal.name} · ${row.name}`,
    description: [client ? `Client: ${client}` : "", `Customer: ${row.name}`, row.phone ? `Phone: ${row.phone}` : "", row.email ? `Email: ${row.email}` : "", staff ? `With: ${staff}` : "", ...answers.map((a) => `${a.label}: ${a.value}`), row.notes ? `Notes: ${row.notes}` : "", "", "Managed by F2B Agency OS · Scheduling"].filter((l, i, all) => l || (i > 0 && all[i - 1])).join("\n"),
    location: cal.locationType === "onsite" ? (answers.find((a) => /address|eircode|location|town/i.test(a.label))?.value || cal.locationDetail) : cal.locationDetail,
    start: row.start_at, end: row.end_at, video: cal.locationType === "video", requestId: row.id.replace(/[^a-zA-Z0-9]/g, "").slice(0, 60),
  };
}

async function syncGoogle(deps: Deps, cal: CalendarConfig, row: BookingRow, workspace: WorkspaceLite, mode: "create" | "update" | "cancel", previousStaff: string[] = []) {
  if (!deps.google) return;
  const events = parse<Record<string, string>>(row.google_events, {});
  const staffIds = parse<string[]>(row.staff_ids, []);
  let meet = row.meet_link;
  try {
    const connected = await deps.google.connected(row.owner_id, [...new Set([...staffIds, ...previousStaff])]);
    // Removed staff (reassigned) lose the event.
    for (const sid of previousStaff.filter((s) => !staffIds.includes(s))) if (events[sid] && connected[sid]) { await deps.google.remove(row.owner_id, sid, events[sid]).catch(() => undefined); delete events[sid]; }
    for (const sid of staffIds) {
      if (!connected[sid]) continue;
      if (mode === "cancel") { if (events[sid]) await deps.google.remove(row.owner_id, sid, events[sid]).catch(() => undefined); delete events[sid]; continue; }
      const ev = eventFor(cal, row, workspace);
      if (events[sid]) await deps.google.patch(row.owner_id, sid, events[sid], ev);
      else { const made = await deps.google.create(row.owner_id, sid, { ...ev, video: ev.video && !meet }); if (made) { events[sid] = made.id; if (made.meetLink && !meet) meet = made.meetLink; } }
    }
  } catch (error) { console.error("Scheduling Google sync failed", error instanceof Error ? error.message : error); }
  await deps.db.prepare("UPDATE sched_bookings SET google_events=?3, meet_link=?4 WHERE owner_id=?1 AND id=?2").bind(row.owner_id, row.id, JSON.stringify(events), meet || "").run();
}

export async function updateBooking(deps: Deps, ownerId: string, id: string, change: { status?: string; start?: string; staffIds?: string[]; notes?: string; addPhotos?: string[]; removePhoto?: string; by: string; notify?: boolean }, workspace: WorkspaceLite) {
  const { db } = deps;
  const row = await getBooking(db, ownerId, id);
  if (!row) throw new SchedulingError("That appointment no longer exists.", 404);
  const cal = await getCalendar(db, ownerId, row.calendar_id);
  if (!cal) throw new SchedulingError("The booking calendar for this appointment was deleted.", 404);
  const now = new Date(nowMs(deps)).toISOString();
  const prevStaff = parse<string[]>(row.staff_ids, []);
  if (change.status === "cancelled") return cancelBooking(deps, row, cal, change.by, workspace, change.notify !== false);
  if (change.status && ["booked", "completed", "no_show"].includes(change.status)) {
    if (row.status === "cancelled" && change.status === "booked") throw new SchedulingError("A cancelled appointment can't be restored. Book a new one instead.", 409);
    await db.prepare("UPDATE sched_bookings SET status=?3, updated_at=?4 WHERE owner_id=?1 AND id=?2").bind(ownerId, id, change.status, now).run();
    if (row.contact_id && change.status !== row.status) {
      await db.prepare("INSERT INTO crm_activities (id, owner_id, opportunity_id, contact_id, activity_type, body, created_by, created_at) VALUES (?1,?2,?3,?4,'note',?5,?6,?7)").bind(crypto.randomUUID(), ownerId, row.opportunity_id, row.contact_id, `📅 ${cal.name}: marked ${change.status === "no_show" ? "no-show" : change.status}`, change.by, now).run().catch(() => undefined);
      if (change.status === "no_show" || change.status === "completed") await emitAutomationEvent(db as never, { ownerId, scopeId: cal.clientId, type: change.status === "no_show" ? "appointment_no_show" : "appointment_completed", contactId: row.contact_id, payload: { calendarId: cal.id, calendarName: cal.name, bookingId: id }, dedupeKey: `appt:${id}:${change.status}` }).catch(() => undefined);
    }
  }
  const newStart = change.start ? Date.parse(change.start) : Date.parse(row.start_at);
  const moved = change.start && newStart !== Date.parse(row.start_at);
  const newStaff = change.staffIds?.length ? [...new Set(change.staffIds)].filter((sid) => workspace.staff.some((s) => s.id === sid)) : prevStaff;
  const reassigned = newStaff.join(",") !== prevStaff.join(",");
  if ((moved || reassigned) && row.status === "booked") {
    if (!Number.isFinite(newStart)) throw new SchedulingError("Choose a valid time.");
    const end = newStart + Math.max(5 * 60_000, (Date.parse(row.end_at) - Date.parse(row.start_at)) || cal.durationMin * 60_000); // keep the appointment's own length
    const clash = await bookedBusy(db, ownerId, newStaff, newStart - cal.bufferBefore * 60_000, end + cal.bufferAfter * 60_000, id);
    const hit = clash.find((b) => b.start < end + cal.bufferAfter * 60_000 && b.end > newStart - cal.bufferBefore * 60_000);
    if (hit) throw new SchedulingError(`${workspace.staff.find((s) => s.id === hit.staffId)?.name || "That person"} already has an appointment then.`, 409);
    const s = new Date(newStart).toISOString(), e = new Date(end).toISOString();
    await db.batch([
      db.prepare("UPDATE sched_bookings SET start_at=?3, end_at=?4, staff_ids=?5, updated_at=?6 WHERE owner_id=?1 AND id=?2").bind(ownerId, id, s, e, JSON.stringify(newStaff), now),
      db.prepare("DELETE FROM sched_booking_staff WHERE booking_id=?1").bind(id),
      ...newStaff.map((sid) => db.prepare("INSERT INTO sched_booking_staff (booking_id, owner_id, staff_id, start_at, end_at, active) VALUES (?1,?2,?3,?4,?5,1)").bind(id, ownerId, sid, new Date(newStart - cal.bufferBefore * 60_000).toISOString(), new Date(end + cal.bufferAfter * 60_000).toISOString())),
      db.prepare("DELETE FROM sched_reminders WHERE booking_id=?1 AND sent_at IS NULL").bind(id),
      ...([["24h", 86_400_000], ["1h", 3_600_000]] as const).filter(([, before]) => newStart - before > nowMs(deps) + 10 * 60_000).map(([kind, before]) => db.prepare("INSERT OR REPLACE INTO sched_reminders (booking_id, kind, due_at, sent_at) VALUES (?1,?2,?3,NULL)").bind(id, kind, new Date(newStart - before).toISOString())),
    ]);
    const fresh = (await getBooking(db, ownerId, id)) as BookingRow;
    await syncGoogle(deps, cal, fresh, workspace, "update", prevStaff);
    if (row.contact_id) await db.prepare("INSERT INTO crm_activities (id, owner_id, opportunity_id, contact_id, activity_type, body, created_by, created_at) VALUES (?1,?2,?3,?4,'note',?5,?6,?7)").bind(crypto.randomUUID(), ownerId, row.opportunity_id, row.contact_id, `📅 ${cal.name} ${moved ? `moved to ${new Date(newStart).toLocaleString("en-IE", { timeZone: cal.timezone, weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}` : ""}${reassigned ? ` · now with ${newStaff.map((sid) => workspace.staff.find((p) => p.id === sid)?.name || "Team").join(", ")}` : ""}`.trim(), change.by, now).run().catch(() => undefined);
    if (moved) {
      if (row.contact_id) await emitAutomationEvent(db as never, { ownerId, scopeId: cal.clientId, type: "appointment_rescheduled", contactId: row.contact_id, payload: { calendarId: cal.id, calendarName: cal.name, bookingId: id, start: s }, dedupeKey: `appt:${id}:moved:${s}` }).catch(() => undefined);
      await sendBookingEmails(deps, cal, fresh, workspace, workspace.clients.find((c) => c.id === cal.clientId), "rescheduled", change.notify !== false);
    } else if (reassigned) await sendBookingEmails(deps, cal, fresh, workspace, workspace.clients.find((c) => c.id === cal.clientId), "reassigned", false);
  }
  if (typeof change.notes === "string") await db.prepare("UPDATE sched_bookings SET notes=?3, updated_at=?4 WHERE owner_id=?1 AND id=?2").bind(ownerId, id, clean(change.notes, 2000), now).run();
  if (change.addPhotos?.length || change.removePhoto) {
    const answers = parse<Array<{ label: string; value: string }>>(row.answers, []);
    const keep = answers.filter((a) => !(/^Photo/i.test(a.label) && a.value === change.removePhoto));
    const photos = keep.filter((a) => /^Photo/i.test(a.label)).map((a) => a.value);
    const others = keep.filter((a) => !/^Photo/i.test(a.label));
    const added = (change.addPhotos || []).map((u) => clean(u, 600)).filter((u) => /^(https:\/\/|\/media\/)/.test(u) && !photos.includes(u));
    const all = [...photos, ...added].slice(0, 12).map((value, i) => ({ label: i ? `Photo ${i + 1}` : "Photo", value }));
    await db.prepare("UPDATE sched_bookings SET answers=?3, updated_at=?4 WHERE owner_id=?1 AND id=?2").bind(ownerId, id, JSON.stringify([...others, ...all]), now).run();
  }
  return bookingView((await getBooking(db, ownerId, id)) as BookingRow);
}

export async function cancelBooking(deps: Deps, row: BookingRow, cal: CalendarConfig, by: string, workspace: WorkspaceLite, notifyCustomer = true) {
  const { db } = deps;
  if (row.status === "cancelled") return bookingView(row);
  const now = new Date(nowMs(deps)).toISOString();
  await db.batch([
    db.prepare("UPDATE sched_bookings SET status='cancelled', updated_at=?3 WHERE owner_id=?1 AND id=?2").bind(row.owner_id, row.id, now),
    db.prepare("UPDATE sched_booking_staff SET active=0 WHERE booking_id=?1").bind(row.id),
    db.prepare("DELETE FROM sched_reminders WHERE booking_id=?1 AND sent_at IS NULL").bind(row.id),
  ]);
  const fresh = (await getBooking(db, row.owner_id, row.id)) as BookingRow;
  await syncGoogle(deps, cal, fresh, workspace, "cancel");
  if (row.contact_id) {
    await db.prepare("INSERT INTO crm_activities (id, owner_id, opportunity_id, contact_id, activity_type, body, created_by, created_at) VALUES (?1,?2,?3,?4,'note',?5,?6,?7)").bind(crypto.randomUUID(), row.owner_id, row.opportunity_id, row.contact_id, `📅 ${cal.name} cancelled (${by})`, by, now).run().catch(() => undefined);
    await emitAutomationEvent(db as never, { ownerId: row.owner_id, scopeId: cal.clientId, type: "appointment_cancelled", contactId: row.contact_id, payload: { calendarId: cal.id, calendarName: cal.name, bookingId: row.id }, dedupeKey: `appt:${row.id}:cancelled` }).catch(() => undefined);
  }
  await sendBookingEmails(deps, cal, fresh, workspace, workspace.clients.find((c) => c.id === cal.clientId), "cancelled", notifyCustomer);
  return bookingView(fresh);
}

// ---------- emails ----------
type MailKind = "booked" | "rescheduled" | "cancelled" | "reassigned" | "reminder";
async function sendBookingEmails(deps: Deps, cal: CalendarConfig, row: BookingRow, workspace: WorkspaceLite, client: ClientLite | undefined, kind: MailKind, toCustomer: boolean, reminderLabel = "") {
  if (!deps.sendEmail) return;
  const business = client?.name || workspace.agencyName || "F2B Media";
  const brand = client?.branding?.primary && /^#[0-9a-f]{6}$/i.test(client.branding.primary) ? client.branding.primary : cal.color;
  const when = new Date(Date.parse(row.start_at)).toLocaleString("en-IE", { timeZone: cal.timezone, weekday: "long", day: "numeric", month: "long", hour: "2-digit", minute: "2-digit" });
  const staff = parse<string[]>(row.staff_ids, []).map((id) => workspace.staff.find((s) => s.id === id)).filter(Boolean) as StaffLite[];
  const manageUrl = `${deps.baseUrl}/f/book/manage?t=${row.manage_token}`;
  const where = locationLabel(cal.locationType, cal.locationDetail) + (row.meet_link ? ` · ${row.meet_link}` : "");
  const answers = parse<Array<{ label: string; value: string }>>(row.answers, []).filter((a) => a.value);
  const headline = kind === "booked" ? "You're booked in" : kind === "rescheduled" ? "Your appointment has moved" : kind === "cancelled" ? "Your appointment is cancelled" : kind === "reminder" ? `Reminder: ${reminderLabel}` : "Appointment update";
  const rows: Array<[string, string]> = [["What", cal.name], ["When", when], ["With", staff.map((s) => s.name).join(", ") || business], ["Where", where]];
  const table = rows.map(([k, v]) => `<tr><td style="padding:8px 0;color:#64748b;font-size:14px;width:90px;vertical-align:top">${esc(k)}</td><td style="padding:8px 0;color:#0f172a;font-size:15px;font-weight:600">${esc(v)}</td></tr>`).join("");
  const wrap = (title: string, body: string) => `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif"><div style="max-width:560px;margin:0 auto;padding:24px 14px"><div style="background:${brand};border-radius:18px 18px 0 0;padding:20px 24px;color:#fff"><div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;opacity:.8">${esc(business)}</div><div style="font-size:22px;font-weight:800;margin-top:6px">${esc(title)}</div></div><div style="background:#fff;border-radius:0 0 18px 18px;padding:22px 24px">${body}</div></div></body></html>`;
  const sends: Array<() => Promise<void>> = [];
  if (toCustomer && row.email) {
    const actions = kind === "cancelled" ? `<p style="margin:16px 0 0"><a href="${esc(deps.baseUrl)}/f/book/${esc(cal.slug)}" style="display:inline-block;background:${brand};color:#fff;text-decoration:none;font-weight:700;padding:11px 18px;border-radius:999px">Book another time</a></p>` : `<p style="margin:16px 0 0"><a href="${esc(manageUrl)}" style="display:inline-block;background:${brand};color:#fff;text-decoration:none;font-weight:700;padding:11px 18px;border-radius:999px">Reschedule or cancel</a></p>`;
    const html = wrap(headline, `<p style="margin:0 0 12px;color:#0f172a;font-size:16px">Hi ${esc(row.name.split(" ")[0])},</p>${kind === "booked" && cal.confirmationMessage ? `<p style="color:#334155;font-size:15px;line-height:1.55">${esc(cal.confirmationMessage)}</p>` : ""}<table style="width:100%;border-collapse:collapse">${table}</table>${actions}<p style="margin:18px 0 0;color:#64748b;font-size:12px">${esc(business)}${client?.phone ? ` · ${esc(client.phone)}` : ""}</p>`);
    const textBody = [headline, "", ...rows.map(([k, v]) => `${k}: ${v}`), "", kind === "cancelled" ? `Book another time: ${deps.baseUrl}/f/book/${cal.slug}` : `Reschedule or cancel: ${manageUrl}`, "", business].join("\n");
    const subject = `${headline}: ${cal.name} – ${when}`;
    sends.push(() => deps.sendEmail!({ to: [row.email], subject, html, text: textBody, fromName: business, replyTo: client?.email || staff[0]?.email, idempotencyKey: `sched/${row.id}/${kind}/${reminderLabel || row.updated_at}/customer` })
      .then(() => logSystemEmail(deps.db as never, { ownerId: row.owner_id, clientId: cal.clientId || null, to: row.email, name: row.name, subject, text: textBody })));
  }
  const staffTo = staff.map((s) => s.email || "").filter((e) => /@/.test(e));
  if (staffTo.length && kind !== "reminder") {
    const title = kind === "booked" ? `New booking: ${cal.name}` : kind === "rescheduled" ? `Moved: ${cal.name}` : kind === "cancelled" ? `Cancelled: ${cal.name}` : `Assigned to you: ${cal.name}`;
    const extra = [["Customer", row.name], ...(row.phone ? [["Phone", row.phone]] : []), ...(row.email ? [["Email", row.email]] : []), ...answers.map((a) => [a.label, a.value]), ...(row.channel ? [["Source", row.channel]] : [])] as Array<[string, string]>;
    const html = wrap(title, `<table style="width:100%;border-collapse:collapse">${table}${extra.map(([k, v]) => `<tr><td style="padding:8px 0;color:#64748b;font-size:14px;vertical-align:top">${esc(k)}</td><td style="padding:8px 0;color:#0f172a;font-size:15px">${esc(v)}</td></tr>`).join("")}</table><p style="margin:16px 0 0;color:#64748b;font-size:12px">Saved in Scheduling and the CRM.</p>`);
    const textBody = [title, "", ...rows.map(([k, v]) => `${k}: ${v}`), ...extra.map(([k, v]) => `${k}: ${v}`)].join("\n");
    const subject = `${title} – ${row.name} – ${when}`;
    sends.push(() => deps.sendEmail!({ to: staffTo, subject, html, text: textBody, fromName: `${business} bookings`, replyTo: row.email || undefined, idempotencyKey: `sched/${row.id}/${kind}/${row.updated_at}/staff` })
      .then(() => logSystemEmail(deps.db as never, { ownerId: row.owner_id, clientId: cal.clientId || null, to: staffTo.join(", "), subject, text: textBody })));
  }
  for (const send of sends) await send().catch((error) => console.error("Scheduling email failed", error instanceof Error ? error.message : error));
}

/** Cron: send due 24h / 1h reminders. Indexed on due_at; at most 50 per run. */
export async function processSchedulingReminders(deps: Deps, loadWorkspace: () => Promise<WorkspaceLite | null>) {
  const { db } = deps;
  await ensureSchedulingTables(db);
  const now = new Date(nowMs(deps)).toISOString();
  const due = (await db.prepare("SELECT booking_id, kind FROM sched_reminders WHERE sent_at IS NULL AND due_at<=?1 ORDER BY due_at LIMIT 50").bind(now).all<{ booking_id: string; kind: string }>()).results || [];
  if (!due.length) return { sent: 0 };
  const workspace = await loadWorkspace();
  let sent = 0;
  for (const item of due) {
    await db.prepare("UPDATE sched_reminders SET sent_at=?3 WHERE booking_id=?1 AND kind=?2").bind(item.booking_id, item.kind, now).run();
    const row = await db.prepare("SELECT * FROM sched_bookings WHERE id=?1").bind(item.booking_id).first<BookingRow>();
    if (!row || row.status !== "booked" || Date.parse(row.start_at) < nowMs(deps) || !workspace) continue;
    const cal = await getCalendar(db, row.owner_id, row.calendar_id);
    if (!cal) continue;
    await sendBookingEmails(deps, cal, row, workspace, workspace.clients.find((c) => c.id === cal.clientId), "reminder", true, item.kind === "24h" ? "tomorrow" : "in 1 hour");
    sent++;
  }
  return { sent };
}

// ---------- calendar feed ----------
export async function icsFeed(db: Db, feedToken: string, workspace: WorkspaceLite | null) {
  await ensureSchedulingTables(db);
  if (!/^[a-f0-9]{40,64}$/.test(feedToken)) return null;
  const who = await db.prepare("SELECT owner_id, staff_id FROM sched_staff_settings WHERE ics_token=?1").bind(feedToken).first<{ owner_id: string; staff_id: string }>();
  if (!who) return null;
  const from = new Date(Date.now() - 30 * 86_400_000).toISOString(), to = new Date(Date.now() + 180 * 86_400_000).toISOString();
  const rows = (await db.prepare("SELECT b.* FROM sched_booking_staff s JOIN sched_bookings b ON b.id=s.booking_id WHERE s.owner_id=?1 AND s.staff_id=?2 AND s.start_at>=?3 AND s.start_at<?4 ORDER BY s.start_at LIMIT 1000").bind(who.owner_id, who.staff_id, from, to).all<BookingRow>()).results || [];
  // Cancelled bookings drop their staff rows to active=0 but stay joinable, so the feed can mark them cancelled.
  const cals = new Map<string, CalendarConfig | null>();
  const events = [];
  for (const row of rows) {
    if (!cals.has(row.calendar_id)) cals.set(row.calendar_id, await getCalendar(db, row.owner_id, row.calendar_id));
    const cal = cals.get(row.calendar_id);
    const ev = cal && workspace ? eventFor(cal, row, workspace) : null;
    events.push({ id: row.id, start: row.start_at, end: row.end_at, summary: ev?.summary || `${cal?.name || "Appointment"} · ${row.name}`, description: ev?.description, location: ev?.location || (row.meet_link || undefined), status: row.status, updatedAt: row.updated_at });
  }
  const name = workspace?.staff.find((s) => s.id === who.staff_id)?.name;
  return buildIcs(`${name ? `${name} · ` : ""}F2B bookings`, events);
}

// ---------- staff booking profiles (reviews + photos) ----------
export type StaffReview = { id: string; author: string; rating: number; text: string; source: string; date: string };
export type StaffPhoto = { url: string; caption: string };
export type StaffProfile = { showReviews: boolean; showPhotos: boolean; title: string; bio: string; reviews: StaffReview[]; photos: StaffPhoto[] };
const EMPTY_PROFILE: StaffProfile = { showReviews: false, showPhotos: false, title: "", bio: "", reviews: [], photos: [] };
const okImage = (url: string) => /^(https:\/\/|\/media\/)/.test(url) && url.length < 1000;

export function sanitizeProfile(input: unknown): StaffProfile {
  const r = (input && typeof input === "object" ? input : {}) as Record<string, unknown>;
  const reviews = Array.isArray(r.reviews) ? (r.reviews as unknown[]).slice(0, 60).map((x, i) => {
    const v = (x || {}) as Record<string, unknown>;
    return { id: clean(v.id, 40) || `rv${i}${Date.now().toString(36)}`, author: clean(v.author, 80), rating: Math.max(1, Math.min(5, Math.round(Number(v.rating) || 5))), text: clean(v.text, 800), source: clean(v.source, 40), date: /^\d{4}-\d{2}-\d{2}$/.test(String(v.date)) ? String(v.date) : "" };
  }).filter((x) => x.author || x.text) : [];
  const photos = Array.isArray(r.photos) ? (r.photos as unknown[]).slice(0, 16).map((x) => { const v = (x || {}) as Record<string, unknown>; return { url: clean(v.url, 1000), caption: clean(v.caption, 120) }; }).filter((p) => okImage(p.url)) : [];
  return { showReviews: Boolean(r.showReviews), showPhotos: Boolean(r.showPhotos), title: clean(r.title, 60), bio: clean(r.bio, 400), reviews, photos };
}

export async function getStaffProfiles(db: Db, ownerId: string, staffIds: string[]) {
  await ensureSchedulingTables(db);
  const ids = [...new Set(staffIds)].slice(0, 100);
  const out: Record<string, StaffProfile> = {};
  if (!ids.length) return out;
  const rows = (await db.prepare(`SELECT staff_id, profile FROM sched_staff_profiles WHERE owner_id=?1 AND staff_id IN (${ids.map((_, i) => `?${i + 2}`).join(",")})`).bind(ownerId, ...ids).all<{ staff_id: string; profile: string }>()).results || [];
  for (const row of rows) out[row.staff_id] = sanitizeProfile(parse(row.profile, EMPTY_PROFILE));
  return out;
}

export async function saveStaffProfile(db: Db, ownerId: string, staffId: string, input: unknown) {
  await ensureSchedulingTables(db);
  const profile = sanitizeProfile(input);
  await db.prepare("INSERT INTO sched_staff_profiles (owner_id, staff_id, profile, updated_at) VALUES (?1,?2,?3,?4) ON CONFLICT(owner_id, staff_id) DO UPDATE SET profile=excluded.profile, updated_at=excluded.updated_at").bind(ownerId, staffId, JSON.stringify(profile), new Date().toISOString()).run();
  return profile;
}

/** What customers see on the booking page (only what the toggles allow). */
export function publicProfile(p: StaffProfile | undefined) {
  if (!p) return null;
  const reviews = p.showReviews ? p.reviews : [];
  const photos = p.showPhotos ? p.photos : [];
  if (!reviews.length && !photos.length && !p.title && !p.bio) return null;
  const rating = reviews.length ? Math.round((reviews.reduce((n, r) => n + r.rating, 0) / reviews.length) * 10) / 10 : 0;
  return { title: p.title, bio: p.bio, rating, reviewCount: reviews.length, reviews: reviews.slice(0, 30).map(({ author, rating, text, source, date }) => ({ author, rating, text, source, date })), photos };
}

// ---------- review request links ----------
export async function reviewLinkToken(db: Db, ownerId: string, staffId: string, rotate = false) {
  await ensureSchedulingTables(db);
  if (rotate) await db.prepare("DELETE FROM sched_review_links WHERE owner_id=?1 AND staff_id=?2").bind(ownerId, staffId).run();
  const fresh = token().slice(0, 40);
  await db.prepare("INSERT INTO sched_review_links (token, owner_id, staff_id, created_at) VALUES (?1,?2,?3,?4) ON CONFLICT(owner_id, staff_id) DO NOTHING").bind(fresh, ownerId, staffId, new Date().toISOString()).run();
  const row = await db.prepare("SELECT token FROM sched_review_links WHERE owner_id=?1 AND staff_id=?2").bind(ownerId, staffId).first<{ token: string }>();
  return row?.token || fresh;
}

export async function reviewLinkOwner(db: Db, linkToken: string) {
  await ensureSchedulingTables(db);
  if (!/^[a-f0-9]{32,64}$/.test(linkToken)) return null;
  return db.prepare("SELECT owner_id, staff_id FROM sched_review_links WHERE token=?1").bind(linkToken).first<{ owner_id: string; staff_id: string }>();
}

/** A customer left a review through the link: add it to the top of that person's profile. */
export async function addCollectedReview(db: Db, ownerId: string, staffId: string, review: { author: string; rating: number; text: string }) {
  const current = (await getStaffProfiles(db, ownerId, [staffId]))[staffId] || { ...EMPTY_PROFILE };
  const entry: StaffReview = { id: `rv${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`, author: clean(review.author, 80) || "Customer", rating: Math.max(1, Math.min(5, Math.round(Number(review.rating) || 5))), text: clean(review.text, 800), source: "Review link", date: new Date().toISOString().slice(0, 10) };
  return saveStaffProfile(db, ownerId, staffId, { ...current, reviews: [entry, ...current.reviews].slice(0, 60) });
}
