// @ts-nocheck  (plain JS module, shared with the companion worker and tested in node; kept as-is)
// F2B Agency OS · in-app website content editor: shared core (companion worker + app route /api/client-site).
// Storage is swappable: d1Store (interim working copy in D1 + R2, per client, with versions) or githubStore
// (GitHub contents/git-data API on a PREVIEW branch only). No code path here can write to a live branch or a live domain.
import { createApproval, listApprovals, decideApproval, logClientEvent } from '../client-accounts/client-users-core';
import { parse as yamlParse, dump as yamlDump } from './yaml-lite';

export class SiteError extends Error { constructor(status, msg, extra) { super(msg); this.status = status; this.extra = extra; } }
const nowIso = () => new Date().toISOString();
const str = (v, n) => String(v ?? '').slice(0, n);
export const LIMITS = { imageBytes: 2 * 1024 * 1024, textBytes: 400 * 1024, importFiles: 400, message: 200 };
const IMAGE_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/avif': 'avif', 'image/gif': 'gif' };
const FORBIDDEN_BRANCHES = /^(main|master|live|prod|production|release|gh-pages)$/i;

export async function sha(bytes) {
  const d = await crypto.subtle.digest('SHA-256', typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes);
  return [...new Uint8Array(d)].slice(0, 20).map(b => b.toString(16).padStart(2, '0')).join('');
}
export function sniffImage(b) {
  const h = [...b.slice(0, 16)];
  if (h[0] === 0xff && h[1] === 0xd8 && h[2] === 0xff) return 'image/jpeg';
  if (h[0] === 0x89 && h[1] === 0x50 && h[2] === 0x4e && h[3] === 0x47) return 'image/png';
  if (h[0] === 0x47 && h[1] === 0x49 && h[2] === 0x46) return 'image/gif';
  if (String.fromCharCode(...h.slice(0, 4)) === 'RIFF' && String.fromCharCode(...h.slice(8, 12)) === 'WEBP') return 'image/webp';
  if (String.fromCharCode(...h.slice(4, 12)) === 'ftypavif') return 'image/avif';
  return null;
}

// ---------------- schema / entries ----------------
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,120}$/;
export function entryFiles(schema, paths) {
  // Map stored file paths onto schema entries. Returns [{key,label,type,items:[{slug,path}]}].
  const out = [];
  for (const e of schema.entries) {
    if (e.type === 'singleton') { const p = e.path + e.ext; out.push({ key: e.key, label: e.label, type: e.type, items: paths.has(p) ? [{ slug: null, path: p }] : [] }); continue; }
    const dir = e.path.replace(/\*$/, '');
    const items = [...paths].filter(p => p.startsWith(dir) && p.endsWith(e.ext) && SLUG_RE.test(p.slice(dir.length, -e.ext.length))).sort()
      .map(p => ({ slug: p.slice(dir.length, -e.ext.length), path: p }));
    out.push({ key: e.key, label: e.label, type: e.type, slugField: e.slugField, items });
  }
  return out;
}
export function entryForPath(schema, path) {
  for (const e of schema.entries) {
    if (e.type === 'singleton' && path === e.path + e.ext) return { entry: e, slug: null };
    if (e.type === 'collection') { const dir = e.path.replace(/\*$/, ''); if (path.startsWith(dir) && path.endsWith(e.ext) && SLUG_RE.test(path.slice(dir.length, -e.ext.length))) return { entry: e, slug: path.slice(dir.length, -e.ext.length) }; }
  }
  return null;
}
export function imageDirs(schema, extra = []) {
  const dirs = new Set(extra.filter(d => /^public\/images\/[a-z0-9_-]{1,40}$/.test(d)));
  const walk = f => { if (!f || typeof f !== 'object') return; if (f.kind === 'image' && /^public\/images\/[a-z0-9_-]{1,40}$/.test(f.directory)) dirs.add(f.directory); if (f.fields) Object.values(f.fields).forEach(walk); if (f.element) walk(f.element); };
  for (const e of schema.entries) Object.values(e.schema).forEach(walk);
  return [...dirs].sort();
}

