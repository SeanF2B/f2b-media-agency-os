/* F2B Agency OS · in-app website content editor (Marketing → Websites).
 * Loaded on demand by f2b-client-switcher.js. Forms are generated from the site's Keystatic schema (no hardcoded field names).
 * Saves go ONLY to the client's preview working copy via /api/client-site. There is no publish / live path here. */
(() => {
  if (window.f2bSiteEditor) return;
  const API = '/api/client-site';
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const when = t => t ? new Date(t).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : '';
  const ago = t => { if (!t) return ''; const s = (Date.now() - new Date(t)) / 1000; return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86400 ? `${Math.round(s / 3600)} h ago` : when(t); };
  const who = a => String(a || '').replace(/@.*/, '').replace(/^cloudflare-access:/, '') || 'someone';
  const clone = o => JSON.parse(JSON.stringify(o ?? null));
  const getAt = (o, p) => p.reduce((x, k) => (x == null ? undefined : x[k]), o);
  const setAt = (o, p, v) => { let x = o; for (let i = 0; i < p.length - 1; i++) { if (x[p[i]] == null || typeof x[p[i]] !== 'object') x[p[i]] = typeof p[i + 1] === 'number' ? [] : {}; x = x[p[i]]; } x[p[p.length - 1]] = v; };
  const req = async (q, opt = {}) => {
    const r = await fetch(API + q, { cache: 'no-store', ...opt });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.error || `Request failed (${r.status})`); e.status = r.status; e.fieldErrors = j.fieldErrors; throw e; }
    return j;
  };
  const CSS = `
.f2b-se{border:1px solid var(--f2b-border,#dfe4e8);border-radius:14px;background:#fff;margin:0 0 16px;box-shadow:0 2px 10px #172b2808;overflow:hidden}
.f2b-se>header{display:flex;align-items:center;gap:10px;padding:12px 16px;border-bottom:1px solid #e8ece9;flex-wrap:wrap}
.f2b-se>header h3{margin:0;font-size:15px}.f2b-se>header .sub{font-size:12px;color:#6c7a73}
.f2b-se>header .r{margin-left:auto;display:flex;gap:8px;align-items:center}
.f2b-se .pill{font-size:11px;font-weight:800;border-radius:999px;padding:3px 9px;background:#fff3df;color:#9a6112;border:1px solid #f0d6a8}
.f2b-se .cols{display:grid;grid-template-columns:270px minmax(0,1fr);min-height:520px}
.f2b-se nav{border-right:1px solid #e8ece9;background:#fafcfa;padding:10px;overflow:auto;max-height:78vh}
.f2b-se nav input{width:100%;box-sizing:border-box;border:1px solid #dfe6e1;border-radius:9px;padding:7px 10px;font:inherit;font-size:13px;margin-bottom:8px}
.f2b-se nav h4{margin:12px 6px 4px;font-size:10px;letter-spacing:.12em;text-transform:uppercase;color:#7c8a83}
.f2b-se nav details{margin:2px 0}.f2b-se nav summary{cursor:pointer;font-size:13px;font-weight:700;padding:6px 8px;border-radius:8px;list-style:none;display:flex;gap:6px}
.f2b-se nav summary::-webkit-details-marker{display:none}.f2b-se nav summary:before{content:'▸';color:#9aa59f}.f2b-se nav details[open]>summary:before{content:'▾'}
.f2b-se nav summary .n{margin-left:auto;font-weight:600;color:#9aa59f;font-size:11px}
.f2b-se nav button.pg{display:flex;width:100%;text-align:left;gap:8px;align-items:center;border:0;background:none;padding:6px 8px 6px 10px;border-radius:8px;font:inherit;font-size:13px;cursor:pointer;color:inherit}
.f2b-se nav button.pg:hover{background:#eef3ef}.f2b-se nav button.pg.on{background:#173f35;color:#fff}
.f2b-se nav button.pg .t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.f2b-se .dot{width:8px;height:8px;border-radius:50%;flex:none;background:#c9d1cc}.f2b-se .dot.ok{background:#2f9e6a}.f2b-se .dot.warn{background:#e0a33a}.f2b-se .dot.bad{background:#d0473b}
.f2b-se main{padding:16px 20px;min-width:0;overflow:auto;max-height:78vh}
.f2b-se .empty{color:#6c7a73;font-size:13px;padding:40px 10px;text-align:center}
.f2b-se .bar{position:sticky;top:-16px;z-index:2;background:#fff;margin:-16px -20px 14px;padding:12px 20px;border-bottom:1px solid #e8ece9;display:flex;gap:10px;align-items:center;flex-wrap:wrap}
.f2b-se .bar h2{margin:0;font-size:17px}.f2b-se .bar .meta{font-size:12px;color:#6c7a73}
.f2b-se .bar .r{margin-left:auto;display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.f2b-se .bar button:disabled{opacity:.45;cursor:default}
.f2b-se .bar .dirty{font-size:12px;color:#9a6112;font-weight:700}
.f2b-se .banner{border-radius:10px;padding:10px 12px;margin:0 0 12px;font-size:13px}
.f2b-se .banner.ok{background:#e4f2eb;border:1px solid #c7e3d5;color:#1f5e41}.f2b-se .banner.err{background:#fdecea;border:1px solid #f3c7c2;color:#8d2a20}
.f2b-se .banner.info{background:#eef4fb;border:1px solid #d3e2f3;color:#2d4c6f}
.f2b-se .banner a{color:inherit;font-weight:800}
.f2b-se .card{border:1px solid #e3e9e5;border-radius:12px;padding:14px;margin:0 0 14px;background:#fff}
.f2b-se .card>h4{margin:0 0 10px;font-size:13px;display:flex;gap:8px;align-items:center}
.f2b-se .card.seo{border-color:#cfe0d6;background:#fbfdfb}
.f2b-se .f{display:grid;gap:4px;margin:0 0 12px}.f2b-se .f>label{font-size:12px;font-weight:700;color:#2c3a34;display:flex;gap:8px;align-items:baseline}
.f2b-se .f>label .cnt{margin-left:auto;font-weight:600;color:#7c8a83;font-variant-numeric:tabular-nums}.f2b-se .f>label .cnt.over{color:#d0473b}
.f2b-se .f .help{font-size:11px;color:#7c8a83;line-height:1.35}
.f2b-se .f input[type=text],.f2b-se .f input[type=url],.f2b-se .f input[type=number],.f2b-se .f input[type=date],.f2b-se .f select,.f2b-se .f textarea{width:100%;box-sizing:border-box;border:1px solid #d8e0db;border-radius:9px;padding:8px 10px;font:inherit;font-size:13px;background:#fff;color:inherit}
.f2b-se .f textarea{min-height:70px;resize:vertical;line-height:1.45}.f2b-se .f textarea.md{min-height:360px;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12.5px}
.f2b-se .f.err input,.f2b-se .f.err textarea{border-color:#d0473b;background:#fff8f7}.f2b-se .f .emsg{font-size:11px;color:#d0473b;font-weight:700}
.f2b-se .f.chk{grid-template-columns:auto 1fr;align-items:center}.f2b-se .f.chk label{font-weight:600}
.f2b-se .slug{font-size:12px;color:#6c7a73}.f2b-se .slug code{background:#eef3ef;border-radius:6px;padding:1px 6px}
.f2b-se fieldset{border:1px solid #e8ece9;border-radius:10px;padding:10px 12px 2px;margin:0 0 12px}.f2b-se legend{font-size:12px;font-weight:800;padding:0 6px}
.f2b-se .arr{display:grid;gap:8px;margin:0 0 12px}.f2b-se .arr>.lbl{font-size:12px;font-weight:800;display:flex;align-items:center;gap:8px}
.f2b-se .arr>.lbl .n{color:#9aa59f;font-weight:600}
.f2b-se .item{border:1px solid #e3e9e5;border-radius:10px;background:#fafcfa}
.f2b-se .item>summary{cursor:pointer;display:flex;gap:8px;align-items:center;padding:8px 10px;font-size:13px;font-weight:700;list-style:none}
.f2b-se .item>summary::-webkit-details-marker{display:none}.f2b-se .item>summary .t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.f2b-se .item>summary button{border:1px solid #dfe6e1;background:#fff;border-radius:7px;padding:2px 7px;font-size:12px;cursor:pointer;color:inherit}
.f2b-se .item>div{padding:4px 12px 2px;border-top:1px solid #e8ece9}
.f2b-se .simple{display:flex;gap:6px;align-items:center;margin:0 0 6px}.f2b-se .simple input{flex:1}
.f2b-se .simple button,.f2b-se .add{border:1px solid #dfe6e1;background:#fff;border-radius:8px;padding:5px 9px;font-size:12px;cursor:pointer;color:inherit}
.f2b-se .add{justify-self:start;font-weight:700}
.f2b-se .img{display:flex;gap:12px;align-items:center}.f2b-se .img .th{width:120px;height:72px;border-radius:8px;border:1px solid #dfe6e1;background:#eef3ef center/cover no-repeat;flex:none;display:grid;place-items:center;font-size:11px;color:#9aa59f}
.f2b-se .img .ctl{display:grid;gap:6px;min-width:0}.f2b-se .img code{font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.f2b-se .imgs{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px;margin:0 0 12px}
.f2b-se .imgs .img{flex-direction:column;align-items:stretch;border:1px solid #e3e9e5;border-radius:10px;padding:6px;gap:6px}.f2b-se .imgs .th{width:100%;height:90px}
.f2b-se .snip{border:1px solid #e3e9e5;border-radius:10px;padding:12px 14px;background:#fff;margin:0 0 12px;font-family:arial,sans-serif}
.f2b-se .snip .u{font-size:12px;color:#202124}.f2b-se .snip .h{font-size:19px;color:#1a0dab;margin:3px 0;line-height:1.3}.f2b-se .snip .d{font-size:13px;color:#4d5156;line-height:1.5}
.f2b-se .checks{display:grid;gap:4px;margin:0 0 12px;font-size:12px}.f2b-se .checks div{display:flex;gap:6px}
.f2b-se .tb{display:flex;gap:4px;flex-wrap:wrap;margin-bottom:6px}.f2b-se .tb button{border:1px solid #dfe6e1;background:#fff;border-radius:7px;padding:3px 8px;font-size:12px;cursor:pointer;color:inherit}
.f2b-se .mdprev{border:1px solid #e3e9e5;border-radius:9px;padding:6px 14px;max-height:420px;overflow:auto;font-size:14px;line-height:1.55}
.f2b-se pre.diff{margin:0;background:#f7f9f8;border:1px solid #e3e9e5;border-radius:9px;padding:8px 10px;font-size:11.5px;line-height:1.5;max-height:340px;overflow:auto;white-space:pre-wrap;word-break:break-word}
.f2b-se pre.diff span{display:block;min-height:1.5em}.f2b-se pre.diff .dadd{background:#e3f5ea;color:#145c36;display:block}.f2b-se pre.diff .ddel{background:#fdecea;color:#8d2a20;display:block;text-decoration:line-through;text-decoration-color:#d0473b66}
.dark-mode .f2b-se pre.diff{background:#1b1c1f;border-color:#45434a}.dark-mode .f2b-se pre.diff .dadd{background:#1d3a2a;color:#a6e3bd}.dark-mode .f2b-se pre.diff .ddel{background:#3d1f1c;color:#f3b0a8}
.f2b-se .hist{display:grid;gap:6px}.f2b-se .hist .v{display:flex;gap:10px;align-items:center;border:1px solid #e8ece9;border-radius:10px;padding:8px 10px;font-size:12px}
.f2b-se .hist .v .m{flex:1;min-width:0}.f2b-se .hist .v b{display:block;font-size:13px}.f2b-se .hist .v .k{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.08em;color:#7c8a83}
.f2b-se .hist .v button{border:1px solid #dfe6e1;background:#fff;border-radius:8px;padding:4px 9px;font-size:12px;cursor:pointer;color:inherit}
@media (max-width:980px){.f2b-se .cols{grid-template-columns:1fr}.f2b-se nav{border-right:0;border-bottom:1px solid #e8ece9;max-height:260px}}
.dark-mode .f2b-se,.dark-mode .f2b-se .card,.dark-mode .f2b-se .bar,.dark-mode .f2b-se .snip{background:#242629;border-color:#45434a}
.dark-mode .f2b-se nav,.dark-mode .f2b-se .item,.dark-mode .f2b-se .card.seo{background:#1d1f22;border-color:#45434a}
.dark-mode .f2b-se .f input,.dark-mode .f2b-se .f select,.dark-mode .f2b-se .f textarea,.dark-mode .f2b-se nav input,.dark-mode .f2b-se .item>summary button,.dark-mode .f2b-se .simple button,.dark-mode .f2b-se .add,.dark-mode .f2b-se .tb button,.dark-mode .f2b-se .hist .v button{background:#1b1c1f;border-color:#4a4950;color:#eee}
.dark-mode .f2b-se .f>label{color:#e6e6e6}.dark-mode .f2b-se nav button.pg:hover{background:#2c2f33}
.dark-mode .f2b-se .snip .h{color:#8ab4f8}.dark-mode .f2b-se .snip .u,.dark-mode .f2b-se .snip .d{color:#c9cdd1}
.dark-mode .f2b-se>header,.dark-mode .f2b-se .bar,.dark-mode .f2b-se nav,.dark-mode .f2b-se .item>div,.dark-mode .f2b-se fieldset,.dark-mode .f2b-se .hist .v{border-color:#45434a}
`;
  let cssOn = false;
  const ensureCss = () => { if (cssOn) return; cssOn = true; const s = document.createElement('style'); s.id = 'f2b-site-editor-css'; s.textContent = CSS; document.head.appendChild(s); };

  // ---------- tiny markdown preview (escape first; headings, bold/italic, links, lists, paragraphs) ----------
  const mdPreview = md => {
    const inline = t => esc(t).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/(^|\W)\*(?!\s)(.+?)\*(?=\W|$)/g, '$1<i>$2</i>').replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (m, a, u) => /^(https?:\/\/|\/|#)/.test(u.replace(/&amp;/g, '&')) ? `<a href="${u}" target="_blank" rel="noopener noreferrer">${a}</a>` : a);
    return String(md || '').split(/\n{2,}/).map(b => {
      const h = b.match(/^(#{1,4})\s+(.*)$/); if (h) return `<h${h[1].length + 1}>${inline(h[2])}</h${h[1].length + 1}>`;
      if (/^\s*([-*]|\d+\.)\s+/.test(b)) { const ol = /^\s*\d+\./.test(b); return `<${ol ? 'ol' : 'ul'}>${b.split('\n').filter(Boolean).map(l => `<li>${inline(l.replace(/^\s*([-*]|\d+\.)\s+/, ''))}</li>`).join('')}</${ol ? 'ol' : 'ul'}>`; }
      if (/^\{%/.test(b.trim())) return `<p style="color:#7c8a83;font-size:12px">[${esc(b.trim().slice(0, 80))}]</p>`;
      return `<p>${inline(b).replace(/\n/g, '<br>')}</p>`;
    }).join('');
  };

  // ---------- SEO helpers ----------
  const seoState = s => { if (!s) return ''; const t = (s.title || '').length, d = (s.description || '').length; if (!t || !d) return 'warn'; if (t > 60 || d > 155) return 'bad'; return 'ok'; };
  const fill = (tpl, item) => String(tpl || '').replace(/\{\{(\w+)\}\}/g, (m, k) => { const v = item?.[k]; return v == null ? '' : typeof v === 'object' ? (v.name || v.label || '') : String(v); }).trim();

  function mount(host, opts) {
    ensureCss();
    const st = { overview: null, page: null, data: null, body: null, dirty: false, q: '', errors: {}, banner: null, view: 'edit', mdPrev: false, openArr: new Set() };
    const canWrite = () => !!st.overview?.canWrite;
    const canUndo = () => !!st.overview?.canUndo;
    const isClient = () => st.overview?.role === 'client';
    const root = document.createElement('section'); root.className = 'f2b-se'; root.setAttribute('aria-label', `${opts.name} website content editor`);
    host.after(root);
    const q = (s) => root.querySelector(s);
    const imgSrc = p => !p ? '' : `${API}?clientId=${encodeURIComponent(opts.clientId)}&op=asset&path=${encodeURIComponent(p)}`;
    const beforeUnload = e => { if (st.dirty) { e.preventDefault(); e.returnValue = ''; } };
    window.addEventListener('beforeunload', beforeUnload);

    async function loadOverview() {
      root.innerHTML = `<header><h3>✏️ Site content & SEO</h3><span class="sub">Loading…</span></header>`;
      try { st.overview = await req(`?clientId=${encodeURIComponent(opts.clientId)}`); } catch (e) { root.innerHTML = `<header><h3>✏️ Site content & SEO</h3></header><div class="empty">${esc(e.message)}</div>`; return; }
      if (!st.overview.ready) { root.innerHTML = `<header><h3>✏️ Site content & SEO</h3></header><div class="empty">${esc(st.overview.message)}<br><small>The agency imports the site once from its repo (site-sync.mjs seed). After that every page is editable here.</small></div>`; return; }
      shell();
    }
    function shell() {
      const o = st.overview, last = o.history?.find(h => h.kind !== 'import');
      root.innerHTML = `<header><h3>✏️ ${o.role === 'client' ? 'Edit your website' : 'Site content & SEO'}</h3><span class="pill" title="Edits are saved to the preview copy of the site. Nothing goes to the live domain.">${o.role === 'client' ? '◐ Saves to preview · F2B approves' : '◐ Saves to preview only'}</span>
        <span class="sub">${last ? `Last saved by <b>${esc(who(last.actor))}</b> · ${esc(ago(last.created_at))}` : 'No edits yet'}${o.canWrite ? '' : ' · view only'}</span>
        <div class="r">${o.role === 'client' ? '<button type="button" class="secondary-button" data-a="mine">📨 My edits</button>' : o.canUndo ? `<button type="button" class="${o.pendingApprovals ? 'primary-button' : 'secondary-button'}" data-a="approvals">${o.pendingApprovals ? `🟠 Client edits to review (${o.pendingApprovals})` : '✅ Client edits'}</button>` : ''}<button type="button" class="secondary-button" data-a="allhist">🕘 All changes</button>${opts.embedded ? '' : '<button type="button" class="secondary-button" data-a="close">Close editor</button>'}</div></header>
        <div class="cols"><nav aria-label="Pages"></nav><main><div class="empty">Choose a page on the left to edit its text, images, sections and SEO.</div></main></div>`;
      root.querySelector('[data-a=close]')?.addEventListener('click', () => close());
      root.querySelector('[data-a=approvals]')?.addEventListener('click', () => { if (!guard()) return; st.page = null; st.view = 'approvals'; renderNav(); renderApprovals(); });
      root.querySelector('[data-a=mine]')?.addEventListener('click', () => { if (!guard()) return; st.page = null; st.view = 'mine'; renderNav(); renderMine(); });
      root.querySelector('[data-a=allhist]').onclick = () => { if (!guard()) return; st.page = null; st.view = 'allhist'; renderNav(); renderAllHistory(); };
      renderNav();
    }
    function renderNav() {
      const o = st.overview, nav = q('nav'); if (!nav) return;
      const groupsByKey = Object.fromEntries(o.groups.map(g => [g.key, g]));
      const term = st.q.toLowerCase();
      const pgBtn = it => `<button type="button" class="pg ${st.page?.path === it.path ? 'on' : ''}" data-p="${esc(it.path)}" title="${esc(it.title)}${it.seo ? `\nSEO: ${esc(it.seo.title || '(no SEO title)')}` : ''}"><span class="dot ${it.seo ? seoState(it.seo) : ''}"></span><span class="t">${esc(it.title)}</span></button>`;
      let html = `<input type="search" placeholder="Find a page…" value="${esc(st.q)}" aria-label="Find a page">`;
      for (const [nav1, keys] of Object.entries(o.navigation || { Content: o.groups.map(g => g.key) })) {
        const parts = keys.map(k => groupsByKey[k]).filter(Boolean).map(g => {
          const items = g.items.filter(it => !term || `${it.title} ${it.slug || ''} ${g.label}`.toLowerCase().includes(term));
          if (!items.length) return '';
          if (g.type === 'singleton') return pgBtn({ ...items[0], title: g.label });
          return `<details ${term || items.some(i => i.path === st.page?.path) || g.items.length <= 6 ? 'open' : ''}><summary>${esc(g.label)}<span class="n">${items.length}</span></summary>${items.map(pgBtn).join('')}</details>`;
        }).join('');
        if (parts) html += `<h4>${esc(nav1)}</h4>${parts}`;
      }
      nav.innerHTML = html + `<p style="font-size:11px;color:#9aa59f;margin:12px 6px">● SEO ok · ● missing title/description · ● too long</p>`;
      const inp = nav.querySelector('input'); inp.oninput = () => { st.q = inp.value; const pos = inp.selectionStart; renderNav(); const n = q('nav input'); n.focus(); n.setSelectionRange(pos, pos); };
      nav.querySelectorAll('button.pg').forEach(b => b.onclick = () => openPage(b.dataset.p));
    }
    const guard = () => !st.dirty || confirm('You have unsaved changes on this page. Leave without saving?');
    async function openPage(path, { force = false } = {}) {
      if (!force && !guard()) return;
      const main = q('main'); main.innerHTML = '<div class="empty">Loading…</div>';
      try { const p = await req(`?clientId=${encodeURIComponent(opts.clientId)}&op=page&path=${encodeURIComponent(path)}`); st.page = p; st.data = clone(p.data); st.body = p.body; st.dirty = false; st.errors = {}; st.view = 'edit'; if (!force) st.banner = null; }
      catch (e) { main.innerHTML = `<div class="empty">${esc(e.message)}</div>`; return; }
      renderNav(); renderPage();
    }

    // ---------- page editor ----------
    function renderPage() {
      const p = st.page, e = p.schema, main = q('main'), ro = !canWrite();
      const title = (e.slugField && typeof st.data[e.slugField] === 'string' && st.data[e.slugField]) || (e.type === 'collection' ? p.slug : e.label);
      const last = p.history?.[0];
      main.innerHTML = `<div class="bar"><div><h2>${esc(title)}</h2><div class="meta">${esc(e.type === 'collection' ? e.label.replace(/s$/, '') : 'Settings')} · ${last ? `last saved by <b>${esc(who(last.actor))}</b>, ${esc(when(last.created_at))}` : `version ${p.version}`}</div></div>
        <div class="r"><span class="dirty" ${st.dirty ? '' : 'hidden'}>● Unsaved changes</span>
          ${p.url ? `<a class="secondary-button" href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">👀 View on preview ↗</a>` : ''}
          <button type="button" class="secondary-button" data-a="hist">🕘 History${p.history?.length ? ` (${p.history.length})` : ''}</button>
          ${ro ? '<span class="pill">View only</span>' : `<button type="button" class="secondary-button" data-a="discard" ${st.dirty ? '' : 'disabled'}>Discard</button><button type="button" class="primary-button" data-a="save" ${st.dirty ? '' : 'disabled'}>💾 Save to preview</button>`}</div></div>
        <div class="bn"></div><div class="body"></div>`;
      renderBanner();
      main.querySelector('[data-a=hist]').onclick = () => { st.view = st.view === 'hist' ? 'edit' : 'hist'; st.view === 'hist' ? renderHistory() : renderForm(); };
      main.querySelector('[data-a=save]')?.addEventListener('click', save);
      main.querySelector('[data-a=discard]')?.addEventListener('click', () => { if (confirm('Discard your unsaved changes?')) { st.data = clone(p.data); st.body = p.body; st.dirty = false; st.errors = {}; renderPage(); } });
      st.view === 'hist' ? renderHistory() : renderForm();
    }
    function renderBanner() {
      const el = q('main .bn'); if (!el) return; const b = st.banner;
      el.innerHTML = b ? `<div class="banner ${b.kind}" role="status">${b.html}</div>` : '';
    }
    function markDirty() {
      st.dirty = JSON.stringify(st.data) !== JSON.stringify(st.page.data) || (st.body ?? null) !== (st.page.body ?? null);
      const m = q('main .bar .dirty'); if (m) m.hidden = !st.dirty;
      q('main [data-a=save]') && (q('main [data-a=save]').disabled = !st.dirty);
      q('main [data-a=discard]') && (q('main [data-a=discard]').disabled = !st.dirty);
    }
    function renderForm() {
      const p = st.page, e = p.schema, body = q('main .body'), ro = !canWrite();
      const fields = Object.entries(e.schema);
      const seoKey = fields.find(([k, f]) => f.kind === 'object' && f.fields?.title && f.fields?.description && /seo/i.test(k + f.label))?.[0];
      let html = '';
      if (seoKey) html += `<div class="card seo" data-seo><h4>🔎 Search & sharing (SEO)</h4><div class="snipbox"></div>${fieldHtml(e.schema[seoKey], [seoKey], ro, true)}</div>`;
      const rest = fields.filter(([k]) => k !== seoKey && k !== e.contentField);
      if (rest.length) html += `<div class="card"><h4>📝 Page content</h4>${rest.map(([k, f]) => fieldHtml(f, [k], ro)).join('')}</div>`;
      if (e.contentField) html += `<div class="card"><h4>📄 ${esc(e.schema[e.contentField].label || 'Article')}</h4>${bodyHtml(ro)}</div>`;
      body.innerHTML = html;
      wire(body);
      if (seoKey) renderSnippet(seoKey);
    }
    const fid = path => 'f' + path.join('_').replace(/[^\w]/g, '_');
    const lbl = (f, path, extra = '') => `<label for="${fid(path)}">${esc(f.label || path[path.length - 1])}${extra}</label>`;
    const help = f => f.description ? `<div class="help">${esc(f.description)}</div>` : '';
    const errOf = path => st.errors[path.join('.')];
    function fieldHtml(f, path, ro, inSeo = false) {
      const v = getAt(st.data, path), id = fid(path), dis = ro ? 'disabled' : '', pd = esc(JSON.stringify(path)), er = errOf(path);
      const wrap = (inner, cls = '') => `<div class="f ${cls} ${er ? 'err' : ''}" data-path='${pd}'>${inner}${er ? `<div class="emsg">${esc(er)}</div>` : ''}</div>`;
      switch (f.kind) {
        case 'text': {
          const max = f.maxLength, len = String(v ?? '').length;
          const cnt = max ? `<span class="cnt ${len > max ? 'over' : ''}">${len}/${max}</span>` : '';
          const inp = f.multiline ? `<textarea id="${id}" data-k="text" ${dis}>${esc(v ?? '')}</textarea>` : `<input type="text" id="${id}" data-k="text" value="${esc(v ?? '')}" ${dis}>`;
          return wrap(lbl(f, path, cnt) + inp + help(f));
        }
        case 'url': return wrap(lbl(f, path) + `<input type="url" id="${id}" data-k="text" value="${esc(v ?? '')}" placeholder="https://" ${dis}>` + help(f));
        case 'integer': case 'number': return wrap(lbl(f, path) + `<input type="number" id="${id}" data-k="${f.kind}" value="${esc(v ?? '')}" ${f.kind === 'integer' ? 'step="1"' : 'step="any"'} ${f.min != null ? `min="${f.min}"` : ''} ${f.max != null ? `max="${f.max}"` : ''} ${dis}>` + help(f));
        case 'date': return wrap(lbl(f, path) + `<input type="date" id="${id}" data-k="text" value="${esc(v ?? '')}" ${dis}>` + help(f));
        case 'checkbox': return wrap(`<input type="checkbox" id="${id}" data-k="checkbox" ${v ? 'checked' : ''} ${dis}>${lbl(f, path)}` + help(f), 'chk');
        case 'select': return wrap(lbl(f, path) + `<select id="${id}" data-k="select" ${dis}>${(f.options || []).map(o => `<option value="${esc(o.value)}" ${o.value === (v ?? f.defaultValue) ? 'selected' : ''}>${esc(o.label)}</option>`).join('')}</select>` + help(f));
        case 'slug': {
          const name = typeof v === 'string' ? v : (v?.name ?? '');
          const slug = st.page.slug;
          return wrap(lbl(f, path) + `<input type="text" id="${id}" data-k="slug" value="${esc(name)}" ${dis}>` + (slug ? `<div class="slug">${esc(f.slugLabel || 'URL slug')}: <code>${esc(slug)}</code> · the page address stays the same (changing it would break links and SEO).</div>` : '') + help(f));
        }
        case 'image': return wrap(lbl(f, path) + imgHtml(f, path, v, ro) + help(f));
        case 'object': {
          const inner = Object.entries(f.fields || {}).map(([k, sf]) => fieldHtml(sf, [...path, k], ro, inSeo)).join('');
          if ((inSeo && path.length === 1) || typeof path[path.length - 1] === 'number') return inner;   // SEO card / array item: no extra frame
          return `<fieldset><legend>${esc(f.label || path[path.length - 1])}</legend>${help(f)}${inner}</fieldset>`;
        }
        case 'array': return arrHtml(f, path, Array.isArray(v) ? v : [], ro);
        case 'markdoc': case 'mdx': return '';
        default: return wrap(lbl(f, path) + `<div class="help">This field type (${esc(f.kind)}) is kept as it is.</div>`);
      }
    }
    function imgHtml(f, path, v, ro, compact = false) {
      const pd = esc(JSON.stringify(path));
      return `<div class="img" data-img='${pd}' data-dir="${esc(f.directory || '')}"><div class="th" ${v ? `style="background-image:url('${esc(imgSrc(v))}')"` : ''}>${v ? '' : 'No image'}</div>
        <div class="ctl">${v ? `<code title="${esc(v)}">${esc(String(v).split('/').pop())}</code>` : ''}${ro ? '' : `<div style="display:flex;gap:6px;flex-wrap:wrap"><button type="button" class="add" data-a="up">⬆ ${v ? 'Replace' : 'Upload'}</button>${v ? '<button type="button" class="add" data-a="clr">Remove</button>' : ''}</div>`}${compact ? '' : `<div class="help">JPG, PNG, WebP, AVIF or GIF · max ${Math.round((st.overview.limits?.imageBytes || 2097152) / 1048576)} MB</div>`}</div></div>`;
    }
    function arrHtml(f, path, list, ro) {
      const el = f.element || {}, pd = esc(JSON.stringify(path)), key = path.join('.');
      let items;
      if (el.kind === 'image') items = `<div class="imgs">${list.map((x, i) => `<div>${imgHtml(el, [...path, i], x, ro, true)}${ro ? '' : `<div style="display:flex;gap:4px;margin-top:4px"><button type="button" class="add" data-mv="-1" data-i="${i}">◀</button><button type="button" class="add" data-mv="1" data-i="${i}">▶</button><button type="button" class="add" data-rm="${i}">✕</button></div>`}</div>`).join('')}</div>`;
      else if (el.kind !== 'object' && el.kind !== 'array') items = list.map((x, i) => `<div class="simple" data-path='${esc(JSON.stringify([...path, i]))}'><input type="text" data-k="${el.kind === 'integer' ? 'integer' : 'text'}" value="${esc(x ?? '')}" ${ro ? 'disabled' : ''} aria-label="${esc(el.label || f.label)} ${i + 1}">${ro ? '' : `<button type="button" data-mv="-1" data-i="${i}" title="Move up">↑</button><button type="button" data-mv="1" data-i="${i}" title="Move down">↓</button><button type="button" data-rm="${i}" title="Remove">✕</button>`}</div>`).join('');
      else items = list.map((x, i) => {
        const t = fill(f.itemLabel, x) || `${el.label || 'Item'} ${i + 1}`;
        const open = st.openArr.has(`${key}.${i}`);
        return `<details class="item" data-k2="${esc(key)}.${i}" ${open ? 'open' : ''}><summary><span class="t">${esc(t)}</span>${ro ? '' : `<button type="button" data-mv="-1" data-i="${i}" title="Move up">↑</button><button type="button" data-mv="1" data-i="${i}" title="Move down">↓</button><button type="button" data-rm="${i}" title="Remove">✕</button>`}</summary><div>${open ? fieldHtml(el, [...path, i], ro) : ''}</div></details>`;
      }).join('');
      return `<div class="arr" data-arr='${pd}'><div class="lbl">${esc(f.label || path[path.length - 1])} <span class="n">${list.length}</span></div>${help(f)}${items}${ro ? '' : `<button type="button" class="add" data-add>+ Add ${esc((el.label || 'item').toLowerCase())}</button>`}</div>`;
    }
    const emptyOf = f => f.kind === 'object' ? Object.fromEntries(Object.entries(f.fields || {}).map(([k, sf]) => [k, emptyOf(sf)])) : f.kind === 'array' ? [] : f.kind === 'checkbox' ? !!f.defaultValue : f.kind === 'integer' || f.kind === 'number' ? (f.defaultValue ?? null) : f.kind === 'select' ? (f.defaultValue ?? f.options?.[0]?.value ?? '') : (f.defaultValue ?? '');
    const fieldAt = path => { let f = st.page.schema.schema[path[0]]; for (const k of path.slice(1)) { if (!f) return null; f = f.kind === 'array' ? f.element : f.fields?.[k]; } return f; };
    function wire(body) {
      body.addEventListener('input', ev => {
        const t = ev.target, box = t.closest('[data-path]'); if (!box || !t.dataset.k) return;
        const path = JSON.parse(box.dataset.path); let v = t.value;
        if (t.dataset.k === 'checkbox') v = t.checked;
        else if (t.dataset.k === 'integer') v = t.value === '' ? null : parseInt(t.value, 10);
        else if (t.dataset.k === 'number') v = t.value === '' ? null : Number(t.value);
        setAt(st.data, path, v);
        const cnt = box.querySelector('.cnt'); if (cnt) { const max = fieldAt(path)?.maxLength; cnt.textContent = `${String(v).length}/${max}`; cnt.classList.toggle('over', String(v).length > max); }
        if (st.errors[path.join('.')]) { delete st.errors[path.join('.')]; box.classList.remove('err'); box.querySelector('.emsg')?.remove(); }
        markDirty(); if (box.closest('[data-seo]') || /^(h1|title|name)$/.test(path[0])) { const sk = q('[data-seo] [data-path]') && JSON.parse(q('[data-seo] [data-path]').dataset.path)[0]; if (sk) renderSnippet(sk); }
      });
      body.addEventListener('change', ev => { const t = ev.target; if (t.matches('select,input[type=checkbox]')) t.dispatchEvent(new Event('input', { bubbles: true })); });
      body.addEventListener('toggle', ev => { const d = ev.target; if (!d.matches?.('details.item')) return; const k = d.dataset.k2; if (d.open) { st.openArr.add(k); if (!d.querySelector(':scope>div').children.length) { const arr = d.closest('[data-arr]'); const path = [...JSON.parse(arr.dataset.arr), +k.split('.').pop()]; d.querySelector(':scope>div').innerHTML = fieldHtml(fieldAt(path.slice(0, -1)).element, path, !canWrite()); } } else st.openArr.delete(k); }, true);
      body.addEventListener('click', async ev => {
        const b = ev.target.closest('button'); if (!b || b.disabled) return;
        const arr = b.closest('[data-arr]');
        if (arr && (b.dataset.add !== undefined || b.dataset.rm !== undefined || b.dataset.mv !== undefined)) {
          ev.preventDefault(); const path = JSON.parse(arr.dataset.arr); const f = fieldAt(path); let list = getAt(st.data, path); if (!Array.isArray(list)) { list = []; setAt(st.data, path, list); }
          if (b.dataset.add !== undefined) { if (f.element.kind === 'image') return upload(f.element, null, path); list.push(emptyOf(f.element)); st.openArr.add(`${path.join('.')}.${list.length - 1}`); }
          if (b.dataset.rm !== undefined) { const i = +b.dataset.rm; const it = list[i]; if (typeof it === 'object' && it && !confirm(`Remove “${fill(f.itemLabel, it) || 'this item'}”?`)) return; list.splice(i, 1); st.openArr.clear(); }
          if (b.dataset.mv !== undefined) { const i = +b.dataset.i, j = i + +b.dataset.mv; if (j < 0 || j >= list.length) return; [list[i], list[j]] = [list[j], list[i]]; st.openArr.clear(); }
          markDirty(); return rerender();
        }
        const im = b.closest('[data-img]');
        if (im) { const path = JSON.parse(im.dataset.img); const f = fieldAt(path); if (b.dataset.a === 'clr') { setAt(st.data, path, ''); markDirty(); return rerender(); } if (b.dataset.a === 'up') return upload(f, path); }
        if (b.dataset.tb) return mdTool(b.dataset.tb);
        if (b.dataset.a === 'mdprev') { st.mdPrev = !st.mdPrev; return rerender(); }
      });
    }
    const rerender = () => { const m = q('main'); const top = m.scrollTop; renderForm(); m.scrollTop = top; };
    function upload(f, path, appendTo) {
      const inp = document.createElement('input'); inp.type = 'file'; inp.accept = 'image/jpeg,image/png,image/webp,image/avif,image/gif';
      inp.onchange = async () => {
        const file = inp.files?.[0]; if (!file) return;
        const max = st.overview.limits?.imageBytes || 2097152;
        if (file.size > max) { st.banner = { kind: 'err', html: `“${esc(file.name)}” is ${(file.size / 1048576).toFixed(1)} MB. Images must be ${max / 1048576} MB or smaller – export about 1600 px wide as JPG or WebP.` }; return renderBanner(); }
        st.banner = { kind: 'info', html: `Uploading ${esc(file.name)}…` }; renderBanner();
        try {
          const r = await req(`?clientId=${encodeURIComponent(opts.clientId)}&op=image&dir=${encodeURIComponent(f.directory || '')}&name=${encodeURIComponent(file.name)}`, { method: 'POST', headers: { 'Content-Type': file.type || 'application/octet-stream' }, body: file });
          if (appendTo) { let list = getAt(st.data, appendTo); if (!Array.isArray(list)) { list = []; setAt(st.data, appendTo, list); } list.push(r.publicPath); } else setAt(st.data, path, r.publicPath);
          st.banner = { kind: 'info', html: `Image uploaded to the preview copy as <code>${esc(r.publicPath)}</code>. Press <b>Save to preview</b> to use it on the page.` };
          markDirty(); renderBanner(); rerender();
        } catch (e) { st.banner = { kind: 'err', html: esc(e.message) }; renderBanner(); }
      };
      inp.click();
    }
    // markdown body
    function bodyHtml(ro) {
      return `<div class="f" data-body>${ro ? '' : `<div class="tb"><button type="button" data-tb="b"><b>B</b></button><button type="button" data-tb="i"><i>I</i></button><button type="button" data-tb="h2">H2</button><button type="button" data-tb="h3">H3</button><button type="button" data-tb="ul">• List</button><button type="button" data-tb="link">🔗 Link</button><button type="button" data-a="mdprev" style="margin-left:auto">${st.mdPrev ? '✏️ Write' : '👁 Preview'}</button></div>`}
        ${st.mdPrev || ro ? `<div class="mdprev">${mdPreview(st.body)}</div>` : `<textarea class="md" aria-label="Article text (Markdown)">${esc(st.body ?? '')}</textarea><div class="help">Markdown: ## heading, **bold**, *italic*, - list, [text](link). Blank line = new paragraph.</div>`}</div>`;
    }
    function mdTool(k) {
      const ta = q('textarea.md'); if (!ta) return; const s = ta.selectionStart, e = ta.selectionEnd, sel = ta.value.slice(s, e) || 'text';
      const lineStart = ta.value.lastIndexOf('\n', s - 1) + 1;
      let out, a = s, b = e;
      if (k === 'b' || k === 'i') { const m = k === 'b' ? '**' : '*'; out = ta.value.slice(0, s) + m + sel + m + ta.value.slice(e); a = s + m.length; b = a + sel.length; }
      else if (k === 'h2' || k === 'h3' || k === 'ul') { const m = k === 'h2' ? '## ' : k === 'h3' ? '### ' : '- '; out = ta.value.slice(0, lineStart) + m + ta.value.slice(lineStart); a = s + m.length; b = e + m.length; }
      else if (k === 'link') { const u = prompt('Link address (https://… or /page/)'); if (!u) return; if (!/^(https?:\/\/|\/)/.test(u)) return alert('Use a full https:// address or a site path starting with /'); out = ta.value.slice(0, s) + `[${sel}](${u})` + ta.value.slice(e); a = s + 1; b = a + sel.length; }
      ta.value = out; ta.focus(); ta.setSelectionRange(a, b); st.body = ta.value; markDirty();
    }
    root.addEventListener('input', ev => { if (ev.target.matches?.('textarea.md')) { st.body = ev.target.value; markDirty(); } });
    function renderSnippet(seoKey) {
      const box = q('[data-seo] .snipbox'); if (!box) return;
      const s = st.data[seoKey] || {}, p = st.page;
      const name = (st.page.schema.slugField && st.data[st.page.schema.slugField]) || st.data.h1 || st.data.title || st.page.schema.label;
      const t = s.title || `${name} | ${opts.name}`, d = s.description || '(Google will pick text from the page)';
      const url = (p.url || '').replace(/^https?:\/\//, '').replace(/\/$/, '').replace(/\//g, ' › ');
      const kw = String(s.focusKeyword || '').trim().toLowerCase();
      const h1 = String(st.data.h1 || st.data.heroTitle || st.data.title || name || '').toLowerCase();
      const firstPara = String(st.body || st.data.intro || st.data.lead || '').slice(0, 600).toLowerCase();
      const ck = (ok, txt, warn) => `<div>${ok ? '✅' : warn ? '⚠️' : '❌'} ${txt}</div>`;
      const tl = (s.title || '').length, dl = (s.description || '').length;
      box.innerHTML = `<div class="snip" aria-label="Google preview"><div class="u">${esc(url || 'preview address')}</div><div class="h">${esc(t.length > 62 ? t.slice(0, 60) + '…' : t)}</div><div class="d">${esc(d.length > 158 ? d.slice(0, 155) + '…' : d)}</div></div>
        <div class="checks">${ck(tl > 0 && tl <= 60, `SEO title ${tl}/60 characters${tl ? '' : ' – blank uses the default'}`, !tl)}${ck(dl >= 70 && dl <= 155, `Meta description ${dl}/155 characters${dl && dl < 70 ? ' – a bit short' : ''}`, !dl || dl < 70)}
        ${kw ? ck((s.title || '').toLowerCase().includes(kw), `Focus keyword “${esc(kw)}” in the SEO title`) + ck((s.description || '').toLowerCase().includes(kw), 'Focus keyword in the meta description', true) + ck(h1.includes(kw), 'Focus keyword in the page headline', true) + (firstPara ? ck(firstPara.includes(kw), 'Focus keyword near the start of the text', true) : '') : ck(false, 'No focus keyword set', true)}
        ${s.noindex ? ck(false, 'This page is hidden from Google (noindex is on)', true) : ''}</div>`;
    }

    async function save() {
      const p = st.page; const btn = q('main [data-a=save]'); if (btn) { btn.disabled = true; btn.textContent = 'Saving…'; }
      try {
        const r = await req('', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId: opts.clientId, op: 'save', path: p.path, data: st.data, body: p.schema.contentField ? st.body : undefined, baseSha: p.sha }) });
        if (r.unchanged) { st.banner = { kind: 'info', html: 'Nothing changed.' }; st.dirty = false; return renderPage(); }
        st.banner = r.needsApproval
          ? { kind: 'ok', html: `✔ Saved to the preview and sent to F2B Media for approval · “${esc(r.message)}”${r.url ? ` · <a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">view it ↗</a>` : ''}<br><small>${esc(r.previewNote || '')} Nothing goes live until F2B Media approves it.</small>` }
          : { kind: 'ok', html: `✔ Saved to preview · version ${r.version} · “${esc(r.message)}”${r.url ? ` · <a href="${esc(r.url)}" target="_blank" rel="noopener noreferrer">view it ↗</a>` : ''}<br><small>${esc(r.previewNote || '')} Nothing has been published to the live site.</small>` };
        st.overview = await req(`?clientId=${encodeURIComponent(opts.clientId)}`).catch(() => st.overview);
        await openPage(p.path, { force: true });
        const sub = root.querySelector('header .sub'); if (sub) { const last = st.overview.history?.find(h => h.kind !== 'import'); if (last) sub.innerHTML = `Last saved by <b>${esc(who(last.actor))}</b> · ${esc(ago(last.created_at))}`; }
      } catch (e) {
        if (e.fieldErrors) { st.errors = Object.fromEntries(e.fieldErrors.map(([k, m]) => [k, m])); for (const k of Object.keys(st.errors)) { const parts = k.split('.'); for (let i = 1; i < parts.length; i++) if (/^\d+$/.test(parts[i])) st.openArr.add(parts.slice(0, i + 1).join('.')); } }
        st.banner = { kind: 'err', html: esc(e.message) + (e.status === 409 ? ' <button type="button" class="add" data-reload>Reload page</button>' : '') };
        renderPage(); q('main [data-reload]')?.addEventListener('click', () => openPage(p.path, { force: true }));
        q('main .f.err')?.scrollIntoView({ block: 'center' });
      }
    }

    // ---------- history / undo / restore ----------
    const histRow = (h, { page }) => `<div class="v"><div class="m"><span class="k">${esc(h.kind)}</span><b>${esc(h.message)}</b>${esc(who(h.actor))} · ${esc(when(h.created_at))} · v${h.version}</div>
      ${canUndo() && h.kind !== 'import' ? `<button type="button" data-undo="${h.version}" title="Put the files this change touched back the way they were">↶ Undo this change</button>` : ''}
      ${canUndo() && page ? `<button type="button" data-restore="${h.version}" title="Make this page look exactly like it did at this version">⟲ Restore this version</button>` : ''}</div>`;
    function renderHistory() {
      const p = st.page, body = q('main .body');
      body.innerHTML = `<div class="card"><h4>🕘 History of this page</h4><p class="help" style="margin:0 0 10px;font-size:12px;color:#6c7a73">Every save is a version. Undo or restore creates a new version, so nothing is ever lost. All of this is the preview copy only.</p><div class="hist">${(p.history || []).map(h => histRow(h, { page: true })).join('') || '<div class="empty">No history yet.</div>'}</div></div>`;
      wireHist(body);
    }
    async function renderAllHistory() {
      const main = q('main'); main.innerHTML = '<div class="empty">Loading…</div>';
      const r = await req(`?clientId=${encodeURIComponent(opts.clientId)}&op=history&limit=50`).catch(e => ({ error: e.message }));
      main.innerHTML = `<div class="bar"><div><h2>All changes</h2><div class="meta">Newest first · preview copy</div></div></div><div class="bn"></div><div class="body"><div class="card"><div class="hist">${(r.history || []).map(h => histRow(h, { page: false })).join('') || `<div class="empty">${esc(r.error || 'No changes yet.')}</div>`}</div></div></div>`;
      renderBanner(); wireHist(main);
    }
    const diffHtml = d => `<pre class="diff">${(d?.lines || []).map(([o, l]) => `<span class="${o === '+' ? 'dadd' : o === '-' ? 'ddel' : ''}">${o === ' ' ? '  ' : o + ' '}${esc(l)}</span>`).join('')}</pre>`;
    async function renderApprovals(all = false) {
      const main = q('main'); main.innerHTML = '<div class="empty">Loading…</div>';
      const r = await req(`?clientId=${encodeURIComponent(opts.clientId)}&op=approvals${all ? '&status=all' : ''}`).catch(e => ({ error: e.message }));
      const list = r.approvals || [];
      main.innerHTML = `<div class="bar"><div><h2>Client edits</h2><div class="meta">Edits made by ${esc(opts.name)}’s own login. They are on the preview only. Approve to keep, or undo to put the page back.</div></div><div class="r"><button type="button" class="secondary-button" data-a="all">${all ? 'Show waiting only' : 'Show all'}</button></div></div><div class="bn"></div>
        <div class="body">${list.map(a => `<div class="card appr" data-id="${esc(a.id)}"><h4><span class="st ${esc(a.status)}">${a.status === 'pending' ? '🟠 Waiting for you' : a.status === 'approved' ? '✅ Approved' : '↶ Undone'}</span> ${esc(a.message)}</h4>
          <div class="help" style="margin:-4px 0 8px">${esc(a.actor)} · ${esc(when(a.createdAt))} · v${a.version} · <code>${esc(a.path.split('/').slice(-2).join('/'))}</code>${a.decidedBy ? ` · ${esc(a.status)} by ${esc(who(a.decidedBy))} ${esc(when(a.decidedAt))}` : ''}</div>
          ${diffHtml(a.diff)}
          ${a.status === 'pending' ? `<div style="display:flex;gap:8px;margin-top:10px"><button type="button" class="primary-button" data-d="approve">✅ Approve</button><button type="button" class="secondary-button" data-d="undo">↶ Undo this edit</button></div>` : ''}</div>`).join('') || `<div class="empty">${esc(r.error || (all ? 'No client edits yet.' : 'Nothing waiting. 🎉'))}</div>`}</div>`;
      renderBanner();
      main.querySelector('[data-a=all]').onclick = () => renderApprovals(!all);
      main.querySelectorAll('.appr [data-d]').forEach(b => b.onclick = async () => {
        const id = b.closest('.appr').dataset.id, d = b.dataset.d;
        if (d === 'undo' && !confirm('Undo this client edit? The page goes back to how it was before it (in the preview copy).')) return;
        b.disabled = true;
        try { await req('', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ clientId: opts.clientId, op: 'decide', id, decision: d }) }); st.banner = { kind: 'ok', html: d === 'approve' ? '✔ Approved. It stays on the preview; publishing live is still a separate step.' : '✔ Undone in the preview copy.' }; }
        catch (e) { st.banner = { kind: 'err', html: esc(e.message) }; }
        st.overview = await req(`?clientId=${encodeURIComponent(opts.clientId)}`).catch(() => st.overview); shell(); st.view = 'approvals'; renderApprovals(all);
      });
    }
    async function renderMine() {
      const main = q('main'); main.innerHTML = '<div class="empty">Loading…</div>';
      const r = await req(`?clientId=${encodeURIComponent(opts.clientId)}&op=approvals`).catch(e => ({ error: e.message }));
      main.innerHTML = `<div class="bar"><div><h2>My edits</h2><div class="meta">Every edit is checked by F2B Media before anything goes live.</div></div></div><div class="body"><div class="card"><div class="hist">${(r.approvals || []).map(a => `<div class="v"><div class="m"><span class="k">${a.status === 'pending' ? 'Waiting for F2B' : a.status === 'approved' ? 'Approved' : 'Undone by F2B'}</span><b>${esc(a.message)}</b>${esc(when(a.createdAt))}</div></div>`).join('') || `<div class="empty">${esc(r.error || 'No edits yet.')}</div>`}</div></div></div>`;
    }
    function wireHist(el) {
      el.querySelectorAll('[data-undo],[data-restore]').forEach(b => b.onclick = async () => {
        const undo = b.dataset.undo, ver = +(undo || b.dataset.restore);
        if (!confirm(undo ? `Undo version ${ver}? This puts those edits back the way they were (in the preview copy).` : `Restore this page to version ${ver}? Your current version stays in history.`)) return;
        b.disabled = true;
        try {
          const r = await req('', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(undo ? { clientId: opts.clientId, op: 'undo', version: ver } : { clientId: opts.clientId, op: 'restore', path: st.page.path, version: ver }) });
          st.banner = { kind: 'ok', html: r.unchanged ? 'Already the same as that version.' : `✔ ${undo ? `Undid version ${ver}` : `Restored version ${ver}`} · saved as version ${r.version} in the preview copy.${st.page?.url ? ` <a href="${esc(st.page.url)}" target="_blank" rel="noopener noreferrer">view it ↗</a>` : ''}` };
          st.overview = await req(`?clientId=${encodeURIComponent(opts.clientId)}`).catch(() => st.overview);
          if (st.page) { await openPage(st.page.path, { force: true }); } else { renderNav(); renderAllHistory(); }
        } catch (e) { st.banner = { kind: 'err', html: esc(e.message) }; renderBanner(); b.disabled = false; }
      });
    }
    function close(force = false) { if (!force && !guard()) return false; const lost = st.dirty; st.dirty = false; window.removeEventListener('beforeunload', beforeUnload); root.remove(); opts.onClose?.({ lost }); return true; }
    loadOverview();
    return { root, close, get dirty() { return st.dirty; }, open: openPage };
  }
  window.f2bSiteEditor = { mount };
})();
