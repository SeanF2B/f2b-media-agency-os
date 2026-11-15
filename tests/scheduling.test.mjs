import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import { computeSlots, localToUtc, utcToLocal, sanitizeCalendar, sanitizeWeekly, chooseStaff, buildIcs, DEFAULT_WEEKLY } from "../lib/scheduling/core.ts";
import { saveCalendar, saveStaffSettings, availableSlots, createBooking, updateBooking, listBookings, getBookingByToken, cancelBooking, getCalendar, icsFeed, staffFeedToken, processSchedulingReminders } from "../lib/scheduling/server.ts";
import { AUTOMATION_SCHEMA_SQL } from "../lib/crm-automations/schema-sql.ts";

const crmSql = await readFile(new URL("../drizzle/0041_native_crm.sql", import.meta.url), "utf8");

function d1(raw) {
  const prepare = (sql) => {
    const make = (params) => ({
      bind: (...values) => make(values.map((value) => (value === undefined ? null : typeof value === "boolean" ? Number(value) : value))),
      first: async () => raw.prepare(sql).get(...params) ?? null,
      all: async () => ({ results: raw.prepare(sql).all(...params) }),
      run: async () => { const info = raw.prepare(sql).run(...params); return { meta: { changes: Number(info.changes) } }; },
    });
    return make([]);
  };
  return { prepare, batch: async (statements) => { raw.exec("BEGIN"); try { const out = []; for (const s of statements) out.push(await s.run()); raw.exec("COMMIT"); return out; } catch (error) { raw.exec("ROLLBACK"); throw error; } } };
}

// Monday 16 Nov 2026, 08:00 Dublin (= UTC in winter).
const MONDAY = "2026-11-16";
const NOW = Date.parse("2026-11-15T12:00:00Z");
const workspace = { ownerId: "owner", agencyName: "F2B", clients: [{ id: "c1", name: "Pro Roofers", email: "pat@example.com" }], staff: [{ id: "pat", name: "Pat", email: "pat@example.com" }, { id: "mick", name: "Mick", email: "mick@example.com" }] };

function setup() {
  const raw = new DatabaseSync(":memory:");
  raw.exec(crmSql);
  raw.exec("ALTER TABLE crm_pipelines ADD COLUMN client_id TEXT; ALTER TABLE crm_opportunities ADD COLUMN project_location TEXT NOT NULL DEFAULT ''; ALTER TABLE crm_opportunities ADD COLUMN project_type TEXT NOT NULL DEFAULT '';");
  raw.exec(AUTOMATION_SCHEMA_SQL);
  raw.exec("INSERT INTO crm_pipelines (id, owner_id, name, description, archived, created_at, updated_at, client_id) VALUES ('p1','owner','Leads','',0,'t','t','c1'); INSERT INTO crm_pipeline_stages VALUES ('s1','owner','p1','New lead',0,'open','t'),('s2','owner','p1','Appointment booked',1,'open','t'),('s3','owner','p1','Won',2,'won','t');");
  const db = d1(raw);
  const mails = [];
  const deps = { db, baseUrl: "https://os.example", now: () => NOW, sendEmail: async (m) => { mails.push(m); } };
  return { raw, db, deps, mails };
}

async function seed(deps, extra = {}) {
  await saveStaffSettings(deps.db, "owner", "pat", { weekly: { mon: [["09:00", "12:00"]] }, timezone: "Europe/Dublin" });
  await saveStaffSettings(deps.db, "owner", "mick", { weekly: { mon: [["09:00", "12:00"]] }, timezone: "Europe/Dublin" });
  return saveCalendar(deps.db, "owner", { name: "Roof survey", clientId: "c1", durationMin: 60, slotInterval: 60, bufferAfter: 30, minNoticeMin: 60, staffIds: ["pat", "mick"], assignMode: "round_robin", questions: [{ label: "Eircode", required: true }], ...extra });
}

test("time zone helpers round-trip across DST", () => {
  const summer = localToUtc("2026-07-01", "09:00", "Europe/Dublin");
  assert.equal(new Date(summer).toISOString(), "2026-07-01T08:00:00.000Z");
  assert.deepEqual(utcToLocal(summer, "Europe/Dublin").time, "09:00");
  const winter = localToUtc("2026-12-01", "09:00", "Europe/Dublin");
  assert.equal(new Date(winter).toISOString(), "2026-12-01T09:00:00.000Z");
});

