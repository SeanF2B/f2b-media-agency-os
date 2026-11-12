// @ts-nocheck  (plain JS module, shared with the companion worker and tested in node; kept as-is)
// F2B Agency OS · client logins (client user role) — shared by the app drop-in, the gate and the companion.
// A client user signs in with the existing Cloudflare Access email one-time code. Their Access email is mapped to
// client_users here. They only ever reach their own client's Website & SEO editor; every other route is 403 (see client-portal-gate.js).
import { WS_ID } from './client-accounts-core';

export class ClientUserError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
export const SCOPES = { website_seo: 'Website & SEO' };
export const CLIENT_USERS_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS client_users (id TEXT PRIMARY KEY NOT NULL, email TEXT NOT NULL UNIQUE, client_id TEXT NOT NULL, scope TEXT NOT NULL DEFAULT 'website_seo', status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','paused','archived')), created_by TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, last_seen TEXT)`,
  `CREATE INDEX IF NOT EXISTS client_users_client_idx ON client_users (client_id)`,
  `CREATE TABLE IF NOT EXISTS client_user_events (id TEXT PRIMARY KEY NOT NULL, client_id TEXT NOT NULL, email TEXT NOT NULL, action TEXT NOT NULL, detail TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS client_user_events_client_idx ON client_user_events (client_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS client_edit_approvals (id TEXT PRIMARY KEY NOT NULL, client_id TEXT NOT NULL, version INTEGER NOT NULL, path TEXT NOT NULL, message TEXT NOT NULL, actor TEXT NOT NULL, before_text TEXT NOT NULL, after_text TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','undone')), decided_by TEXT, decided_at TEXT, note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL)`,
  `CREATE INDEX IF NOT EXISTS client_edit_approvals_idx ON client_edit_approvals (client_id, status, created_at DESC)`,
];
const nowIso = () => new Date().toISOString();
const uid = () => crypto.randomUUID();
const noTable = e => /no such table/i.test(String(e?.message || e));
export const normEmail = e => String(e || '').trim().toLowerCase();
const EMAIL_RE = /^[a-z0-9._%+'-]+@[a-z0-9-]+(\.[a-z0-9-]+)*\.[a-z]{2,}$/;

/** Emails of the agency team (owner + non-bot staff). Team always wins over a client login. */
export async function teamIdentity(db) {
  const row = await db.prepare(`SELECT owner_id AS ownerId, (SELECT json_group_array(lower(json_extract(value,'$.email'))) FROM json_each(data,'$.staff') WHERE json_extract(value,'$.isBot') IS NOT 1 AND json_extract(value,'$.email') IS NOT NULL) AS emails FROM workspace_documents WHERE id = ?1`).bind(WS_ID).first();
  return { ownerId: String(row?.ownerId || ''), emails: new Set(JSON.parse(row?.emails || '[]').filter(Boolean)) };
}
export async function isTeam(db, user) {
  const t = await teamIdentity(db);
  return t.ownerId === user.userId || t.emails.has(normEmail(user.email));
}

/** The client login for this Access email (any status), joined with its client. null when none / table missing. */
export async function findClientLogin(db, email) {
  try {
    return await db.prepare(`SELECT cu.*, (SELECT json_extract(c.value,'$.name') FROM workspace_documents w, json_each(w.data,'$.clients') c WHERE w.id = ?2 AND json_extract(c.value,'$.id') = cu.client_id) AS client_name, (SELECT json_extract(c.value,'$.logo') FROM workspace_documents w, json_each(w.data,'$.clients') c WHERE w.id = ?2 AND json_extract(c.value,'$.id') = cu.client_id) AS client_logo, ca.status AS client_status, ca.preview_url AS preview_url, ca.live_url AS live_url, ca.website_status AS website_status
      FROM client_users cu LEFT JOIN client_accounts ca ON ca.client_id = cu.client_id WHERE cu.email = ?1`).bind(normEmail(email), WS_ID).first();
  } catch (e) { if (noTable(e)) return null; throw e; }
}
export const loginUsable = cu => !!cu && cu.status === 'active' && cu.client_status && cu.client_status !== 'archived';

export async function logClientEvent(db, clientId, email, action, detail = '') {
  try { await db.prepare(`INSERT INTO client_user_events (id, client_id, email, action, detail, created_at) VALUES (?1,?2,?3,?4,?5,?6)`).bind(uid(), clientId, normEmail(email), String(action).slice(0, 40), String(detail).slice(0, 500), nowIso()).run(); }
  catch (e) { if (!noTable(e)) throw e; }
}
/** Updates last_seen at most every 5 minutes; logs a "sign-in" event when the previous visit was over 8 hours ago. */
export async function touchClientLogin(db, cu) {
  const last = cu.last_seen ? Date.parse(cu.last_seen) : 0;
  if (Date.now() - last < 5 * 60e3) return;
  await db.prepare(`UPDATE client_users SET last_seen = ?1 WHERE id = ?2`).bind(nowIso(), cu.id).run();
  if (Date.now() - last > 8 * 3600e3) await logClientEvent(db, cu.client_id, cu.email, 'sign-in', '');
}

// ---------- admin management (Clients → client → Settings → Client logins) ----------
const pub = r => ({ id: r.id, email: r.email, clientId: r.client_id, scope: r.scope, scopeLabel: SCOPES[r.scope] || r.scope, status: r.status, createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at, lastSeen: r.last_seen || null });
export async function listClientUsers(db, clientId) {
  try {
    const users = (await db.prepare(`SELECT * FROM client_users WHERE client_id = ?1 ORDER BY created_at`).bind(clientId).all()).results || [];
    const events = (await db.prepare(`SELECT email, action, detail, created_at FROM client_user_events WHERE client_id = ?1 ORDER BY created_at DESC LIMIT 15`).bind(clientId).all()).results || [];
    return { users: users.map(pub), events, scopes: Object.entries(SCOPES).map(([value, label]) => ({ value, label })), ready: true };
  } catch (e) { if (noTable(e)) return { users: [], events: [], scopes: [], ready: false }; throw e; }
}
export async function addClientUser(db, clientId, input, actor) {
  const email = normEmail(input?.email), scope = String(input?.scope || 'website_seo');
  if (!EMAIL_RE.test(email) || email.length > 254) throw new ClientUserError(400, 'Enter a valid email address.');
  if (!SCOPES[scope]) throw new ClientUserError(400, 'Choose what this login can do.');
  const acc = await db.prepare(`SELECT status FROM client_accounts WHERE client_id = ?1`).bind(clientId).first();
  if (!acc) throw new ClientUserError(404, 'Client not found.');
  if (acc.status === 'archived') throw new ClientUserError(409, 'This client is archived. Restore it before adding logins.');
  if ((await teamIdentity(db)).emails.has(email)) throw new ClientUserError(409, 'That email belongs to someone on the F2B team. Team members keep their normal access.');
  const prev = await db.prepare(`SELECT client_id FROM client_users WHERE email = ?1`).bind(email).first();
  if (prev) throw new ClientUserError(409, prev.client_id === clientId ? 'That email already has a login for this client.' : 'That email already has a login for another client. One email = one client.');
  const at = nowIso(), id = uid();
  await db.prepare(`INSERT INTO client_users (id, email, client_id, scope, status, created_by, created_at, updated_at) VALUES (?1,?2,?3,?4,'active',?5,?6,?6)`).bind(id, email, clientId, scope, String(actor || '').slice(0, 254), at).run();
  await logClientEvent(db, clientId, email, 'login-added', `by ${actor}`);
  return { user: pub(await db.prepare(`SELECT * FROM client_users WHERE id = ?1`).bind(id).first()) };
}
export async function setClientUserStatus(db, clientId, id, status, actor) {
  if (!['active', 'paused'].includes(status)) throw new ClientUserError(400, 'Unknown status.');
  const cu = await db.prepare(`SELECT * FROM client_users WHERE id = ?1 AND client_id = ?2`).bind(String(id), clientId).first();
  if (!cu) throw new ClientUserError(404, 'Login not found.');
  if (cu.status === 'archived') throw new ClientUserError(409, 'This login is off because the client is archived. Restore the client to turn it back on.');
  await db.prepare(`UPDATE client_users SET status = ?1, updated_at = ?2 WHERE id = ?3`).bind(status, nowIso(), cu.id).run();
  await logClientEvent(db, clientId, cu.email, status === 'paused' ? 'login-paused' : 'login-resumed', `by ${actor}`);
  return { user: pub({ ...cu, status }) };
}
export async function removeClientUser(db, clientId, id, actor) {
  const cu = await db.prepare(`SELECT * FROM client_users WHERE id = ?1 AND client_id = ?2`).bind(String(id), clientId).first();
  if (!cu) throw new ClientUserError(404, 'Login not found.');
  await db.prepare(`DELETE FROM client_users WHERE id = ?1`).bind(cu.id).run();
  await logClientEvent(db, clientId, cu.email, 'login-removed', `by ${actor}`);
  return { removed: cu.email };
}
/** Archive turns every login for the client off (status 'archived'); restore turns exactly those back on. */
export async function archiveClientLogins(db, clientId, on) {
  try {
    const r = await db.prepare(on ? `UPDATE client_users SET status = 'archived', updated_at = ?1 WHERE client_id = ?2 AND status = 'active'` : `UPDATE client_users SET status = 'active', updated_at = ?1 WHERE client_id = ?2 AND status = 'archived'`).bind(nowIso(), clientId).run();
    return r?.meta?.changes || 0;
  } catch (e) { if (noTable(e)) return 0; throw e; }
}

// ---------- client edit approvals ----------
export function lineDiff(a, b, context = 2) {
  const A = String(a).split('\n'), B = String(b).split('\n');
  let s = 0; while (s < A.length && s < B.length && A[s] === B[s]) s++;
  let ea = A.length - 1, eb = B.length - 1; while (ea >= s && eb >= s && A[ea] === B[eb]) { ea--; eb--; }
  const a2 = A.slice(s, ea + 1), b2 = B.slice(s, eb + 1);
  let ops;
  if (a2.length * b2.length > 4e6) ops = [...a2.map(l => ['-', l]), ...b2.map(l => ['+', l])];
  else {
    const n = a2.length, m = b2.length, L = Array.from({ length: n + 1 }, () => new Uint32Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) L[i][j] = a2[i] === b2[j] ? L[i + 1][j + 1] + 1 : Math.max(L[i + 1][j], L[i][j + 1]);
    ops = []; let i = 0, j = 0;
    while (i < n && j < m) { if (a2[i] === b2[j]) { ops.push([' ', a2[i]]); i++; j++; } else if (L[i + 1][j] >= L[i][j + 1]) ops.push(['-', a2[i++]]); else ops.push(['+', b2[j++]]); }
    while (i < n) ops.push(['-', a2[i++]]); while (j < m) ops.push(['+', b2[j++]]);
  }
  const pre = A.slice(Math.max(0, s - context), s).map(l => [' ', l]), post = A.slice(ea + 1, ea + 1 + context).map(l => [' ', l]);
  return { startLine: Math.max(0, s - context) + 1, lines: [...pre, ...ops, ...post].slice(0, 400) };
}
export async function createApproval(db, { clientId, version, path, message, actor, beforeText, afterText }) {
  const id = uid();
  await db.prepare(`INSERT INTO client_edit_approvals (id, client_id, version, path, message, actor, before_text, after_text, status, created_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,'pending',?9)`)
    .bind(id, clientId, version, path, String(message).slice(0, 200), normEmail(actor), beforeText, afterText, nowIso()).run();
  return id;
}
export async function listApprovals(db, clientId, { status = 'pending', limit = 50 } = {}) {
  try {
    const rows = (await db.prepare(`SELECT * FROM client_edit_approvals WHERE client_id = ?1 ${status === 'all' ? '' : 'AND status = ?3'} ORDER BY created_at DESC LIMIT ?2`).bind(...(status === 'all' ? [clientId, limit] : [clientId, limit, status])).all()).results || [];
    return rows.map(r => ({ id: r.id, version: r.version, path: r.path, message: r.message, actor: r.actor, status: r.status, decidedBy: r.decided_by, decidedAt: r.decided_at, note: r.note, createdAt: r.created_at, diff: lineDiff(r.before_text, r.after_text) }));
  } catch (e) { if (noTable(e)) return []; throw e; }
}
export async function pendingApprovalCounts(db) {
  try { return Object.fromEntries(((await db.prepare(`SELECT client_id, COUNT(*) AS n FROM client_edit_approvals WHERE status = 'pending' GROUP BY client_id`).all()).results || []).map(r => [r.client_id, r.n])); }
  catch (e) { if (noTable(e)) return {}; throw e; }
}
/** Approve (keeps the edit, still preview-only) or undo (reverts that version in the working copy). */
export async function decideApproval(env, clientId, id, decision, actor, undoFn) {
  const r = await env.DB.prepare(`SELECT * FROM client_edit_approvals WHERE id = ?1 AND client_id = ?2`).bind(String(id), clientId).first();
  if (!r) throw new ClientUserError(404, 'Approval not found.');
  if (r.status !== 'pending') throw new ClientUserError(409, `Already ${r.status}.`);
  let undo = null;
  if (decision === 'undo') undo = await undoFn(r.version);
  else if (decision !== 'approve') throw new ClientUserError(400, 'Choose approve or undo.');
  const status = decision === 'approve' ? 'approved' : 'undone';
  await env.DB.prepare(`UPDATE client_edit_approvals SET status = ?1, decided_by = ?2, decided_at = ?3 WHERE id = ?4 AND status = 'pending'`).bind(status, String(actor).slice(0, 254), nowIso(), r.id).run();
  await logClientEvent(env.DB, clientId, r.actor, decision === 'approve' ? 'edit-approved' : 'edit-undone', `${r.message} · by ${actor}`);
  return { id: r.id, status, undo };
}
