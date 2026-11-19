// Settings → Audit log: staff sign-ins (with time, IP, country, device) and active time (mouse / keyboard /
// touch activity reported by the open app once a minute). Calls come from the AI phone agent's call log.
type Db = D1Database;

let ready: Promise<unknown> | null = null;
export function ensureActivityTables(db: Db) {
  ready ||= db.batch([
    db.prepare("CREATE TABLE IF NOT EXISTS staff_logins (id TEXT PRIMARY KEY, email TEXT NOT NULL, at TEXT NOT NULL, ip TEXT NOT NULL DEFAULT '', country TEXT NOT NULL DEFAULT '', city TEXT NOT NULL DEFAULT '', device TEXT NOT NULL DEFAULT '', path TEXT NOT NULL DEFAULT '')"),
    db.prepare("CREATE INDEX IF NOT EXISTS staff_logins_at ON staff_logins (at)"),
    db.prepare("CREATE INDEX IF NOT EXISTS staff_logins_email ON staff_logins (email, at)"),
    db.prepare("CREATE TABLE IF NOT EXISTS staff_active (email TEXT NOT NULL, day TEXT NOT NULL, seconds INTEGER NOT NULL DEFAULT 0, first_at TEXT NOT NULL, last_at TEXT NOT NULL, pages TEXT NOT NULL DEFAULT '{}', PRIMARY KEY (email, day))"),
  ]).catch((e) => { ready = null; throw e; });
  return ready;
}

const device = (ua: string) => {
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Mac OS X/.test(ua) ? "Mac" : /Windows/.test(ua) ? "Windows" : /Linux/.test(ua) ? "Linux" : "Other";
  const br = /Edg\//.test(ua) ? "Edge" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : /Firefox\//.test(ua) ? "Firefox" : "Browser";
  return `${br} · ${os}${/Mobile/.test(ua) ? " (mobile)" : ""}`;
};

/** One sign-in per person per 30 minutes of app loads (a new session after a break counts again). */
export async function recordLogin(db: Db, email: string, request: Request) {
  if (!email) return;
  await ensureActivityTables(db);
  const now = new Date();
  const recent = await db.prepare("SELECT at FROM staff_logins WHERE email = ?1 ORDER BY at DESC LIMIT 1").bind(email.toLowerCase()).first<{ at: string }>();
  const active = await db.prepare("SELECT last_at FROM staff_active WHERE email = ?1 AND day = ?2").bind(email.toLowerCase(), now.toISOString().slice(0, 10)).first<{ last_at: string }>();
  const lastSeen = Math.max(recent ? Date.parse(recent.at) : 0, active ? Date.parse(active.last_at) : 0);
  if (now.getTime() - lastSeen < 30 * 60_000) return;
  const cf = (request as Request & { cf?: { country?: string; city?: string } }).cf || {};
  await db.prepare("INSERT INTO staff_logins (id, email, at, ip, country, city, device, path) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)")
    .bind(crypto.randomUUID(), email.toLowerCase(), now.toISOString(), request.headers.get("cf-connecting-ip") || "", String(cf.country || ""), String(cf.city || ""), device(request.headers.get("user-agent") || ""), new URL(request.url).pathname.slice(0, 120)).run();
}

/** Heartbeat from the open app: up to 60 active seconds per call, at most one counted per 50 seconds. */
export async function recordActive(db: Db, email: string, seconds: number, page: string) {
  await ensureActivityTables(db);
  const now = new Date(), day = now.toISOString().slice(0, 10), key = email.toLowerCase();
  const secs = Math.max(0, Math.min(60, Math.round(seconds)));
  const row = await db.prepare("SELECT seconds, last_at, pages FROM staff_active WHERE email = ?1 AND day = ?2").bind(key, day).first<{ seconds: number; last_at: string; pages: string }>();
  if (row && now.getTime() - Date.parse(row.last_at) < 50_000) return;
  const pages = (() => { try { return JSON.parse(row?.pages || "{}") as Record<string, number>; } catch { return {}; } })();
  const p = String(page || "Other").slice(0, 40); pages[p] = (pages[p] || 0) + secs;
  if (row) await db.prepare("UPDATE staff_active SET seconds = seconds + ?3, last_at = ?4, pages = ?5 WHERE email = ?1 AND day = ?2").bind(key, day, secs, now.toISOString(), JSON.stringify(pages)).run();
  else await db.prepare("INSERT INTO staff_active (email, day, seconds, first_at, last_at, pages) VALUES (?1,?2,?3,?4,?4,?5)").bind(key, day, secs, now.toISOString(), JSON.stringify(pages)).run();
}
