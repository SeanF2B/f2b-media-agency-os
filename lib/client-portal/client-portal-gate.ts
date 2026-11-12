// @ts-nocheck  (plain JS module, shared with the companion worker and tested in node; kept as-is)
// F2B Agency OS · client login gate. Runs in front of EVERY request (middleware.ts in the app; cs-wrapper.js in the local harness).
// Team members (owner + non-bot staff) pass straight through: the app is unchanged for them.
// An Access email that has a row in client_users (and is not on the team) becomes a client user:
//   - allowed:  GET /client-portal (their own page), /f2b-site-editor.js, a few static icons,
//               GET /api/client-portal/me, /api/client-site (own client, Website & SEO only)
//   - anything else: 403 (APIs) or a redirect to /client-portal (pages). No agency data, other clients, CRM, tasks, billing, bots or automations.
//   - paused / removed-by-archive logins get a 403 page on every route.
import { findClientLogin, loginUsable, isTeam, touchClientLogin, logClientEvent, SCOPES } from '../client-accounts/client-users-core';
import { handleClientSite } from '../site-content/client-site-api';
import { PORTAL_HTML, PAUSED_HTML } from './client-portal-page';

const notClient = new Map();   // email → expiry (ms). Only negative answers are cached, so pausing a login is immediate.
const denyLog = new Map();
const STATIC_OK = new Set(['/f2b-site-editor.js', '/f2b-site-builder.js', '/f2b-home-icon.png', '/favicon.ico', '/icon.png', '/apple-icon.png']);
const HEX = /^#[0-9a-fA-F]{6}$/;
async function brandIndex(db, clientId) {
  return db.prepare(`SELECT CAST(c.key AS INTEGER) AS idx, json_extract(c.value,'$.branding') AS branding FROM workspace_documents w, json_each(w.data,'$.clients') c WHERE w.id = 'f2b-agency' AND json_extract(c.value,'$.id') = ?1`).bind(clientId).first();
}
async function saveBrand(request, env, cu, email) {
  let b; try { b = await request.json(); } catch { return json({ error: 'Send a valid request.' }, 400); }
  const primary = String(b.primary || ''), secondary = String(b.secondary || ''), logo = String(b.logo || '');
  if (!HEX.test(primary) || !HEX.test(secondary)) return json({ error: 'Choose two valid colours.' }, 400);
  if (logo && (!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(logo) || logo.length > 200000)) return json({ error: 'That logo is too large or not a PNG, JPG or WebP image.' }, 400);
  const row = await brandIndex(env.DB, cu.client_id);
  if (!row) return json({ error: 'Your account could not be found.' }, 404);
  const branding = JSON.stringify({ primary: primary.toLowerCase(), secondary: secondary.toLowerCase(), logo, name: '' });
  for (let attempt = 0; attempt < 4; attempt++) {
    const meta = await env.DB.prepare(`SELECT updated_at FROM workspace_documents WHERE id = 'f2b-agency'`).first();
    const base = `$.clients[${Number(row.idx)}]`;
    const res = await env.DB.prepare(`UPDATE workspace_documents SET data = json_set(data, '${base}.branding', json(?1)${logo ? `, '${base}.logo', ?2` : ''}), updated_at = ? WHERE id = 'f2b-agency' AND updated_at = ?`)
      .bind(...(logo ? [branding, logo] : [branding]), `client-brand-${crypto.randomUUID()}`, meta.updated_at).run();
    if (res.meta.changes === 1) { await logClientEvent(env.DB, cu.client_id, email, 'brand', 'Updated logo and colours'); return json({ ok: true }); }
  }
  return json({ error: 'The workspace changed while saving. Try again.' }, 409);
}
const json = (b, status = 200) => Response.json(b, { status, headers: { 'Cache-Control': 'no-store' } });
const html = (h, status = 200) => new Response(h, { status, headers: { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-frame-options': 'DENY', 'referrer-policy': 'same-origin' } });

/** Returns a Response for client users, or null to let the request continue to the app unchanged. */
export async function clientGate(request, env, user) {
  const email = String(user?.email || '').toLowerCase();
  if (!email) return null;
  const now = Date.now();
  if ((notClient.get(email) || 0) > now) return null;
  const cu = await findClientLogin(env.DB, email);
  if (!cu || (await isTeam(env.DB, user))) { notClient.set(email, now + 30e3); if (notClient.size > 2000) notClient.clear(); return null; }

  const url = new URL(request.url), path = url.pathname.replace(/\/+$/, '') || '/', isApi = path.startsWith('/api/');
  if (!loginUsable(cu)) {
    await logClientEvent(env.DB, cu.client_id, email, 'blocked', `${cu.status === 'active' ? 'client archived' : cu.status} · ${request.method} ${path}`.slice(0, 300));
    return isApi ? json({ error: 'Your login is paused. Contact F2B Media.' }, 403) : html(PAUSED_HTML, 403);
  }
  await touchClientLogin(env.DB, cu);
  if (request.method === 'GET' && path === '/client-portal') return html(PORTAL_HTML);
  if (request.method === 'GET' && STATIC_OK.has(path)) return null;
  if (path === '/api/client-portal/me' && request.method === 'GET') {
    const bro = await brandIndex(env.DB, cu.client_id).catch(() => null); let branding = null; try { branding = bro?.branding ? JSON.parse(bro.branding) : null; } catch { /* ignore */ }
    return json({ branding, email, scope: cu.scope, scopeLabel: SCOPES[cu.scope] || cu.scope, client: { id: cu.client_id, name: cu.client_name || 'Your website', logo: cu.client_logo || '' },
      website: { previewUrl: cu.preview_url || '', liveUrl: cu.live_url || '', status: cu.website_status || '' } });
  }
  if (path === '/api/client-portal/brand' && request.method === 'POST') return saveBrand(request, env, cu, email);
  if (path === '/api/client-site') return handleClientSite(request, env, user, cu);
  // everything else is off-limits
  const k = `${email} ${request.method} ${path}`;
  if ((denyLog.get(k) || 0) < now) { denyLog.set(k, now + 60e3); if (denyLog.size > 2000) denyLog.clear(); await logClientEvent(env.DB, cu.client_id, email, 'denied', `${request.method} ${path}`.slice(0, 300)); }
  if (!isApi && request.method === 'GET' && (request.headers.get('accept') || '').includes('text/html')) return Response.redirect(new URL('/client-portal', url).toString(), 302);
  return isApi ? json({ error: 'Not available for client logins.' }, 403) : new Response('Not available for client logins.', { status: 403, headers: { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' } });
}
