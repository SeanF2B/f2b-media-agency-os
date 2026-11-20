// @ts-nocheck  (plain JS module so it runs in the worker and is unit-tested in node)
// F2B Agency OS · own email + password login (replaces the Cloudflare Access email-code screen).
//
// Security:
//  - Passwords: PBKDF2-SHA256, 100,000 iterations (the Workers maximum), 16-byte random salt per user.
//    Only the derived hash is stored; comparisons are constant-time.
//  - Sessions: 256-bit random id in an HttpOnly, Secure, SameSite=Lax cookie. Only its SHA-256 is stored,
//    so a database leak cannot be replayed as a login. 30-day expiry, revoked on sign-out / password change.
//  - Set-password / reset links: 256-bit single-use tokens (SHA-256 stored), 7 days for invites, 1 hour for resets.
//  - Brute force: per-account lockout (8 misses → 15 min) plus a per-IP limiter. Answers never reveal
//    whether an email has an account.
//  - Only current team members (owner + non-bot staff) and active client logins can sign in; removing
//    someone from Team ends their sessions within 5 minutes.

export const SESSION_COOKIE = 'f2b_session';
// F2B mark inlined so it shows on the login pages before sign-in and in every email client.
const LOGO = 'data:image/png;base64,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';
const SESSION_DAYS = 30;
const IMPERSONATE_MS = 4 * 3600e3;
export const RETURN_COOKIE = 'f2b_return';
const PBKDF2_ITER = 100000;
const INVITE_TTL = 7 * 864e5;
const RESET_TTL = 3600e3;
const MAX_FAILS = 8;
const LOCK_MS = 15 * 60e3;
const MIN_PW = 10;
const WS_ID = 'f2b-agency';

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS auth_users (email TEXT PRIMARY KEY NOT NULL, pw_hash TEXT NOT NULL, pw_salt TEXT NOT NULL, pw_iter INTEGER NOT NULL, failed_count INTEGER NOT NULL DEFAULT 0, locked_until INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_login TEXT)`,
  `CREATE TABLE IF NOT EXISTS auth_sessions (id_hash TEXT PRIMARY KEY NOT NULL, email TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, ip TEXT NOT NULL DEFAULT '', ua TEXT NOT NULL DEFAULT '', impersonated_by TEXT)`,
  `CREATE INDEX IF NOT EXISTS auth_sessions_email_idx ON auth_sessions (email)`,
  `CREATE TABLE IF NOT EXISTS auth_tokens (token_hash TEXT PRIMARY KEY NOT NULL, email TEXT NOT NULL, purpose TEXT NOT NULL, created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, used_at INTEGER)`,
  `CREATE INDEX IF NOT EXISTS auth_tokens_email_idx ON auth_tokens (email, created_at)`,
];
const schemaReady = new WeakMap();
export function ensureAuthSchema(db) {
  let p = schemaReady.get(db);
  if (!p) { p = db.batch(SCHEMA.map((s) => db.prepare(s))).catch((e) => { schemaReady.delete(db); throw e; }); schemaReady.set(db, p); }
  return p;
}

const enc = new TextEncoder();
export const normEmail = (e) => String(e || '').trim().toLowerCase();
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const b64 = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)));
const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));
const hex = (bytes) => [...new Uint8Array(bytes)].map((b) => b.toString(16).padStart(2, '0')).join('');
const randomToken = () => { const a = new Uint8Array(32); crypto.getRandomValues(a); return b64(a).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
export async function sha256(text) { return hex(await crypto.subtle.digest('SHA-256', enc.encode(text))); }
function sameBytes(a, b) { if (a.length !== b.length) return false; let d = 0; for (let i = 0; i < a.length; i++) d |= a[i] ^ b[i]; return d === 0; }

async function derive(password, salt, iterations) {
  const key = await crypto.subtle.importKey('raw', enc.encode(password), 'PBKDF2', false, ['deriveBits']);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256));
}
export async function hashPassword(password) {
  const salt = new Uint8Array(16); crypto.getRandomValues(salt);
  return { pw_hash: b64(await derive(password, salt, PBKDF2_ITER)), pw_salt: b64(salt), pw_iter: PBKDF2_ITER };
}
export async function verifyPassword(password, rec) {
  if (!rec?.pw_hash || !rec?.pw_salt) return false;
  return sameBytes(await derive(password, unb64(rec.pw_salt), Number(rec.pw_iter) || PBKDF2_ITER), unb64(rec.pw_hash));
}
export function passwordProblem(pw) {
  pw = String(pw || '');
  if (pw.length < MIN_PW) return `Use at least ${MIN_PW} characters.`;
  if (pw.length > 200) return 'That password is too long.';
  if (/^(.)\1+$/.test(pw) || /^(password|12345|qwerty)/i.test(pw)) return 'Pick something harder to guess.';
  return '';
}

/** Who may sign in: current team (owner + non-bot staff with this email) or an active client login. */
const eligibleCache = new Map();
export async function eligible(db, email, { fresh = false } = {}) {
  email = normEmail(email);
  if (!EMAIL_RE.test(email)) return false;
  const hit = eligibleCache.get(email);
  if (!fresh && hit && hit.exp > Date.now()) return hit.ok;
  let ok = false;
  const team = await db.prepare(`SELECT 1 AS ok FROM workspace_documents w, json_each(w.data,'$.staff') s WHERE w.id = ?1 AND json_extract(s.value,'$.isBot') IS NOT 1 AND lower(trim(json_extract(s.value,'$.email'))) = ?2 LIMIT 1`).bind(WS_ID, email).first().catch(() => null);
  if (team) ok = true;
  else {
    const cu = await db.prepare(`SELECT cu.status, ca.status AS client_status FROM client_users cu LEFT JOIN client_accounts ca ON ca.client_id = cu.client_id WHERE cu.email = ?1`).bind(email).first().catch(() => null);
    ok = !!cu && cu.status === 'active' && (!cu.client_status || cu.client_status !== 'archived');
  }
  eligibleCache.set(email, { ok, exp: Date.now() + 5 * 60e3 });
  if (eligibleCache.size > 1000) eligibleCache.clear();
  return ok;
}

export async function createToken(db, email, purpose) {
  await ensureAuthSchema(db);
  const token = randomToken(), now = Date.now();
  const ttl = purpose === 'reset' ? RESET_TTL : INVITE_TTL;
  // A new link replaces any older unused link of the same kind.
  await db.batch([
    db.prepare(`UPDATE auth_tokens SET used_at = ?1 WHERE email = ?2 AND purpose = ?3 AND used_at IS NULL`).bind(now, normEmail(email), purpose),
    db.prepare(`INSERT INTO auth_tokens (token_hash, email, purpose, created_at, expires_at) VALUES (?1, ?2, ?3, ?4, ?5)`).bind(await sha256(token), normEmail(email), purpose, now, now + ttl),
  ]);
  return token;
}
async function readToken(db, token) {
  if (!token || token.length < 30 || token.length > 100) return null;
  await ensureAuthSchema(db);
  const row = await db.prepare(`SELECT * FROM auth_tokens WHERE token_hash = ?1`).bind(await sha256(token)).first();
  if (!row || row.used_at || row.expires_at < Date.now()) return null;
  return row;
}

const sessionCache = new Map();
export async function createSession(db, email, request, impersonatedBy = null) {
  await ensureAuthSchema(db);
  const sid = randomToken(), now = Date.now();
  const ttl = impersonatedBy ? IMPERSONATE_MS : SESSION_DAYS * 864e5;
  await db.prepare(`INSERT INTO auth_sessions (id_hash, email, created_at, expires_at, ip, ua, impersonated_by) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)`)
    .bind(await sha256(sid), normEmail(email), now, now + ttl, request.headers.get('cf-connecting-ip') || '', (request.headers.get('user-agent') || '').slice(0, 200), impersonatedBy).run();
  return sid;
}
export function readCookie(header, name) {
  for (const part of String(header || '').split(';')) { const i = part.indexOf('='); if (i > 0 && part.slice(0, i).trim() === name) return part.slice(i + 1).trim(); }
  return '';
}
/** { email, impersonatedBy } for a valid session cookie, or null. Cached per isolate for 60 s to keep D1 reads low. */
export async function sessionIdentity(db, cookieHeader) {
  const sid = readCookie(cookieHeader, SESSION_COOKIE);
  if (!sid || sid.length < 30 || sid.length > 100) return null;
  const idHash = await sha256(sid), now = Date.now();
  const hit = sessionCache.get(idHash);
  let found = null;
  if (hit && hit.check > now) found = hit.found;
  else {
    const row = await db.prepare(`SELECT email, expires_at, impersonated_by FROM auth_sessions WHERE id_hash = ?1`).bind(idHash).first().catch(() => null);
    found = row ? { email: row.email, impersonatedBy: row.impersonated_by || null, expiresAt: row.expires_at } : null;
    sessionCache.set(idHash, { found, check: now + 60e3 });
    if (sessionCache.size > 2000) sessionCache.clear();
  }
  if (!found || found.expiresAt <= now) return null;
  return (await eligible(db, found.email)) ? { email: found.email, impersonatedBy: found.impersonatedBy } : null;
}

/** The workspace owner (the staff profile whose id is the workspace owner id) may sign in as anyone. */
export async function isWorkspaceOwnerEmail(db, email) {
  email = normEmail(email);
  if (!email) return false;
  const row = await db.prepare(`SELECT 1 AS ok FROM workspace_documents w, json_each(w.data,'$.staff') s WHERE w.id = ?1 AND json_extract(s.value,'$.id') = w.owner_id AND lower(trim(json_extract(s.value,'$.email'))) = ?2 LIMIT 1`).bind(WS_ID, email).first().catch(() => null);
  return !!row;
}
function sessionCookie(sid, maxAge) {
  return `${SESSION_COOKIE}=${sid}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}`;
}

// ── rate limiting (per isolate; account lockout below is the durable control) ──
const ipHits = new Map();
function ipLimited(request, bucket, max, windowMs) {
  const key = `${bucket}:${request.headers.get('cf-connecting-ip') || 'x'}`, now = Date.now();
  const list = (ipHits.get(key) || []).filter((t) => t > now - windowMs);
  list.push(now); ipHits.set(key, list);
  if (ipHits.size > 5000) ipHits.clear();
  return list.length > max;
}

// ── email ──
export async function sendAuthEmail(env, { to, subject, heading, intro, buttonLabel, link, appUrl }) {
  if (!env.RESEND_API_KEY || !env.TASK_NOTIFICATION_FROM) throw new Error('Email sending is not configured.');
  const esc = (v) => String(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const html = authEmailHtml({ heading, intro, buttonLabel, link, appUrl, esc });
  const text = `${intro}\n\n${buttonLabel}: ${link}\n\nWorkspace: ${appUrl}\nOn your phone: open the workspace link, then Share → Add to Home Screen (iPhone) or ⋮ → Install app (Android).`;
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: env.TASK_NOTIFICATION_FROM, to: [to], subject, text, html }),
    signal: AbortSignal.timeout(15000),
  });
  const out = await res.json().catch(() => null);
  if (!res.ok || !out?.id) throw new Error(`Email service returned HTTP ${res.status}: ${out?.message || 'not accepted'}`);
  return { id: out.id, html, text };
}
export function authEmailHtml({ heading, intro, buttonLabel, link, appUrl, esc }) {
  const logo = `${new URL(appUrl).origin}/f2b-media-mark.png`;
  return `<div style="margin:0;background:#eef2f6;padding:32px 12px;font-family:Arial,Helvetica,sans-serif;color:#222124"><table role="presentation" align="center" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;margin:0 auto;background:#fff;border:1px solid #d9dfe5;border-radius:14px;overflow:hidden"><tr><td style="padding:18px 24px;background:#222124"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td style="padding-right:13px"><img src="${esc(logo)}" width="50" height="50" alt="F2B Media" style="display:block;width:50px;height:50px;border:0;background:#fff;border-radius:9px" /></td><td><div style="font-size:20px;font-weight:700;color:#fff">F2B Media</div><div style="margin-top:4px;font-size:11px;letter-spacing:1.4px;font-weight:700;color:#b7dafa">TEAM WORKSPACE</div></td></tr></table></td></tr><tr><td height="5" style="height:5px;background:#287cac;font-size:1px;line-height:1px">&nbsp;</td></tr><tr><td style="padding:30px 32px 6px"><h1 style="margin:0 0 14px;font-size:25px;line-height:1.25;color:#222124">${esc(heading)}</h1><div style="color:#303942;font-size:15px;line-height:1.7">${esc(intro).replace(/\n/g, '<br>')}</div></td></tr><tr><td align="center" style="padding:22px 24px 10px"><table role="presentation" cellpadding="0" cellspacing="0"><tr><td align="center" bgcolor="#287cac" style="border-radius:8px"><a href="${esc(link)}" target="_blank" style="display:inline-block;padding:15px 34px;border-radius:8px;background:#287cac;color:#fff;text-decoration:none;font-size:16px;font-weight:700">${esc(buttonLabel)}&nbsp; →</a></td></tr></table></td></tr><tr><td style="padding:14px 32px 8px"><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f3f7fb;border-radius:10px"><tr><td style="padding:16px 18px;font-size:13px;line-height:1.65;color:#303942"><b>Your workspace:</b> <a href="${esc(appUrl)}" style="color:#24628b">${esc(appUrl)}</a><br><b>Get the app on your phone:</b> open the workspace link on your phone, sign in, then tap <b>Share → Add to Home Screen</b> on iPhone or <b>⋮ → Install app</b> on Android.</td></tr></table></td></tr><tr><td align="center" style="padding:10px 28px 24px;color:#68737d;font-size:12px;line-height:1.6">If the button doesn’t work, copy this link into your browser:<br><a href="${esc(link)}" style="color:#24628b;word-break:break-all">${esc(link)}</a></td></tr><tr><td align="center" style="padding:15px 20px;border-top:1px solid #e5e9ed;background:#f8fafc;color:#77818a;font-size:11px">F2B Media · Private team workspace · Never share this link</td></tr></table></div>`;
}