test("sanitizers clamp input", () => {
  const cal = sanitizeCalendar({ name: "  Consult ", durationMin: 9999, bufferBefore: -5, assignMode: "nope", redirectUrl: "javascript:alert(1)", color: "red" });
  assert.equal(cal.durationMin, 600); assert.equal(cal.bufferBefore, 0); assert.equal(cal.assignMode, "customer_pick"); assert.equal(cal.redirectUrl, ""); assert.equal(cal.color, "#2563eb"); assert.equal(cal.slug, "consult");
  assert.deepEqual(sanitizeWeekly({ mon: [["17:00", "09:00"], ["09:00", "12:00"]], xyz: [] }), { mon: [["09:00", "12:00"]] });
});

test("slots respect hours, buffers, notice and collective mode", () => {
  const cal = { ...sanitizeCalendar({ name: "Survey", durationMin: 60, slotInterval: 30, bufferAfter: 30, staffIds: ["a", "b"], assignMode: "collective" }), id: "x", ownerId: "o", minNoticeMin: 0 };
  const availability = [{ staffId: "a", timezone: "Europe/Dublin", weekly: { mon: [["09:00", "12:00"]] }, blocked: [], dailyLimit: 0 }, { staffId: "b", timezone: "Europe/Dublin", weekly: { mon: [["10:00", "12:00"]] }, blocked: [], dailyLimit: 0 }];
  const busy = [{ staffId: "b", start: Date.parse(`${MONDAY}T10:00:00Z`), end: Date.parse(`${MONDAY}T10:30:00Z`) }];
  const slots = computeSlots({ cal, availability, busy, bookingsForLimits: [], fromDate: MONDAY, toDate: MONDAY, now: NOW });
  // b busy 10:00-10:30 (+30 min buffer after our slot): first shared slot is 10:30? 10:30-11:30 fine; 11:00-12:00 fine.
  assert.deepEqual(slots.map((s) => s.start.slice(11, 16)), ["10:30", "11:00"]);
  assert.ok(slots.every((s) => s.staffIds.length === 2));
  const one = computeSlots({ cal: { ...cal, assignMode: "customer_pick" }, availability, busy, bookingsForLimits: [], fromDate: MONDAY, toDate: MONDAY, now: NOW, onlyStaffId: "a" });
  assert.equal(one[0].start.slice(11, 16), "09:00");
  assert.equal(computeSlots({ cal: { ...cal, minNoticeMin: 60 * 24 * 3 }, availability, busy: [], bookingsForLimits: [], fromDate: MONDAY, toDate: MONDAY, now: NOW }).length, 0);
});

test("round robin picks the least busy person", () => {
  const slot = { start: `${MONDAY}T09:00:00.000Z`, end: "", staffIds: ["a", "b"] };
  assert.deepEqual(chooseStaff({ assignMode: "round_robin", staffIds: ["a", "b"], timezone: "Europe/Dublin" }, slot, "", [{ staffId: "a", start: Date.parse(`${MONDAY}T14:00:00Z`) }]), ["b"]);
  assert.deepEqual(chooseStaff({ assignMode: "customer_pick", staffIds: ["a", "b"], timezone: "Europe/Dublin" }, slot, "a", []), ["a"]);
});

