// Booking pages: several booking calendars grouped under one link (GHL-style "group" / service menu).
// The customer picks a service (picture, length, price), then a staff member and a time on that calendar's page.
// Links share one namespace with calendar links: /f/book/<slug> is either a calendar or a booking page.
type Db = { prepare(sql: string): { bind(...v: unknown[]): { first<T = unknown>(): Promise<T | null>; all<T = unknown>(): Promise<{ results?: T[] }>; run(): Promise<unknown> }; first<T = unknown>(): Promise<T | null>; run(): Promise<unknown> } };

export type BookingGroup = { id: string; ownerId: string; clientId: string; slug: string; name: string; intro: string; calendarIds: string[]; images: Record<string, string>; active: boolean; updatedAt: string };

const text = (v: unknown, n: number) => (typeof v === "string" ? v.trim().slice(0, n) : "");
export const slugifyLink = (v: string) => v.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
const safeImage = (v: unknown) => { const s = text(v, 600); return /^(https:\/\/|\/api\/marketing-public\/media\?f=)/.test(s) ? s : ""; };
const RESERVED = new Set(["manage", "g", "api", "admin", "new"]);

let ready = false;
export async function ensureGroupTable(db: Db) {
  if (ready) return;
  await db.prepare("CREATE TABLE IF NOT EXISTS sched_groups (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, client_id TEXT NOT NULL DEFAULT '', slug TEXT NOT NULL, name TEXT NOT NULL, active INTEGER NOT NULL DEFAULT 1, config TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)").run();
  await db.prepare("CREATE UNIQUE INDEX IF NOT EXISTS sched_groups_slug_idx ON sched_groups(slug)").run();
  await db.prepare("CREATE INDEX IF NOT EXISTS sched_groups_scope_idx ON sched_groups(owner_id, client_id)").run();
  ready = true;
}

type Row = { id: string; owner_id: string; client_id: string; slug: string; name: string; active: number; config: string; updated_at: string };
const toGroup = (r: Row): BookingGroup => {
  let c: Record<string, unknown> = {}; try { c = JSON.parse(r.config || "{}"); } catch { /* empty */ }
  const images = (c.images && typeof c.images === "object" ? c.images : {}) as Record<string, unknown>;
  return { id: r.id, ownerId: r.owner_id, clientId: r.client_id || "", slug: r.slug, name: r.name, intro: text(c.intro, 1500), calendarIds: Array.isArray(c.calendarIds) ? (c.calendarIds as unknown[]).map(String).slice(0, 40) : [], images: Object.fromEntries(Object.entries(images).map(([k, v]) => [k, safeImage(v)]).filter(([, v]) => v)), active: Boolean(r.active), updatedAt: r.updated_at };
};

export async function listGroups(db: Db, ownerId: string, clientId: string | null) {
  await ensureGroupTable(db);
  const rows = clientId === null
    ? (await db.prepare("SELECT * FROM sched_groups WHERE owner_id=?1 ORDER BY updated_at DESC LIMIT 200").bind(ownerId).all<Row>()).results || []
    : (await db.prepare("SELECT * FROM sched_groups WHERE owner_id=?1 AND client_id=?2 ORDER BY updated_at DESC LIMIT 100").bind(ownerId, clientId).all<Row>()).results || [];
  return rows.map(toGroup);
}
export async function getGroup(db: Db, ownerId: string, id: string) {
  await ensureGroupTable(db);
  const r = await db.prepare("SELECT * FROM sched_groups WHERE owner_id=?1 AND id=?2").bind(ownerId, id).first<Row>();
  return r ? toGroup(r) : null;
}
export async function getGroupBySlug(db: Db, slug: string) {
  await ensureGroupTable(db);
  const r = await db.prepare("SELECT * FROM sched_groups WHERE slug=?1").bind(slug).first<Row>();
  return r ? toGroup(r) : null;
}

/** Is this link free? Checks booking pages and booking calendars (they share /f/book/<slug>). */
export async function linkTaken(db: Db, slug: string, except: { groupId?: string; calendarId?: string } = {}) {
  if (RESERVED.has(slug)) return true;
  await ensureGroupTable(db);
  const g = await db.prepare("SELECT id FROM sched_groups WHERE slug=?1").bind(slug).first<{ id: string }>();
  if (g && g.id !== except.groupId) return true;
  const c = await db.prepare("SELECT id FROM sched_calendars WHERE slug=?1").bind(slug).first<{ id: string }>().catch(() => null);
  return Boolean(c && c.id !== except.calendarId);
}

export async function saveGroup(db: Db, ownerId: string, input: Record<string, unknown>, validCalendarIds: string[], now = new Date().toISOString()) {
  await ensureGroupTable(db);
  const id = text(input.id, 80) || `grp_${crypto.randomUUID()}`;
  const existing = input.id ? await getGroup(db, ownerId, id) : null;
  if (input.id && !existing) throw new Error("That booking page no longer exists.");
  const name = text(input.name, 120) || "Book an appointment";
  const wanted = slugifyLink(text(input.slug, 60) || name) || "book";
  if (await linkTaken(db, wanted, { groupId: id })) throw new Error(`The link /f/book/${wanted} is already taken. Try another.`);
  const calendarIds = (Array.isArray(input.calendarIds) ? input.calendarIds : []).map(String).filter((c) => validCalendarIds.includes(c));
  if (!calendarIds.length) throw new Error("Pick at least one booking calendar for this page.");
  const rawImages = (input.images && typeof input.images === "object" ? input.images : {}) as Record<string, unknown>;
  const images = Object.fromEntries(calendarIds.map((c) => [c, safeImage(rawImages[c])]).filter(([, v]) => v));
  const clientId = existing ? existing.clientId : text(input.clientId, 120);
  const config = JSON.stringify({ intro: text(input.intro, 1500), calendarIds, images });
  await db.prepare("INSERT INTO sched_groups (id, owner_id, client_id, slug, name, active, config, created_at, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?8) ON CONFLICT(id) DO UPDATE SET slug=excluded.slug, name=excluded.name, active=excluded.active, config=excluded.config, updated_at=excluded.updated_at")
    .bind(id, ownerId, clientId, wanted, name, input.active === false ? 0 : 1, config, now).run();
  return (await getGroup(db, ownerId, id)) as BookingGroup;
}
export async function deleteGroup(db: Db, ownerId: string, id: string) {
  await ensureGroupTable(db);
  await db.prepare("DELETE FROM sched_groups WHERE owner_id=?1 AND id=?2").bind(ownerId, id).run();
}