// ── public paths: reachable without signing in ──
const PUBLIC_EXACT = new Set(['/login', '/logout', '/set-password', '/forgot-password', '/api/marketing-public/media', '/manifest-v5.webmanifest', '/sw.js', '/favicon.ico', '/favicon.svg', '/robots.txt']);
export function isPublicPath(path) {
  if (PUBLIC_EXACT.has(path)) return true;
  if (path.startsWith('/api/auth/')) return true;
  if (path.startsWith('/f/connect/')) return true;
  // Static brand images and icons (no data).
  if (/^\/[\w.-]+\.(png|svg|ico|webp|jpg)$/.test(path)) return true;
  return false;
}
export function safeNext(value) {
  const v = String(value || '/');
  if (!v.startsWith('/') || v.startsWith('//') || v.startsWith('/\\')) return '/';
  if (/^\/(login|logout|set-password|forgot-password|api\/auth)/.test(v)) return '/';
  return v.slice(0, 500);
}

const json = (b, status = 200, extra = {}) => new Response(JSON.stringify(b), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store', ...extra } });
const page = (h, status = 200, extra = {}) => new Response(h, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'DENY', 'referrer-policy': 'no-referrer', 'content-security-policy': "default-src 'self'; style-src 'self' 'unsafe-inline'; script-src 'self' 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'; form-action 'self'; base-uri 'none'", ...extra } });