export function parseEntry(entry, text) {
  if (!entry.frontmatter) { const data = JSON.parse(text); return { data, body: null }; }
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { data: {}, body: text };
  return { data: yamlParse(m[1]), body: m[2].replace(/^\n/, '') };
}
export function serializeEntry(entry, data, body, prevText = '') {
  if (!entry.frontmatter) {
    const indent = (prevText.match(/^\{\n( +)"/) || [, '  '])[1].length;
    return JSON.stringify(data, null, indent) + (prevText && !prevText.endsWith('\n') ? '' : '\n');
  }
  const { [entry.contentField]: _drop, ...fm } = data || {};
  return `---\n${yamlDump(fm)}---\n\n${String(body ?? '').replace(/^\n+/, '')}`;
}

// Validate data against the schema. Collects field errors; returns { errors, labels } (labels for changed fields).
export function validateData(entry, data) {
  const errors = [];
  const walk = (f, v, path) => {
    if (!f) return;
    const at = path.join('.');
    switch (f.kind) {
      case 'text': if (v != null && typeof v !== 'string') errors.push([at, `${f.label}: must be text`]); else if (f.maxLength && (v || '').length > f.maxLength) errors.push([at, `${f.label}: ${v.length}/${f.maxLength} characters`]); break;
      case 'slug': if (typeof v !== 'string' || !v.trim()) errors.push([at, `${f.label}: required`]); break;
      case 'integer': if (v != null && v !== '' && !Number.isInteger(v)) errors.push([at, `${f.label}: whole number`]); else if (v != null && ((f.min != null && v < f.min) || (f.max != null && v > f.max))) errors.push([at, `${f.label}: ${f.min}–${f.max}`]); break;
      case 'number': if (v != null && v !== '' && typeof v !== 'number') errors.push([at, `${f.label}: number`]); break;
      case 'checkbox': if (v != null && typeof v !== 'boolean') errors.push([at, `${f.label}: yes/no`]); break;
      case 'select': if (v != null && v !== '' && !(f.options || []).some(o => o.value === v)) errors.push([at, `${f.label}: not an option`]); break;
      case 'url': if (v && !/^https?:\/\/\S+$/.test(v)) errors.push([at, `${f.label}: must be a web address`]); break;
      case 'image': if (v && !(typeof v === 'string' && /^\/[\w\-./]+$/.test(v) && !v.includes('..'))) errors.push([at, `${f.label}: invalid image path`]); break;
      case 'date': if (v && !/^\d{4}-\d\d-\d\d$/.test(v)) errors.push([at, `${f.label}: YYYY-MM-DD`]); break;
      case 'object': if (v != null && (typeof v !== 'object' || Array.isArray(v))) errors.push([at, `${f.label}: group`]); else for (const [k, sf] of Object.entries(f.fields || {})) walk(sf, v?.[k], [...path, k]); break;
      case 'array': if (v != null && !Array.isArray(v)) errors.push([at, `${f.label}: list`]); else (v || []).forEach((x, i) => walk(f.element, x, [...path, i])); break;
      default: break;
    }
  };
  for (const [k, f] of Object.entries(entry.schema)) if (k !== entry.contentField) walk(f, data?.[k], [k]);
  return errors;
}
export function changedLabels(entry, before, after, bodyChanged) {
  const out = [];
  for (const [k, f] of Object.entries(entry.schema)) {
    if (k === entry.contentField) { if (bodyChanged) out.push(f.label || 'Article'); continue; }
    if (JSON.stringify(before?.[k]) === JSON.stringify(after?.[k])) continue;
    if (f.kind === 'object' && f.fields) { const sub = Object.entries(f.fields).filter(([sk]) => JSON.stringify(before?.[k]?.[sk]) !== JSON.stringify(after?.[k]?.[sk])).map(([, sf]) => sf.label); out.push(`${f.label}${sub.length && sub.length < 4 ? ` (${sub.join(', ')})` : ''}`); }
    else out.push(f.label || k);
  }
  return out;
}
const titleOf = (entry, data, slug) => {
  const v = entry.slugField ? data?.[entry.slugField] : null;
  return (typeof v === 'string' && v) || (v && v.name) || data?.h1 || data?.title || slug || entry.label;
};

// ---------------- interim store: D1 (+ R2 for images) ----------------
export const D1_SCHEMA = [
  `CREATE TABLE IF NOT EXISTS site_content_sites (client_id TEXT PRIMARY KEY NOT NULL, backend TEXT NOT NULL DEFAULT 'd1', schema_json TEXT NOT NULL, image_dirs TEXT NOT NULL DEFAULT '[]', preview_url TEXT NOT NULL DEFAULT '', repo TEXT NOT NULL DEFAULT '', branch TEXT NOT NULL DEFAULT '', baseline_version INTEGER NOT NULL DEFAULT 0, source_note TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)`,
  `CREATE TABLE IF NOT EXISTS site_content_versions (client_id TEXT NOT NULL, version INTEGER NOT NULL, kind TEXT NOT NULL, message TEXT NOT NULL, actor TEXT NOT NULL, created_at TEXT NOT NULL, paths TEXT NOT NULL DEFAULT '[]', undoes INTEGER, PRIMARY KEY (client_id, version))`,
  `CREATE TABLE IF NOT EXISTS site_content_revisions (client_id TEXT NOT NULL, version INTEGER NOT NULL, path TEXT NOT NULL, sha TEXT NOT NULL, size INTEGER NOT NULL DEFAULT 0, content_type TEXT NOT NULL DEFAULT 'text', text TEXT, r2_key TEXT, deleted INTEGER NOT NULL DEFAULT 0, PRIMARY KEY (client_id, version, path))`,
  `CREATE TABLE IF NOT EXISTS site_content_files (client_id TEXT NOT NULL, path TEXT NOT NULL, sha TEXT NOT NULL, size INTEGER NOT NULL DEFAULT 0, content_type TEXT NOT NULL DEFAULT 'text', text TEXT, r2_key TEXT, version INTEGER NOT NULL, updated_at TEXT NOT NULL, updated_by TEXT NOT NULL, PRIMARY KEY (client_id, path))`,
  `CREATE INDEX IF NOT EXISTS site_content_revisions_path_idx ON site_content_revisions (client_id, path, version DESC)`,
];

export function d1Store(db, bucket, clientId) {
  const C = clientId;
  return {
    backend: 'd1',
    async list() {
      return ((await db.prepare(`SELECT path, sha, size, content_type, version, updated_at, updated_by FROM site_content_files WHERE client_id = ?1`).bind(C).all()).results || []);
    },
    async read(path) {
      const r = await db.prepare(`SELECT path, sha, size, content_type, text, r2_key, version, updated_at, updated_by FROM site_content_files WHERE client_id = ?1 AND path = ?2`).bind(C, path).first();
      return r || null;
    },
    async readBlob(shaHex) {
      const r = await db.prepare(`SELECT r2_key, content_type FROM site_content_revisions WHERE client_id = ?1 AND sha = ?2 AND r2_key IS NOT NULL LIMIT 1`).bind(C, shaHex).first();
      if (!r || !bucket) return null;
      const o = await bucket.get(r.r2_key); return o ? { body: o.body, contentType: r.content_type } : null;
    },
    async head() { return (await db.prepare(`SELECT COALESCE(MAX(version), 0) AS v FROM site_content_versions WHERE client_id = ?1`).bind(C).first())?.v || 0; },
    /** changes: [{path, text} | {path, bytes, contentType}] — one version per call. */
    async commit({ changes, message, actor, kind = 'save', undoes = null, expect = {} }) {
      const at = nowIso();
      const rows = [];
      for (const c of changes) {
        if (c.bytes) {
          const h = await sha(c.bytes); const key = `site-content/${C}/blobs/${h}`;
          if (!bucket) throw new SiteError(503, 'Image storage is not configured.');
          await bucket.put(key, c.bytes, { httpMetadata: { contentType: c.contentType } });
          rows.push({ path: c.path, sha: h, size: c.bytes.byteLength, ct: c.contentType, text: null, r2: key });
        } else rows.push({ path: c.path, sha: await sha(c.text), size: new TextEncoder().encode(c.text).byteLength, ct: 'text', text: c.text, r2: null });
      }
      for (let attempt = 0; attempt < 5; attempt++) {
        for (const r of rows) if (expect[r.path] !== undefined) {
          const cur = await db.prepare(`SELECT sha FROM site_content_files WHERE client_id = ?1 AND path = ?2`).bind(C, r.path).first();
          if ((cur?.sha || null) !== expect[r.path]) throw new SiteError(409, 'Someone saved this page after you opened it. Reload to see their changes, then edit again.', { path: r.path });
        }
        const v = (await this.head()) + 1;
        const stmts = [db.prepare(`INSERT INTO site_content_versions (client_id, version, kind, message, actor, created_at, paths, undoes) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)`)
          .bind(C, v, kind, str(message, LIMITS.message), str(actor, 120), at, JSON.stringify(rows.map(r => r.path)), undoes)];
        for (const r of rows) {
          stmts.push(db.prepare(`INSERT INTO site_content_revisions (client_id, version, path, sha, size, content_type, text, r2_key) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)`).bind(C, v, r.path, r.sha, r.size, r.ct, r.text, r.r2));
          stmts.push(db.prepare(`INSERT INTO site_content_files (client_id, path, sha, size, content_type, text, r2_key, version, updated_at, updated_by) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)
            ON CONFLICT (client_id, path) DO UPDATE SET sha=excluded.sha, size=excluded.size, content_type=excluded.content_type, text=excluded.text, r2_key=excluded.r2_key, version=excluded.version, updated_at=excluded.updated_at, updated_by=excluded.updated_by`)
            .bind(C, r.path, r.sha, r.size, r.ct, r.text, r.r2, v, at, str(actor, 120)));
        }
        try { await db.batch(stmts); return { version: v, at, paths: rows.map(r => r.path) }; }
        catch (e) { if (!/UNIQUE|PRIMARY KEY|constraint/i.test(String(e?.message || e))) throw e; }
      }
      throw new SiteError(409, 'Busy saving, please try again.');
    },
    async history({ path = null, limit = 30 } = {}) {
      const r = path
        ? await db.prepare(`SELECT v.version, v.kind, v.message, v.actor, v.created_at, v.paths, v.undoes, r.sha FROM site_content_revisions r JOIN site_content_versions v ON v.client_id = r.client_id AND v.version = r.version WHERE r.client_id = ?1 AND r.path = ?2 ORDER BY r.version DESC LIMIT ?3`).bind(C, path, limit).all()
        : await db.prepare(`SELECT version, kind, message, actor, created_at, paths, undoes FROM site_content_versions WHERE client_id = ?1 ORDER BY version DESC LIMIT ?2`).bind(C, limit).all();
      return (r.results || []).map(x => ({ ...x, paths: JSON.parse(x.paths || '[]') }));
    },
    async revisionBefore(path, version) {
      return await db.prepare(`SELECT version, sha, content_type, text, r2_key, deleted FROM site_content_revisions WHERE client_id = ?1 AND path = ?2 AND version < ?3 ORDER BY version DESC LIMIT 1`).bind(C, path, version).first();
    },
    async revisionAt(path, version) {
      return await db.prepare(`SELECT version, sha, content_type, text, r2_key FROM site_content_revisions WHERE client_id = ?1 AND path = ?2 AND version <= ?3 ORDER BY version DESC LIMIT 1`).bind(C, path, version).first();
    },
    async exportSince(since = 0) {
      const files = ((await db.prepare(`SELECT path, sha, size, content_type, text, version FROM site_content_files WHERE client_id = ?1 AND version > ?2 ORDER BY path`).bind(C, since).all()).results || []);
      return { head: await this.head(), files };
    },
  };
}

// ---------------- later: GitHub backend (preview branch only) ----------------
export function githubStore({ repo, branch, token, fetchImpl = fetch, contentRoot = '' }) {
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo || '')) throw new SiteError(503, 'GitHub repo is not configured (owner/name).');
  if (!branch || FORBIDDEN_BRANCHES.test(branch)) throw new SiteError(403, `Refusing to use branch "${branch}". The editor only writes to a preview branch.`);
  if (!token) throw new SiteError(503, 'GitHub token secret is not set.');
  const api = async (method, p, body) => {
    const r = await fetchImpl(`https://api.github.com/repos/${repo}${p}`, { method, headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'x-github-api-version': '2022-11-28', 'user-agent': 'f2b-agency-os', ...(body ? { 'content-type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
    const j = r.status === 204 ? {} : await r.json().catch(() => ({}));
    if (!r.ok) throw new SiteError(r.status === 409 || r.status === 422 ? 409 : 502, `GitHub: ${j.message || r.status}`);
    return j;
  };
  let checked = false;
  const guard = async () => {
    if (checked) return; const info = await api('GET', '');
    if (info.default_branch === branch) throw new SiteError(403, `"${branch}" is the repo's default (live) branch. The editor only writes to a preview branch.`);
    checked = true;
  };
  const b64 = bytes => { let s = ''; const u = bytes instanceof Uint8Array ? bytes : new TextEncoder().encode(bytes); for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode(...u.subarray(i, i + 0x8000)); return btoa(s); };
  const fromB64 = s => new TextDecoder().decode(Uint8Array.from(atob(s.replace(/\n/g, '')), c => c.charCodeAt(0)));
  return {
    backend: 'github',
    async list() { await guard(); const ref = await api('GET', `/git/trees/${encodeURIComponent(branch)}?recursive=1`); return (ref.tree || []).filter(t => t.type === 'blob' && /^(src\/content|public\/images)\//.test(t.path)).map(t => ({ path: t.path, sha: t.sha, size: t.size, content_type: t.path.startsWith('public/') ? 'image' : 'text', version: null, updated_at: null, updated_by: null })); },
    async read(path) { await guard(); const f = await api('GET', `/contents/${path}?ref=${encodeURIComponent(branch)}`); return { path, sha: f.sha, size: f.size, content_type: 'text', text: fromB64(f.content || '') }; },
    async head() { await guard(); return (await api('GET', `/git/ref/heads/${encodeURIComponent(branch)}`)).object.sha; },
    async commit({ changes, message, actor, expect = {} }) {
      await guard();
      const ref = await api('GET', `/git/ref/heads/${encodeURIComponent(branch)}`);
      const parent = await api('GET', `/git/commits/${ref.object.sha}`);
      for (const [p, s] of Object.entries(expect)) { const cur = await api('GET', `/contents/${p}?ref=${ref.object.sha}`).catch(() => null); if ((cur?.sha || null) !== s) throw new SiteError(409, 'Someone saved this page after you opened it. Reload, then edit again.', { path: p }); }
      const tree = [];
      for (const c of changes) { const blob = await api('POST', '/git/blobs', { content: b64(c.bytes || c.text), encoding: 'base64' }); tree.push({ path: c.path, mode: '100644', type: 'blob', sha: blob.sha }); }
      const t = await api('POST', '/git/trees', { base_tree: parent.tree.sha, tree });
      const commit = await api('POST', '/git/commits', { message: `${str(message, LIMITS.message)}\n\nSaved from Agency OS by ${actor}`, tree: t.sha, parents: [ref.object.sha] });
      await api('PATCH', `/git/refs/heads/${encodeURIComponent(branch)}`, { sha: commit.sha, force: false });
      return { version: commit.sha, at: nowIso(), paths: changes.map(c => c.path) };
    },
    async history({ path = null, limit = 30 } = {}) { await guard(); const cs = await api('GET', `/commits?sha=${encodeURIComponent(branch)}&per_page=${limit}${path ? `&path=${encodeURIComponent(path)}` : ''}`); return cs.map(c => ({ version: c.sha, kind: 'save', message: c.commit.message.split('\n')[0], actor: (c.commit.message.match(/Saved from Agency OS by (.+)$/m) || [, c.commit.author?.name])[1], created_at: c.commit.author?.date, paths: path ? [path] : [] })); },
    async revisionBefore(path, version) { await guard(); const c = await api('GET', `/commits/${version}`); const p = c.parents?.[0]?.sha; if (!p) return null; const f = await api('GET', `/contents/${path}?ref=${p}`).catch(() => null); return f ? { version: p, sha: f.sha, content_type: 'text', text: fromB64(f.content || '') } : { deleted: 1 }; },
    async revisionAt(path, version) { await guard(); const f = await api('GET', `/contents/${path}?ref=${version}`).catch(() => null); return f ? { version, sha: f.sha, content_type: 'text', text: fromB64(f.content || '') } : null; },
    async readBlob() { return null; },
    async exportSince() { throw new SiteError(400, 'With GitHub the preview builds straight from the branch; no export needed.'); },
  };
}

// ---------------- site API (shared by companion + app route) ----------------
export async function getSite(db, clientId) {
  const s = await db.prepare(`SELECT * FROM site_content_sites WHERE client_id = ?1`).bind(clientId).first().catch(e => { if (/no such table/i.test(String(e?.message))) return null; throw e; });
  if (!s) return null;
  return { ...s, schema: JSON.parse(s.schema_json), imageDirs: JSON.parse(s.image_dirs || '[]') };
}
export function storeFor(site, env, clientId) {
  if (site.backend === 'github') return githubStore({ repo: site.repo, branch: site.branch, token: env.GITHUB_CONTENT_TOKEN });
  return d1Store(env.DB, env.BUCKET, clientId);
}

/** Box-side seed: schema + all content files (text) from the repo. Refuses to overwrite edits unless force. */
export async function importSite(env, clientId, body, actor) {
  for (const s of D1_SCHEMA) await env.DB.prepare(s).run();
  const schema = body.schema;
  if (!schema || !Array.isArray(schema.entries) || !schema.entries.length) throw new SiteError(400, 'schema.entries missing.');
  const files = Array.isArray(body.files) ? body.files : [];
  if (files.length > LIMITS.importFiles) throw new SiteError(400, 'Too many files.');
  if (body.previewUrl && !/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}\/?$/i.test(String(body.previewUrl))) throw new SiteError(400, 'previewUrl must be an https address.');
  const prev = await getSite(env.DB, clientId);
  const store = d1Store(env.DB, env.BUCKET, clientId);
  const head = await store.head();
  if (prev && head > prev.baseline_version && !body.force) throw new SiteError(409, `The working copy has ${head - prev.baseline_version} saved edit(s) since the last import. Pull them into the repo first, or pass force.`);
  const changes = [];
  for (const f of files) {
    if (!entryForPath(schema, f.path)) continue;                       // only content entries
    if (typeof f.text !== 'string' || f.text.length > LIMITS.textBytes) throw new SiteError(400, `Bad file ${f.path}`);
    const cur = await store.read(f.path);
    if (!cur || cur.text !== f.text) changes.push({ path: f.path, text: f.text });
  }
  const at = nowIso();
  const dirs = imageDirs(schema, body.imageDirs || []);
  let version = head;
  if (changes.length) version = (await store.commit({ changes, message: str(body.message || `Import from ${body.source || 'site repo'}`, 200), actor, kind: 'import' })).version;
  await env.DB.prepare(`INSERT INTO site_content_sites (client_id, backend, schema_json, image_dirs, preview_url, baseline_version, source_note, created_at, updated_at) VALUES (?1,'d1',?2,?3,?4,?5,?6,?7,?7)
    ON CONFLICT (client_id) DO UPDATE SET schema_json=excluded.schema_json, image_dirs=excluded.image_dirs, preview_url=CASE WHEN excluded.preview_url<>'' THEN excluded.preview_url ELSE site_content_sites.preview_url END, baseline_version=excluded.baseline_version, source_note=excluded.source_note, updated_at=excluded.updated_at`)
    .bind(clientId, JSON.stringify(schema), JSON.stringify(dirs), str(body.previewUrl, 300), version, str(body.source, 300), at).run();
  return { clientId, imported: changes.length, unchanged: files.length - changes.length, version, imageDirs: dirs };
}

export async function siteAction(env, clientId, req, { canWrite, actor, previewBase = '', role = canWrite ? 'admin' : 'staff' }) {
  const isClient = role === 'client';
  const site = await getSite(env.DB, clientId);
  const op = req.op;
  if (!site) { if (op === 'overview') return { ready: false, message: 'Website content has not been imported for this client yet.' }; throw new SiteError(404, 'Website content has not been imported for this client yet.'); }
  const store = storeFor(site, env, clientId);
  const schema = site.schema;
  const preview = (site.preview_url || previewBase || '').replace(/\/$/, '');
  const pageUrl = (entry, slug) => {
    if (!preview) return '';
    if (entry.key === 'home') return preview + '/';
    if (entry.key === 'services' && slug) return `${preview}/${slug}/`;
    if (entry.key === 'blog' && slug) return `${preview}/blog/${slug}/`;
    if (entry.key === 'areas') return `${preview}/service-areas/`;
    return preview + '/';
  };
  const mustWrite = () => { if (!canWrite) throw new SiteError(403, 'Only an agency owner or admin can edit website content.'); };
  const mustAdmin = () => { if (!canWrite || isClient) throw new SiteError(403, 'Only F2B Media can do this.'); };

  if (op === 'overview') {
    const files = await store.list();
    const byPath = new Map(files.map(f => [f.path, f]));
    const groups = entryFiles(schema, new Set(files.filter(f => f.content_type === 'text').map(f => f.path)));
    for (const g of groups) for (const it of g.items) { const f = byPath.get(it.path); Object.assign(it, { updatedAt: f?.updated_at, updatedBy: f?.updated_by, version: f?.version }); }
    // titles + SEO summary come from the stored JSON/frontmatter (cheap: files are small)
    for (const g of groups) {
      const e = schema.entries.find(x => x.key === g.key);
      for (const it of g.items) {
        const f = await store.read(it.path);
        try { const { data } = parseEntry(e, f.text); it.title = titleOf(e, data, it.slug); const s = data.seo || null; it.seo = s ? { title: s.title || '', description: s.description || '', focusKeyword: s.focusKeyword || '' } : null; it.url = pageUrl(e, it.slug); }
        catch { it.title = it.slug || e.label; it.error = 'Could not read this file'; }
      }
    }
    const hist = await store.history({ limit: 15 });
    return { ready: true, backend: site.backend, previewUrl: preview, canWrite, canUndo: canWrite && !isClient, role, pendingApprovals: isClient ? undefined : (await listApprovals(env.DB, clientId, { status: 'pending', limit: 100 })).length, navigation: schema.navigation, groups, entries: schema.entries.map(e => ({ key: e.key, label: e.label, type: e.type })), history: hist, baselineVersion: site.baseline_version, imageDirs: site.imageDirs, limits: { imageBytes: LIMITS.imageBytes } };
  }
  if (op === 'read') {
    const path = str(req.path, 300); const hit = entryForPath(schema, path); if (!hit) throw new SiteError(400, 'Not an editable page.');
    const f = await store.read(path); if (!f) throw new SiteError(404, 'Page not found in the working copy.');
    const { data, body } = parseEntry(hit.entry, f.text);
    return { path, entryKey: hit.entry.key, slug: hit.slug, schema: hit.entry, data, body, sha: f.sha, updatedAt: f.updated_at, updatedBy: f.updated_by, version: f.version, url: pageUrl(hit.entry, hit.slug), history: await store.history({ path, limit: 20 }) };
  }
  if (op === 'save') {
    mustWrite();
    const path = str(req.path, 300); const hit = entryForPath(schema, path); if (!hit) throw new SiteError(400, 'Not an editable page.');
    const f = await store.read(path); if (!f) throw new SiteError(404, 'Page not found.');
    if (req.baseSha && req.baseSha !== f.sha) throw new SiteError(409, 'Someone saved this page after you opened it. Reload to see their changes, then edit again.');
    const before = parseEntry(hit.entry, f.text);
    const data = req.data && typeof req.data === 'object' ? req.data : before.data;
    if (hit.entry.slugField && typeof before.data[hit.entry.slugField] === 'string' && data[hit.entry.slugField] !== before.data[hit.entry.slugField] && !String(data[hit.entry.slugField] || '').trim()) throw new SiteError(400, 'The page name cannot be empty.');
    const errs = validateData(hit.entry, data);
    if (errs.length) throw new SiteError(400, `Please fix: ${errs.slice(0, 4).map(e => e[1]).join('; ')}`, { fieldErrors: errs });
    const body = hit.entry.frontmatter ? String(req.body ?? before.body ?? '') : null;
    const text = serializeEntry(hit.entry, data, body, f.text);
    if (text.length > LIMITS.textBytes) throw new SiteError(400, 'This page is too large to save.');
    if (text === f.text) return { unchanged: true, path, sha: f.sha };
    const labels = changedLabels(hit.entry, before.data, data, hit.entry.frontmatter && body !== before.body);
    const title = titleOf(hit.entry, data, hit.slug);
    const message = str(req.message, 160) || `${hit.entry.type === 'collection' ? `${hit.entry.label.replace(/s$/, '')}: ${title}` : hit.entry.label}: edit ${labels.join(', ') || 'content'}`;
    const c = await store.commit({ changes: [{ path, text }], message: isClient ? `Client edit · ${message}` : message, actor, expect: { [path]: f.sha } });
    let approvalId = null;
    if (isClient) { approvalId = await createApproval(env.DB, { clientId, version: c.version, path, message, actor, beforeText: f.text, afterText: text }); await logClientEvent(env.DB, clientId, actor, 'save', `v${c.version} · ${message}`); }
    return { saved: true, approvalId, needsApproval: isClient, path, version: c.version, at: c.at, message, sha: (await store.read(path)).sha, url: pageUrl(hit.entry, hit.slug), previewNote: site.backend === 'd1' ? 'Saved to the preview working copy. The preview site shows it after the next preview build.' : 'Saved to the preview branch. The preview rebuilds from it.' };
  }
  if (op === 'history') return { history: await store.history({ path: req.path ? str(req.path, 300) : null, limit: Math.min(+req.limit || 30, 100) }) };
  if (op === 'undo') {
    // Undo one save: put every file it touched back to how it was just before it (only if nobody changed it since).
    mustAdmin();
    const version = req.version; const h = (await store.history({ limit: 100 })).find(x => String(x.version) === String(version));
    if (!h) throw new SiteError(404, 'Version not found.');
    if (h.kind === 'import') throw new SiteError(400, 'The original import cannot be undone.');
    const changes = [], expect = {};
    for (const p of h.paths) {
      const cur = await store.read(p); const at = await store.revisionAt(p, version);
      if (!cur || !at || cur.sha !== at.sha) throw new SiteError(409, `“${p.split('/').pop()}” was changed again after that save. Undo the newer save first.`);
      const prev = await store.revisionBefore(p, version);
      if (!prev || prev.deleted || prev.content_type !== 'text') throw new SiteError(409, 'Nothing earlier to go back to for this file.');
      changes.push({ path: p, text: prev.text }); expect[p] = cur.sha;
    }
    const c = await store.commit({ changes, message: `Undo: ${h.message}`, actor, kind: 'undo', undoes: typeof version === 'number' ? version : null, expect });
    return { undone: version, version: c.version, at: c.at };
  }
  if (op === 'restore') {
    mustAdmin();
    const path = str(req.path, 300); if (!entryForPath(schema, path)) throw new SiteError(400, 'Not an editable page.');
    const at = await store.revisionAt(path, req.version); const cur = await store.read(path);
    if (!at || at.content_type !== 'text') throw new SiteError(404, 'That version of the page was not found.');
    if (cur.sha === at.sha) return { unchanged: true };
    const c = await store.commit({ changes: [{ path, text: at.text }], message: `Restore ${path.split('/').pop()} to version ${req.version}`, actor, kind: 'restore', expect: { [path]: cur.sha } });
    return { restored: req.version, version: c.version, at: c.at };
  }
  if (op === 'image') {
    mustWrite();
    const dir = str(req.dir, 80); if (!site.imageDirs.includes(dir)) throw new SiteError(400, `Images can go to: ${site.imageDirs.join(', ')}`);
    const bytes = req.bytes; if (!(bytes instanceof Uint8Array) || !bytes.byteLength) throw new SiteError(400, 'No image received.');
    if (bytes.byteLength > LIMITS.imageBytes) throw new SiteError(413, `Images must be ${LIMITS.imageBytes / 1048576} MB or smaller. Export a smaller JPG/WebP (about 1600 px wide is plenty).`);
    const type = sniffImage(bytes); if (!type) throw new SiteError(415, 'Use a JPG, PNG, WebP, AVIF or GIF image.');
    const base = str(req.name, 120).toLowerCase().replace(/\.[a-z0-9]+$/, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'image';
    const h = (await sha(bytes)).slice(0, 8);
    const path = `${dir}/${base}-${h}.${IMAGE_TYPES[type]}`;
    const exists = await store.read(path);
    if (!exists) await store.commit({ changes: [{ path, bytes, contentType: type }], message: `${isClient ? 'Client upload · ' : ''}Upload image ${path.split('/').pop()}`, actor, kind: 'image' });
    if (isClient) await logClientEvent(env.DB, clientId, actor, 'image', path);
    return { path, publicPath: '/' + path.replace(/^public\//, ''), size: bytes.byteLength, contentType: type, sha: h };
  }
  if (op === 'approvals') {
    if (isClient) return { approvals: (await listApprovals(env.DB, clientId, { status: 'all', limit: 30 })).filter(a => a.actor === String(actor).toLowerCase()).map(({ diff, ...a }) => a) };
    mustAdmin(); return { approvals: await listApprovals(env.DB, clientId, { status: req.status === 'all' ? 'all' : 'pending', limit: 50 }) };
  }
  if (op === 'decide') {
    mustAdmin();
    return await decideApproval(env, clientId, req.id, req.decision, actor, async version => siteAction(env, clientId, { op: 'undo', version }, { canWrite, actor, previewBase, role }));
  }
  if (op === 'export') { if (!req.coordinator) throw new SiteError(403, 'Export is for the sync script.'); return { ...(await store.exportSince(+req.since || 0)), pendingClientEdits: (await listApprovals(env.DB, clientId, { status: 'pending', limit: 100 })).length }; }
  throw new SiteError(400, 'Unknown action.');
}

/** Serve an uploaded (not yet built) image from the working copy so the editor can preview it. */
export async function workingImage(env, clientId, publicPath) {
  const site = await getSite(env.DB, clientId); if (!site || site.backend !== 'd1') return null;
  const path = 'public' + publicPath;
  const f = await d1Store(env.DB, env.BUCKET, clientId).read(path);
  if (!f || !f.r2_key || !env.BUCKET) return null;
  const o = await env.BUCKET.get(f.r2_key); return o ? { body: o.body, contentType: f.content_type } : null;
}
