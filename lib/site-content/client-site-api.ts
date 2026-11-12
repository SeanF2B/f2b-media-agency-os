// @ts-nocheck  (plain JS module, shared with the companion worker and tested in node; kept as-is)
// F2B Agency OS · /api/client-site handler (framework-free; used by app/api/client-site/route.ts and the local harness).
// In-app website content editor for Marketing → Websites. Saves go ONLY to the client's preview working copy
// (interim D1/R2 store) or, later, a GitHub preview branch. There is no publish/live path in this API.
//   GET  /api/client-site?clientId=…                       → overview (pages grouped like Keystatic, SEO summaries, recent history)
//   GET  /api/client-site?clientId=…&op=page&path=…        → one page: schema + data (+ markdown body) + history
//   GET  /api/client-site?clientId=…&op=history[&path=…]   → versions
//   GET  /api/client-site?clientId=…&op=asset&path=/images/…  → a not-yet-built uploaded image, else redirect to the preview site
//   POST /api/client-site { clientId, op: 'save', path, data, body?, baseSha, message? }   (owner / Owner+Admin only)
//   POST /api/client-site { clientId, op: 'undo', version } | { op: 'restore', path, version }
//   POST /api/client-site?clientId=…&op=image&dir=public/images/og&name=photo.jpg   (raw image bytes, ≤ 2 MB)
import { resolveAccess } from '../client-accounts/client-accounts-api';
import { AccountError } from '../client-accounts/client-accounts-core';
import { findClientLogin, loginUsable, isTeam, ClientUserError } from '../client-accounts/client-users-core';
import { siteAction, workingImage, getSite, SiteError, LIMITS } from './site-content-core';

const json = (body, status = 200) => Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
const CLIENT_RE = /^[\w-]{1,120}$/;

/** Who is calling: agency team (resolveAccess) or a client login (Website & SEO scope, own client only). */
async function caller(env, user, clientLogin) {
  if (clientLogin) return { client: clientLogin };
  try { return await resolveAccess(env.DB, user); }
  catch (e) {
    if (!(e instanceof AccountError) || e.status !== 403 || !user?.email) throw e;
    const cu = await findClientLogin(env.DB, user.email);   // defense in depth if the gate is not in front
    if (!cu || (await isTeam(env.DB, user))) throw e;
    if (!loginUsable(cu)) throw new SiteError(403, 'Your login is paused. Contact F2B Media.');
    return { client: cu };
  }
}