async function readBody(request) {
  if (!/json/i.test(request.headers.get('content-type') || '')) return null;
  const text = await request.text();
  if (text.length > 4000) return null;
  try { return JSON.parse(text); } catch { return null; }
}
function sameOrigin(request) {
  const origin = request.headers.get('origin');
  return !origin || origin === new URL(request.url).origin;
}

/** Handles the login routes. Returns a Response, or null when the path is not an auth route. */
export async function handleAuthRoute(request, env, url, identity = null) {
  const path = url.pathname.replace(/\/+$/, '') || '/';
  const db = env.DB;
  if (!db) return null;
  const method = request.method;

  if (path === '/login' && method === 'GET') return page(loginPage({ next: safeNext(url.searchParams.get('next')), reset: url.searchParams.get('done') === '1' }));
  if (path === '/forgot-password' && method === 'GET') return page(forgotPage());
  if (path === '/set-password' && method === 'GET') {
    const row = await readToken(db, url.searchParams.get('token') || '').catch(() => null);
    return page(setPasswordPage({ valid: !!row, email: row?.email || '', purpose: row?.purpose || 'invite' }), row ? 200 : 410);
  }
  if (path === '/logout') {
    const sid = readCookie(request.headers.get('cookie'), SESSION_COOKIE);
    if (sid) { const h = await sha256(sid); sessionCache.delete(h); await db.prepare(`DELETE FROM auth_sessions WHERE id_hash = ?1`).bind(h).run().catch(() => undefined); }
    const headers = new Headers({ location: '/login', 'cache-control': 'no-store', 'clear-site-data': '"cache"' });
    headers.append('set-cookie', sessionCookie('', 0));
    headers.append('set-cookie', `${RETURN_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
    return new Response(null, { status: 303, headers });
  }
  if (!path.startsWith('/api/auth/')) return null;
  if (path === '/api/auth/me' && method === 'GET') return json({ email: identity?.email || null, impersonatedBy: identity?.impersonatedBy || null, owner: identity?.email ? await isWorkspaceOwnerEmail(db, identity.impersonatedBy || identity.email) : false, passwordLogin: !!identity?.viaSession });
  if (method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  if (!sameOrigin(request)) return json({ error: 'Request blocked.' }, 403);
  await ensureAuthSchema(db);
  const body = await readBody(request);
  if (!body) return json({ error: 'Send a valid request.' }, 400);

  if (path === '/api/auth/login') {
    if (ipLimited(request, 'login', 30, 15 * 60e3)) return json({ error: 'Too many attempts. Wait a few minutes and try again.' }, 429);
    const email = normEmail(body.email), password = String(body.password || '');
    const fail = () => json({ error: 'That email and password don’t match. Try again or reset your password.' }, 401);
    if (!EMAIL_RE.test(email) || !password || password.length > 200) return fail();
    const rec = await db.prepare(`SELECT * FROM auth_users WHERE email = ?1`).bind(email).first();
    if (!rec) { await derive(password, new Uint8Array(16), 1000); return fail(); }
    if (rec.locked_until > Date.now()) return json({ error: 'Too many wrong passwords. This account is locked for 15 minutes, or reset your password.' }, 429);
    const ok = await verifyPassword(password, rec);
    if (!ok) {
      const fails = Number(rec.failed_count || 0) + 1;
      await db.prepare(`UPDATE auth_users SET failed_count = ?1, locked_until = ?2 WHERE email = ?3`).bind(fails >= MAX_FAILS ? 0 : fails, fails >= MAX_FAILS ? Date.now() + LOCK_MS : 0, email).run();
      return fail();
    }
    if (!(await eligible(db, email, { fresh: true }))) return json({ error: 'This login has been switched off. Contact F2B Media.' }, 403);
    await db.prepare(`UPDATE auth_users SET failed_count = 0, locked_until = 0, last_login = ?1 WHERE email = ?2`).bind(new Date().toISOString(), email).run();
    const sid = await createSession(db, email, request);
    return json({ ok: true, next: safeNext(body.next) }, 200, { 'set-cookie': sessionCookie(sid, SESSION_DAYS * 86400) });
  }

  if (path === '/api/auth/forgot') {
    if (ipLimited(request, 'forgot', 8, 60 * 60e3)) return json({ error: 'Too many requests. Try again later.' }, 429);
    const email = normEmail(body.email);
    const generic = json({ ok: true, message: 'If that email has a login, a reset link is on its way. Check your inbox (and spam).' });
    if (!EMAIL_RE.test(email) || !(await eligible(db, email, { fresh: true }))) return generic;
    const recent = await db.prepare(`SELECT COUNT(*) AS n FROM auth_tokens WHERE email = ?1 AND purpose = 'reset' AND created_at > ?2`).bind(email, Date.now() - 3600e3).first();
    if (Number(recent?.n || 0) >= 3) return generic;
    try {
      const token = await createToken(db, email, 'reset');
      const origin = url.origin;
      const sent = await sendAuthEmail(env, { to: email, subject: 'Reset your F2B Media password', heading: 'Reset your password', intro: 'Someone asked to reset the password for your F2B Media workspace login. If that was you, set a new password below. The link works once and expires in 1 hour.\n\nIf it wasn’t you, ignore this email: your password stays the same.', buttonLabel: 'Set a new password', link: `${origin}/set-password?token=${token}`, appUrl: `${origin}/` });
      await logEmail(db, email, 'Reset your F2B Media password', sent);
    } catch (e) { console.error('reset email', e); }
    return generic;
  }

  if (path === '/api/auth/impersonate') {
    // Owner only: open the workspace exactly as another user. 4-hour session, logged, one click back.
    const actor = normEmail(identity?.impersonatedBy || identity?.email);
    if (!actor || !(await isWorkspaceOwnerEmail(db, actor))) return json({ error: 'Only the workspace owner can sign in as another user.' }, 403);
    const target = normEmail(body.email);
    if (!target || target === actor) return json({ error: 'Choose someone else to sign in as.' }, 400);
    if (!(await eligible(db, target, { fresh: true }))) return json({ error: 'That person doesn’t have an active login.' }, 404);
    const cookies = request.headers.get('cookie');
    const current = readCookie(cookies, SESSION_COOKIE);
    // Keep the owner's own session to come back to (if already impersonating, keep the original one).
    const keep = identity?.impersonatedBy ? readCookie(cookies, RETURN_COOKIE) : current;
    if (identity?.impersonatedBy && current) { const h = await sha256(current); sessionCache.delete(h); await db.prepare(`DELETE FROM auth_sessions WHERE id_hash = ?1`).bind(h).run(); }
    const sid = await createSession(db, target, request, actor);
    try { const { logAction } = await import('../action-log'); await logAction(db, { actor, method: 'POST', path: '/api/auth/impersonate', status: 200, clientId: '', body: { signedInAs: target }, ip: request.headers.get('cf-connecting-ip') || '' }); } catch { /* best-effort */ }
    const headers = new Headers({ 'content-type': 'application/json', 'cache-control': 'no-store' });
    headers.append('set-cookie', sessionCookie(sid, IMPERSONATE_MS / 1000));
    headers.append('set-cookie', keep ? `${RETURN_COOKIE}=${keep}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${SESSION_DAYS * 86400}` : `${RETURN_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
    return new Response(JSON.stringify({ ok: true, email: target }), { status: 200, headers });
  }

  if (path === '/api/auth/return') {
    const cookies = request.headers.get('cookie');
    const current = readCookie(cookies, SESSION_COOKIE), back = readCookie(cookies, RETURN_COOKIE);
    if (identity?.impersonatedBy && current) { const h = await sha256(current); sessionCache.delete(h); await db.prepare(`DELETE FROM auth_sessions WHERE id_hash = ?1`).bind(h).run(); }
    const headers = new Headers({ 'content-type': 'application/json', 'cache-control': 'no-store' });
    headers.append('set-cookie', back ? sessionCookie(back, SESSION_DAYS * 86400) : sessionCookie('', 0));
    headers.append('set-cookie', `${RETURN_COOKIE}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`);
    return new Response(JSON.stringify({ ok: true }), { status: 200, headers });
  }

  if (path === '/api/auth/set-password') {
    if (ipLimited(request, 'setpw', 20, 15 * 60e3)) return json({ error: 'Too many attempts. Wait a few minutes.' }, 429);
    const row = await readToken(db, String(body.token || ''));
    if (!row) return json({ error: 'This link has expired or was already used. Ask for a new one.' }, 410);
    const problem = passwordProblem(body.password);
    if (problem) return json({ error: problem }, 400);
    if (!(await eligible(db, row.email, { fresh: true }))) return json({ error: 'This login has been switched off. Contact F2B Media.' }, 403);
    const h = await hashPassword(String(body.password));
    const nowIso = new Date().toISOString(), now = Date.now();
    const claim = await db.prepare(`UPDATE auth_tokens SET used_at = ?1 WHERE token_hash = ?2 AND used_at IS NULL`).bind(now, row.token_hash).run();
    if (!claim.meta?.changes) return json({ error: 'This link was already used. Ask for a new one.' }, 410);
    await db.batch([
      db.prepare(`INSERT INTO auth_users (email, pw_hash, pw_salt, pw_iter, failed_count, locked_until, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, 0, 0, ?5, ?5) ON CONFLICT(email) DO UPDATE SET pw_hash = excluded.pw_hash, pw_salt = excluded.pw_salt, pw_iter = excluded.pw_iter, failed_count = 0, locked_until = 0, updated_at = excluded.updated_at`).bind(row.email, h.pw_hash, h.pw_salt, h.pw_iter, nowIso),
      // New password signs out every other device.
      db.prepare(`DELETE FROM auth_sessions WHERE email = ?1`).bind(row.email),
    ]);
    sessionCache.clear();
    const sid = await createSession(db, row.email, request);
    return json({ ok: true, next: '/' }, 200, { 'set-cookie': sessionCookie(sid, SESSION_DAYS * 86400) });
  }
  return json({ error: 'Not found.' }, 404);
}

async function logEmail(db, to, subject, sent) {
  try { const { logSystemEmail } = await import('../email-log'); await logSystemEmail(db, { to, subject, text: sent.text, html: sent.html }); } catch { /* logging is best-effort */ }
}

// ── pages ──
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
function shell(title, inner, script) {
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1"><meta name="robots" content="noindex"><meta name="theme-color" content="#0f1720"><link rel="manifest" href="/manifest-v5.webmanifest"><link rel="apple-touch-icon" href="/apple-touch-icon.png"><link rel="icon" href="/favicon.svg"><title>${esc(title)} · F2B Media</title><style>
*{box-sizing:border-box}html,body{margin:0;min-height:100%}body{font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,Arial,sans-serif;color:#eef3f8;background:#0b1118;background-image:radial-gradient(900px 500px at 15% -10%,rgba(40,124,172,.35),transparent 60%),radial-gradient(700px 500px at 110% 110%,rgba(40,124,172,.22),transparent 60%);display:flex;align-items:center;justify-content:center;min-height:100vh;padding:24px}
.card{width:100%;max-width:410px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.12);border-radius:20px;padding:34px 30px;box-shadow:0 30px 80px rgba(0,0,0,.45);backdrop-filter:blur(18px);-webkit-backdrop-filter:blur(18px)}
.brand{display:flex;align-items:center;gap:12px;margin-bottom:26px}.brand img{width:44px;height:44px;border-radius:11px;background:#fff;object-fit:contain;padding:4px}.brand b{font-size:18px;display:block}.brand small{font-size:11px;letter-spacing:1.4px;color:#9fcdf2;font-weight:700}
h1{font-size:24px;margin:0 0 6px}p.sub{margin:0 0 22px;color:#a9b6c3;font-size:14px;line-height:1.55}
label{display:block;font-size:13px;font-weight:600;color:#c9d4de;margin:14px 0 6px}input{width:100%;font-size:16px;padding:13px 14px;border-radius:11px;border:1px solid rgba(255,255,255,.16);background:rgba(0,0,0,.28);color:#fff;outline:none;transition:border-color .15s,box-shadow .15s}input:focus,input:hover{border-color:#3d9ad0;box-shadow:0 0 0 3px rgba(61,154,208,.22)}
.pw{position:relative}.pw button{position:absolute;right:8px;top:50%;transform:translateY(-50%);background:none;border:0;color:#9fb0c0;font-size:12px;font-weight:700;cursor:pointer;padding:6px}
.btn{margin-top:22px;width:100%;padding:14px;border:0;border-radius:11px;background:#287cac;color:#fff;font-size:16px;font-weight:700;cursor:pointer;transition:transform .15s,background .15s}.btn:hover{background:#3189bb;transform:translateY(-1px)}.btn:disabled{opacity:.6;cursor:wait;transform:none}
.msg{margin-top:14px;font-size:14px;line-height:1.5;min-height:1px}.err{color:#ff9b9b}.ok{color:#8fe3b0}.links{margin-top:20px;display:flex;justify-content:space-between;font-size:13px}.links a,a{color:#8cc8f0;text-decoration:none}a:hover{text-decoration:underline}
.tip{margin-top:22px;padding:13px 14px;border-radius:11px;background:rgba(40,124,172,.14);border:1px solid rgba(61,154,208,.25);font-size:12.5px;line-height:1.55;color:#c4d6e4}
</style></head><body><main class="card"><div class="brand"><img src="${LOGO}" alt="F2B Media"><div><b>F2B Media</b><small>TEAM WORKSPACE</small></div></div>${inner}</main><script>${script}</script></body></html>`;
}
const post = `async function post(u,b){const r=await fetch(u,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(b),credentials:'same-origin'});let j={};try{j=await r.json()}catch(e){}if(!r.ok)throw new Error(j.error||'Something went wrong. Try again.');return j}
document.querySelectorAll('.pw button').forEach(b=>b.onclick=()=>{const i=b.previousElementSibling;i.type=i.type==='password'?'text':'password';b.textContent=i.type==='password'?'Show':'Hide'});`;

export function loginPage({ next, reset }) {
  return shell('Sign in', `<h1>Sign in</h1><p class="sub">Welcome back. Use the email your invite was sent to.</p>
<form id="f" novalidate><label for="e">Email</label><input id="e" type="email" autocomplete="username" required autofocus>
<label for="p">Password</label><div class="pw"><input id="p" type="password" autocomplete="current-password" required><button type="button">Show</button></div>
<button class="btn" id="b">Sign in</button><div class="msg ${reset ? 'ok' : ''}" id="m" role="status">${reset ? 'Password saved. Sign in with your new password.' : ''}</div></form>
<div class="links"><a href="/forgot-password">Forgot password?</a><span style="color:#7d8b98">New? Use your invite link.</span></div>`,
  `${post}const next=${JSON.stringify(next)};document.getElementById('f').onsubmit=async(ev)=>{ev.preventDefault();const b=document.getElementById('b'),m=document.getElementById('m');m.className='msg';m.textContent='';b.disabled=true;b.textContent='Signing in…';try{const j=await post('/api/auth/login',{email:document.getElementById('e').value,password:document.getElementById('p').value,next});location.replace(j.next||'/')}catch(e){m.className='msg err';m.textContent=e.message;b.disabled=false;b.textContent='Sign in'}}`);
}
export function forgotPage() {
  return shell('Reset password', `<h1>Reset your password</h1><p class="sub">Enter your login email and we’ll send you a link to set a new password.</p>
<form id="f" novalidate><label for="e">Email</label><input id="e" type="email" autocomplete="username" required autofocus>
<button class="btn" id="b">Send reset link</button><div class="msg" id="m" role="status"></div></form><div class="links"><a href="/login">← Back to sign in</a></div>`,
  `${post}document.getElementById('f').onsubmit=async(ev)=>{ev.preventDefault();const b=document.getElementById('b'),m=document.getElementById('m');b.disabled=true;try{const j=await post('/api/auth/forgot',{email:document.getElementById('e').value});m.className='msg ok';m.textContent=j.message}catch(e){m.className='msg err';m.textContent=e.message}b.disabled=false}`);
}
export function setPasswordPage({ valid, email, purpose }) {
  if (!valid) return shell('Link expired', `<h1>This link has expired</h1><p class="sub">Set-password links work once and expire. Ask whoever invited you to send a new invite, or request a reset link.</p><a class="btn" style="display:block;text-align:center;text-decoration:none" href="/forgot-password">Send me a new link</a><div class="links"><a href="/login">← Back to sign in</a></div>`, '');
  const welcome = purpose === 'invite';
  return shell(welcome ? 'Create your password' : 'New password', `<h1>${welcome ? 'Create your password' : 'Choose a new password'}</h1><p class="sub">${welcome ? 'Welcome to F2B Media. ' : ''}Signing in as <b style="color:#fff">${esc(email)}</b>.</p>
<form id="f" novalidate><input type="email" autocomplete="username" value="${esc(email)}" hidden readonly>
<label for="p">New password</label><div class="pw"><input id="p" type="password" autocomplete="new-password" minlength="${MIN_PW}" required autofocus><button type="button">Show</button></div>
<label for="c">Confirm password</label><div class="pw"><input id="c" type="password" autocomplete="new-password" required><button type="button">Show</button></div>
<button class="btn" id="b">${welcome ? 'Create password & sign in' : 'Save & sign in'}</button><div class="msg" id="m" role="status">At least ${MIN_PW} characters.</div></form>
<div class="tip"><b>Use it like an app:</b> after signing in on your phone, tap <b>Share → Add to Home Screen</b> (iPhone) or <b>⋮ → Install app</b> (Android).</div>`,
  `${post}const token=new URLSearchParams(location.search).get('token');history.replaceState(null,'','/set-password');document.getElementById('f').onsubmit=async(ev)=>{ev.preventDefault();const b=document.getElementById('b'),m=document.getElementById('m'),p=document.getElementById('p').value;if(p!==document.getElementById('c').value){m.className='msg err';m.textContent='The two passwords don’t match.';return}b.disabled=true;try{const j=await post('/api/auth/set-password',{token,password:p});location.replace(j.next||'/')}catch(e){m.className='msg err';m.textContent=e.message;b.disabled=false}}`);
}
