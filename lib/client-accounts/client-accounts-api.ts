// @ts-nocheck  (plain JS module, shared with the companion worker and tested in node; kept as-is)
// F2B Agency OS · /api/client-accounts handler (framework-free; used by app/api/client-accounts/route.ts and the local harness).
// Auth mirrors the app: user from Cloudflare Access / oai headers; owner + Owner/Admin staff manage, other staff see only clientAccessIds.
import { listAccounts, archiveClient, restoreClient, saveSettings, saveWebsite, AccountError, WS_ID } from './client-accounts-core';
import { listClientUsers, addClientUser, setClientUserStatus, removeClientUser, pendingApprovalCounts, ClientUserError } from './client-users-core';

const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });

/** user = { userId, email } from the app's session helper (same one /api/crm uses). */
export async function resolveAccess(db, user) {
  if (!user) throw new AccountError(401, 'Sign in first.');
  const row = await db.prepare(`SELECT json_object('ownerId', owner_id, 'staff', json(COALESCE((SELECT json_group_array(json_object(
      'id', json_extract(value,'$.id'), 'email', json_extract(value,'$.email'), 'role', json_extract(value,'$.role'), 'isBot', json_extract(value,'$.isBot'),
      'permissions', json_extract(value,'$.permissions'), 'clientAccessIds', json_extract(value,'$.clientAccessIds'))) FROM json_each(data,'$.staff')), '[]')),
      'tasks', json(COALESCE((SELECT json_group_array(json_object('clientId', json_extract(value,'$.clientId'), 'assigneeId', json_extract(value,'$.assigneeId')))
        FROM json_each(data,'$.tasks')), '[]'))) AS d FROM workspace_documents WHERE id = ?1`).bind(WS_ID).first();
  if (!row?.d) throw new AccountError(503, 'The agency workspace could not be found.');
  const ws = JSON.parse(row.d);
  const ownerId = String(ws.ownerId || '');
  const email = String(user.email || '').toLowerCase();
  const me = (ws.staff || []).find(s => !s.isBot && (s.id === user.userId || (email && String(s.email || '').toLowerCase() === email)));
  const admin = ownerId === user.userId || ['Owner', 'Admin'].includes(me?.role || '');
  if (admin) return { ownerId, admin: true, allowedIds: null, actor: email || user.userId };
  if (!me) throw new AccountError(403, 'Your account is not on the F2B team yet.');
  const perms = typeof me.permissions === 'string' ? JSON.parse(me.permissions || '{}') : (me.permissions || {});
  const access = typeof me.clientAccessIds === 'string' ? JSON.parse(me.clientAccessIds) : me.clientAccessIds;
  let allowedIds;
  if (Array.isArray(access)) allowedIds = access;                         // explicit list wins (same rule as /api/workspace)
  else if (perms.clients) allowedIds = null;                              // "Clients" permission: all clients
  else allowedIds = [...new Set((ws.tasks || []).filter(t => t.assigneeId === me.id && t.clientId).map(t => t.clientId))];
  return { ownerId, admin: false, allowedIds, actor: email };
}

export async function handleClientAccounts(request, db, user) {
  try {
    const acc = await resolveAccess(db, user);
    const url = new URL(request.url);
    if (request.method === 'GET') {
      const includeArchived = acc.admin && url.searchParams.get('include') === 'archived';
      if (url.searchParams.get('op') === 'client-users') {
        if (!acc.admin) throw new AccountError(403, 'Only an agency owner or admin can manage client logins.');
        const cid = String(url.searchParams.get('clientId') || '').slice(0, 120);
        if (!cid) throw new AccountError(400, 'Choose a client.');
        return json(await listClientUsers(db, cid));
      }
      const data = await listAccounts(db, { ownerId: acc.ownerId, allowedIds: acc.allowedIds, includeArchived });
      if (acc.admin) { const pend = await pendingApprovalCounts(db); for (const a of data.accounts) a.pendingClientEdits = pend[a.clientId] || 0; }
      if (!acc.admin) for (const a of data.accounts) { a.siteKeys = []; a.settings = { timezone: a.settings?.timezone || '' }; a.archivedBy = null; }
      return json({ ...data, me: { admin: acc.admin, canManage: acc.admin } });
    }
    if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
    if (!acc.admin) throw new AccountError(403, 'Only an agency owner or admin can manage clients.');
    let body; try { body = await request.json(); } catch { throw new AccountError(400, 'Send valid JSON.'); }
    const clientId = String(body.clientId || '').slice(0, 120);
    if (!clientId) throw new AccountError(400, 'Choose a client.');
    if (body.action === 'archive') return json(await archiveClient(db, clientId, acc.actor, String(body.reason || '')));
    if (body.action === 'restore') return json(await restoreClient(db, clientId, acc.actor));
    if (body.action === 'settings') return json(await saveSettings(db, clientId, body.settings || {}, acc.actor));
    if (body.action === 'website') return json(await saveWebsite(db, clientId, body.website || {}, acc.actor));
    if (body.action === 'client-user-add') return json(await addClientUser(db, clientId, { email: body.email, scope: body.scope }, acc.actor));
    if (body.action === 'client-user-status') return json(await setClientUserStatus(db, clientId, body.id, body.status, acc.actor));
    if (body.action === 'client-user-remove') return json(await removeClientUser(db, clientId, body.id, acc.actor));
    throw new AccountError(400, 'Unknown action.');
  } catch (e) {
    if (e instanceof AccountError || e instanceof ClientUserError) return json({ error: e.message }, e.status);
    console.error('client-accounts failed', e);
    return json({ error: 'Could not load client accounts.' }, 500);
  }
}

/** Server-side CRM scope for GET /api/crm. Reads ?clientId= or the f2b_client cookie ('' / 'agency' = agency view). */
export function crmScopeFrom(request) {
  const url = new URL(request.url);
  let v = url.searchParams.get('clientId');
  if (v === null) { const m = /(?:^|;\s*)f2b_client=([^;]*)/.exec(request.headers.get('cookie') || ''); v = m ? decodeURIComponent(m[1]) : null; }
  if (v === null) return null;                     // no scope requested: legacy behaviour (everything)
  return v === '' || v === 'agency' ? { clientId: null } : { clientId: v.slice(0, 120) };
}
