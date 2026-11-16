// Scheduling tables. Also shipped as drizzle/0048_scheduling.sql; created on demand so the feature works
// before the migration is applied. Every query the feature runs is index-backed (no full-table scans).
export const SCHEDULING_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS sched_calendars (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  client_id TEXT NOT NULL DEFAULT '',
  slug TEXT NOT NULL,
  name TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  config TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS sched_calendars_slug_idx ON sched_calendars(slug);
CREATE INDEX IF NOT EXISTS sched_calendars_scope_idx ON sched_calendars(owner_id, client_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS sched_staff_settings (
  owner_id TEXT NOT NULL,
  staff_id TEXT NOT NULL,
  timezone TEXT NOT NULL DEFAULT 'Europe/Dublin',
  weekly TEXT NOT NULL DEFAULT '{}',
  blocked TEXT NOT NULL DEFAULT '[]',
  daily_limit INTEGER NOT NULL DEFAULT 0,
  ics_token TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, staff_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS sched_staff_settings_ics_idx ON sched_staff_settings(ics_token);

CREATE TABLE IF NOT EXISTS sched_bookings (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  client_id TEXT NOT NULL DEFAULT '',
  calendar_id TEXT NOT NULL,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'booked' CHECK (status IN ('booked','cancelled','completed','no_show')),
  staff_ids TEXT NOT NULL DEFAULT '[]',
  contact_id TEXT,
  opportunity_id TEXT,
  name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  answers TEXT NOT NULL DEFAULT '[]',
  notes TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'public',
  channel TEXT NOT NULL DEFAULT '',
  manage_token TEXT NOT NULL,
  google_events TEXT NOT NULL DEFAULT '{}',
  meet_link TEXT NOT NULL DEFAULT '',
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS sched_bookings_scope_start_idx ON sched_bookings(owner_id, client_id, start_at);
CREATE INDEX IF NOT EXISTS sched_bookings_calendar_start_idx ON sched_bookings(calendar_id, start_at);
CREATE UNIQUE INDEX IF NOT EXISTS sched_bookings_manage_idx ON sched_bookings(manage_token);

-- One row per staff member per booking, so clash checks and per-person feeds are indexed lookups.
CREATE TABLE IF NOT EXISTS sched_booking_staff (
  booking_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  staff_id TEXT NOT NULL,
  start_at TEXT NOT NULL,
  end_at TEXT NOT NULL,
  active INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (booking_id, staff_id)
);
CREATE INDEX IF NOT EXISTS sched_booking_staff_busy_idx ON sched_booking_staff(owner_id, staff_id, start_at) WHERE active = 1;

CREATE TABLE IF NOT EXISTS sched_google_connections (
  owner_id TEXT NOT NULL,
  staff_id TEXT NOT NULL,
  encrypted_refresh_token TEXT NOT NULL,
  token_iv TEXT NOT NULL,
  account_email TEXT NOT NULL DEFAULT '',
  connected_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, staff_id)
);

-- Booking-page profile per staff member: reviews and work photos customers see before picking who to book.
CREATE TABLE IF NOT EXISTS sched_staff_profiles (
  owner_id TEXT NOT NULL,
  staff_id TEXT NOT NULL,
  profile TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, staff_id)
);

CREATE TABLE IF NOT EXISTS sched_reminders (
  booking_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  due_at TEXT NOT NULL,
  sent_at TEXT,
  PRIMARY KEY (booking_id, kind)
);
CREATE INDEX IF NOT EXISTS sched_reminders_due_idx ON sched_reminders(due_at) WHERE sent_at IS NULL;
`;

type SchemaDb = { prepare(sql: string): unknown; batch(statements: unknown[]): Promise<unknown> };
const ready = new WeakMap<object, Promise<void>>();
export function ensureSchedulingTables(db: SchemaDb) {
  let p = ready.get(db);
  if (!p) {
    const statements = SCHEDULING_SCHEMA_SQL.split(/;\s*\n/).map((part) => part.split("\n").filter((line) => !line.trim().startsWith("--")).join("\n").trim()).filter(Boolean);
    p = db.batch(statements.map((sql) => db.prepare(sql))).then(() => undefined).catch((error) => { ready.delete(db); throw error; });
    ready.set(db, p);
  }
  return p;
}
