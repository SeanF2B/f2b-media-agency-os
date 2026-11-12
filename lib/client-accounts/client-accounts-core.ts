// @ts-nocheck  (plain JS module, shared with the companion worker and tested in node; kept as-is)
// F2B Agency OS · client sub-accounts core (shared by the companion worker and the app's /api/client-accounts route).
// Plain ES module, no dependencies. Needs a D1 binding (db). All doc writes are CAS on workspace_documents.updated_at.
// Tables: client_accounts, crm_pipelines.client_id, lead_site_keys.paused_at (see ../PLAN.md §3).
export const WS_ID = 'f2b-agency';
import { archiveClientLogins } from './client-users-core';
export const ARCHIVE_REASON = 'Client archived – paused';
const OPEN_FOR_PAUSE = new Set(['To do']);           // "future tasks": not started yet
const TZ_RE = /^[A-Za-z_]+(?:\/[A-Za-z0-9_+\-]+){0,2}$/;
const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[a-z]{2,}$/i;
const COLOR_RE = /^#[0-9a-f]{6}$/i;
const nowIso = () => new Date().toISOString();
const s = (v, n) => String(v ?? '').trim().slice(0, n);

export class AccountError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

export function slugify(name) {
  return String(name || '').toLowerCase().replace(/&/g, 'and').replace(/['’.|]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'client';
}

async function docClients(db) {
  const r = await db.prepare(
    `SELECT CAST(c.key AS INTEGER) AS idx, json_extract(c.value,'$.id') AS id, json_extract(c.value,'$.name') AS name,
            json_extract(c.value,'$.status') AS status, json_extract(c.value,'$.logo') AS logo, json_extract(c.value,'$.color') AS color,
            json_extract(c.value,'$.wordpressSiteUrl') AS website,
            (SELECT json_group_array(json_extract(x.value,'$.name')) FROM json_each(c.value,'$.services') x) AS services
     FROM workspace_documents w, json_each(w.data,'$.clients') c WHERE w.id = ?1`).bind(WS_ID).all();
  return (r.results || []).map(c => ({ ...c, services: [...new Set(JSON.parse(c.services || '[]').filter(Boolean))] }));
}

/** Make sure every doc client has a client_accounts row (new clients added in the app get one lazily). */
export async function ensureAccounts(db, ownerId) {
  const [clients, rows] = await Promise.all([docClients(db), db.prepare(`SELECT client_id, slug FROM client_accounts`).all()]);
  const have = new Set((rows.results || []).map(r => r.client_id));
  const slugs = new Set((rows.results || []).map(r => r.slug));
  const at = nowIso(), ins = [];
  for (const c of clients) {
    if (have.has(c.id)) continue;
    let slug = slugify(c.name), i = 2; while (slugs.has(slug)) slug = `${slugify(c.name)}-${i++}`; slugs.add(slug);
    ins.push(db.prepare(`INSERT OR IGNORE INTO client_accounts (client_id, owner_id, slug, status, settings, created_at, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?6)`)
      .bind(c.id, ownerId, slug, c.status === 'Archived' ? 'archived' : c.status === 'Paused' ? 'paused' : 'active', JSON.stringify({ timezone: 'Europe/Dublin' }), at));
  }
  if (ins.length) await db.batch(ins);
  return clients;
}

/**
 * List sub-accounts for the switcher / Clients page.
 * allowedIds: null = all (owner/admin), else array of client ids the user may see (staff.clientAccessIds).
 */
export async function listAccounts(db, { ownerId, allowedIds = null, includeArchived = false, withLogos = true } = {}) {
  const clients = await ensureAccounts(db, ownerId);
  const today = nowIso().slice(0, 10), since7 = new Date(Date.now() - 7 * 864e5).toISOString();
  const [acc, counts, leads, pipes, keys] = await Promise.all([
    db.prepare(`SELECT * FROM client_accounts`).all(),
    db.prepare(`SELECT json_extract(t.value,'$.clientId') AS cid,
        SUM(CASE WHEN json_extract(t.value,'$.status') NOT IN ('Done','Cancelled') AND COALESCE(json_extract(t.value,'$.aiRunState'),'') <> 'cancelled' THEN 1 ELSE 0 END) AS open,
        SUM(CASE WHEN json_extract(t.value,'$.status') NOT IN ('Done','Cancelled') AND COALESCE(json_extract(t.value,'$.aiRunState'),'') <> 'cancelled'
                  AND COALESCE(json_extract(t.value,'$.due'),'') <> '' AND json_extract(t.value,'$.due') < ?2 THEN 1 ELSE 0 END) AS overdue
      FROM workspace_documents w, json_each(w.data,'$.tasks') t WHERE w.id = ?1 GROUP BY cid`).bind(WS_ID, today).all(),
    db.prepare(`SELECT client_id AS cid, COUNT(*) AS n FROM crm_opportunities WHERE owner_id = ?1 AND created_at >= ?2 AND source = 'form submission' GROUP BY client_id`).bind(ownerId, since7).all(),
    db.prepare(`SELECT id, client_id, name FROM crm_pipelines WHERE owner_id = ?1 AND archived = 0`).bind(ownerId).all(),
    db.prepare(`SELECT client_id, id, name, allowed_origins, revoked_at, paused_at FROM lead_site_keys`).all(),
  ]);
  const A = new Map((acc.results || []).map(r => [r.client_id, r]));
  const C = new Map((counts.results || []).map(r => [r.cid, r]));
  const L = new Map((leads.results || []).map(r => [r.cid, r.n]));
  const allow = allowedIds ? new Set(allowedIds) : null;
  const accounts = [];
  for (const c of clients) {
    if (allow && !allow.has(c.id)) continue;
    const a = A.get(c.id) || {};
    const status = a.status || 'active';
    if (status === 'archived' && !includeArchived) continue;
    let settings = {}; try { settings = JSON.parse(a.settings || '{}'); } catch {}
    const siteKeys = (keys.results || []).filter(k => k.client_id === c.id && !k.revoked_at)
      .map(k => { let o = []; try { o = JSON.parse(k.allowed_origins || '[]'); } catch {} return { id: k.id, name: k.name, domain: (o[0] || '').replace(/^https?:\/\/(www\.)?/, ''), paused: !!k.paused_at }; });
    accounts.push({
      clientId: c.id, name: c.name, slug: a.slug || slugify(c.name), status, website: c.website || '', services: c.services,
      color: c.color || '', logo: withLogos ? (c.logo || '') : '', archivedAt: a.archived_at || null, archivedBy: a.archived_by || null,
      settings, siteKeys, open: C.get(c.id)?.open || 0, overdue: C.get(c.id)?.overdue || 0, newLeads7d: L.get(c.id) || 0,
      pipelines: (pipes.results || []).filter(p => p.client_id === c.id).map(p => ({ id: p.id, name: p.name })),
      websiteLinks: websiteOf(a),
    });
  }
  accounts.sort((x, y) => (y.open - x.open) || x.name.localeCompare(y.name));
  return { accounts, agencyPipelines: (pipes.results || []).filter(p => !p.client_id).map(p => ({ id: p.id, name: p.name })),
    pipelineClient: Object.fromEntries((pipes.results || []).map(p => [p.id, p.client_id || null])) };
}

export function cleanSettings(input, prev = {}) {
  const out = { ...prev };
  if (input.timezone !== undefined) {
    const tz = s(input.timezone, 64);
    try { if (!TZ_RE.test(tz)) throw 0; new Intl.DateTimeFormat('en-IE', { timeZone: tz }); } catch { throw new AccountError(400, 'Choose a valid timezone, e.g. Europe/Dublin.'); }
    out.timezone = tz;
  }
  if (input.emailBranding !== undefined) {
    const b = input.emailBranding || {}, o = {};
    o.fromName = s(b.fromName, 80);
    o.replyTo = s(b.replyTo, 254).toLowerCase(); if (o.replyTo && !EMAIL_RE.test(o.replyTo)) throw new AccountError(400, 'Reply-to must be an email address.');
    o.color = s(b.color, 7); if (o.color && !COLOR_RE.test(o.color)) throw new AccountError(400, 'Brand colour must look like #C62828.');
    o.phone = s(b.phone, 40);
    o.website = s(b.website, 200); if (o.website && !/^https:\/\/[^\s]+$/i.test(o.website)) throw new AccountError(400, 'Website must start with https://');
    out.emailBranding = Object.fromEntries(Object.entries(o).filter(([, v]) => v));
  }
  if (input.leadNotifyEmails !== undefined) {
    const list = (Array.isArray(input.leadNotifyEmails) ? input.leadNotifyEmails : String(input.leadNotifyEmails || '').split(/[\s,;]+/))
      .map(e => s(e, 254).toLowerCase()).filter(Boolean);
    const bad = list.filter(e => !EMAIL_RE.test(e));
    if (bad.length) throw new AccountError(400, `Not an email address: ${bad.join(', ')}`);
    if (list.length > 10) throw new AccountError(400, 'Up to 10 notify emails.');
    out.leadNotifyEmails = [...new Set(list)];
  }
  return out;
}

export async function saveSettings(db, clientId, input, actor) {
  const a = await db.prepare(`SELECT settings FROM client_accounts WHERE client_id = ?1`).bind(clientId).first();
  if (!a) throw new AccountError(404, 'Client not found.');
  let prev = {}; try { prev = JSON.parse(a.settings || '{}'); } catch {}
  const next = cleanSettings(input || {}, prev);
  await db.prepare(`UPDATE client_accounts SET settings = ?1, updated_at = ?2 WHERE client_id = ?3`).bind(JSON.stringify(next), nowIso(), clientId).run();
  return { clientId, settings: next, by: actor || '' };
}

/** CAS write: set the client's status and change some tasks in place. Paths are generated from integer indexes only. */
async function casDoc(db, build) {
  // D1 allows 100 bound params per statement, so large plans are applied in rounds of <=90 sets.
  // build() must be idempotent (it re-reads the doc and only returns what still needs changing).
  let total = null, changed = false;
  for (let round = 0; round < 50; round++) {
    let done = false;
    for (let attempt = 0; attempt < 4 && !done; attempt++) {
      const meta = await db.prepare(`SELECT updated_at FROM workspace_documents WHERE id = ?1`).bind(WS_ID).first();
      if (!meta) throw new AccountError(503, 'Workspace not found.');
      const plan = await build();
      if (total === null) total = plan.info;
      const onlyStatus = plan.sets.length <= 1 && changed;
      if (!plan.sets.length || onlyStatus) return { changed, ...total };
      const sets = plan.sets.slice(0, 89);   // 1 client set + 44 task pairs: never split a task's status/reason pair
      const params = [];
      const expr = `json_set(data, ${sets.map(([p]) => { if (!/^\$\.(clients|tasks)\[\d+\]\.[A-Za-z]+$/.test(p)) throw new Error('bad path'); return `'${p}', ?`; }).join(', ')})`;
      for (const [, v] of sets) params.push(v);
      params.push(`client-accounts-${crypto.randomUUID()}`, WS_ID, meta.updated_at);
      const res = await db.prepare(`UPDATE workspace_documents SET data = ${expr}, updated_at = ? WHERE id = ? AND updated_at = ?`).bind(...params).run();
      if (res.meta.changes === 1) { changed = true; done = true; if (plan.sets.length <= 89) return { changed, ...total }; }
    }
    if (!done) throw new AccountError(409, 'The workspace changed while saving (4 attempts). Try again.');
  }
  throw new AccountError(500, 'Too many changes in one go.');
}
async function clientIndex(db, clientId) {
  return db.prepare(`SELECT CAST(c.key AS INTEGER) AS idx, json_extract(c.value,'$.status') AS status, json_extract(c.value,'$.name') AS name
    FROM workspace_documents w, json_each(w.data,'$.clients') c WHERE w.id = ?1 AND json_extract(c.value,'$.id') = ?2`).bind(WS_ID, clientId).first();
}
async function clientTasks(db, clientId) {
  const r = await db.prepare(`SELECT CAST(t.key AS INTEGER) AS idx, json_extract(t.value,'$.id') AS id, json_extract(t.value,'$.status') AS status,
      json_extract(t.value,'$.pendingReason') AS pendingReason FROM workspace_documents w, json_each(w.data,'$.tasks') t
      WHERE w.id = ?1 AND json_extract(t.value,'$.clientId') = ?2`).bind(WS_ID, clientId).all();
  return r.results || [];
}

/** Archive: hide the client, pause its not-started tasks, its bot flows and its lead-intake keys. Nothing is deleted. */
export async function archiveClient(db, clientId, actor, reason = '') {
  const acc = await db.prepare(`SELECT * FROM client_accounts WHERE client_id = ?1`).bind(clientId).first();
  if (!acc) throw new AccountError(404, 'Client not found.');
  if (acc.status === 'archived') return { clientId, status: 'archived', alreadyArchived: true };
  const at = nowIso();
  const pausedMap = new Map(); let prevStatus = null;
  const doc = await casDoc(db, async () => {
    const c = await clientIndex(db, clientId);
    if (!c) throw new AccountError(404, 'Client not found in the workspace.');
    if (prevStatus === null) prevStatus = c.status && c.status !== 'Archived' ? c.status : 'Active';
    const tasks = (await clientTasks(db, clientId)).filter(t => OPEN_FOR_PAUSE.has(t.status));
    for (const t of tasks) if (!pausedMap.has(t.id)) pausedMap.set(t.id, { id: t.id, status: t.status, pendingReason: t.pendingReason || '' });
    const sets = [[`$.clients[${c.idx}].status`, 'Archived']];
    for (const t of tasks) { sets.push([`$.tasks[${t.idx}].status`, 'Blocked'], [`$.tasks[${t.idx}].pendingReason`, ARCHIVE_REASON]); }
    return { sets, info: { tasksPaused: tasks.length } };
  });
  const flows = (await db.prepare(`SELECT flow_id FROM agent_flow_enrollments WHERE client_id = ?1 AND status = 'active'`).bind(clientId).all()).results || [];
  const keys = (await db.prepare(`SELECT id FROM lead_site_keys WHERE client_id = ?1 AND revoked_at IS NULL AND paused_at IS NULL`).bind(clientId).all()).results || [];
  const paused = [...pausedMap.values()];
  const state = { prevStatus, tasks: paused, flows: flows.map(f => f.flow_id), siteKeys: keys.map(k => k.id), at };
  await db.batch([
    db.prepare(`UPDATE agent_flow_enrollments SET status = 'paused' WHERE client_id = ?1 AND status = 'active'`).bind(clientId),
    db.prepare(`UPDATE lead_site_keys SET paused_at = ?1 WHERE client_id = ?2 AND revoked_at IS NULL AND paused_at IS NULL`).bind(at, clientId),
    db.prepare(`UPDATE client_accounts SET status = 'archived', archived_at = ?1, archived_by = ?2, archive_reason = ?3, archive_state = ?4, updated_at = ?1 WHERE client_id = ?5`)
      .bind(at, s(actor, 254), s(reason, 300), JSON.stringify(state), clientId),
  ]);
  const loginsOff = await archiveClientLogins(db, clientId, true);
  return { clientId, status: 'archived', loginsOff, tasksPaused: paused.length, flowsPaused: state.flows.length, siteKeysPaused: state.siteKeys.length };
}

/** Restore: undo exactly what archive paused (tasks only if still paused by archive). */
export async function restoreClient(db, clientId, actor) {
  const acc = await db.prepare(`SELECT * FROM client_accounts WHERE client_id = ?1`).bind(clientId).first();
  if (!acc) throw new AccountError(404, 'Client not found.');
  if (acc.status !== 'archived') return { clientId, status: acc.status, notArchived: true };
  let st = {}; try { st = JSON.parse(acc.archive_state || '{}'); } catch {}
  const saved = new Map((st.tasks || []).map(t => [t.id, t]));
  const restored = new Set();
  await casDoc(db, async () => {
    const c = await clientIndex(db, clientId);
    if (!c) throw new AccountError(404, 'Client not found in the workspace.');
    const sets = [[`$.clients[${c.idx}].status`, st.prevStatus && st.prevStatus !== 'Archived' ? st.prevStatus : 'Active']];
    for (const t of await clientTasks(db, clientId)) {
      const o = saved.get(t.id);
      if (!o || t.status !== 'Blocked' || t.pendingReason !== ARCHIVE_REASON) continue;   // someone changed it since: leave alone
      sets.push([`$.tasks[${t.idx}].status`, o.status], [`$.tasks[${t.idx}].pendingReason`, o.pendingReason]); restored.add(t.id);
    }
    return { sets, info: {} };
  });
  const stmts = [db.prepare(`UPDATE client_accounts SET status = 'active', archived_at = NULL, archived_by = NULL, archive_reason = '', archive_state = '{}', updated_at = ?1 WHERE client_id = ?2`).bind(nowIso(), clientId)];
  for (const f of st.flows || []) stmts.push(db.prepare(`UPDATE agent_flow_enrollments SET status = 'active' WHERE client_id = ?1 AND flow_id = ?2 AND status = 'paused'`).bind(clientId, f));
  for (const k of st.siteKeys || []) stmts.push(db.prepare(`UPDATE lead_site_keys SET paused_at = NULL WHERE id = ?1 AND client_id = ?2`).bind(k, clientId));
  await db.batch(stmts);
  const loginsOn = await archiveClientLogins(db, clientId, false);
  return { clientId, status: 'active', loginsOn, tasksRestored: restored.size, flowsResumed: (st.flows || []).length, siteKeysResumed: (st.siteKeys || []).length, by: actor || '' };
}

// ---------- per-client website links (Marketing → Websites) ----------
const WEB_STATUSES = ['preview', 'live'];
export function websiteOf(a) {
  return { previewUrl: a?.preview_url || '', liveUrl: a?.live_url || '', editorUrl: a?.editor_url || '',
    status: WEB_STATUSES.includes(a?.website_status) ? a.website_status : '', updatedAt: a?.website_updated_at || null };
}
function httpsUrl(v, label) {
  const t = s(v, 300);
  if (!t) return '';
  let u; try { u = new URL(t); } catch { throw new AccountError(400, `${label} must be a full https:// address.`); }
  if (u.protocol !== 'https:' || !u.hostname.includes('.') || u.username || u.password) throw new AccountError(400, `${label} must be a full https:// address.`);
  return u.href.replace(/\/$/, u.pathname === '/' && !t.endsWith('/') ? '' : '/');
}
export function cleanWebsite(input, prev) {
  const out = { ...prev };
  if (input.previewUrl !== undefined) out.previewUrl = httpsUrl(input.previewUrl, 'Preview URL');
  if (input.liveUrl !== undefined) out.liveUrl = httpsUrl(input.liveUrl, 'Live URL');
  if (input.editorUrl !== undefined) out.editorUrl = httpsUrl(input.editorUrl, 'Editor URL');
  if (input.status !== undefined) {
    const st = s(input.status, 10).toLowerCase();
    if (st && !WEB_STATUSES.includes(st)) throw new AccountError(400, 'Status must be preview or live.');
    out.status = st;
  }
  return out;
}
export async function getWebsite(db, clientId) {
  const a = await db.prepare(`SELECT client_id, slug, preview_url, live_url, editor_url, website_status, website_updated_at FROM client_accounts WHERE client_id = ?1`).bind(clientId).first();
  if (!a) throw new AccountError(404, 'Client not found.');
  return { clientId, slug: a.slug, website: websiteOf(a) };
}
export async function saveWebsite(db, clientId, input, actor) {
  const cur = await getWebsite(db, clientId);
  const w = cleanWebsite(input || {}, cur.website), at = nowIso();
  await db.prepare(`UPDATE client_accounts SET preview_url = ?1, live_url = ?2, editor_url = ?3, website_status = ?4, website_updated_at = ?5, updated_at = ?5 WHERE client_id = ?6`)
    .bind(w.previewUrl, w.liveUrl, w.editorUrl, w.status || null, at, clientId).run();
  return { clientId, website: { ...w, updatedAt: at }, by: actor || '' };
}

/** Delete is only allowed from Archived. Call before the app's existing client-delete handler. */
export async function assertDeletable(db, clientId) {
  const a = await db.prepare(`SELECT status FROM client_accounts WHERE client_id = ?1`).bind(clientId).first();
  if (!a || a.status !== 'archived') throw new AccountError(409, 'Archive this client first. Delete is only available for archived clients.');
}

/** Pipelines a view may show: a client's own, or (agency view) only agency pipelines (client_id NULL). */
export async function scopedPipelineIds(db, ownerId, clientId) {
  const r = await db.prepare(clientId
    ? `SELECT id FROM crm_pipelines WHERE owner_id = ?1 AND archived = 0 AND client_id = ?2`
    : `SELECT id FROM crm_pipelines WHERE owner_id = ?1 AND archived = 0 AND client_id IS NULL`).bind(...(clientId ? [ownerId, clientId] : [ownerId])).all();
  return (r.results || []).map(x => x.id);
}
