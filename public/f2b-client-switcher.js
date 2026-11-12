/* F2B Agency OS · client switcher + sub-accounts (HighLevel-style). Standalone, no build step.
   Ship: copy to public/f2b-client-switcher.js and add <script src="/f2b-client-switcher.js" defer /> to app/layout.tsx.
   Needs GET/POST /api/client-accounts (app/api/client-accounts/route.ts). If that route is missing, this script does nothing.
   Marketing → Websites gets a per-client Website section (preview / live / editor links).
   Kill switch per browser: localStorage.setItem('f2b-client-switcher','off')  (and reload). */
(() => {
  if (window.__f2bClientSwitcher) return; window.__f2bClientSwitcher = true;
  const OFF = localStorage.getItem('f2b-client-switcher') === 'off';
  const COOKIE = 'f2b_client';
  const setCookie = v => { document.cookie = v === null ? `${COOKIE}=; Path=/; Max-Age=0; SameSite=Lax` : `${COOKIE}=${encodeURIComponent(v)}; Path=/; Max-Age=31536000; SameSite=Lax; Secure`; };
  if (OFF) { setCookie(null); return; }

  const CSS = `
.f2b-cs-on aside.sidebar .clients-label,.f2b-cs-on aside.sidebar .client-nav{display:none!important}
.f2b-cs{position:relative;margin:0 4px 14px;z-index:60}
.f2b-cs-trigger{width:100%;display:flex;align-items:center;gap:8px;background:#ffffff12;border:1px solid #ffffff24;border-radius:11px;padding:7px 8px 7px 6px;font:inherit;color:#fff;cursor:pointer;text-align:left}
.f2b-cs-trigger:hover{background:#ffffff1a}
.f2b-cs-trigger.open{background:#ffffff1f;border-color:#ffffff55;box-shadow:0 0 0 3px #ffffff14}
.f2b-cs-trigger .t{display:grid;line-height:1.2;min-width:0}
.f2b-cs-trigger .t small{font-size:9px;letter-spacing:.12em;text-transform:uppercase;font-weight:800;color:#ffffff99}
.f2b-cs-trigger .t b{font-size:12.5px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;letter-spacing:-.01em}
.f2b-cs-trigger .chev{margin-left:auto;font-size:14px;color:#ffffffaa;line-height:1}
.f2b-cs-logo{width:22px;height:22px;border-radius:7px;background:#fff;display:grid;place-items:center;overflow:hidden;flex:none;font-size:10px;font-weight:800;color:#31423d}
.f2b-cs-logo img{width:100%;height:100%;object-fit:contain;padding:2px;box-sizing:border-box}
.f2b-cs-logo.lg{width:30px;height:30px;border-radius:9px}
.f2b-cs-logo.agency{background:#172b28;color:#fff}
.f2b-cs-pop{position:fixed;width:420px;max-width:calc(100vw - 24px);max-height:min(560px,calc(100vh - 40px));display:flex;flex-direction:column;background:#fff;color:#2c3a34;border:1px solid #dfe6e1;border-radius:14px;box-shadow:0 18px 50px #172b2830,0 2px 6px #172b2812;z-index:2147483000;overflow:hidden;font-family:inherit;text-align:left}
.f2b-cs-pop .search{padding:12px 12px 8px}
.f2b-cs-pop .search input{width:100%;box-sizing:border-box;border:1px solid #d9e2dd;border-radius:9px;padding:9px 11px 9px 32px;font:inherit;font-size:13px;color:#25332d;background:#f8faf8 url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 24 24' fill='none' stroke='%237c8a83' stroke-width='2.4'%3E%3Ccircle cx='11' cy='11' r='7'/%3E%3Cpath d='m20 20-3.5-3.5'/%3E%3C/svg%3E") 11px 50% no-repeat;outline:none}
.f2b-cs-pop .search input:focus{border-color:#24473e;box-shadow:0 0 0 3px #24473e1a}
.f2b-cs-pop .list{overflow:auto;padding-bottom:6px}
.f2b-cs-pop .sec{font-size:9px;letter-spacing:.13em;font-weight:800;color:#7c8a83;padding:8px 16px 5px;display:flex;justify-content:space-between;text-transform:uppercase}
.f2b-cs-row{display:flex;align-items:center;gap:10px;padding:7px 10px;margin:0 6px;border-radius:9px;font-size:13px;color:#2c3a34;cursor:pointer;border:0;background:none;width:calc(100% - 12px);font:inherit;text-align:left}
.f2b-cs-row:hover,.f2b-cs-row.hover{background:#f1f5f2}
.f2b-cs-row.current{background:#e9f3ee}
.f2b-cs-row .n{display:grid;line-height:1.2;min-width:0}
.f2b-cs-row .n b{font-weight:650;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;font-size:13px}
.f2b-cs-row .n small{font-size:11px;color:#7c8a83;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.f2b-cs-row .meta{margin-left:auto;display:flex;gap:5px;align-items:center;flex:none}
.f2b-cs-badge{font-size:10px;font-weight:700;border-radius:999px;padding:2px 7px;background:#eef2ef;color:#4b5a53;white-space:nowrap}
.f2b-cs-badge.red{background:#fdecea;color:#b4362b}.f2b-cs-badge.lead{background:#e7f0fb;color:#24609a}
.f2b-cs-check{color:#24473e;font-weight:900;width:12px}
.f2b-cs-pop .empty{padding:14px 16px;color:#7c8a83;font-size:12px}
.f2b-cs-pop .foot{border-top:1px solid #edf1ee;display:flex;gap:8px;padding:10px 12px;background:#fafcfa}
.f2b-cs-pop .foot button{flex:1;font:inherit;font-size:12px;font-weight:650;border-radius:9px;padding:8px 10px;cursor:pointer;border:1px solid #d9e2dd;background:#fff;color:#2c3a34}
.f2b-cs-pop .foot button.dark{background:#24473e;border-color:#24473e;color:#fff}
.f2b-cs-crumb{display:inline-flex;align-items:center;gap:6px}
.f2b-cs-crumb .f2b-cs-logo{width:18px;height:18px;border-radius:5px;border:1px solid #e3e9e5}
.f2b-cs-pill{font-size:10px;font-weight:700;color:#1f5d48;background:#e4f2eb;border:1px solid #c7e3d5;border-radius:999px;padding:2px 8px;margin-left:2px}
.f2b-cs-pill.agency{color:#3e4a45;background:#eef2ef;border-color:#dfe6e1}
.f2b-cs-on .breadcrumbs>.f2b-cs-crumb+span{display:none}
.f2b-cs-on .client-head-actions.f2b-cs-is-archived>.status-pill{display:none}
.f2b-cs-hidden{display:none!important}
.f2b-cs-arch-toggle{display:flex;align-items:center;gap:8px;font-size:12px;color:#5b6a63;margin:0 0 10px;padding:6px 10px;border:1px dashed #d9e2dd;border-radius:10px;background:#fafcfa;cursor:pointer;width:100%;font-family:inherit;text-align:left}
.f2b-cs-arch-toggle b{color:#2c3a34}
.client-list-card.f2b-cs-archived{opacity:.62}
.client-list-card.f2b-cs-archived .client-card-name small:after{content:" · Archived";color:#9a6112;font-weight:700}
.f2b-cs-status{font-size:11px;font-weight:700;border-radius:999px;padding:3px 9px;background:#eceeed;color:#6c7a73;align-self:center}
.f2b-cs-modal-back{position:fixed;inset:0;background:#172b2840;z-index:2147483001;display:grid;place-items:center;padding:16px}
.f2b-cs-modal{width:min(520px,100%);max-height:calc(100vh - 32px);overflow:auto;background:#fff;color:#25332d;border-radius:16px;box-shadow:0 24px 70px #172b2840;font-family:inherit;font-size:13px}
.f2b-cs-modal header{display:flex;gap:12px;align-items:center;padding:16px 18px;border-bottom:1px solid #edf1ee}
.f2b-cs-modal header h2{margin:0;font-size:17px;font-family:inherit}
.f2b-cs-modal header small{display:block;color:#7c8a83;font-size:11px}
.f2b-cs-modal .body{padding:8px 18px 14px}
.f2b-cs-modal h3{margin:12px 0 8px;font-size:10px;letter-spacing:.12em;color:#7c8a83;text-transform:uppercase;font-family:inherit}
.f2b-cs-modal label{display:grid;gap:3px;font-size:11px;color:#6c7a73;font-weight:600;margin-bottom:8px}
.f2b-cs-modal input,.f2b-cs-modal textarea,.f2b-cs-modal select{border:1px solid #d9e2dd;border-radius:8px;padding:8px 9px;font:inherit;font-size:13px;color:#25332d;background:#fff;width:100%;box-sizing:border-box}
.f2b-cs-modal textarea{min-height:64px;resize:vertical}
.f2b-cs-modal .g2{display:grid;grid-template-columns:1fr 1fr;gap:0 10px}
.f2b-cs-modal .hint{font-size:11px;color:#7c8a83;margin:-4px 0 8px}
.f2b-cs-modal .warn{border:1px solid #f1c9c4;background:#fff7f6;border-radius:11px;padding:10px 12px;color:#6b3a35;line-height:1.5}
.f2b-cs-modal .ok{border:1px solid #c7e3d5;background:#f2f9f5;border-radius:11px;padding:10px 12px;color:#1f5d48;line-height:1.5}
.f2b-cs-modal ul{margin:6px 0 2px 18px;padding:0}
.f2b-cs-modal footer{border-top:1px solid #edf1ee;padding:12px 18px;display:flex;gap:8px;justify-content:flex-end;background:#fafcfa;align-items:center}
.f2b-cs-modal footer .err{color:#b3261e;font-size:12px;margin-right:auto}
.f2b-cs-modal footer button{font:inherit;font-size:13px;font-weight:700;border-radius:9px;padding:8px 14px;cursor:pointer;border:1px solid #d9e2dd;background:#fff;color:#2c3a34}
.f2b-cs-modal footer button.dark{background:#24473e;border-color:#24473e;color:#fff}
.f2b-cs-modal footer button.danger{background:#b3261e;border-color:#b3261e;color:#fff}
.f2b-cs-modal footer button:disabled{opacity:.6;cursor:default}
.f2b-cs-toast{position:fixed;bottom:22px;left:50%;transform:translateX(-50%);background:#24473e;color:#fff;font-size:13px;font-weight:600;border-radius:10px;padding:10px 16px;z-index:2147483002;box-shadow:0 10px 30px #172b2840}
.dark-mode .f2b-cs-pop,.dark-mode .f2b-cs-modal{background:#242629;color:#f1f1f1;border-color:#45434a}
.dark-mode .f2b-cs-row{color:#e8e8e8}.dark-mode .f2b-cs-row:hover,.dark-mode .f2b-cs-row.hover{background:#2f3134}.dark-mode .f2b-cs-row.current{background:#2d3a35}
.dark-mode .f2b-cs-pop .search input,.dark-mode .f2b-cs-modal input,.dark-mode .f2b-cs-modal textarea,.dark-mode .f2b-cs-modal select{background-color:#1d1f22;color:#f1f1f1;border-color:#45434a}
.dark-mode .f2b-cs-pop .foot,.dark-mode .f2b-cs-modal footer{background:#1d1f22;border-color:#45434a}
.dark-mode .f2b-cs-pop .foot button:not(.dark),.dark-mode .f2b-cs-modal footer button:not(.dark):not(.danger){background:#2f3134;color:#f1f1f1;border-color:#45434a}
.dark-mode .f2b-cs-modal header{border-color:#45434a}

/* Marketing tab clean-up: legacy sections hidden (not deleted). Bring back: localStorage.setItem('f2b-marketing-legacy','on') */
html.f2b-mk-clean [data-f2b-legacy],
html.f2b-mk-clean .sites-page .sites-heading-actions,
html.f2b-mk-clean .sites-page .sites-account-connect,
html.f2b-mk-clean .sites-page .sites-connect-prompt,
html.f2b-mk-clean .sites-page .sites-elementor-prompt,
html.f2b-mk-clean .sites-page .sites-direct-connect,
html.f2b-mk-clean .sites-page .sites-page-loading,
html.f2b-mk-clean .sites-page .sites-public-inventory,
html.f2b-mk-clean .sites-page .sites-message{display:none!important}
html:not(.f2b-mk-clean) .f2b-mk-sub{display:none}
.f2b-cs-ltable{width:100%;border-collapse:collapse;font-size:12.5px;margin:6px 0 10px}.f2b-cs-ltable th{text-align:left;font-size:10px;letter-spacing:.08em;text-transform:uppercase;color:#7c8a83;padding:4px 6px;border-bottom:1px solid #e3e9e5}
.f2b-cs-ltable td{padding:7px 6px;border-bottom:1px solid #eef2ef;vertical-align:middle}.f2b-cs-ltable td.acts{text-align:right;white-space:nowrap}.f2b-cs-ltable td:first-child{word-break:break-all}.f2b-cs-ltable th:nth-child(4){white-space:nowrap}
.f2b-cs-ltable button,.f2b-cs-ladd button{border:1px solid #dfe6e1;background:#fff;border-radius:8px;padding:4px 9px;font-size:12px;cursor:pointer;margin-left:4px;color:inherit}
.f2b-cs-lst{font-size:11px;font-weight:800;border-radius:999px;padding:2px 8px}.f2b-cs-lst.active{background:#e4f2eb;color:#1f6e4b}.f2b-cs-lst.paused{background:#fff3df;color:#9a6112}.f2b-cs-lst.archived{background:#eef2ef;color:#6c7a73}
.f2b-cs-ladd{display:flex;gap:6px;align-items:center}.f2b-cs-ladd input{flex:1}.f2b-cs-ladd select{width:auto}.f2b-cs-ladd button.dark{background:#173f35;color:#fff;border-color:#173f35;padding:7px 12px}
.f2b-cs-lev{margin:6px 0 0;padding-left:18px;font-size:11.5px;color:#5d6b64;max-height:160px;overflow:auto}
.f2b-cs-web .pend{margin:12px 0 0;display:flex;gap:10px;align-items:center;background:#fff3df;border:1px solid #f0d6a8;color:#7a4c0e;border-radius:10px;padding:8px 12px;font-size:13px}.f2b-cs-web .pend button{margin-left:auto}
.dark-mode .f2b-cs-ltable button,.dark-mode .f2b-cs-ladd button:not(.dark){background:#1b1c1f;border-color:#4a4950;color:#eee}.dark-mode .f2b-cs-web .pend{background:#3a2f1c;border-color:#5b4724;color:#f2c879}
.f2b-cs-web{border:1px solid var(--f2b-border,#dfe4e8);border-radius:14px;background:#fff;padding:16px 18px;margin:0 0 16px;box-shadow:0 2px 10px #172b2808}
.f2b-cs-web .head{display:flex;align-items:flex-start;gap:12px;flex-wrap:wrap}
.f2b-cs-web .head h2{margin:2px 0 0;font-size:18px;display:flex;align-items:center;gap:8px}
.f2b-cs-web .head p{margin:3px 0 0;color:#6c7a73;font-size:12px}
.f2b-cs-web .head .r{margin-left:auto;display:flex;gap:8px;align-items:center}
.f2b-cs-web-badge{font-size:11px;font-weight:800;border-radius:999px;padding:3px 10px;letter-spacing:.02em}
.f2b-cs-web-badge.preview{background:#fff3df;color:#9a6112;border:1px solid #f0d6a8}
.f2b-cs-web-badge.live{background:#e4f2eb;color:#1f6e4b;border:1px solid #c7e3d5}
.f2b-cs-web-badge.unset{background:#eef2ef;color:#6c7a73;border:1px solid #dfe6e1}
.f2b-cs-web .links{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px;margin-top:14px}
.f2b-cs-web .link{border:1px solid #e3e9e5;border-radius:12px;padding:12px;display:grid;gap:8px;background:#fafcfa;min-width:0}
.f2b-cs-web .link small{font-size:10px;letter-spacing:.1em;text-transform:uppercase;font-weight:800;color:#7c8a83}
.f2b-cs-web .link code{font-size:12px;color:#2c3a34;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;background:none;padding:0}
.f2b-cs-web .link .unset{font-size:12px;color:#9aa59f;font-style:italic}
.f2b-cs-web .link a,.f2b-cs-web .link button{justify-self:start;text-decoration:none}
.f2b-cs-web .link button:disabled{opacity:.6;cursor:not-allowed}
.f2b-cs-web .note{margin:10px 0 0;font-size:11px;color:#7c8a83}
@media (max-width:900px){.f2b-cs-web .links{grid-template-columns:1fr}}
.dark-mode .f2b-cs-web{background:#242629;border-color:#45434a}
.dark-mode .f2b-cs-web .link{background:#1d1f22;border-color:#45434a}
.dark-mode .f2b-cs-web .link code{color:#e8e8e8}
.dark-mode .f2b-cs-web .head p,.dark-mode .f2b-cs-web .note{color:#a9b2ad}
.dark-mode .f2b-cs-web-badge.preview{background:#3a2f1c;color:#f2c879;border-color:#5b4724}
.dark-mode .f2b-cs-web-badge.live{background:#1d2e25;color:#9fdcb8;border-color:#3d6550}
.dark-mode .f2b-cs-web-badge.unset{background:#2f3134;color:#b9c0bc;border-color:#45434a}
`;
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const initials = n => String(n || '?').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  const logoHtml = (a, cls = '') => a === AGENCY ? `<span class="f2b-cs-logo agency ${cls}"><img alt="" src="/f2b-home-icon.png" onerror="this.replaceWith('F2B')"></span>`
    : `<span class="f2b-cs-logo ${cls}">${a.logo ? `<img alt="" src="${esc(a.logo)}">` : esc(initials(a.name))}</span>`;
  const AGENCY = { clientId: null, slug: '', name: 'F2B Media', agency: true };
  const LS = 'f2b-cs-current';

  let data = null;          // { accounts, agencyPipelines, pipelineClient, me }
  let current = AGENCY;     // AGENCY or an account
  let showArchived = false;
  let applyKey = '';        // changes on every switch so filters are re-applied once

  const api = async (body) => {
    const r = await fetch('/api/client-accounts' + (body ? '' : (data?.me?.admin ? '?include=archived' : '')), body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), cache: 'no-store' } : { cache: 'no-store' });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`);
    return j;
  };
  const accounts = () => (data?.accounts || []);
  const active = () => accounts().filter(a => a.status !== 'archived');
  const byId = id => accounts().find(a => a.clientId === id);
  const byName = n => accounts().find(a => a.name.trim().toLowerCase() === String(n || '').trim().toLowerCase());
  const toast = msg => { const t = document.createElement('div'); t.className = 'f2b-cs-toast'; t.textContent = msg; document.body.appendChild(t); setTimeout(() => t.remove(), 3200); };

  // ---------- state ----------
  function choose(acc, { silent = false } = {}) {
    current = acc && acc.clientId ? acc : AGENCY;
    localStorage.setItem(LS, current.clientId || 'agency');
    setCookie(current.clientId || 'agency');
    const u = new URL(location.href);
    if (current.clientId) u.searchParams.set('client', current.slug); else u.searchParams.delete('client');
    if (u.href !== location.href) history.replaceState(history.state, '', u);
    applyKey = (current.clientId || 'agency') + ':' + Date.now();
    render();
    if (!silent) { refreshCrmView(); openWorkroomIfOnClients(); }
  }
  function initialChoice() {
    const slug = new URL(location.href).searchParams.get('client');
    if (slug) { const a = active().find(x => x.slug === slug); if (a) return a; }
    const nativeSaved = localStorage.getItem('f2b-client-scope');
    if (nativeSaved) { const a = active().find(x => x.clientId === nativeSaved); if (a) return a; }
    const saved = nativeSaved === null ? localStorage.getItem(LS) : null;
    if (saved && saved !== 'agency') { const a = active().find(x => x.clientId === saved); if (a) return a; }
    return AGENCY;
  }

  // ---------- sidebar switcher ----------
  let wrap = null, pop = null, hoverIdx = -1;
  function mountSwitcher() {
    const aside = document.querySelector('aside.sidebar'); if (!aside) return;
    const brand = aside.querySelector('.sidebar-brand'); if (!brand) return;
    document.documentElement.classList.add('f2b-cs-on');
    if (!wrap || !wrap.isConnected || wrap.previousElementSibling !== brand) {
      wrap?.remove();
      wrap = document.createElement('div'); wrap.className = 'f2b-cs';
      wrap.innerHTML = '<button type="button" class="f2b-cs-trigger" aria-haspopup="listbox" aria-expanded="false"></button>';
      wrap.firstChild.addEventListener('click', e => { e.stopPropagation(); pop ? closePop() : openPop(); });
      brand.after(wrap);
    }
    const t = wrap.firstChild, isAg = !current.clientId;
    const label = isAg ? (data?.me?.admin ? 'Agency view' : 'All my clients') : 'Sub-account';
    const html = `${logoHtml(current, 'lg')}<span class="t"><small>${label}</small><b>${esc(current.name)}</b></span><span class="chev">⌄</span>`;
    if (t.dataset.html !== html) { t.innerHTML = html; t.dataset.html = html; }
    t.title = 'Switch client (sub-account)';
  }
  function rowsHtml(q) {
    const ql = q.trim().toLowerCase();
    const match = a => !ql || a.name.toLowerCase().includes(ql) || (a.services || []).some(s => s.toLowerCase().includes(ql)) || (a.siteKeys || []).some(k => (k.domain || '').includes(ql));
    const list = active().filter(match);
    const row = (a, i) => {
      const cur = (a.clientId || null) === (current.clientId || null);
      const sub = a === AGENCY ? (data.me.admin ? 'Agency view · all clients, agency pipeline' : 'Everything you can access')
        : [(a.services || []).slice(0, 2).join(' · '), (a.siteKeys || [])[0]?.domain].filter(Boolean).join(' · ') || 'Client sub-account';
      const meta = a === AGENCY ? '' : [
        a.newLeads7d ? `<span class="f2b-cs-badge lead" title="New website leads, last 7 days">${a.newLeads7d} new</span>` : '',
        a.overdue ? `<span class="f2b-cs-badge red" title="Overdue tasks">${a.overdue} overdue</span>` : '',
        `<span class="f2b-cs-badge" title="Open tasks">${a.open} open</span>`].join('');
      return `<button type="button" class="f2b-cs-row ${cur ? 'current' : ''}" role="option" aria-selected="${cur}" data-i="${i}" data-id="${esc(a.clientId || 'agency')}">
        ${logoHtml(a)}<span class="n"><b>${a === AGENCY ? (data.me.admin ? 'F2B Media · Agency' : 'All my clients') : esc(a.name)}</b><small>${esc(sub)}</small></span><span class="meta">${meta}<span class="f2b-cs-check">${cur ? '✓' : ''}</span></span></button>`;
    };
    const items = [];
    let html = '';
    if (!ql || 'agency f2b media'.includes(ql)) { html += `<div class="sec"><span>Agency</span></div>` + row(AGENCY, items.length); items.push(AGENCY); }
    html += `<div class="sec"><span>Sub-accounts</span><span>${list.length}</span></div>`;
    for (const a of list) { html += row(a, items.length); items.push(a); }
    if (!list.length) html += `<div class="empty">No client matches “${esc(q)}”.</div>`;
    return { html, items };
  }
  let items = [];
  function openPop() {
    if (!wrap) return;
    pop = document.createElement('div'); pop.className = 'f2b-cs-pop'; pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'Switch client');
    const admin = data?.me?.admin;
    pop.innerHTML = `<div class="search"><input type="search" placeholder="Search clients…" aria-label="Search clients" autocomplete="off"></div><div class="list" role="listbox"></div>
      ${admin ? `<div class="foot"><button type="button" data-a="manage">⚙︎ Manage clients</button><button type="button" class="dark" data-a="add">＋ Add client</button></div>` : ''}`;
    document.body.appendChild(pop);
    const r = wrap.getBoundingClientRect();
    pop.style.left = Math.max(8, Math.min(r.left, innerWidth - pop.offsetWidth - 8)) + 'px';
    pop.style.top = Math.min(r.bottom + 6, innerHeight - 120) + 'px';
    wrap.firstChild.classList.add('open'); wrap.firstChild.setAttribute('aria-expanded', 'true');
    const input = pop.querySelector('input'), list = pop.querySelector('.list');
    const draw = () => { const x = rowsHtml(input.value); list.innerHTML = x.html; items = x.items; hoverIdx = -1; };
    draw(); input.focus();
    input.addEventListener('input', draw);
    input.addEventListener('keydown', e => {
      const rows = [...list.querySelectorAll('.f2b-cs-row')];
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); hoverIdx = (hoverIdx + (e.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length; rows.forEach((x, i) => x.classList.toggle('hover', i === hoverIdx)); rows[hoverIdx]?.scrollIntoView({ block: 'nearest' }); }
      else if (e.key === 'Enter') { e.preventDefault(); const i = hoverIdx >= 0 ? hoverIdx : (input.value ? (items.length > 1 && items[0] === AGENCY ? 1 : 0) : -1); if (items[i]) { closePop(); choose(items[i]); } }
      else if (e.key === 'Escape') { closePop(); wrap.firstChild.focus(); }
    });
    list.addEventListener('click', e => { const b = e.target.closest('.f2b-cs-row'); if (!b) return; const a = items[+b.dataset.i]; closePop(); choose(a); });
    pop.querySelector('.foot')?.addEventListener('click', e => {
      const a = e.target.closest('button')?.dataset.a; if (!a) return; closePop();
      gotoClients(); if (a === 'add') setTimeout(() => document.querySelector('.page-heading .primary-button')?.click(), 250);
    });
    setTimeout(() => document.addEventListener('pointerdown', outside, true), 0);
    api().then(j => { data = j; if (pop) draw(); }).catch(() => {});
  }
  const outside = e => { if (pop && !pop.contains(e.target) && !wrap?.contains(e.target)) closePop(); };
  function closePop() { pop?.remove(); pop = null; document.removeEventListener('pointerdown', outside, true); wrap?.firstChild.classList.remove('open'); wrap?.firstChild.setAttribute('aria-expanded', 'false'); }

  // ---------- app navigation helpers ----------
  const navButton = label => [...document.querySelectorAll('aside.sidebar nav .nav-item')].find(b => b.textContent.replace(/\d+$/, '').trim().replace(/^[^A-Za-z]+/, '') === label);
  const currentView = () => document.querySelector('.breadcrumbs b')?.textContent.trim() || '';
  function gotoClients() { navButton('Clients')?.click(); }
  function refreshCrmView() {
    // /api/crm is scoped by the f2b_client cookie on the server; the CRM view loads once on mount, so remount it.
    if (!document.querySelector('.crm-workspace')) return;
    const other = navButton('Overview'), pipe = navButton('Pipeline'); if (!other || !pipe) return;
    other.click(); setTimeout(() => pipe.click(), 30);
  }
  function openWorkroomIfOnClients() {
    if (!document.querySelector('.clients-layout') || !current.clientId) return;
    [...document.querySelectorAll('.client-list-card')].find(c => c.querySelector('.client-card-name b')?.textContent.trim() === current.name)?.click();
  }

  // ---------- breadcrumb ----------
  function renderCrumb() {
    const bc = document.querySelector('.breadcrumbs'); if (!bc) return;
    let c = bc.querySelector(':scope > .f2b-cs-crumb');
    if (!c) { c = document.createElement('span'); c.className = 'f2b-cs-crumb'; bc.prepend(c); }
    const html = `${logoHtml(current)}<span>${esc(current.name)}</span><span class="f2b-cs-pill ${current.clientId ? '' : 'agency'}">${current.clientId ? 'Sub-account' : (data?.me?.admin ? 'Agency' : 'All my clients')}</span>`;
    if (c.dataset.html !== html) { c.innerHTML = html; c.dataset.html = html; }
  }

  // ---------- drive the app's own "All clients" filters ----------
  const setSelect = (sel, value) => {
    if (sel.value === value) return false;
    if (![...sel.options].some(o => o.value === value)) return false;
    Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value').set.call(sel, value);
    sel.dispatchEvent(new Event('change', { bubbles: true })); sel.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  };
  function applyFilters() {
    const want = current.clientId;
    for (const sel of document.querySelectorAll('main select, .page-content select, select#ai-task-client-filter')) {
      const opts = [...sel.options]; if (opts.length < 2) continue;
      const allOpt = opts.find(o => /^All clients$/i.test(o.text.trim()));
      if (!allOpt) continue;
      if (!opts.some(o => byId(o.value) || o.value === want)) continue;   // not a client filter
      if (sel.dataset.f2bCs === applyKey) continue;                       // applied for this switch; user may change it after
      sel.dataset.f2bCs = applyKey;
      setSelect(sel, want && opts.some(o => o.value === want) ? want : allOpt.value);
    }
    for (const sel of document.querySelectorAll('.sites-toolbar select')) {   // Marketing → Websites: follow the sub-account
      if (!current.clientId || sel.dataset.f2bCs === applyKey) continue;
      if (![...sel.options].some(o => /^Choose a client$/i.test(o.text.trim()))) continue;
      sel.dataset.f2bCs = applyKey; setSelect(sel, current.clientId);
    }
    scopePipelineSelect();
  }
  function syncSitesSelect() {
    for (const sel of document.querySelectorAll('.sites-toolbar select')) {   // Marketing → Websites: follow the sub-account
      if (!current.clientId || sel.dataset.f2bCs === applyKey) continue;
      if (![...sel.options].some(o => /^Choose a client$/i.test(o.text.trim()))) continue;
      sel.dataset.f2bCs = applyKey; setSelect(sel, current.clientId);
    }
  }
  function scopePipelineSelect() {
    if (!data) return;
    const lab = [...document.querySelectorAll('.crm-toolbar label')].find(l => /^Pipeline/.test(l.textContent.trim()));
    const sel = lab?.querySelector('select'); if (!sel) return;
    const pc = data.pipelineClient || {}, want = current.clientId || null;
    const inScope = o => o.value in pc ? (pc[o.value] || null) === want : !want;   // unknown (brand-new) pipeline: agency until reload
    let first = null;
    for (const o of sel.options) { const ok = inScope(o); o.hidden = !ok; o.disabled = !ok; if (ok && !first) first = o; }
    const curOk = sel.selectedOptions[0] && inScope(sel.selectedOptions[0]);
    if (!curOk && first) setSelect(sel, first.value);
    lab.classList.toggle('f2b-cs-nopipe', !first);
    lab.title = first ? '' : (want ? `No pipeline for ${current.name} yet. Use ＋ New pipeline to create one for this client.` : '');
  }

  // ---------- Clients page: archive / restore / settings ----------
  function enhanceClients() {
    const layout = document.querySelector('.clients-layout'); if (!layout || !data) return;
    const admin = data.me.admin;
    const listEl = layout.querySelector('.client-list');
    const archivedCount = accounts().filter(a => a.status === 'archived').length;
    if (listEl) {
      for (const card of listEl.querySelectorAll('.client-list-card')) {
        const a = byName(card.querySelector('.client-card-name b')?.textContent);
        const arch = a?.status === 'archived';
        card.classList.toggle('f2b-cs-archived', !!arch);
        card.classList.toggle('f2b-cs-hidden', !!arch && !showArchived);
      }
      let tg = listEl.querySelector(':scope > .f2b-cs-arch-toggle');
      if (admin && archivedCount) {
        if (!tg) { tg = document.createElement('button'); tg.type = 'button'; tg.className = 'f2b-cs-arch-toggle'; listEl.prepend(tg); tg.addEventListener('click', () => { showArchived = !showArchived; enhanceClients(); }); }
        const txt = `🗄 <b>${showArchived ? 'Hide' : 'Show'} archived</b> (${archivedCount})`;
        if (tg.innerHTML !== txt) tg.innerHTML = txt;
      } else tg?.remove();
    }
    const detail = layout.querySelector('.client-detail'); if (!detail) return;
    const a = byName(detail.querySelector('.client-detail-head h2')?.textContent);
    const acts = detail.querySelector('.client-head-actions'); if (!acts || !a) return;
    const arch = a.status === 'archived';
    acts.classList.toggle('f2b-cs-is-archived', arch);
    const del = acts.querySelector('.client-delete-button');
    if (del) { del.classList.toggle('f2b-cs-hidden', !arch); del.title = arch ? 'Permanently delete this archived client and its tasks' : ''; }
    let box = acts.querySelector(':scope > .f2b-cs-acts');
    const key = `${a.clientId}:${a.status}:${admin}`;
    if (box && box.dataset.key === key) return;
    box?.remove();
    if (!admin) return;
    box = document.createElement('span'); box.className = 'f2b-cs-acts'; box.dataset.key = key; box.style.display = 'contents';
    box.innerHTML = (arch ? `<span class="f2b-cs-status">🗄 Archived</span><button type="button" class="secondary-button" data-a="restore">♻️ Restore</button>`
      : `<button type="button" class="secondary-button" data-a="settings">⚙️ Settings</button><button type="button" class="secondary-button" data-a="archive">🗄 Archive</button>`);
    if (del) del.before(box); else acts.appendChild(box);
    box.addEventListener('click', e => { const act = e.target.closest('button')?.dataset.a; if (act === 'settings') settingsModal(a); if (act === 'archive') archiveModal(a); if (act === 'restore') restoreModal(a); });
  }

  function modal({ title, sub, logo, body, actions }) {
    const back = document.createElement('div'); back.className = 'f2b-cs-modal-back';
    back.innerHTML = `<div class="f2b-cs-modal" role="dialog" aria-modal="true" aria-label="${esc(title)}"><header>${logo || ''}<div><h2>${esc(title)}</h2>${sub ? `<small>${esc(sub)}</small>` : ''}</div></header>
      <div class="body">${body}</div><footer><span class="err" role="alert"></span>${actions.map((x, i) => `<button type="button" class="${x.cls || ''}" data-i="${i}">${esc(x.label)}</button>`).join('')}</footer></div>`;
    document.body.appendChild(back);
    const close = () => { back.remove(); document.removeEventListener('keydown', onKey, true); };
    const onKey = e => { if (e.key === 'Escape') { e.stopPropagation(); close(); } };
    document.addEventListener('keydown', onKey, true);
    back.addEventListener('pointerdown', e => { if (e.target === back) close(); });
    const err = back.querySelector('.err');
    back.querySelector('footer').addEventListener('click', async e => {
      const b = e.target.closest('button'); if (!b) return; const x = actions[+b.dataset.i];
      if (!x.run) return close();
      const btns = back.querySelectorAll('footer button'); btns.forEach(z => z.disabled = true); err.textContent = '';
      try { const keep = await x.run(back); if (!keep) close(); } catch (ex) { err.textContent = ex.message || String(ex); } finally { btns.forEach(z => z.disabled = false); }
    });
    back.querySelector('input,textarea,select,footer button')?.focus();
    return back;
  }
  const afterChange = async (msg) => { toast(msg); sessionStorage.setItem('f2b-cs-toast', msg); setTimeout(() => location.reload(), 700); };

  function archiveModal(a) {
    const keys = (a.siteKeys || []).filter(k => !k.paused);
    modal({ title: `Archive ${a.name}?`, sub: 'Nothing is deleted. You can restore it any time.', logo: logoHtml(a, 'lg'),
      body: `<div class="warn">Archiving will:<ul>
        <li>hide ${esc(a.name)} from the client switcher and the client lists</li>
        <li>move its <b>not-started (To do)</b> tasks to Pending with the reason “Client archived – paused”</li>
        <li>pause its bot flows</li>
        <li>turn off its client logins (they can’t sign in until you restore)</li>
        <li>${keys.length ? `pause website lead intake on <b>${keys.map(k => esc(k.domain || k.name)).join(', ')}</b> (forms will be rejected until restored)` : 'pause any website lead intake keys'}</li></ul></div>
        <p class="hint" style="margin-top:10px">In-progress and done tasks, contacts, opportunities, files and notes stay as they are. Delete becomes available only after archiving.</p>`,
      actions: [{ label: 'Cancel' }, { label: '🗄 Archive client', cls: 'danger', run: async () => {
        const r = await api({ action: 'archive', clientId: a.clientId });
        if (current.clientId === a.clientId) choose(AGENCY, { silent: true });
        afterChange(`${a.name} archived · ${r.tasksPaused || 0} tasks, ${r.flowsPaused || 0} flows, ${r.siteKeysPaused || 0} intake keys and ${r.loginsOff || 0} client logins paused`);
      } }] });
  }
  function restoreModal(a) {
    modal({ title: `Restore ${a.name}?`, sub: a.archivedAt ? `Archived ${new Date(a.archivedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' })}` : '', logo: logoHtml(a, 'lg'),
      body: `<div class="ok">Restoring brings back exactly what archiving paused: tasks still marked “Client archived – paused” go back to To do, bot flows resume and website lead intake starts accepting forms again.</div>`,
      actions: [{ label: 'Cancel' }, { label: '♻️ Restore client', cls: 'dark', run: async () => {
        const r = await api({ action: 'restore', clientId: a.clientId });
        afterChange(`${a.name} restored · ${r.tasksRestored || 0} tasks, ${r.flowsResumed || 0} flows and ${r.siteKeysResumed || 0} intake keys resumed`);
      } }] });
  }
  const TZS = ['Europe/Dublin', 'Europe/London', 'Europe/Paris', 'Europe/Berlin', 'Europe/Madrid', 'America/New_York', 'America/Chicago', 'America/Los_Angeles', 'Australia/Sydney', 'Asia/Dubai'];
  function settingsModal(a) {
    const s = a.settings || {}, b = s.emailBranding || {};
    const tz = s.timezone || 'Europe/Dublin';
    const tzs = TZS.includes(tz) ? TZS : [tz, ...TZS];
    const back = modal({ title: `${a.name} · settings`, sub: 'Used for lead emails, reminders and reports for this sub-account.', logo: logoHtml(a, 'lg'),
      body: `<h3>Timezone</h3><label>Timezone<select name="tz">${tzs.map(z => `<option ${z === tz ? 'selected' : ''}>${esc(z)}</option>`).join('')}</select></label>
        <h3>Email branding</h3><div class="g2">
          <label>From name<input name="fromName" maxlength="80" value="${esc(b.fromName || '')}" placeholder="${esc(a.name)}"></label>
          <label>Reply-to email<input name="replyTo" type="email" maxlength="254" value="${esc(b.replyTo || '')}" placeholder="office@…"></label>
          <label>Phone<input name="phone" maxlength="40" value="${esc(b.phone || '')}"></label>
          <label>Brand colour<input name="color" maxlength="7" value="${esc(b.color || '')}" placeholder="#C62828"></label></div>
          <label>Website<input name="website" maxlength="200" value="${esc(b.website || '')}" placeholder="https://"></label>
        <h3>Lead notifications</h3><label>Email these people when a new website lead arrives<textarea name="notify" placeholder="name@company.ie, other@company.ie">${esc((s.leadNotifyEmails || []).join(', '))}</textarea></label>
        <p class="hint">Up to 10 addresses, separated by commas. Website lead emails already sent to the site's own list keep going; these are added.</p>
        <h3>Client logins</h3><div class="f2b-cs-logins"><p class="hint">Loading…</p></div>`,
      actions: [{ label: 'Cancel' }, { label: 'Save settings', cls: 'dark', run: async back => {
        const v = n => back.querySelector(`[name=${n}]`).value.trim();
        const r = await api({ action: 'settings', clientId: a.clientId, settings: { timezone: v('tz'), emailBranding: { fromName: v('fromName'), replyTo: v('replyTo'), phone: v('phone'), color: v('color'), website: v('website') }, leadNotifyEmails: v('notify') } });
        a.settings = r.settings; toast(`Saved settings for ${a.name}`);
      } }] });
    clientLogins(back.querySelector('.f2b-cs-logins'), a);
  }
  // Clients → client → Settings → Client logins (sign-in is the existing Cloudflare Access email code; Website & SEO only)
  async function clientLogins(el, a) {
    if (!el) return;
    const get = async () => { const r = await fetch(`/api/client-accounts?op=client-users&clientId=${encodeURIComponent(a.clientId)}`, { cache: 'no-store' }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || `Request failed (${r.status})`); return j; };
    const fmt = t => t ? new Date(t).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }) : 'Never';
    const draw = async (msg = '') => {
      let d; try { d = await get(); } catch (e) { el.innerHTML = `<p class="hint">${esc(e.message)}</p>`; return; }
      if (!d.ready) { el.innerHTML = '<p class="hint">Client logins are not set up yet (the client_users table is created by the drop-in migration).</p>'; return; }
      const arch = a.status === 'archived';
      el.innerHTML = `<p class="hint" style="margin-top:0">People at ${esc(a.name)} who can sign in with their email (one-time code) and edit <b>only this client’s website & SEO</b>. Their edits go to the preview and wait for your approval. They never see agency data, other clients, CRM, tasks, billing or bots.</p>
        ${d.users.length ? `<table class="f2b-cs-ltable"><thead><tr><th>Email</th><th>Can edit</th><th>Status</th><th>Last sign-in</th><th></th></tr></thead><tbody>${d.users.map(u => `<tr data-id="${esc(u.id)}"><td>${esc(u.email)}</td><td>${esc(u.scopeLabel)}</td><td><span class="f2b-cs-lst ${esc(u.status)}">${u.status === 'active' ? 'Active' : u.status === 'paused' ? 'Paused' : 'Off (client archived)'}</span></td><td>${esc(fmt(u.lastSeen))}</td>
          <td class="acts">${u.status === 'archived' ? '' : `<button type="button" data-l="${u.status === 'active' ? 'pause' : 'resume'}">${u.status === 'active' ? '⏸ Pause' : '▶ Resume'}</button>`}<button type="button" data-l="remove">✕ Remove</button></td></tr>`).join('')}</tbody></table>` : '<p class="hint">No client logins yet.</p>'}
        ${arch ? '<p class="hint">This client is archived, so its logins are off. Restore the client to turn them back on.</p>' : `<div class="f2b-cs-ladd"><input type="email" name="cuEmail" maxlength="254" placeholder="name@client.ie" aria-label="Client email"><select name="cuScope" aria-label="Can edit">${d.scopes.map(x => `<option value="${esc(x.value)}">${esc(x.label)} only</option>`).join('')}</select><button type="button" class="dark" data-l="add">+ Add login</button></div>`}
        <p class="hint">Adding a login here does not send an invite. The person can sign in once their email is also allowed in Cloudflare Access (a manual step, see PATCHES.md).</p>
        ${msg ? `<p class="hint" role="status" style="color:#1f6e4b;font-weight:700">${esc(msg)}</p>` : ''}
        ${d.events.length ? `<details><summary class="hint" style="cursor:pointer">Recent client activity (${d.events.length})</summary><ul class="f2b-cs-lev">${d.events.map(e => `<li><b>${esc(e.action)}</b> · ${esc(e.email)} · ${esc(fmt(e.created_at))}${e.detail ? ` · ${esc(e.detail)}` : ''}</li>`).join('')}</ul></details>` : ''}`;
      el.querySelectorAll('[data-l]').forEach(b => b.onclick = async () => {
        const act = b.dataset.l, id = b.closest('tr')?.dataset.id;
        try {
          b.disabled = true;
          if (act === 'add') { const email = el.querySelector('[name=cuEmail]').value.trim(); await api({ action: 'client-user-add', clientId: a.clientId, email, scope: el.querySelector('[name=cuScope]').value }); return draw(`Added ${email}.`); }
          if (act === 'remove') { if (!confirm('Remove this login? They will not be able to sign in any more.')) { b.disabled = false; return; } await api({ action: 'client-user-remove', clientId: a.clientId, id }); return draw('Login removed.'); }
          await api({ action: 'client-user-status', clientId: a.clientId, id, status: act === 'pause' ? 'paused' : 'active' }); return draw(act === 'pause' ? 'Login paused.' : 'Login resumed.');
        } catch (e) { b.disabled = false; const m = el.querySelector('.f2b-cs-lerr') || el.appendChild(Object.assign(document.createElement('p'), { className: 'f2b-cs-lerr hint' })); m.style.color = '#b3261e'; m.style.fontWeight = '700'; m.textContent = e.message; }
      });
    };
    draw();
  }


  // ---------- Marketing → Websites: per-client website links (preview / live / editor) ----------
  const WEB_LBL = { preview: 'Preview', live: 'Live' };
  function renderWebsite() {
    const shell = document.querySelector('.sites-page .sites-shell');
    const toolbar = shell?.querySelector(':scope > .sites-toolbar');
    let box = document.querySelector('.f2b-cs-web');
    const sel = toolbar?.querySelector('select');
    const a = sel ? byId(sel.value) : null;
    if (!toolbar || !a) { box?.remove(); if (editor && !toolbar) { editor.root.remove(); editor = null; editorOpen = null; } else if (editor) editor.close(true); return; }
    const w = a.websiteLinks || {}, admin = !!data.me.admin;
    const key = JSON.stringify([a.clientId, w, admin, editorOpen === a.clientId, a.pendingClientEdits || 0]);
    if (box && box.dataset.key === key && box.previousElementSibling === toolbar) return;
    box?.remove();
    box = document.createElement('section'); box.className = 'f2b-cs-web'; box.dataset.key = key; box.setAttribute('aria-label', `${a.name} website`);
    const st = WEB_LBL[w.status] ? w.status : '';
    const link = (label, url, btn, opts = {}) => `<div class="link"><small>${label}</small>${url ? `<code title="${esc(url)}">${esc(url.replace(/^https:\/\//, ''))}</code>` : '<span class="unset">Not set</span>'}
      ${opts.disabled ? `<button type="button" class="secondary-button" disabled title="${esc(opts.why)}">🔒 ${esc(opts.why)}</button>`
        : url ? `<a class="${opts.primary ? 'primary-button' : 'secondary-button'}" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${btn} ↗</a>`
        : `<button type="button" class="secondary-button" disabled>${btn}</button>`}</div>`;
    box.innerHTML = `<div class="head"><div><p class="eyebrow">🌐 WEBSITE · ${esc(a.name.toUpperCase())}</p>
        <h2>Website <span class="f2b-cs-web-badge ${st || 'unset'}">${st ? (st === 'live' ? '● Live' : '◐ Preview') : 'Status not set'}</span></h2>
        <p>${st === 'preview' ? 'The new site is on a preview address. Edit its content below; changes stay on the preview.' : st === 'live' ? 'The site is live on its own domain. Edits below still go to the preview copy first.' : 'Add this client’s preview and live links.'}${w.updatedAt ? ` · Updated ${esc(new Date(w.updatedAt).toLocaleString('en-GB', { dateStyle: 'medium', timeStyle: 'short' }))}` : ''}</p></div>
        ${admin ? `<div class="r"><button type="button" class="secondary-button" data-a="edit">✏️ Edit links</button></div>` : ''}</div>
      <div class="links">${link('Preview', w.previewUrl, '👀 Open preview', { primary: st === 'preview' })}${link('Live site', w.liveUrl, '🌐 Open live site', { primary: st === 'live' })}
        <div class="link"><small>Content & SEO</small><span class="unset" style="font-style:normal;color:#5d6b64">Edit pages, images, sections and SEO right here. Saves go to the preview copy only.</span>
          <button type="button" class="${editorOpen === a.clientId ? 'secondary-button' : 'primary-button'}" data-a="content">${editorOpen === a.clientId ? '✕ Close editor' : admin ? '✏️ Edit site content' : '👀 View site content'}</button></div></div>
      ${admin && a.pendingClientEdits ? `<div class="pend">🟠 <b>${a.pendingClientEdits} client edit${a.pendingClientEdits > 1 ? 's' : ''}</b> waiting for your approval (made with ${esc(a.name)}’s own login).<button type="button" class="primary-button" data-a="review">Review</button></div>` : ''}
      <p class="note">Publishing to the live site is a separate step that only Sean approves. Nothing in this editor touches the live domain.</p>`;
    toolbar.after(box);
    box.querySelector('[data-a=edit]')?.addEventListener('click', () => websiteModal(a));
    box.querySelector('[data-a=content]')?.addEventListener('click', () => toggleEditor(a, box));
    box.querySelector('[data-a=review]')?.addEventListener('click', async () => { if (editorOpen !== a.clientId) await toggleEditor(a, box); const t0 = Date.now(); const go = () => { const b = editor?.root.querySelector('[data-a=approvals]'); if (b) b.click(); else if (Date.now() - t0 < 8000) setTimeout(go, 150); }; go(); });
    if (editor && editorOpen !== a.clientId) editor.close(true);
    if (editor && editorOpen === a.clientId && editor.root.isConnected) box.after(editor.root);
  }
  // in-app content editor (public/f2b-site-editor.js, loaded on first use)
  let editor = null, editorOpen = null;
  const loadEditor = () => window.f2bSiteEditor ? Promise.resolve() : new Promise((ok, bad) => { const s = document.createElement('script'); s.src = '/f2b-site-editor.js'; s.onload = ok; s.onerror = () => bad(new Error('Could not load the editor.')); document.head.appendChild(s); });
  async function toggleEditor(a, box) {
    if (editor && editorOpen === a.clientId) { editor.close(); return; }
    try { await loadEditor(); } catch (e) { toast(e.message); return; }
    if (editor) editor.close();
    if (editor) return;   // user kept unsaved changes
    editorOpen = a.clientId;
    editor = window.f2bSiteEditor.mount(box, { clientId: a.clientId, name: a.name, admin: !!data.me.admin, onClose: ({ lost } = {}) => { if (lost) toast('Editor closed · unsaved changes were not saved'); editor = null; editorOpen = null; document.querySelector('.f2b-cs-web')?.remove(); schedule(); } });
    box.remove(); schedule();
  }
  function websiteModal(a) {
    const w = a.websiteLinks || {};
    modal({ title: `${a.name} · website links`, sub: 'Shown in Marketing → Websites. Links open in a new tab.', logo: logoHtml(a, 'lg'),
      body: `<h3>Status</h3><label>Website status<select name="status"><option value="" ${!w.status ? 'selected' : ''}>Not set</option><option value="preview" ${w.status === 'preview' ? 'selected' : ''}>Preview (not live yet)</option><option value="live" ${w.status === 'live' ? 'selected' : ''}>Live</option></select></label>
        <h3>Links</h3>
        <label>Preview URL<input name="previewUrl" type="url" maxlength="300" value="${esc(w.previewUrl || '')}" placeholder="https://client-preview.f2b-media.workers.dev"></label>
        <label>Live URL<input name="liveUrl" type="url" maxlength="300" value="${esc(w.liveUrl || '')}" placeholder="https://client.ie"></label>
        <p class="hint">Full https:// addresses only. Leave a field empty to show “Not set”. Content is edited in-app with “Edit site content”, so no external editor link is needed.</p>`,
      actions: [{ label: 'Cancel' }, { label: 'Save links', cls: 'dark', run: async back => {
        const v = n => back.querySelector(`[name=${n}]`).value.trim();
        const r = await api({ action: 'website', clientId: a.clientId, website: { status: v('status'), previewUrl: v('previewUrl'), liveUrl: v('liveUrl'), editorUrl: '' } });
        a.websiteLinks = r.website; schedule(); toast(`Saved website links for ${a.name}`);
      } }] });
  }

  // ---------- Marketing tab clean-up (Sean 12 Nov: "Build it in the marketing tab just remove what's there") ----------
  // Hidden with CSS only; nothing is deleted. Kept: Websites (client site select, new Website section + editor, technical site check),
  // SEO, Google Ads. Hidden in Websites: WordPress account card, Connect WordPress prompt, WordPress page list, Elementor prompt, direct connect, WordPress loading box, header WordPress buttons. Per browser: localStorage.setItem('f2b-marketing-legacy','on') brings every legacy section back.
  const LEGACY_HUB_TABS = ['Tracking & Analytics', 'Email Marketing', 'Cold Outreach', 'Marketing Automations', 'Meta Ads', 'Proposals', 'Reporting'];
  const LEGACY_SITE_TABS = ['Landing Pages', 'Forms', 'Surveys'];
  const legacyOn = () => { try { return localStorage.getItem('f2b-marketing-legacy') === 'on'; } catch { return false; } };
  const btnName = b => b.textContent.replace(/^[^A-Za-z]+/, '').trim();
  function cleanMarketing() {
    const on = !legacyOn();
    document.documentElement.classList.toggle('f2b-mk-clean', on);
    if (!on) return;
    const hub = document.querySelector('.marketing-hub-tabs');
    if (hub) {
      for (const b of hub.querySelectorAll('button')) if (LEGACY_HUB_TABS.includes(btnName(b)) && !b.hasAttribute('data-f2b-legacy')) b.setAttribute('data-f2b-legacy', '');
      const act = hub.querySelector('button.active[data-f2b-legacy]');
      if (act) [...hub.querySelectorAll('button')].find(b => btnName(b) === 'Websites')?.click();
      const sub = hub.parentElement?.querySelector(':scope > div.marketing-subnav');
      if (sub) {
        for (const b of sub.querySelectorAll('button')) if (LEGACY_SITE_TABS.includes(btnName(b)) && !b.hasAttribute('data-f2b-legacy')) b.setAttribute('data-f2b-legacy', '');
        if (sub.querySelector('button.active[data-f2b-legacy]')) [...sub.querySelectorAll('button')].find(b => btnName(b) === 'Website')?.click();
      }
    }
    const head = document.querySelector('.sites-page .sites-heading');
    if (head && !head.querySelector('.f2b-mk-sub')) {
      const p = [...head.querySelectorAll('p')].find(x => /WordPress/i.test(x.textContent));
      if (p) { p.setAttribute('data-f2b-legacy', ''); const n = document.createElement('p'); n.className = 'f2b-mk-sub'; n.textContent = 'Edit each client’s website content and SEO. Changes go to the preview first.'; p.after(n); }
    }
  }

  // ---------- render loop ----------
  let raf = 0;
  function render() {
    if (!data) return;
    // The app has its own native client picker (sidebar) that sets the f2b_client cookie and filters every view,
    // so this script no longer mounts a second switcher / breadcrumb / filter syncing. It keeps: Clients settings & archive,
    // client logins, Website section + editor, and the Marketing clean-up.
    syncSitesSelect(); enhanceClients(); cleanMarketing(); renderWebsite();
  }
  const schedule = () => { if (!raf) raf = requestAnimationFrame(() => { raf = 0; try { render(); } catch (e) { console.warn('[f2b-client-switcher]', e); } }); };

  async function boot() {
    const t = sessionStorage.getItem('f2b-cs-toast'); if (t) { sessionStorage.removeItem('f2b-cs-toast'); setTimeout(() => toast(t), 1200); }
    const css = document.createElement('style'); css.id = 'f2b-client-switcher-css'; css.textContent = CSS;
    try { data = await (await fetch('/api/client-accounts?include=archived', { cache: 'no-store' })).json(); } catch { data = null; }
    if (!data || !Array.isArray(data.accounts)) { data = null; setCookie(null); return; }   // route not deployed / not signed in: leave the app untouched
    document.head.appendChild(css);
    choose(initialChoice(), { silent: true });
    new MutationObserver(schedule).observe(document.body, { childList: true, subtree: true });
    setInterval(() => api().then(j => { data = j; if (current.clientId && !active().some(a => a.clientId === current.clientId)) choose(AGENCY, { silent: true }); else { current = current.clientId ? (byId(current.clientId) || current) : AGENCY; schedule(); } }).catch(() => {}), 120000);
    window.addEventListener('f2b-scope', e => { const id = e.detail || ''; choose(id ? (byId(id) || AGENCY) : AGENCY, { silent: true }); });
    window.f2bClientSwitcher = { get current() { return current; }, choose: id => choose(id ? byId(id) : AGENCY), reload: () => api().then(j => { data = j; schedule(); }) };
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
