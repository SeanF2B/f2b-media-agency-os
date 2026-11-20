import { test } from "node:test";
import assert from "node:assert/strict";
import { DatabaseSync } from "node:sqlite";
import * as auth from "../lib/auth/password-auth.js";

// Minimal D1 shim over node:sqlite.
function d1() {
  const db = new DatabaseSync(":memory:");
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    first: async () => db.prepare(sql).get(...args) ?? null,
    all: async () => ({ results: db.prepare(sql).all(...args) }),
    run: async () => { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; },
  });
  return { raw: db, prepare: (sql) => stmt(sql), batch: async (list) => Promise.all(list.map((s) => s.run())) };
}
function setup() {
  const db = d1();
  db.raw.exec(`CREATE TABLE workspace_documents (id TEXT PRIMARY KEY, owner_id TEXT, data TEXT, updated_at TEXT)`);
  db.raw.exec(`CREATE TABLE client_users (email TEXT, status TEXT, client_id TEXT)`);
  db.raw.exec(`CREATE TABLE client_accounts (client_id TEXT, status TEXT)`);
  db.raw.prepare(`INSERT INTO workspace_documents VALUES ('f2b-agency', 'own1', ?, 'x')`).run(JSON.stringify({ staff: [
    { id: "own1", email: "boss@agency.test", role: "Admin" },
    { id: "s2", email: "Staff@Agency.test ", role: "Staff" },
    { id: "bot", email: "bot@agency.test", isBot: true },
  ] }));
  return db;
}
const env = (db) => ({ DB: db });
const req = (path, body, headers = {}) => new Request(`https://os.test${path}`, { method: body ? "POST" : "GET", headers: { "content-type": "application/json", origin: "https://os.test", "cf-connecting-ip": `1.1.1.${Math.floor(Math.random() * 250)}`, ...headers }, body: body ? JSON.stringify(body) : undefined });
const cookieFrom = (res) => (res.headers.getSetCookie?.() || [res.headers.get("set-cookie")]).map((c) => c.split(";")[0]).join("; ");

test("hash + verify, wrong password rejected, salt differs", async () => {
  const a = await auth.hashPassword("correct horse battery");
  const b = await auth.hashPassword("correct horse battery");
  assert.notEqual(a.pw_hash, b.pw_hash);
  assert.equal(await auth.verifyPassword("correct horse battery", a), true);
  assert.equal(await auth.verifyPassword("wrong", a), false);
  assert.equal(a.pw_iter, 100000);
});

test("public path list keeps the OS private", () => {
  for (const p of ["/login", "/set-password", "/api/auth/login", "/f2b-media-mark.png", "/f/connect/abc"]) assert.equal(auth.isPublicPath(p), true, p);
  for (const p of ["/", "/api/workspace", "/client-portal", "/api/system-emails", "/f/start", "/api/marketing-public/site"]) assert.equal(auth.isPublicPath(p), false, p);
  assert.equal(auth.safeNext("//evil.com"), "/");
  assert.equal(auth.safeNext("/login"), "/");
  assert.equal(auth.safeNext("/?client=x"), "/?client=x");
});

test("invite → set password → session → login → lockout", async () => {
  const db = setup();
  assert.equal(await auth.eligible(db, "bot@agency.test"), false);
  assert.equal(await auth.eligible(db, "nobody@agency.test"), false);
  const token = await auth.createToken(db, "staff@agency.test", "invite");
  // GET page shows the form, does not consume the token
  let res = await auth.handleAuthRoute(req(`/set-password?token=${token}`), env(db), new URL(`https://os.test/set-password?token=${token}`));
  assert.equal(res.status, 200);
  res = await auth.handleAuthRoute(req("/api/auth/set-password", { token, password: "short" }), env(db), new URL("https://os.test/api/auth/set-password"));
  assert.equal(res.status, 400);
  res = await auth.handleAuthRoute(req("/api/auth/set-password", { token, password: "a-strong-pass-123" }), env(db), new URL("https://os.test/api/auth/set-password"));
  assert.equal(res.status, 200);
  const cookie = cookieFrom(res);
  assert.match(res.headers.get("set-cookie"), /HttpOnly; Secure; SameSite=Lax/);
  assert.deepEqual(await auth.sessionIdentity(db, cookie), { email: "staff@agency.test", impersonatedBy: null });
  // token is single use
  res = await auth.handleAuthRoute(req("/api/auth/set-password", { token, password: "another-pass-456" }), env(db), new URL("https://os.test/api/auth/set-password"));
  assert.equal(res.status, 410);
  // stored hash is not the password
  const row = db.raw.prepare("SELECT * FROM auth_users").get();
  assert.ok(!JSON.stringify(row).includes("a-strong-pass-123"));
  // login
  res = await auth.handleAuthRoute(req("/api/auth/login", { email: "STAFF@agency.test", password: "a-strong-pass-123", next: "//x" }), env(db), new URL("https://os.test/api/auth/login"));
  assert.equal(res.status, 200);
  assert.equal((await res.json()).next, "/");
  // cross-site POST blocked
  res = await auth.handleAuthRoute(req("/api/auth/login", { email: "staff@agency.test", password: "x" }, { origin: "https://evil.test" }), env(db), new URL("https://os.test/api/auth/login"));
  assert.equal(res.status, 403);
  // 8 misses lock the account even with the right password
  for (let i = 0; i < 8; i++) await auth.handleAuthRoute(req("/api/auth/login", { email: "staff@agency.test", password: "nope-nope-nope" }), env(db), new URL("https://os.test/api/auth/login"));
  res = await auth.handleAuthRoute(req("/api/auth/login", { email: "staff@agency.test", password: "a-strong-pass-123" }), env(db), new URL("https://os.test/api/auth/login"));
  assert.equal(res.status, 429);
  // logout revokes the session
  res = await auth.handleAuthRoute(req("/logout", null, { cookie }), env(db), new URL("https://os.test/logout"));
  assert.equal(res.status, 303);
  assert.equal(await auth.sessionIdentity(db, cookie), null);
});

test("owner can log in as staff and come back; staff cannot", async () => {
  const db = setup();
  await auth.ensureAuthSchema(db);
  const ownerSid = await auth.createSession(db, "boss@agency.test", req("/"));
  const ownerCookie = `${auth.SESSION_COOKIE}=${ownerSid}`;
  const ownerId = await auth.sessionIdentity(db, ownerCookie);
  let res = await auth.handleAuthRoute(req("/api/auth/impersonate", { email: "staff@agency.test" }, { cookie: ownerCookie }), env(db), new URL("https://os.test/api/auth/impersonate"), ownerId);
  assert.equal(res.status, 200);
  const asStaff = cookieFrom(res);
  const staffId = await auth.sessionIdentity(db, asStaff);
  assert.deepEqual(staffId, { email: "staff@agency.test", impersonatedBy: "boss@agency.test" });
  // staff (not owner) cannot impersonate
  const plainStaff = { email: "staff@agency.test", impersonatedBy: null };
  res = await auth.handleAuthRoute(req("/api/auth/impersonate", { email: "boss@agency.test" }), env(db), new URL("https://os.test/api/auth/impersonate"), plainStaff);
  assert.equal(res.status, 403);
  // return restores the owner's own session
  res = await auth.handleAuthRoute(req("/api/auth/return", {}, { cookie: asStaff }), env(db), new URL("https://os.test/api/auth/return"), staffId);
  const back = cookieFrom(res).split("; ").find((c) => c.startsWith(`${auth.SESSION_COOKIE}=`));
  assert.equal(back, ownerCookie);
});
