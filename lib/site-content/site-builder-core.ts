// @ts-nocheck  (plain JS module, same style as site-content-core)
// F2B Agency OS · visual website builder storage. Pages are JSON files in the SAME site content store the form editor uses
// (site_content_* tables), under src/content/builder/<slug>.json, so versions, history, undo, restore, client approvals and the
// preview sync all work unchanged. There is no publish/live path here.
import { createApproval, logClientEvent } from '../client-accounts/client-users-core';

export const BUILDER_DIR = 'src/content/builder/';
export const CONFIG_PATH = BUILDER_DIR + '_config.json';
export const BUILDER_IMAGE_DIR = 'public/images/builder';
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,60}$/;
const SEO = { title: 60, description: 155, focusKeyword: 80 };
const MAX_BLOCKS = 80, MAX_TEXT = 400 * 1024, MAX_STR = 4000;
const str = (v, n) => String(v ?? '').slice(0, n);
const err = (SiteError, status, msg, extra) => new SiteError(status, msg, extra);

export const isBuilderPath = p => typeof p === 'string' && p.startsWith(BUILDER_DIR) && p.endsWith('.json') && !p.slice(BUILDER_DIR.length).includes('/');
export const pathForSlug = slug => `${BUILDER_DIR}${slug}.json`;

/** Default per-client block configuration. Admin can change it (op builder-save, slug _config). */
export const DEFAULT_CONFIG = {
  v: 1,
  theme: { primary: '#2f7de1', secondary: '#1f2a44', font: 'system', radius: 12, name: '', phone: '' },
  blocks: ['hero', 'stats', 'services', 'features', 'steps', 'text', 'imagetext', 'image', 'gallery', 'reviews', 'faq', 'cta', 'contact'],
  custom: [],   // [{ type, label, fields: [{ key, label, kind: 'text'|'textarea'|'image'|'link' }] }] for client-specific sections
};

