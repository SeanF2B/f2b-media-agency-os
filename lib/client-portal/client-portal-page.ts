// @ts-nocheck  (plain JS module, shared with the companion worker and tested in node; kept as-is)
// The only page a client login can open: their own website (Marketing → Website & SEO). Served by client-portal-gate.js.
// It never loads the agency app shell, so no agency data is ever sent to a client browser.
export const PAUSED_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Login paused</title>
<style>body{font-family:Inter,system-ui,sans-serif;background:#f4f6f5;display:grid;place-items:center;min-height:100vh;margin:0;color:#1f2a25}.c{background:#fff;border:1px solid #dfe4e8;border-radius:16px;padding:28px 32px;max-width:420px;text-align:center}a{color:#173f35;font-weight:700}</style></head>
<body><div class="c"><h1 style="font-size:20px">Your login is paused</h1><p>Please contact F2B Media if you need access to your website editor again.</p><p><a href="/cdn-cgi/access/logout">Sign out</a></p></div></body></html>`;

export const PORTAL_HTML = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>Your website · F2B Media</title>
<style>
*{box-sizing:border-box}body{margin:0;font-family:Inter,ui-sans-serif,system-ui,-apple-system,"Segoe UI",sans-serif;background:#f4f6f5;color:#1f2a25;font-size:14px}
.app{display:grid;grid-template-columns:230px minmax(0,1fr);min-height:100vh}
aside{background:#17191c;color:#e8ece9;padding:16px 12px;display:flex;flex-direction:column;gap:14px;position:sticky;top:0;height:100vh}
aside .brand{display:flex;align-items:center;gap:10px;font-weight:800;font-size:14px;padding:4px 6px}
aside .brand img,aside .brand .ini{width:34px;height:34px;border-radius:9px;background:#fff;object-fit:contain;display:grid;place-items:center;color:#173f35;font-weight:800}
aside .acct{background:#23262a;border:1px solid #33373c;border-radius:12px;padding:10px 12px}aside .acct small{display:block;font-size:9.5px;letter-spacing:.14em;color:#9aa59f;font-weight:800}aside .acct b{font-size:13px}
aside h6{margin:6px 8px 0;font-size:10px;letter-spacing:.14em;color:#8b958f}
aside nav a{display:flex;align-items:center;gap:10px;padding:9px 12px;border-radius:10px;color:#e8ece9;text-decoration:none;font-weight:600}
aside nav a.on{background:#2f7de1;color:#fff}aside nav a.sub{margin-left:14px;font-size:13px;padding:7px 12px}
aside .foot{margin-top:auto;font-size:12px;color:#9aa59f;padding:8px;border-top:1px solid #2c3034}aside .foot a{color:#cfe0d6}
header.top{display:flex;align-items:center;gap:12px;padding:14px 26px;background:#fff;border-bottom:1px solid #e3e8e5;position:sticky;top:0;z-index:5}
header.top .crumb{font-size:13px;color:#5d6b64}header.top .crumb b{color:#1f2a25}header.top .r{margin-left:auto;font-size:12px;color:#5d6b64;display:flex;gap:12px;align-items:center}
header.top .r a{color:#173f35;font-weight:700}
main.page{padding:22px 26px;max-width:1280px}
h1{font-size:24px;margin:0 0 4px}.lead{color:#5d6b64;margin:0 0 16px}
.f2b-cs-web{border:1px solid #dfe4e8;border-radius:14px;background:#fff;padding:16px 18px;margin:0 0 16px}
.badge{font-size:11px;font-weight:800;border-radius:999px;padding:3px 10px;margin-left:8px;vertical-align:middle}.badge.preview{background:#fff3df;color:#9a6112;border:1px solid #f0d6a8}.badge.live{background:#e4f2eb;color:#1f6e4b;border:1px solid #c7e3d5}
.links{display:flex;gap:10px;flex-wrap:wrap;margin-top:12px}
.primary-button,.secondary-button{display:inline-flex;align-items:center;gap:6px;border-radius:10px;padding:8px 13px;font:inherit;font-size:13px;font-weight:700;cursor:pointer;text-decoration:none;border:1px solid #d5ddd8;background:#fff;color:#1f2a25}
.primary-button{background:#2f7de1;border-color:#2f7de1;color:#fff}
.note{font-size:12px;color:#6c7a73;margin:10px 0 0}
.err{color:#8d2a20;background:#fdecea;border:1px solid #f3c7c2;border-radius:10px;padding:12px}
@media (max-width:860px){.app{grid-template-columns:1fr}aside{position:static;height:auto}}
</style></head>
<body><div class="app"><aside aria-label="Navigation"><div class="brand"><span class="ini" id="logo">F2B</span><span>F2B Media</span></div>
<div class="acct"><small>YOUR WEBSITE</small><b id="cname">…</b></div>
<h6>MENU</h6><nav><a href="/client-portal" class="on">📣 Marketing</a><a href="/client-portal" class="sub on" aria-current="page" style="background:#23262a">🌐 Website &amp; SEO</a></nav>
<div class="foot">Signed in as<br><b id="who"></b><br><a href="/cdn-cgi/access/logout">Sign out</a></div></aside>
<div><header class="top"><span class="crumb"><span id="cname2"></span> / <b>Website &amp; SEO</b></span><span class="r"><span>Need help? Contact F2B Media</span><a href="/cdn-cgi/access/logout">Sign out</a></span></header>
<main class="page"><h1>Your website</h1><p class="lead">Edit your pages, photos and Google listing text. Changes go to your preview site first and F2B Media checks every change before it goes live.</p>
<section class="f2b-cs-web" id="web"><div>Loading…</div></section></main></div></div>
<script>
(async () => {
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const web = document.getElementById('web');
  let me; try { const r = await fetch('/api/client-portal/me', { cache: 'no-store' }); me = await r.json(); if (!r.ok) throw new Error(me.error || 'Could not load your account'); }
  catch (e) { web.innerHTML = '<div class="err">' + esc(e.message) + '</div>'; return; }
  document.getElementById('cname').textContent = me.client.name; document.getElementById('cname2').textContent = me.client.name; document.getElementById('who').textContent = me.email;
  document.title = me.client.name + ' · Website & SEO';
  if (me.client.logo && /^(https:|data:image\\/)/.test(me.client.logo)) { const i = document.createElement('img'); i.alt = ''; i.src = me.client.logo; document.getElementById('logo').replaceWith(i); }
  const w = me.website, st = w.status;
  web.innerHTML = '<h2 style="margin:0;font-size:18px">' + esc(me.client.name) + (st ? '<span class="badge ' + esc(st) + '">' + (st === 'live' ? '● Live' : '◐ Preview') + '</span>' : '') + '</h2>'
    + '<div class="links">' + (w.previewUrl ? '<a class="primary-button" href="' + esc(w.previewUrl) + '" target="_blank" rel="noopener noreferrer">👀 Open preview site ↗</a>' : '')
    + (w.liveUrl && st === 'live' ? '<a class="secondary-button" href="' + esc(w.liveUrl) + '" target="_blank" rel="noopener noreferrer">🌐 Open live site ↗</a>' : '') + '</div>'
    + '<p class="note">Your login can edit: <b>' + esc(me.scopeLabel) + '</b>. Saving never changes your live website.</p>'
    + '<p><button type="button" class="primary-button" id="open-builder">🧱 Open visual builder</button></p>';
  document.getElementById('open-builder').onclick = () => { const b = document.createElement('script'); b.src = '/f2b-site-builder.js'; b.onload = () => window.f2bSiteBuilder.open({ clientId: me.client.id, name: me.client.name }); document.head.appendChild(b); };
  (() => {
    const br = me.branding || {}, card = document.createElement('section'); card.className = 'f2b-cs-web'; card.style.marginTop = '16px';
    card.innerHTML = '<h2 style="margin:0;font-size:18px">Your brand</h2><p class="note">Your logo and two colours. F2B Media uses them in your account.</p>'
      + '<div style="display:flex;gap:14px;align-items:center;flex-wrap:wrap;margin:12px 0"><img id="bl" alt="" style="width:64px;height:64px;object-fit:contain;border:1px solid #d0d5dd;border-radius:12px;background:#fff;display:' + (br.logo || me.client.logo ? 'block' : 'none') + '"><label class="secondary-button" style="cursor:pointer">Upload logo<input id="bf" type="file" accept="image/*" hidden></label>'
      + '<label>Main colour <input id="bp" type="color" value="' + esc(br.primary || '#3b82f6') + '"></label><label>Second colour <input id="bs" type="color" value="' + esc(br.secondary || '#1e3a8a') + '"></label></div>'
      + '<button type="button" class="primary-button" id="bsave">Save brand</button> <span id="bmsg" role="status" style="margin-left:8px"></span>';
    web.after(card);
    const img = card.querySelector('#bl'); img.src = br.logo || me.client.logo || ''; let logo = br.logo || '';
    card.querySelector('#bf').onchange = async (e) => {
      const f = e.target.files[0]; if (!f) return; const msg = card.querySelector('#bmsg');
      try {
        if (!/^image\\//.test(f.type)) throw new Error('Choose an image file.');
        const url = URL.createObjectURL(f); const im = await new Promise((ok, bad) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => bad(new Error('That image could not be read.')); i.src = url; });
        const k = Math.min(1, 256 / Math.max(im.naturalWidth || 256, im.naturalHeight || 256)), c = document.createElement('canvas'); c.width = Math.max(1, Math.round(im.naturalWidth * k)); c.height = Math.max(1, Math.round(im.naturalHeight * k));
        c.getContext('2d').drawImage(im, 0, 0, c.width, c.height); logo = c.toDataURL('image/png'); img.src = logo; img.style.display = 'block'; msg.textContent = '';
      } catch (er) { msg.textContent = er.message; }
    };
    card.querySelector('#bsave').onclick = async () => {
      const msg = card.querySelector('#bmsg'); msg.textContent = 'Saving…';
      try { const r = await fetch('/api/client-portal/brand', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ primary: card.querySelector('#bp').value, secondary: card.querySelector('#bs').value, logo }) }); const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'Could not save.'); msg.textContent = 'Saved ✓'; }
      catch (er) { msg.textContent = er.message; }
    };
  })();
  const s = document.createElement('script'); s.src = '/f2b-site-editor.js';
  s.onload = () => window.f2bSiteEditor.mount(web, { clientId: me.client.id, name: me.client.name, admin: false, embedded: true });
  document.head.appendChild(s);
})();
</script></body></html>`;