export async function handleClientSite(request, env, user, clientLogin = null) {
  try {
    const who = await caller(env, user, clientLogin);
    if (who.client) return await handleAsClient(request, env, who.client);
    const acc = who;
    const url = new URL(request.url);
    let body = null;
    const op0 = url.searchParams.get('op') || '';
    if (request.method === 'POST' && op0 !== 'image') { try { body = await request.json(); } catch { throw new SiteError(400, 'Send valid JSON.'); } }
    const clientId = String(body?.clientId || url.searchParams.get('clientId') || '');
    if (!CLIENT_RE.test(clientId)) throw new SiteError(400, 'Choose a client.');
    if (!acc.admin && acc.allowedIds !== null && !acc.allowedIds.includes(clientId)) throw new SiteError(403, 'You do not have access to this client.');
    const ctx = { canWrite: acc.admin, actor: acc.actor };
    if (request.method === 'GET') {
      const op = op0 || 'overview';
      if (op === 'overview') return json(await siteAction(env, clientId, { op: 'overview' }, ctx));
      if (op === 'page') return json(await siteAction(env, clientId, { op: 'read', path: url.searchParams.get('path') }, ctx));
      if (op === 'history') return json(await siteAction(env, clientId, { op: 'history', path: url.searchParams.get('path'), limit: url.searchParams.get('limit') }, ctx));
      if (op === 'approvals') return json(await siteAction(env, clientId, { op: 'approvals', status: url.searchParams.get('status') }, ctx));
      if (op === 'builder-list') return json(await siteAction(env, clientId, { op }, ctx));
      if (op === 'builder-read') return json(await siteAction(env, clientId, { op, slug: url.searchParams.get('slug') }, ctx));
      if (op === 'asset') {
        const p = String(url.searchParams.get('path') || '');
        if (!/^\/images\/[\w./-]{1,200}$/.test(p) || p.includes('..')) throw new SiteError(400, 'Bad image path.');
        const img = await workingImage(env, clientId, p);
        if (img) return new Response(img.body, { headers: { 'content-type': img.contentType, 'cache-control': 'private, max-age=300', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'" } });
        const site = await getSite(env.DB, clientId);
        const prev = String(site?.preview_url || '');
        if (/^https:\/\/[^/]+$/.test(prev.replace(/\/$/, ''))) return Response.redirect(prev.replace(/\/$/, '') + p, 302);
        throw new SiteError(404, 'Image not found.');
      }
      throw new SiteError(400, 'Unknown action.');
    }
    if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
    if (!acc.admin) throw new SiteError(403, 'Only an agency owner or admin can edit website content.');
    if (op0 === 'image') {
      if (+(request.headers.get('content-length') || 0) > LIMITS.imageBytes) throw new SiteError(413, `Images must be ${LIMITS.imageBytes / 1048576} MB or smaller.`);
      const bytes = new Uint8Array(await request.arrayBuffer());
      return json(await siteAction(env, clientId, { op: 'image', dir: url.searchParams.get('dir'), name: url.searchParams.get('name'), bytes }, ctx));
    }
    const op = String(body.op || '');
    if (!['save', 'undo', 'restore', 'decide', 'builder-save', 'builder-import'].includes(op)) throw new SiteError(400, 'Unknown action.');
    return json(await siteAction(env, clientId, { ...body, op }, ctx));
  } catch (e) {
    if (e instanceof SiteError) return json({ error: e.message, ...(e.extra || {}) }, e.status);
    if (e instanceof AccountError || e instanceof ClientUserError) return json({ error: e.message }, e.status);
    console.error('client-site failed', e);
    return json({ error: 'Could not load the website content.' }, 500);
  }
}

/** Client login: only its own client, only Website & SEO ops. Undo/restore/approvals decisions/export stay with F2B. */
async function handleAsClient(request, env, cu) {
  if (cu.scope !== 'website_seo') throw new SiteError(403, 'This login cannot edit the website.');
  const url = new URL(request.url);
  const op0 = url.searchParams.get('op') || '';
  const ctx = { canWrite: true, actor: cu.email, role: 'client' };
  let body = null;
  if (request.method === 'POST' && op0 !== 'image') { try { body = await request.json(); } catch { throw new SiteError(400, 'Send valid JSON.'); } }
  const asked = String(body?.clientId || url.searchParams.get('clientId') || cu.client_id);
  if (asked !== cu.client_id) throw new SiteError(403, 'You can only edit your own website.');
  const clientId = cu.client_id;
  if (request.method === 'GET') {
    const op = op0 || 'overview';
    if (op === 'overview') return json(await siteAction(env, clientId, { op: 'overview' }, ctx));
    if (op === 'page') return json(await siteAction(env, clientId, { op: 'read', path: url.searchParams.get('path') }, ctx));
    if (op === 'history') return json(await siteAction(env, clientId, { op: 'history', path: url.searchParams.get('path'), limit: url.searchParams.get('limit') }, ctx));
    if (op === 'approvals') return json(await siteAction(env, clientId, { op: 'approvals' }, ctx));
    if (op === 'builder-list') return json(await siteAction(env, clientId, { op }, ctx));
    if (op === 'builder-read') return json(await siteAction(env, clientId, { op, slug: url.searchParams.get('slug') }, ctx));
    if (op === 'asset') {
      const p = String(url.searchParams.get('path') || '');
      if (!/^\/images\/[\w./-]{1,200}$/.test(p) || p.includes('..')) throw new SiteError(400, 'Bad image path.');
      const img = await workingImage(env, clientId, p);
      if (img) return new Response(img.body, { headers: { 'content-type': img.contentType, 'cache-control': 'private, max-age=300', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'" } });
      const prev = String((await getSite(env.DB, clientId))?.preview_url || '').replace(/\/$/, '');
      if (/^https:\/\/[^/]+$/.test(prev)) return Response.redirect(prev + p, 302);
      throw new SiteError(404, 'Image not found.');
    }
    throw new SiteError(403, 'Not available for client logins.');
  }
  if (request.method !== 'POST') return json({ error: 'Method not allowed.' }, 405);
  if (op0 === 'image') {
    if (+(request.headers.get('content-length') || 0) > LIMITS.imageBytes) throw new SiteError(413, `Images must be ${LIMITS.imageBytes / 1048576} MB or smaller.`);
    return json(await siteAction(env, clientId, { op: 'image', dir: url.searchParams.get('dir'), name: url.searchParams.get('name'), bytes: new Uint8Array(await request.arrayBuffer()) }, ctx));
  }
  if (body.op !== 'save' && body.op !== 'builder-save') throw new SiteError(403, 'Only F2B Media can undo, restore or approve changes.');
  return json(await siteAction(env, clientId, { ...body, op: body.op, allowNew: false }, ctx));
}