function cleanScalar(v, kind) {
  if (kind === 'image') { const s = str(v, 300); return s === '' || (/^\/[\w\-./]+$/.test(s) && !s.includes('..')) || /^https:\/\/[^\s"'<>]+$/.test(s) ? s : ''; }
  if (kind === 'link') { const s = str(v, 400).trim(); return s === '' || /^(https?:\/\/[^\s"'<>]+|\/[\w\-./?=&#%]*|#[\w-]*|tel:[+\d\s()-]+|mailto:[^\s"'<>]+)$/.test(s) ? s : ''; }
  return str(v, MAX_STR);
}
const IMG_KEYS = new Set(['image', 'img']), LINK_KEYS = new Set(['link', 'buttonLink', 'href']);
function cleanProps(value, depth = 0) {
  if (depth > 5) return null;
  if (Array.isArray(value)) return value.slice(0, 100).map(x => cleanProps(x, depth + 1)).filter(x => x !== null);
  if (value && typeof value === 'object') {
    const out = {};
    for (const [k, v] of Object.entries(value).slice(0, 40)) {
      if (!/^[A-Za-z][\w]{0,40}$/.test(k)) continue;
      if (Array.isArray(v) && v.every(x => typeof x === 'string')) { out[k] = v.slice(0, 100).map(x => cleanScalar(x, k === 'images' ? 'image' : 'text')); continue; }
      out[k] = typeof v === 'string' ? cleanScalar(v, IMG_KEYS.has(k) ? 'image' : LINK_KEYS.has(k) ? 'link' : 'text') : (typeof v === 'number' || typeof v === 'boolean') ? v : cleanProps(v, depth + 1);
    }
    return out;
  }
  return typeof value === 'string' ? str(value, MAX_STR) : (typeof value === 'number' || typeof value === 'boolean') ? value : null;
}

export function normalizePage(SiteError, page, slug) {
  if (!page || typeof page !== 'object') throw err(SiteError, 400, 'Send the page content.');
  const seo = page.seo && typeof page.seo === 'object' ? page.seo : {};
  const clean = { title: str(seo.title, 400).trim(), description: str(seo.description, 1000).trim(), focusKeyword: str(seo.focusKeyword, 200).trim() };
  if (clean.title.length > SEO.title) throw err(SiteError, 400, `The SEO title is ${clean.title.length} characters. Keep it to ${SEO.title} or fewer.`, { field: 'seo.title' });
  if (clean.description.length > SEO.description) throw err(SiteError, 400, `The SEO description is ${clean.description.length} characters. Keep it to ${SEO.description} or fewer.`, { field: 'seo.description' });
  if (!Array.isArray(page.blocks)) throw err(SiteError, 400, 'The page needs a list of sections.');
  if (page.blocks.length > MAX_BLOCKS) throw err(SiteError, 400, `A page can have up to ${MAX_BLOCKS} sections.`);
  const ids = new Set();
  const blocks = page.blocks.map((b, i) => {
    if (!b || typeof b.type !== 'string' || !/^[a-z][\w-]{0,40}$/.test(b.type)) throw err(SiteError, 400, `Section ${i + 1} is not valid.`);
    let id = /^[\w-]{4,40}$/.test(String(b.id || '')) ? String(b.id) : 'b' + Math.random().toString(36).slice(2, 10);
    while (ids.has(id)) id += 'x'; ids.add(id);
    return { id, type: b.type, props: cleanProps(b.props || {}) || {} };
  });
  let url = str(page.url, 120).trim();
  if (url && !/^\/[a-z0-9\-/]*$/.test(url)) throw err(SiteError, 400, 'The page address can only use lowercase letters, numbers and dashes, like /roof-repair/.');
  if (!url) url = slug === 'home' ? '/' : `/${slug}/`;
  if (url !== '/' && !url.endsWith('/')) url += '/';
  let raw;
  if (page.raw && typeof page.raw === 'object') {
    const origin = String(page.raw.origin || ''), head = String(page.raw.head || ''), body = String(page.raw.body || ''), scripts = String(page.raw.scripts || '');
    if (!/^https:\/\/[a-z0-9.-]+$/i.test(origin)) throw err(SiteError, 400, 'The copied page needs its original https address.');
    if (head.length + body.length + scripts.length > MAX_TEXT - 8000) throw err(SiteError, 413, 'This page is too large to copy as one page.');
    raw = { origin, head, body, scripts };
  }
  return { v: 1, slug, title: str(page.title, 120).trim() || slug, url, seo: clean, blocks, ...(raw ? { raw } : {}) };
}
export function normalizeConfig(SiteError, c) {
  const theme = c?.theme || {}, hex = (v, d) => /^#[0-9a-fA-F]{6}$/.test(String(v || '')) ? String(v).toLowerCase() : d;
  const custom = (Array.isArray(c?.custom) ? c.custom : []).slice(0, 20).map(x => ({
    type: /^[a-z][\w-]{1,30}$/.test(String(x?.type || '')) ? String(x.type) : null, label: str(x?.label, 40) || 'Custom section',
    fields: (Array.isArray(x?.fields) ? x.fields : []).slice(0, 12).map(f => ({ key: /^[A-Za-z]\w{0,30}$/.test(String(f?.key || '')) ? String(f.key) : null, label: str(f?.label, 40), kind: ['text', 'textarea', 'image', 'link'].includes(f?.kind) ? f.kind : 'text' })).filter(f => f.key),
  })).filter(x => x.type);
  const known = DEFAULT_CONFIG.blocks;
  const blocks = (Array.isArray(c?.blocks) ? c.blocks : known).filter(b => known.includes(b) || custom.some(x => x.type === b)).slice(0, 40);
  return { v: 1, theme: { primary: hex(theme.primary, DEFAULT_CONFIG.theme.primary), secondary: hex(theme.secondary, DEFAULT_CONFIG.theme.secondary), font: ['system', 'serif', 'rounded', 'luxury'].includes(theme.font) ? theme.font : 'system', radius: Math.min(32, Math.max(0, +theme.radius || 12)), name: str(theme.name, 60), phone: str(theme.phone, 40) }, blocks, custom };
}

const J = text => { try { return JSON.parse(text); } catch { return null; } };
const asArr = v => Array.isArray(v) ? v : [];
const b = (type, props) => ({ id: 'b' + Math.random().toString(36).slice(2, 10), type, props });

/** Build starter pages from the client's existing site content (Keystatic-style JSON): home + one page per service. */
export async function importFromContent(store) {
  const files = await store.list();
  const read = async p => { const f = files.find(x => x.path === p) ? await store.read(p) : null; return f ? J(f.text) : null; };
  const site = await read('src/content/settings/site.json'), home = await read('src/content/settings/home.json');
  const phone = site?.business?.phoneDisplay || '', bizName = site?.business?.name || '';
  const reviewFiles = files.filter(f => f.path.startsWith('src/content/reviews/')).slice(0, 6);
  const reviews = [];
  for (const f of reviewFiles) { const d = J((await store.read(f.path))?.text || ''); if (d) reviews.push({ name: str(d.name || d.author || d.reviewer || '', 80), text: str(d.text || d.body || d.review || d.quote || '', 400), rating: +d.rating || 5, source: str(d.source || d.platform || '', 30) }); }
  const faqFiles = files.filter(f => f.path.startsWith('src/content/faqs/')).slice(0, 8), faqs = [];
  for (const f of faqFiles) { const d = J((await store.read(f.path))?.text || ''); if (d) faqs.push({ q: str(d.q || d.question || d.title || '', 200), a: str(d.a || d.answer || d.text || '', 800) }); }
  const cta = (title, text, btn) => b('cta', { title, text, buttonText: btn || 'Get a free quote', buttonLink: '/contact/' });
  const pages = [];
  if (home) {
    const blocks = [b('hero', { eyebrow: str(home.hero?.eyebrow, 120), title: str(home.hero?.title, 200), text: str(home.hero?.lead, 500), buttonText: str(home.hero?.formHeading || 'Get a free quote', 80), buttonLink: '/contact/', image: str(asArr(home.galleryStrip)[0] || '', 300) })];
    if (asArr(home.stats).length) blocks.push(b('stats', { items: asArr(home.stats).slice(0, 6).map(s => ({ value: str(s.value, 60), label: str(s.label, 80) })) }));
    if (asArr(home.services).length) blocks.push(b('services', { title: 'Our services', intro: '', items: asArr(home.services).slice(0, 12).map(s => ({ title: str(s.title, 80), text: str(s.text, 300), image: str(s.img, 300), link: str(s.href, 200) })) }));
    if (asArr(home.whyUs).length) blocks.push(b('features', { title: 'Why choose us', intro: '', items: asArr(home.whyUs).slice(0, 8).map(s => ({ title: str(s.title, 80), text: str(s.text, 300) })) }));
    if (asArr(home.process).length) blocks.push(b('steps', { title: 'How it works', items: asArr(home.process).slice(0, 8).map(s => ({ title: str(s.title, 80), text: str(s.text, 300) })) }));
    if (asArr(home.galleryStrip).length) blocks.push(b('gallery', { title: 'Recent work', images: asArr(home.galleryStrip).slice(0, 12).map(x => str(x, 300)) }));
    if (reviews.length) blocks.push(b('reviews', { title: 'What customers say', items: reviews }));
    if (faqs.length) blocks.push(b('faq', { title: 'Common questions', items: faqs }));
    blocks.push(cta('Ready to get started?', phone ? `Call ${phone} or send us your details for a free, no-obligation quote.` : 'Send us your details for a free, no-obligation quote.'));
    pages.push({ slug: 'home', title: 'Home', url: '/', seo: { title: str(home.seo?.title, 60), description: str(home.seo?.description, 155), focusKeyword: str(home.seo?.focusKeyword, 80) }, blocks });
  }
  for (const f of files.filter(x => /^src\/content\/services\/[\w-]+\.json$/.test(x.path))) {
    const d = J((await store.read(f.path))?.text || ''); if (!d) continue;
    const slug = f.path.split('/').pop().replace(/\.json$/, '');
    const blocks = [b('hero', { eyebrow: str(d.name, 80), title: str(d.h1 || d.name, 200), text: str(d.lead, 500), buttonText: str(d.formButton || 'Get a free quote', 80), buttonLink: '/contact/', image: str(asArr(d.images)[0] || '', 300) })];
    const intro = asArr(d.intro).map(x => str(x, 1200)).join('\n\n'); if (intro) blocks.push(b('text', { title: str(d.introTitle, 120), text: intro }));
    if (asArr(d.benefits).length) blocks.push(b('features', { title: str(d.benefitsTitle, 120), intro: '', items: asArr(d.benefits).slice(0, 8).map(x => ({ title: str(x.t, 80), text: str(x.d, 300) })) }));
    for (const sct of asArr(d.sections).slice(0, 8)) blocks.push(b('text', { title: str(sct.title, 120), text: asArr(sct.text).map(x => str(x, 1200)).join('\n\n') }));
    if (asArr(d.process).length) blocks.push(b('steps', { title: str(d.processTitle, 120), items: asArr(d.process).slice(0, 8).map(x => ({ title: str(x.t, 80), text: str(x.d, 300) })) }));
    if (asArr(d.images).length > 1) blocks.push(b('gallery', { title: 'Our work', images: asArr(d.images).slice(0, 12).map(x => str(x, 300)) }));
    if (asArr(d.faqs).length) blocks.push(b('faq', { title: 'Questions about ' + str(d.name, 60).toLowerCase(), items: asArr(d.faqs).slice(0, 10).map(x => ({ q: str(x.q, 200), a: str(x.a, 800) })) }));
    blocks.push(cta(str(d.formHeading || 'Get a free quote', 120), str(d.formIntro, 300), str(d.formButton, 80)));
    pages.push({ slug, title: str(d.name || slug, 120), url: `/${slug}/`, seo: { title: str(d.seo?.title, 60), description: str(d.seo?.description, 155), focusKeyword: str(d.seo?.focusKeyword, 80) }, blocks });
  }
  const theme = { ...DEFAULT_CONFIG.theme, name: bizName };
  return { pages, config: { ...DEFAULT_CONFIG, theme } };
}

/** Clients whose site already has builder pages: they can be copied as a template. */
async function templateSources(env, clientId) {
  try {
    const rows = (await env.DB.prepare(`SELECT DISTINCT f.client_id AS id FROM site_content_files f WHERE f.path = ?1 AND f.client_id <> ?2`).bind(BUILDER_DIR + 'home.json', clientId).all()).results || [];
    const names = (await env.DB.prepare(`SELECT json_extract(c.value,'$.id') AS id, json_extract(c.value,'$.name') AS name FROM workspace_documents w, json_each(w.data,'$.clients') c WHERE w.id='f2b-agency'`).all()).results || [];
    return rows.map(r => ({ id: r.id, name: names.find(n => n.id === r.id)?.name || 'Another client' }));
  } catch { return []; }
}

export async function builderAction(SiteError, env, clientId, req, { store, site, canWrite, isClient, actor, preview }) {
  const op = req.op;
  const mustWrite = () => { if (!canWrite) throw err(SiteError, 403, 'Only an agency owner or admin can edit website content.'); };
  const readConfig = async () => { const f = await store.read(CONFIG_PATH); const c = f ? J(f.text) : null; return { config: normalizeConfig(SiteError, c || { ...DEFAULT_CONFIG, theme: { ...DEFAULT_CONFIG.theme, name: '' } }), sha: f?.sha || null }; };
  if (op === 'builder-list') {
    const files = (await store.list()).filter(f => isBuilderPath(f.path) && f.path !== CONFIG_PATH);
    const pages = [];
    for (const f of files) { const r = await store.read(f.path); const d = J(r?.text || ''); if (!d) continue; pages.push({ slug: f.path.slice(BUILDER_DIR.length, -5), title: d.title || '', url: d.url || '', seo: d.seo || {}, blocks: (d.blocks || []).length, updatedAt: f.updated_at, updatedBy: f.updated_by, version: f.version }); }
    pages.sort((a, c) => (a.slug === 'home' ? -1 : c.slug === 'home' ? 1 : a.title.localeCompare(c.title)));
    const { config, sha } = await readConfig();
    return { ready: true, canWrite, role: isClient ? 'client' : canWrite ? 'admin' : 'staff', previewUrl: preview, pages, config, configSha: sha, imageDir: BUILDER_IMAGE_DIR, history: await store.history({ limit: 15 }), canImport: canWrite && !isClient && pages.length === 0 && (await store.list()).some(f => f.path.startsWith('src/content/')), canImportLive: canWrite && !isClient && pages.length === 0, templates: (canWrite && !isClient && pages.length === 0) ? await templateSources(env, clientId) : [] };
  }
  if (op === 'builder-read') {
    const slug = str(req.slug, 70); if (!SLUG_RE.test(slug)) throw err(SiteError, 400, 'Bad page name.');
    const path = pathForSlug(slug), f = await store.read(path); if (!f) throw err(SiteError, 404, 'Page not found.');
    return { slug, page: J(f.text), sha: f.sha, version: f.version, updatedAt: f.updated_at, updatedBy: f.updated_by, history: await store.history({ path, limit: 30 }) };
  }
  if (op === 'builder-import') {
    if (!canWrite || isClient) throw err(SiteError, 403, 'Only F2B Media can start the builder from the current site.');
    if ((await store.list()).some(f => isBuilderPath(f.path))) throw err(SiteError, 409, 'This site already has builder pages.');
    const { pages, config } = await importFromContent(store);
    if (!pages.length) throw err(SiteError, 404, 'No existing pages were found to start from. Use “New page” instead.');
    const changes = pages.map(p => ({ path: pathForSlug(p.slug), text: JSON.stringify(normalizePage(SiteError, p, p.slug), null, 2) }));
    changes.push({ path: CONFIG_PATH, text: JSON.stringify(normalizeConfig(SiteError, config), null, 2) });
    const c = await store.commit({ changes, message: `Visual builder: started from the current site (${pages.length} pages)`, actor, kind: 'import-builder' });
    return { imported: pages.length, version: c.version };
  }
  if (op === 'builder-import-live') {
    if (!canWrite || isClient) throw err(SiteError, 403, 'Only F2B Media can import a website.');
    if ((await store.list()).some(f => isBuilderPath(f.path))) throw err(SiteError, 409, 'This site already has builder pages.');
    let u; try { u = new URL(String(req.url || '').trim()); } catch { throw err(SiteError, 400, 'Enter the full website address, e.g. https://example.workers.dev'); }
    if (u.protocol !== 'https:' || !/^[a-z0-9-]+(\.[a-z0-9-]+)+$/i.test(u.hostname) || /^\d+(\.\d+){3}$/.test(u.hostname) || /(^|\.)(localhost|local|internal)$/i.test(u.hostname)) throw err(SiteError, 400, 'Only public https websites can be imported.');
    const { importLiveSite } = await import('./html-import');
    let pages; try { pages = await importLiveSite(u.origin); } catch (e) { throw err(SiteError, 502, `Could not read that website: ${String(e?.message || e).slice(0, 140)}`); }
    if (!pages.length) throw err(SiteError, 404, 'No pages found on that website.');
    const changes = pages.map(p => ({ path: pathForSlug(p.slug), text: JSON.stringify(normalizePage(SiteError, p, p.slug), null, 2) }));
    const theme = { ...DEFAULT_CONFIG.theme, name: str(req.businessName, 60) };
    if (/^#[0-9a-fA-F]{6}$/.test(String(req.primary || ''))) theme.primary = req.primary;
    if (/^#[0-9a-fA-F]{6}$/.test(String(req.secondary || ''))) theme.secondary = req.secondary;
    changes.push({ path: CONFIG_PATH, text: JSON.stringify(normalizeConfig(SiteError, { ...DEFAULT_CONFIG, theme }), null, 2) });
    await env.DB.prepare('UPDATE site_content_sites SET preview_url = CASE WHEN preview_url = \'\' THEN ?2 ELSE preview_url END WHERE client_id = ?1').bind(clientId, u.origin).run();
    const c = await store.commit({ changes, message: `Visual builder: imported ${pages.length} pages from ${u.hostname}`, actor, kind: 'import-builder' });
    return { imported: pages.length, version: c.version };
  }
  if (op === 'builder-template') {
    if (!canWrite || isClient) throw err(SiteError, 403, 'Only F2B Media can create a site from a template.');
    if ((await store.list()).some(f => isBuilderPath(f.path))) throw err(SiteError, 409, 'This site already has builder pages.');
    const from = str(req.sourceClientId, 80); if (!/^[\w-]{6,80}$/.test(from) || from === clientId) throw err(SiteError, 400, 'Choose a template site.');
    const src = (await templateSources(env, clientId)).find(x => x.id === from); if (!src) throw err(SiteError, 404, 'That template has no builder pages yet. Open it in the builder and start it first.');
    const { d1Store } = await import('./site-content-core');
    const srcStore = d1Store(env.DB, env.BUCKET, from);
    const files = (await srcStore.list()).filter(f => isBuilderPath(f.path));
    const cfgSrc = J((await srcStore.read(CONFIG_PATH))?.text || '') || DEFAULT_CONFIG;
    const name = str(req.businessName, 60), srcName = str(cfgSrc?.theme?.name || src.name, 60);
    const swap = t => (srcName && name) ? t.split(srcName).join(name) : t;
    const changes = [];
    for (const f of files) { if (f.path === CONFIG_PATH) continue; const r = await srcStore.read(f.path); if (r?.text) changes.push({ path: f.path, text: swap(r.text) }); }
    const theme = { ...(cfgSrc.theme || {}), name, phone: str(req.phone, 40) };
    if (/^#[0-9a-fA-F]{6}$/.test(String(req.primary || ''))) theme.primary = req.primary;
    if (/^#[0-9a-fA-F]{6}$/.test(String(req.secondary || ''))) theme.secondary = req.secondary;
    changes.push({ path: CONFIG_PATH, text: JSON.stringify(normalizeConfig(SiteError, { ...cfgSrc, theme }), null, 2) });
    const c = await store.commit({ changes, message: `Visual builder: created from the ${src.name} template (${files.length - (files.some(f => f.path === CONFIG_PATH) ? 1 : 0)} pages)`, actor, kind: 'import-builder' });
    return { imported: changes.length - 1, version: c.version };
  }
  if (op === 'builder-save') {
    mustWrite();
    const slug = str(req.slug, 70);
    if (slug === '_config') {
      if (isClient) throw err(SiteError, 403, 'Only F2B Media can change the builder style and sections.');
      const text = JSON.stringify(normalizeConfig(SiteError, req.page), null, 2), cur = await store.read(CONFIG_PATH);
      if (req.baseSha && cur && req.baseSha !== cur.sha) throw err(SiteError, 409, 'The style settings changed. Reload and try again.');
      if (cur && cur.text === text) return { unchanged: true };
      const c = await store.commit({ changes: [{ path: CONFIG_PATH, text }], message: 'Visual builder: update site style and sections', actor, expect: cur ? { [CONFIG_PATH]: cur.sha } : {} });
      return { saved: true, version: c.version, at: c.at, sha: (await store.read(CONFIG_PATH)).sha };
    }
    if (!SLUG_RE.test(slug)) throw err(SiteError, 400, 'The page name can only use lowercase letters, numbers and dashes.');
    const path = pathForSlug(slug), cur = await store.read(path);
    if (cur && req.baseSha !== cur.sha) throw err(SiteError, 409, 'Someone saved this page after you opened it. Reload to see their changes, then edit again.');
    if (!cur && isClient && !req.allowNew) throw err(SiteError, 403, 'Your login can edit existing pages. Ask F2B Media to add a new page.');
    const page = normalizePage(SiteError, req.page, slug);
    const { config } = await readConfig(); const allowed = new Set([...config.blocks, ...config.custom.map(x => x.type)]);
    for (const blk of page.blocks) if (!allowed.has(blk.type)) throw err(SiteError, 400, `The “${blk.type}” section is not turned on for this site.`);
    const clash = (await store.list()).filter(f => isBuilderPath(f.path) && f.path !== path && f.path !== CONFIG_PATH);
    for (const f of clash) { const d = J((await store.read(f.path))?.text || ''); if (d?.url === page.url) throw err(SiteError, 409, `Another page already uses the address ${page.url}.`); }
    const text = JSON.stringify(page, null, 2);
    if (text.length > MAX_TEXT) throw err(SiteError, 400, 'This page is too large to save.');
    if (cur && cur.text === text) return { unchanged: true, sha: cur.sha };
    const message = str(req.message, 160) || (cur ? `Builder: edit ${page.title}` : `Builder: new page ${page.title}`);
    const c = await store.commit({ changes: [{ path, text }], message: isClient ? `Client edit · ${message}` : message, actor, expect: cur ? { [path]: cur.sha } : {} });
    let approvalId = null;
    if (isClient) { approvalId = await createApproval(env.DB, { clientId, version: c.version, path, message, actor, beforeText: cur?.text || '', afterText: text }); await logClientEvent(env.DB, clientId, actor, 'save', `v${c.version} · ${message}`); }
    return { saved: true, approvalId, needsApproval: isClient, path, version: c.version, at: c.at, sha: (await store.read(path)).sha, page, previewNote: 'Saved to the preview working copy. Nothing goes to the live site.' };
  }
  throw err(SiteError, 400, 'Unknown action.');
}