test("booking flow: CRM contact + opportunity, clash protection, staff pick, cancel, feed", async () => {
  const { raw, deps, mails } = setup();
  const cal = await seed(deps);
  assert.equal(cal.slug, "roof-survey");
  const slots = await availableSlots(deps, cal, { fromDate: MONDAY, days: 1 });
  assert.deepEqual(slots.map((s) => s.start.slice(11, 16)), ["09:00", "10:00", "11:00"]);

  await assert.rejects(createBooking(deps, { cal, start: slots[0].start, name: "Ann Lee", email: "ann@example.com", source: "public", workspace, answers: {} }), /Eircode/);
  const first = await createBooking(deps, { cal, start: slots[0].start, name: "Ann Lee", email: "ann@example.com", phone: "087 123 4567", source: "public", workspace, answers: { q1: "H91 X2Y3" } });
  assert.equal(first.booking.staffIds.length, 1);
  const contact = raw.prepare("SELECT * FROM crm_contacts").get();
  assert.equal(contact.client_id, "c1"); assert.equal(contact.phone, "+353871234567");
  const opp = raw.prepare("SELECT * FROM crm_opportunities").get();
  assert.equal(opp.stage_id, "s2"); assert.equal(opp.contact_id, contact.id);
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM crm_automation_events WHERE event_type='appointment_booked'").get().n, 1);
  assert.ok(mails.some((m) => m.to.includes("ann@example.com") && /booked in/.test(m.subject)));

  // Second booking at 09:00 goes to the other person; a third has nobody left.
  const second = await createBooking(deps, { cal, start: slots[0].start, name: "Bob", email: "bob@example.com", source: "public", workspace, answers: { q1: "x" } });
  assert.notDeepEqual(second.booking.staffIds, first.booking.staffIds);
  await assert.rejects(createBooking(deps, { cal, start: slots[0].start, name: "Cat", email: "cat@example.com", source: "public", workspace, answers: { q1: "x" } }), /taken/);
  // 30-minute buffer after 09:00-10:00 blocks 10:00 for both; 11:00 still open.
  const after = await availableSlots(deps, cal, { fromDate: MONDAY, days: 1 });
  assert.deepEqual(after.map((s) => s.start.slice(11, 16)), ["11:00"]);

  // Same contact books again → reuses the contact and the open opportunity.
  await createBooking(deps, { cal, start: after[0].start, staffId: "pat", name: "Ann Lee", email: "ANN@example.com", source: "public", workspace, answers: { q1: "x" } });
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM crm_contacts WHERE email='ann@example.com'").get().n, 1);
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM crm_opportunities WHERE contact_id=?").get(contact.id).n, 1);

  // Cancel via manage token frees the slot.
  const row = await getBookingByToken(deps.db, first.manageToken);
  await cancelBooking(deps, row, await getCalendar(deps.db, "owner", cal.id), "Customer", workspace);
  const listed = await listBookings(deps.db, "owner", "c1", `${MONDAY}T00:00:00Z`, `${MONDAY}T23:59:59Z`);
  assert.equal(listed.filter((b) => b.status === "cancelled").length, 1);
  assert.equal(raw.prepare("SELECT COUNT(*) n FROM crm_automation_events WHERE event_type='appointment_cancelled'").get().n, 1);

  // Reassign + move from inside the OS, with clash checks.
  const moved = await updateBooking(deps, "owner", second.booking.id, { start: `${MONDAY}T11:00:00.000Z`, staffIds: ["mick"], by: "Sean" }, workspace);
  assert.equal(moved.start, `${MONDAY}T11:00:00.000Z`);
  await assert.rejects(updateBooking(deps, "owner", second.booking.id, { staffIds: ["pat"], by: "Sean" }, workspace), /already has an appointment/);
  const done = await updateBooking(deps, "owner", second.booking.id, { status: "no_show", by: "Sean" }, workspace);
  assert.equal(done.status, "no_show");

  // Private iCal feed for Pat.
  const feedToken = await staffFeedToken(deps.db, "owner", "pat");
  const ics = await icsFeed(deps.db, feedToken, workspace);
  assert.match(ics, /BEGIN:VCALENDAR/); assert.match(ics, /Roof survey/);
  assert.equal(await icsFeed(deps.db, "0".repeat(48), workspace), null);
});

test("reminders send once", async () => {
  const { deps, mails } = setup();
  const cal = await seed(deps);
  const slots = await availableSlots(deps, cal, { fromDate: MONDAY, days: 1 });
  await createBooking(deps, { cal, start: slots[2].start, name: "Ann", email: "ann@example.com", source: "public", workspace, answers: { q1: "x" } });
  mails.length = 0;
  const later = { ...deps, now: () => Date.parse(`${MONDAY}T10:30:00Z`) };
  assert.equal((await processSchedulingReminders(later, async () => workspace)).sent, 1); // booked <24h ahead, so only the 1-hour reminder
  assert.equal((await processSchedulingReminders(later, async () => workspace)).sent, 0);
  assert.ok(mails.every((m) => /Reminder/.test(m.subject)));
});

test("ics escaping and folding", () => {
  const ics = buildIcs("Test", [{ id: "1", start: "2026-11-16T09:00:00.000Z", end: "2026-11-16T10:00:00.000Z", summary: "A, B; C\nD".repeat(10) }]);
  assert.match(ics, /DTSTART:20261116T090000Z/);
  assert.ok(ics.split("\r\n").every((l) => l.length <= 75));
  assert.ok(DEFAULT_WEEKLY.mon);
});
