/* F2B Agency OS · visual website builder (no dependencies, loaded on demand).
   Opens a full-screen drag-and-drop builder for one client site. Used by Marketing → Websites (agency) and the client portal.
   Pages are saved through /api/client-site (ops builder-*), into the same site content store as the form editor.
   There is no publish path: saves only go to the preview working copy (clients' saves become "Client edit" approvals).
   API:  window.f2bSiteBuilder.open({ clientId, name, onClose })  */
(() => {
  if (window.f2bSiteBuilder) return;

  /* ---------------------------------------------------------------- tiny DOM helper */
  const h = (tag, attrs, ...kids) => {
    const el = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs || {})) {
      if (v === false || v == null) continue;
      if (k === 'class') el.className = v; else if (k === 'text') el.textContent = v;
      else if (k.startsWith('on')) el.addEventListener(k.slice(2), v); else el.setAttribute(k, v === true ? '' : v);
    }
    for (const kid of kids.flat()) if (kid != null && kid !== false) el.append(kid.nodeType ? kid : document.createTextNode(String(kid)));
    return el;
  };
  const uid = () => 'b' + Math.random().toString(36).slice(2, 10);
  const clone = v => JSON.parse(JSON.stringify(v));
  const SEO_T = 60, SEO_D = 155;

  /* ---------------------------------------------------------------- styles */
  const CSS = `
.sb{position:fixed;inset:0;z-index:100000;display:grid;grid-template-rows:auto 1fr;font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:var(--fg);background:var(--bg);--bg:#f3f5f8;--panel:#fff;--fg:#1c2330;--mut:#667085;--line:#dfe4ec;--acc:#2f7de1;--acc-soft:#e8f1fd;--danger:#d92d20;--ok:#12a150}
.sb[data-theme=dark]{--bg:#17181c;--panel:#222429;--fg:#eceff4;--mut:#9aa3b2;--line:#363a42;--acc:#4a93f0;--acc-soft:#1d2c42;--danger:#f97066;--ok:#32d583}
.sb *{box-sizing:border-box}
.sb button{font:inherit;color:inherit;cursor:pointer}
.sb-top{display:flex;align-items:center;gap:10px;flex-wrap:wrap;padding:10px 14px;background:var(--panel);border-bottom:1px solid var(--line)}
.sb-top .grow{flex:1;min-width:8px}
.sb-btn{display:inline-flex;align-items:center;gap:6px;min-height:36px;padding:0 12px;border-radius:10px;border:1px solid var(--line);background:var(--panel);font-weight:600;transition:background .15s,border-color .15s,transform .15s}
.sb-btn:hover:not(:disabled){border-color:var(--acc);background:var(--acc-soft);transform:translateY(-1px)}
.sb-btn:disabled{opacity:.45;cursor:not-allowed}
.sb-btn.primary{background:var(--acc);border-color:var(--acc);color:#fff}.sb-btn.primary:hover:not(:disabled){filter:brightness(1.08);background:var(--acc)}
.sb-btn.icon{width:36px;padding:0;justify-content:center}
.sb select,.sb input,.sb textarea{font:inherit;color:var(--fg);background:var(--panel);border:1px solid var(--line);border-radius:9px;padding:8px 10px;min-height:36px;max-width:100%}
.sb input:focus,.sb textarea:focus,.sb select:focus{outline:2px solid var(--acc);outline-offset:0;border-color:var(--acc)}
.sb-seg{display:inline-flex;border:1px solid var(--line);border-radius:10px;overflow:hidden}.sb-seg button{border:0;background:transparent;min-height:34px;padding:0 12px;font-weight:600}.sb-seg button.on{background:var(--acc);color:#fff}
.sb-main{display:grid;grid-template-columns:320px 1fr;min-height:0}
@media(max-width:900px){.sb-main{grid-template-columns:1fr;grid-template-rows:auto 1fr}.sb-side{max-height:40vh}}
.sb-side{background:var(--panel);border-right:1px solid var(--line);display:flex;flex-direction:column;min-height:0}
.sb-tabs{display:flex;border-bottom:1px solid var(--line)}.sb-tabs button{flex:1;border:0;background:transparent;padding:12px 6px;font-weight:700;color:var(--mut);border-bottom:3px solid transparent}.sb-tabs button.on{color:var(--acc);border-bottom-color:var(--acc)}
.sb-pane{overflow:auto;padding:14px;display:grid;gap:12px;align-content:start}
.sb-lib{display:grid;grid-template-columns:1fr 1fr;gap:10px}
.sb-card{border:1px solid var(--line);border-radius:12px;padding:8px;background:var(--panel);cursor:grab;display:grid;gap:6px;text-align:center;transition:border-color .15s,transform .15s,box-shadow .15s}
.sb-card:hover{border-color:var(--acc);transform:translateY(-2px);box-shadow:0 6px 16px rgba(0,0,0,.12)}.sb-card:active{cursor:grabbing}
.sb-card svg{width:100%;height:auto;display:block;border-radius:6px;background:var(--bg)}.sb-card b{font-size:12.5px}
.sb-field{display:grid;gap:5px}.sb-field label,.sb-lab{font-weight:700;font-size:12.5px}
.sb-count{font-size:12px;color:var(--mut);justify-self:end}.sb-count.over{color:var(--danger);font-weight:800}
.sb-google{border:1px solid var(--line);border-radius:12px;padding:12px;background:#fff;color:#202124;display:grid;gap:2px;font-family:Arial,sans-serif}
.sb-google .u{font-size:12px;color:#4d5156;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.sb-google .t{font-size:19px;line-height:1.25;color:#1a0dab}.sb-google .d{font-size:13px;color:#4d5156}
.sb-checks{display:grid;gap:4px;font-size:12.5px}.sb-checks .ok{color:var(--ok)}.sb-checks .no{color:var(--mut)}
.sb-stage{overflow:auto;padding:20px;min-height:0;position:relative}
.sb-banner{margin:0 0 12px;padding:10px 14px;border-radius:10px;background:var(--acc-soft);border:1px solid var(--acc);font-weight:600}
.sb-banner.err{background:rgba(217,45,32,.12);border-color:var(--danger)}
.sb-frame{margin:0 auto;background:#fff;color:#1c2330;border-radius:14px;box-shadow:0 10px 40px rgba(0,0,0,.18);overflow:hidden;container-type:inline-size;transition:max-width .25s ease;width:100%;font-family:var(--font)}
.sb-frame.vp-desktop{max-width:1180px}.sb-frame.vp-tablet{max-width:768px}.sb-frame.vp-mobile{max-width:390px}
.sb-nav{display:flex;align-items:center;justify-content:space-between;padding:14px 28px;border-bottom:1px solid #eceff4;background:#fff}.sb-nav b{font-size:18px;color:var(--p)}.sb-nav span{color:#667085;font-size:13px}
.sb-blk{position:relative;outline:2px solid transparent;outline-offset:-2px;transition:outline-color .12s}
.sb-edit .sb-blk:hover{outline-color:#9cc3f5}.sb-edit .sb-blk.sel{outline-color:var(--acc)}
.sb-tools{position:absolute;top:8px;right:8px;z-index:5;display:none;gap:4px;padding:4px;border-radius:10px;background:#1c2330;box-shadow:0 6px 18px rgba(0,0,0,.35)}
.sb-edit .sb-blk:hover>.sb-tools,.sb-edit .sb-blk.sel>.sb-tools{display:flex}
.sb-tools button{width:30px;height:30px;border:0;border-radius:7px;background:transparent;color:#fff;font-size:15px}.sb-tools button:hover{background:#3a4560}.sb-tools .handle{cursor:grab}.sb-tools .del:hover{background:var(--danger)}
.sb-tag{position:absolute;top:8px;left:8px;z-index:5;display:none;padding:3px 9px;border-radius:99px;background:var(--acc);color:#fff;font-size:11px;font-weight:800;letter-spacing:.04em;text-transform:uppercase}
.sb-edit .sb-blk:hover>.sb-tag,.sb-edit .sb-blk.sel>.sb-tag{display:block}
.sb-dz{height:12px;margin:0;position:relative;transition:height .12s,background .12s}
.sb-edit .sb-dz.over{height:64px;background:var(--acc-soft);outline:2px dashed var(--acc);outline-offset:-4px}
.sb-edit .sb-dz.over::after{content:'Drop section here';position:absolute;inset:0;display:grid;place-items:center;color:var(--acc);font-weight:800}
.sb-dragging .sb-dz{height:22px;background:rgba(47,125,225,.07)}
.sb-sitebar{display:flex;justify-content:space-between;align-items:center;gap:10px;padding:8px 12px;background:#eef1f5;color:#344054;font-size:12px;border-bottom:1px solid #dfe4ec}.sb-iframe{display:block;width:100%;height:calc(100vh - 230px);min-height:480px;border:0;background:#fff}.sb-sitenote{margin:0;padding:10px 14px;font-size:12px;color:#667085;background:#f8fafc}.sb-empty{margin:40px;padding:50px 20px;border:3px dashed var(--line);border-radius:18px;text-align:center;display:grid;gap:12px;justify-items:center;color:var(--mut)}.sb-empty.over{border-color:var(--acc);background:var(--acc-soft);color:var(--acc)}
.sb-empty h3{margin:0;font-size:20px;color:var(--fg)}
[data-ph]:empty::before{content:attr(data-ph);color:#98a2b3;pointer-events:none}
.sb-edit [contenteditable]{outline:none;border-radius:6px;transition:box-shadow .12s,background .12s;cursor:text;min-width:24px;white-space:pre-wrap}
.sb-edit [contenteditable]:hover{box-shadow:0 0 0 2px #cfe2fb}.sb-edit [contenteditable]:focus{box-shadow:0 0 0 2px var(--acc);background:rgba(47,125,225,.06)}
.sb-img{position:relative;background:#e9edf3;overflow:hidden;display:grid;place-items:center;color:#667085;min-height:120px;border-radius:var(--r)}
.sb-img img{width:100%;height:100%;object-fit:cover;display:block;position:absolute;inset:0}
.sb-img .ph{position:relative;font-weight:700}
.sb-edit .sb-img{cursor:pointer}.sb-edit .sb-img::after{content:'📷 Click to change image';position:absolute;inset:0;display:grid;place-items:center;background:rgba(15,23,42,.55);color:#fff;font-weight:700;opacity:0;transition:opacity .15s}.sb-edit .sb-img:hover::after{opacity:1}
.sb-img.busy::after{content:'Uploading…'!important;opacity:1!important}
.sb-link{display:flex;align-items:center;gap:6px;margin-top:8px;font-size:12px;color:#667085}.sb-link input{flex:1;min-height:30px;padding:4px 8px;font-size:12px;background:#fff;color:#1c2330;border-color:#d0d5dd}
.sb-view .sb-link{display:none}
.sb-itembar{position:absolute;top:6px;right:6px;display:none;z-index:3}.sb-edit .sb-item:hover>.sb-itembar{display:flex}
.sb-itembar button{width:24px;height:24px;border:0;border-radius:6px;background:#1c2330;color:#fff;font-size:12px}.sb-itembar button:hover{background:var(--danger)}
.sb-item{position:relative}
.sb-add{display:none;margin-top:10px;border:2px dashed #b9c7dd;background:transparent;color:#4468a3;border-radius:10px;padding:10px;font-weight:700;width:100%}.sb-edit .sb-add{display:block}.sb-add:hover{background:#e8f1fd;border-color:var(--acc)}
.b-sec{padding:56px 40px}.b-sec h2{font-size:30px;line-height:1.2;margin:0 0 8px;color:#1c2330}.b-sec .intro{color:#475467;margin:0 0 26px;font-size:16px}
.b-hero{padding:72px 40px;background:linear-gradient(135deg,var(--s),color-mix(in srgb,var(--s) 70%,var(--p)));color:#fff;display:grid;grid-template-columns:1.1fr .9fr;gap:36px;align-items:center}
.b-hero .eyebrow{display:inline-block;font-size:12px;font-weight:800;letter-spacing:.12em;text-transform:uppercase;color:color-mix(in srgb,var(--p) 55%,#fff);margin-bottom:10px}
.b-hero h1{font-size:44px;line-height:1.08;margin:0 0 14px;letter-spacing:-.02em}.b-hero p{font-size:18px;opacity:.9;margin:0 0 22px}
.btn{display:inline-block;padding:13px 24px;border-radius:calc(var(--r) * .8);background:var(--p);color:#fff;font-weight:800;font-size:15px}
.b-hero .sb-img{height:300px}
.grid{display:grid;gap:18px}.g2{grid-template-columns:repeat(2,1fr)}.g3{grid-template-columns:repeat(3,1fr)}.g4{grid-template-columns:repeat(4,1fr)}
.b-stats{padding:30px 40px;background:#f6f8fb}.b-stats .it{text-align:center}.b-stats .v{font-size:28px;font-weight:900;color:var(--p)}.b-stats .l{color:#667085;font-size:14px}
.cardx{border:1px solid #e4e8ef;border-radius:var(--r);background:#fff;overflow:hidden;box-shadow:0 2px 10px rgba(16,24,40,.05)}.cardx .body{padding:16px}.cardx h3{margin:0 0 6px;font-size:18px}.cardx p{margin:0;color:#475467}
.cardx .sb-img{height:160px;border-radius:0}
.b-feat .cardx .body{padding:22px}.b-feat .ico{width:42px;height:42px;border-radius:12px;background:color-mix(in srgb,var(--p) 15%,#fff);color:var(--p);display:grid;place-items:center;font-weight:900;margin-bottom:10px}
.b-steps .num{width:38px;height:38px;border-radius:50%;background:var(--p);color:#fff;font-weight:900;display:grid;place-items:center;margin-bottom:10px}
.b-text{max-width:860px;margin:0 auto}.b-text .txt{font-size:17px;color:#344054;white-space:pre-wrap}
.b-it{display:grid;grid-template-columns:1fr 1fr;gap:36px;align-items:center}.b-it.right .sb-img{order:2}.b-it .sb-img{height:320px}
.b-image .sb-img{height:420px}.b-image .cap{text-align:center;color:#667085;margin-top:8px}
.b-gal .sb-img{height:170px;min-height:100px}
.b-rev .stars{color:#f5a524;letter-spacing:2px;cursor:default;margin-bottom:6px}.sb-edit .b-rev .stars{cursor:pointer}.b-rev .who{margin-top:10px;font-weight:700;font-size:14px}.b-rev .src{color:#667085;font-weight:500}
.b-faq .q{font-weight:800;font-size:17px}.b-faq .a{color:#475467;margin-top:6px}.b-faq .cardx{padding:16px 20px}
.b-cta{background:var(--p);color:#fff;text-align:center;padding:64px 40px}.b-cta h2{color:#fff}.b-cta p{opacity:.92;font-size:17px;margin:0 auto 22px;max-width:640px}.b-cta .btn{background:#fff;color:var(--p)}
.b-contact{display:grid;grid-template-columns:1fr 1fr;gap:36px;background:#f6f8fb}.b-contact .fake{display:grid;gap:10px}.b-contact .fake div{height:42px;border-radius:9px;background:#fff;border:1px solid #d0d5dd;color:#98a2b3;padding:10px 12px;font-size:14px}
.b-custom .cf{margin-bottom:12px}.b-custom .cf small{display:block;color:#667085;font-weight:700;text-transform:uppercase;font-size:11px;letter-spacing:.06em}
.sb-foot{padding:24px 40px;background:#101828;color:#98a2b3;font-size:13px}
@container (max-width:760px){.b-sec,.b-hero,.b-cta,.b-stats{padding:34px 22px}.b-hero{grid-template-columns:1fr}.b-hero h1{font-size:34px}.g3,.g4{grid-template-columns:repeat(2,1fr)}.b-it,.b-contact{grid-template-columns:1fr}.b-it.right .sb-img{order:0}.sb-nav{padding:12px 22px}}
@container (max-width:480px){.g2,.g3,.g4{grid-template-columns:1fr}.b-stats .g4{grid-template-columns:repeat(2,1fr)}.b-hero h1{font-size:28px}.b-sec h2{font-size:24px}.b-image .sb-img{height:240px}}
.sb-modal{position:fixed;inset:0;z-index:100010;background:rgba(10,14,22,.55);display:grid;place-items:center;padding:18px}
.sb-dialog{background:var(--panel);color:var(--fg);border-radius:16px;width:min(560px,100%);max-height:88vh;overflow:auto;padding:22px;display:grid;gap:14px;box-shadow:0 24px 70px rgba(0,0,0,.45)}
.sb-dialog h3{margin:0;font-size:20px}.sb-dialog .row{display:flex;gap:10px;justify-content:flex-end;flex-wrap:wrap}
.sb-hist{display:grid;gap:8px}.sb-hist .h{display:grid;grid-template-columns:1fr auto;gap:8px;align-items:center;padding:10px 12px;border:1px solid var(--line);border-radius:10px}.sb-hist small{color:var(--mut)}
.sb-toast{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);z-index:100020;padding:11px 18px;border-radius:12px;background:#1c2330;color:#fff;font-weight:700;box-shadow:0 10px 30px rgba(0,0,0,.4);display:flex;gap:12px;align-items:center}.sb-toast.err{background:var(--danger)}.sb-toast button{background:transparent;border:0;color:#9cc3f5;font-weight:800;text-decoration:underline}
.sb-dot{display:inline-block;width:8px;height:8px;border-radius:50%;background:#f79009;margin-right:6px}
.sb-check{display:flex;gap:8px;align-items:center}.sb-check input{min-height:auto}
.sb-col2{display:grid;grid-template-columns:1fr 1fr;gap:10px}
`;

  /* ---------------------------------------------------------------- block library */
  const rect = (x, y, w, hh, f = '#b8c4d6', r = 2) => `<rect x="${x}" y="${y}" width="${w}" height="${hh}" rx="${r}" fill="${f}"/>`;
  const THUMB = {
    hero: rect(6, 8, 50, 6, '#2f7de1') + rect(6, 18, 40, 4) + rect(6, 25, 34, 4) + rect(6, 34, 20, 8, '#2f7de1', 4) + rect(66, 8, 48, 36, '#cbd5e5', 4),
    stats: [0, 1, 2, 3].map(i => rect(8 + i * 28, 18, 20, 8, '#2f7de1') + rect(8 + i * 28, 30, 20, 3)).join(''),
    services: [0, 1, 2].map(i => rect(8 + i * 37, 8, 33, 18, '#cbd5e5', 3) + rect(8 + i * 37, 30, 33, 4) + rect(8 + i * 37, 37, 24, 3)).join(''),
    features: [0, 1, 2].map(i => rect(10 + i * 37, 10, 10, 10, '#2f7de1', 5) + rect(10 + i * 37, 25, 28, 4) + rect(10 + i * 37, 32, 22, 3)).join(''),
    steps: [0, 1, 2].map(i => `<circle cx="${18 + i * 38}" cy="16" r="7" fill="#2f7de1"/>` + rect(8 + i * 38, 28, 26, 4) + rect(8 + i * 38, 35, 20, 3)).join(''),
    text: rect(10, 8, 60, 6, '#2f7de1') + rect(10, 20, 100, 3) + rect(10, 27, 100, 3) + rect(10, 34, 100, 3) + rect(10, 41, 70, 3),
    imagetext: rect(8, 8, 50, 38, '#cbd5e5', 4) + rect(66, 10, 44, 6, '#2f7de1') + rect(66, 22, 46, 3) + rect(66, 29, 46, 3) + rect(66, 36, 30, 3),
    image: rect(8, 6, 104, 40, '#cbd5e5', 4) + rect(40, 49, 40, 3),
    gallery: [0, 1, 2, 3].map(i => rect(8 + (i % 2) * 54, 6 + Math.floor(i / 2) * 22, 50, 18, '#cbd5e5', 3)).join(''),
    reviews: [0, 1].map(i => rect(8 + i * 56, 8, 50, 38, '#fff', 4) + rect(12 + i * 56, 13, 26, 4, '#f5a524') + rect(12 + i * 56, 22, 42, 3) + rect(12 + i * 56, 29, 38, 3) + rect(12 + i * 56, 38, 20, 3, '#2f7de1')).join(''),
    faq: [0, 1, 2].map(i => rect(10, 8 + i * 14, 100, 10, '#fff', 3) + rect(14, 11 + i * 14, 50, 4, '#2f7de1')).join(''),
    cta: rect(0, 0, 120, 52, '#2f7de1', 0) + rect(30, 12, 60, 6, '#fff') + rect(40, 24, 40, 3, '#cfe0fb') + rect(46, 33, 28, 9, '#fff', 4),
    contact: rect(8, 8, 46, 6, '#2f7de1') + rect(8, 20, 46, 3) + rect(8, 27, 36, 3) + rect(64, 8, 48, 8, '#fff') + rect(64, 20, 48, 8, '#fff') + rect(64, 32, 48, 8, '#fff') + rect(64, 44, 20, 6, '#2f7de1'),
  };
  const svgThumb = type => `<svg viewBox="0 0 120 52" aria-hidden="true">${THUMB[type] || rect(8, 8, 104, 36, '#cbd5e5', 4)}</svg>`;
  const LABELS = {
    hero: 'Hero banner', stats: 'Numbers bar', services: 'Services', features: 'Why choose us', steps: 'How it works', text: 'Text', imagetext: 'Image + text', image: 'Big image',
    gallery: 'Photo gallery', reviews: 'Reviews', faq: 'FAQ', cta: 'Call to action', contact: 'Contact form',
  };
  const DEFAULTS = {
    hero: () => ({ eyebrow: 'Local & trusted', title: 'Your headline goes here', text: 'Say what you do and who you do it for in one or two sentences.', buttonText: 'Get a free quote', buttonLink: '/contact/', image: '' }),
    stats: () => ({ items: [{ value: '10+ years', label: 'Experience' }, { value: '5★', label: 'Reviews' }, { value: 'Free', label: 'Quotes' }, { value: 'Local', label: 'Team' }] }),
    services: () => ({ title: 'Our services', intro: 'What we can do for you.', items: [1, 2, 3].map(n => ({ title: 'Service ' + n, text: 'A short description of this service.', image: '', link: '' })) }),
    features: () => ({ title: 'Why choose us', intro: '', items: [1, 2, 3].map(n => ({ title: 'Reason ' + n, text: 'Explain this benefit in a sentence.' })) }),
    steps: () => ({ title: 'How it works', items: [{ title: 'Get in touch', text: 'Tell us what you need.' }, { title: 'We quote', text: 'You get a clear price.' }, { title: 'We deliver', text: 'The job is done properly.' }] }),
    text: () => ({ title: 'A heading', text: 'Write your text here. Click to edit it.' }),
    imagetext: () => ({ title: 'A heading', text: 'Tell your story next to a photo.', image: '', side: 'left', buttonText: '', buttonLink: '' }),
    image: () => ({ image: '', caption: '' }),
    gallery: () => ({ title: 'Our work', images: ['', '', '', ''] }),
    reviews: () => ({ title: 'What customers say', items: [{ name: 'Customer name', text: 'A great review goes here.', rating: 5, source: 'Google' }, { name: 'Customer name', text: 'Another great review.', rating: 5, source: 'Google' }] }),
    faq: () => ({ title: 'Common questions', items: [{ q: 'A question?', a: 'The answer.' }, { q: 'Another question?', a: 'Another answer.' }] }),
    cta: () => ({ title: 'Ready to get started?', text: 'Get in touch for a free, no-obligation quote.', buttonText: 'Get a free quote', buttonLink: '/contact/' }),
    contact: () => ({ title: 'Get in touch', text: 'Send us your details and we will call you back.', buttonText: 'Send message' }),
  };

  /* ---------------------------------------------------------------- the builder */
  function open(opts) {
    const clientId = opts.clientId;
    const S = {
      list: null, slug: null, page: null, baseSha: null, isNew: false, dirty: false, vp: 'desktop', sel: null, tab: 'add',
      undo: [], redo: [], snap: '', history: [], saving: false, mode: 'edit', readonly: true, config: null, theme: 'light',
    };
    const darkNow = () => !!document.querySelector('.app-shell.dark-mode') || (window.matchMedia && matchMedia('(prefers-color-scheme: dark)').matches && !document.querySelector('.app-shell'));
    const root = h('div', { class: 'sb', role: 'dialog', 'aria-label': 'Visual builder', 'data-theme': darkNow() ? 'dark' : 'light' });
    const style = h('style', { text: CSS });
    let stage, side, top, frame, toastEl, tooltip;
    const api = async (op, params = {}, body) => {
      const qs = new URLSearchParams({ clientId, op, ...params });
      const res = await fetch('/api/client-site?' + qs, body ? { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ clientId, op, ...body }) } : { cache: 'no-store' });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) { const e = new Error(j.error || 'Something went wrong.'); e.status = res.status; e.data = j; throw e; }
      return j;
    };
    const toast = (msg, kind, action) => {
      toastEl?.remove(); toastEl = h('div', { class: 'sb-toast' + (kind === 'err' ? ' err' : ''), role: 'status' }, msg, action && h('button', { type: 'button', onclick: () => { action.fn(); toastEl?.remove(); } }, action.label));
      root.append(toastEl); setTimeout(() => toastEl?.remove(), action ? 6000 : 3800);
    };
    const assetUrl = p => !p ? '' : /^https:\/\//.test(p) ? p : `/api/client-site?clientId=${encodeURIComponent(clientId)}&op=asset&path=${encodeURIComponent(p)}`;
    const themeVars = () => { const t = S.config?.theme || {}; return `--p:${t.primary || '#2f7de1'};--s:${t.secondary || '#1f2a44'};--r:${(t.radius ?? 12)}px;--font:${t.font === 'serif' ? 'Georgia,serif' : t.font === 'rounded' ? 'ui-rounded,"Segoe UI",system-ui,sans-serif' : 'system-ui,-apple-system,"Segoe UI",Roboto,sans-serif'}`; };
    const customDefs = () => S.config?.custom || [];
    const enabledTypes = () => [...(S.config?.blocks || Object.keys(LABELS))];
    const labelOf = t => LABELS[t] || customDefs().find(c => c.type === t)?.label || t;

    /* ---------- model + history ---------- */
    const json = () => JSON.stringify(S.page);
    const markDirty = () => { S.dirty = true; renderTop(); };
    const pushHistory = () => { const now = json(); if (S.snap && now !== S.snap) { S.undo.push(S.snap); if (S.undo.length > 100) S.undo.shift(); S.redo = []; } S.snap = now; renderTop(); };
    let typingTimer = null;
    const typed = () => { markDirty(); clearTimeout(typingTimer); typingTimer = setTimeout(pushHistory, 700); };
    const structural = () => { clearTimeout(typingTimer); pushHistory(); markDirty(); renderCanvas(); renderSide(); };
    const doUndo = () => { clearTimeout(typingTimer); pushHistory(); const prev = S.undo.pop(); if (prev == null) return; S.redo.push(json()); S.page = JSON.parse(prev); S.snap = prev; S.dirty = true; renderCanvas(); renderSide(); renderTop(); };
    const doRedo = () => { const next = S.redo.pop(); if (next == null) return; S.undo.push(json()); S.page = JSON.parse(next); S.snap = next; S.dirty = true; renderCanvas(); renderSide(); renderTop(); };

    /* ---------- editable pieces ---------- */
    const editing = () => !S.readonly;
    function T(o, k, tag, cls, ph, multi) {
      const el = h(tag || 'div', { class: cls || '', 'data-ph': ph || 'Click to type' });
      el.textContent = o[k] || '';
      if (!editing()) return el;
      el.contentEditable = 'true'; el.spellcheck = true;
      el.addEventListener('input', () => { o[k] = el.innerText.replace(/ /g, ' ').replace(/\n+$/, ''); typed(); });
      el.addEventListener('paste', e => { e.preventDefault(); const t = (e.clipboardData || window.clipboardData).getData('text/plain'); document.execCommand('insertText', false, multi ? t : t.replace(/\s*\n+\s*/g, ' ')); });
      el.addEventListener('keydown', e => { if (e.key === 'Enter' && !multi) { e.preventDefault(); el.blur(); } });
      el.addEventListener('dragstart', e => e.preventDefault());
      return el;
    }
    function uploadFile(file) {
      if (!/^image\//.test(file.type)) return Promise.reject(new Error('Choose an image file (JPG, PNG, WebP or GIF).'));
      if (file.size > 2 * 1024 * 1024) return Promise.reject(new Error(`That image is ${(file.size / 1048576).toFixed(1)} MB. Images must be 2 MB or smaller (about 1600 px wide is plenty).`));
      return fetch(`/api/client-site?clientId=${encodeURIComponent(clientId)}&op=image&dir=${encodeURIComponent(S.list.imageDir || 'public/images/builder')}&name=${encodeURIComponent(file.name)}`, { method: 'POST', headers: { 'content-type': file.type }, body: file })
        .then(async r => { const j = await r.json().catch(() => ({})); if (!r.ok) throw new Error(j.error || 'The upload failed.'); return j.publicPath; });
    }
    function pickFile() { return new Promise(res => { const i = h('input', { type: 'file', accept: 'image/*', style: 'display:none' }); i.onchange = () => { res(i.files[0] || null); i.remove(); }; root.append(i); i.click(); }); }
    function IMG(o, k, cls, label) {
      const box = h('div', { class: 'sb-img ' + (cls || ''), 'data-key': k });
      const paint = () => { box.querySelectorAll('img,.ph').forEach(n => n.remove()); if (o[k]) { const im = h('img', { src: assetUrl(o[k]), alt: '', loading: 'lazy' }); im.onerror = () => { im.remove(); box.append(h('span', { class: 'ph' }, '🖼 Image not found')); }; box.prepend(im); } else box.append(h('span', { class: 'ph' }, editing() ? '🖼 ' + (label || 'Add an image') : '')); };
      paint();
      if (editing()) box.addEventListener('click', async () => {
        const f = await pickFile(); if (!f) return;
        box.classList.add('busy');
        try { o[k] = await uploadFile(f); paint(); structural(); } catch (e) { toast(e.message, 'err'); } finally { box.classList.remove('busy'); }
      });
      return box;
    }
    const LINK = (o, k, label) => editing() ? h('label', { class: 'sb-link' }, '🔗 ' + label, h('input', { value: o[k] || '', placeholder: '/contact/ or https://…', oninput: e => { o[k] = e.target.value; typed(); } })) : null;
    function items(arr, build, mk, addLabel, minItems = 0) {
      const wrap = h('div', { class: 'sb-list' });
      arr.forEach((it, i) => {
        const el = build(it, i); el.classList.add('sb-item');
        if (editing() && arr.length > minItems) el.append(h('div', { class: 'sb-itembar' }, h('button', { type: 'button', title: 'Remove', onclick: () => { arr.splice(i, 1); structural(); } }, '✕')));
        wrap.append(el);
      });
      return [wrap, editing() ? h('button', { type: 'button', class: 'sb-add', onclick: () => { arr.push(mk()); structural(); } }, '＋ ' + addLabel) : null];
    }

    /* ---------- block renderers ---------- */
    const R = {
      hero: p => h('section', { class: 'b-hero' }, h('div', {}, T(p, 'eyebrow', 'span', 'eyebrow', 'Small headline'), T(p, 'title', 'h1', '', 'Headline'), T(p, 'text', 'p', '', 'A short description', true), T(p, 'buttonText', 'span', 'btn', 'Button text'), LINK(p, 'buttonLink', 'Button link')), IMG(p, 'image', '', 'Add a hero image')),
      stats: p => { const [l, a] = items(p.items, it => h('div', { class: 'it' }, T(it, 'value', 'div', 'v', '10+'), T(it, 'label', 'div', 'l', 'Label')), () => ({ value: '', label: '' }), 'Add a number', 1); l.className = 'grid g4'; return h('section', { class: 'b-stats' }, l, a); },
      services: p => { const [l, a] = items(p.items, it => h('div', { class: 'cardx' }, IMG(it, 'image', '', 'Add photo'), h('div', { class: 'body' }, T(it, 'title', 'h3', '', 'Service name'), T(it, 'text', 'p', '', 'Short description', true), LINK(it, 'link', 'Page link'))), () => ({ title: 'New service', text: '', image: '', link: '' }), 'Add a service'); l.className = 'grid g3'; return h('section', { class: 'b-sec' }, T(p, 'title', 'h2', '', 'Section heading'), T(p, 'intro', 'p', 'intro', 'Intro (optional)', true), l, a); },
      features: p => { const [l, a] = items(p.items, (it, i) => h('div', { class: 'cardx' }, h('div', { class: 'body' }, h('div', { class: 'ico' }, '✓'), T(it, 'title', 'h3', '', 'Title'), T(it, 'text', 'p', '', 'Description', true))), () => ({ title: 'New reason', text: '' }), 'Add a reason'); l.className = 'grid g3'; return h('section', { class: 'b-sec b-feat' }, T(p, 'title', 'h2', '', 'Section heading'), T(p, 'intro', 'p', 'intro', 'Intro (optional)', true), l, a); },
      steps: p => { const [l, a] = items(p.items, (it, i) => h('div', { class: 'cardx b-steps' }, h('div', { class: 'body' }, h('div', { class: 'num' }, String(i + 1)), T(it, 'title', 'h3', '', 'Step title'), T(it, 'text', 'p', '', 'Description', true))), () => ({ title: 'New step', text: '' }), 'Add a step'); l.className = 'grid g3'; return h('section', { class: 'b-sec b-steps' }, T(p, 'title', 'h2', '', 'Section heading'), l, a); },
      text: p => h('section', { class: 'b-sec' }, h('div', { class: 'b-text' }, T(p, 'title', 'h2', '', 'Heading'), T(p, 'text', 'div', 'txt', 'Write your text here', true))),
      imagetext: p => h('section', { class: 'b-sec' }, h('div', { class: 'b-it ' + (p.side === 'right' ? 'right' : '') }, IMG(p, 'image', '', 'Add an image'), h('div', {}, T(p, 'title', 'h2', '', 'Heading'), T(p, 'text', 'div', 'txt', 'Your text', true), (editing() || p.buttonText) ? T(p, 'buttonText', 'span', 'btn', 'Button text (optional)') : null, LINK(p, 'buttonLink', 'Button link'), editing() ? h('button', { type: 'button', class: 'sb-add', style: 'width:auto;display:inline-block', onclick: () => { p.side = p.side === 'right' ? 'left' : 'right'; structural(); } }, '⇄ Flip image side') : null))),
      image: p => h('section', { class: 'b-sec b-image' }, IMG(p, 'image', '', 'Add a big image'), (editing() || p.caption) ? T(p, 'caption', 'div', 'cap', 'Caption (optional)') : null),
      gallery: p => {
        const g = h('div', { class: 'grid g4' });
        p.images.forEach((src, i) => { const holder = { v: src }; const w = h('div', { class: 'sb-item' }); const box = IMG({ get image() { return p.images[i]; }, set image(v) { p.images[i] = v; } }, 'image', '', 'Add photo'); w.append(box); if (editing()) w.append(h('div', { class: 'sb-itembar' }, h('button', { type: 'button', title: 'Remove', onclick: () => { p.images.splice(i, 1); structural(); } }, '✕'))); g.append(w); void holder; });
        return h('section', { class: 'b-sec b-gal' }, T(p, 'title', 'h2', '', 'Section heading'), g, editing() ? h('button', { type: 'button', class: 'sb-add', onclick: () => { p.images.push(''); structural(); } }, '＋ Add a photo') : null);
      },
      reviews: p => { const [l, a] = items(p.items, it => h('div', { class: 'cardx b-rev' }, h('div', { class: 'body' }, h('div', { class: 'stars', title: editing() ? 'Click to change the rating' : '', onclick: () => { if (!editing()) return; it.rating = (it.rating || 5) % 5 + 1; structural(); } }, '★'.repeat(it.rating || 5) + '☆'.repeat(5 - (it.rating || 5))), T(it, 'text', 'p', '', 'What the customer said', true), h('div', { class: 'who' }, T(it, 'name', 'span', '', 'Name'), ' ', T(it, 'source', 'span', 'src', 'Google')))), () => ({ name: '', text: '', rating: 5, source: 'Google' }), 'Add a review'); l.className = 'grid g3'; return h('section', { class: 'b-sec' }, T(p, 'title', 'h2', '', 'Section heading'), l, a); },
      faq: p => { const [l, a] = items(p.items, it => h('div', { class: 'cardx' }, T(it, 'q', 'div', 'q', 'Question?'), T(it, 'a', 'div', 'a', 'Answer', true)), () => ({ q: 'New question?', a: '' }), 'Add a question'); l.className = 'grid'; return h('section', { class: 'b-sec b-faq' }, T(p, 'title', 'h2', '', 'Section heading'), l, a); },
      cta: p => h('section', { class: 'b-cta' }, T(p, 'title', 'h2', '', 'Headline'), T(p, 'text', 'p', '', 'A line of text', true), T(p, 'buttonText', 'span', 'btn', 'Button text'), LINK(p, 'buttonLink', 'Button link')),
      contact: p => h('section', { class: 'b-sec b-contact' }, h('div', {}, T(p, 'title', 'h2', '', 'Heading'), T(p, 'text', 'p', 'intro', 'A line of text', true)), h('div', { class: 'fake' }, h('div', {}, 'Your name'), h('div', {}, 'Phone number'), h('div', {}, 'Email'), h('div', { style: 'height:84px' }, 'How can we help?'), T(p, 'buttonText', 'span', 'btn', 'Button text'))),
    };
    function renderBlock(b) {
      const def = customDefs().find(c => c.type === b.type);
      let body;
      try {
        if (R[b.type]) { if (b.type === 'gallery' && !Array.isArray(b.props.images)) b.props.images = []; if (['stats', 'services', 'features', 'steps', 'reviews', 'faq'].includes(b.type) && !Array.isArray(b.props.items)) b.props.items = []; body = R[b.type](b.props); }
        else if (def) body = h('section', { class: 'b-sec b-custom' }, ...def.fields.map(f => h('div', { class: 'cf' }, h('small', {}, f.label || f.key), f.kind === 'image' ? IMG(b.props, f.key, '', 'Add an image') : f.kind === 'link' ? (LINK(b.props, f.key, f.label || 'Link') || h('span', {}, b.props[f.key] || '')) : T(b.props, f.key, 'div', f.kind === 'textarea' ? 'txt' : '', f.label || f.key, f.kind === 'textarea'))));
        else body = h('section', { class: 'b-sec' }, h('p', { style: 'color:#b42318' }, `The “${b.type}” section is not available for this site.`));
      } catch (e) { body = h('section', { class: 'b-sec' }, h('p', { style: 'color:#b42318' }, 'This section could not be shown.')); console.warn(e); }
      const el = h('div', { class: 'sb-blk' + (S.sel === b.id ? ' sel' : ''), 'data-id': b.id }, body);
      if (editing()) {
        el.prepend(h('span', { class: 'sb-tag' }, labelOf(b.type)));
        const idx = () => S.page.blocks.findIndex(x => x.id === b.id);
        const handle = h('button', { type: 'button', class: 'handle', title: 'Drag to move', draggable: 'true', 'aria-label': 'Drag to move this section' }, '⠿');
        handle.addEventListener('dragstart', e => { e.dataTransfer.setData('text/f2b-move', b.id); e.dataTransfer.effectAllowed = 'move'; try { e.dataTransfer.setDragImage(el, 30, 20); } catch { /* ignore */ } setTimeout(() => stage.classList.add('sb-dragging'), 0); el.style.opacity = '.45'; });
        handle.addEventListener('dragend', () => { stage.classList.remove('sb-dragging'); el.style.opacity = ''; clearOver(); });
        const mv = d => () => { const i = idx(), j = i + d; if (j < 0 || j >= S.page.blocks.length) return; const [x] = S.page.blocks.splice(i, 1); S.page.blocks.splice(j, 0, x); S.sel = b.id; structural(); };
        el.prepend(h('div', { class: 'sb-tools' }, handle, h('button', { type: 'button', title: 'Move up', onclick: mv(-1) }, '▲'), h('button', { type: 'button', title: 'Move down', onclick: mv(1) }, '▼'),
          h('button', { type: 'button', title: 'Duplicate', onclick: () => { const i = idx(); const c = { id: uid(), type: b.type, props: clone(b.props) }; S.page.blocks.splice(i + 1, 0, c); S.sel = c.id; structural(); } }, '⧉'),
          h('button', { type: 'button', class: 'del', title: 'Delete', onclick: () => { const i = idx(); const [gone] = S.page.blocks.splice(i, 1); S.sel = null; structural(); toast(`${labelOf(gone.type)} deleted`, '', { label: 'Undo', fn: doUndo }); } }, '🗑')));
        el.addEventListener('mousedown', () => { if (S.sel !== b.id) { root.querySelectorAll('.sb-blk.sel').forEach(n => n.classList.remove('sel')); S.sel = b.id; el.classList.add('sel'); } });
      }
      return el;
    }

    /* ---------- drag & drop ---------- */
    const isOurs = e => [...(e.dataTransfer?.types || [])].some(t => t === 'text/f2b-move' || t === 'text/f2b-new');
    const clearOver = () => root.querySelectorAll('.sb-dz.over,.sb-empty.over').forEach(n => n.classList.remove('over'));
    function dropAt(index, e) {
      const mvId = e.dataTransfer.getData('text/f2b-move'), nw = e.dataTransfer.getData('text/f2b-new');
      if (mvId) { const from = S.page.blocks.findIndex(x => x.id === mvId); if (from < 0) return; const [x] = S.page.blocks.splice(from, 1); S.page.blocks.splice(from < index ? index - 1 : index, 0, x); S.sel = mvId; }
      else if (nw) addBlock(nw, index);
      stage.classList.remove('sb-dragging'); structural();
    }
    function addBlock(type, index) {
      const mk = DEFAULTS[type]; const def = customDefs().find(c => c.type === type);
      const props = mk ? mk() : Object.fromEntries((def?.fields || []).map(f => [f.key, '']));
      const b = { id: uid(), type, props };
      const at = index == null ? (S.sel ? S.page.blocks.findIndex(x => x.id === S.sel) + 1 : S.page.blocks.length) : index;
      S.page.blocks.splice(at < 0 ? S.page.blocks.length : at, 0, b); S.sel = b.id; return b;
    }
    function dz(index) {
      const z = h('div', { class: 'sb-dz' });
      z.addEventListener('dragover', e => { if (!isOurs(e)) return; e.preventDefault(); e.dataTransfer.dropEffect = e.dataTransfer.types.includes('text/f2b-move') ? 'move' : 'copy'; clearOver(); z.classList.add('over'); });
      z.addEventListener('dragleave', () => z.classList.remove('over'));
      z.addEventListener('drop', e => { e.preventDefault(); dropAt(index, e); });
      return z;
    }
    let scrollRaf = 0;
    function autoScroll(e) { if (!isOurs(e)) return; const r = stage.getBoundingClientRect(); const dy = e.clientY < r.top + 70 ? -18 : e.clientY > r.bottom - 70 ? 18 : 0; if (dy && !scrollRaf) scrollRaf = requestAnimationFrame(() => { stage.scrollTop += dy; scrollRaf = 0; }); }

    /* ---------- canvas ---------- */
    function renderCanvas() {
      const keep = stage?.scrollTop || 0;
      stage.className = 'sb-stage ' + (editing() ? 'sb-edit' : 'sb-view');
      stage.replaceChildren();
      if (S.banner) stage.append(S.banner);
      if (!S.list) return;
      if (!S.page) {
        stage.append(h('div', { class: 'sb-empty' }, h('h3', {}, S.list.pages.length ? 'Choose a page' : 'No pages yet'), h('p', {}, S.list.pages.length ? 'Pick a page from the list at the top.' : 'Start from this client’s current website, or begin with a blank page.'),
          S.list.canImport ? h('button', { type: 'button', class: 'sb-btn primary', onclick: doImport }, '✨ Start from the current website') : null,
          S.list.canImportLive ? h('button', { type: 'button', class: 'sb-btn primary', onclick: doImportLive }, '🌐 Import from a live website link') : null,
          ...(S.list.templates || []).map(t => h('button', { type: 'button', class: 'sb-btn primary', onclick: () => doTemplate(t) }, '🧩 Use the ' + t.name + ' template')),
          S.list.canWrite && !S.list.pages.length ? h('button', { type: 'button', class: 'sb-btn', onclick: () => newPageDialog(false) }, '＋ Blank page') : null));
        return;
      }
      if (S.mode === 'site') {
        const url = location.origin + '/api/marketing-public/site?c=' + encodeURIComponent(clientId) + '&p=' + encodeURIComponent(S.slug || 'home');
        if (!url) { stage.append(h('div', { class: 'sb-empty' }, h('h3', {}, 'No preview site linked'), h('p', {}, 'Add the preview link under Marketing → Websites → Edit links.'))); return; }
        frame = h('div', { class: 'sb-frame vp-' + S.vp, style: 'background:#fff' },
          h('div', { class: 'sb-sitebar' }, h('span', {}, '🌐 ' + url), h('a', { href: url, target: '_blank', rel: 'noopener noreferrer', class: 'sb-btn' }, 'Open in new tab ↗')),
          h('iframe', { src: url, title: 'Preview site', class: 'sb-iframe', referrerpolicy: 'no-referrer' }),
          h('p', { class: 'sb-sitenote' }, 'This is your website as built here. Save in the builder, then switch back to Preview to see every change.'));
        stage.append(frame); return;
      }
      if (S.page.raw) {
        const src = location.origin + '/api/marketing-public/site?c=' + encodeURIComponent(clientId) + '&p=' + encodeURIComponent(S.slug || 'home') + '&edit=' + (editing() ? '1' : '0') + '&r=' + Date.now();
        const ifr = h('iframe', { src, title: 'Page editor', class: 'sb-iframe', style: 'width:100%;height:calc(100vh - 150px);border:0;background:#fff', referrerpolicy: 'no-referrer' });
        S.rawFrame = ifr;
        stage.append(h('div', { class: 'sb-frame vp-' + S.vp, style: 'background:#fff' },
          h('div', { class: 'sb-sitebar' }, h('span', {}, editing() ? '✏️ Exact copy of your website · click any text to edit it, click a picture to change it' : 'Exact copy of your website'), h('a', { href: src.replace('&edit=1', '&edit=0'), target: '_blank', rel: 'noopener noreferrer', class: 'sb-btn' }, 'Open in new tab ↗')), ifr));
        return;
      }
      const t = S.config?.theme || {};
      frame = h('div', { class: 'sb-frame vp-' + S.vp + (t.font === 'luxury' ? ' lux' : ''), style: themeVars() });
      if (t.font === 'luxury' && !document.getElementById('sb-lux-css')) { const st = document.createElement('style'); st.id = 'sb-lux-css'; st.textContent = '@import url("https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@400;500;600&family=Jost:wght@300;400;500&display=swap");.sb-frame.lux{font-family:Jost,system-ui,sans-serif;font-weight:300;color:#55575c;border-radius:0}.lux h1,.lux h2,.lux h3,.lux .sb-nav b{font-family:"Cormorant Garamond",Georgia,serif!important;font-weight:500;letter-spacing:0!important;color:#424448}.lux .sb-nav{background:#fff;border-bottom:1px solid #e7e2d8;padding:18px 40px}.lux .sb-nav span{letter-spacing:.14em;text-transform:uppercase;font-size:11px}.lux .b-hero{background:#f7f4ee;color:#424448}.lux .b-hero h1{font-size:52px;font-weight:400;color:#424448}.lux .b-hero p{opacity:1;color:#55575c;font-size:17px}.lux .b-hero .eyebrow{color:#a8895c;letter-spacing:.2em;font-weight:400}.lux .b-sec h2{font-size:38px}.lux .b-sec.alt,.lux .alt{background:#f7f4ee}.lux button,.lux .btn,.lux .b-hero a,.lux .b-cta a{border-radius:0!important;text-transform:uppercase;letter-spacing:.14em;font-size:12px;font-weight:400}.lux .b-cta{background:#424448}.lux img,.lux .sb-img{border-radius:0!important}.lux .g3>*,.lux .g4>*,.lux .g2>*{border-radius:0}'; document.head.appendChild(st); }
      frame.append(h('div', { class: 'sb-nav' }, h('b', {}, t.name || S.list.clientName || opts.name || 'Your business'), h('span', {}, 'Home · Services · About · Contact')));
      if (!S.page.blocks.length) {
        const empty = h('div', { class: 'sb-empty' }, h('h3', {}, 'Drag a section here'), h('p', {}, 'Pick a section from the left and drop it on this page, or just click it.'));
        empty.addEventListener('dragover', e => { if (!isOurs(e)) return; e.preventDefault(); empty.classList.add('over'); });
        empty.addEventListener('dragleave', () => empty.classList.remove('over'));
        empty.addEventListener('drop', e => { e.preventDefault(); dropAt(0, e); });
        frame.append(empty);
      } else {
        if (editing()) frame.append(dz(0));
        S.page.blocks.forEach((b, i) => { frame.append(renderBlock(b)); if (editing()) frame.append(dz(i + 1)); });
      }
      frame.append(h('div', { class: 'sb-foot' }, '© ' + (t.name || S.list.clientName || opts.name || 'Your business') + ' · Preview only'));
      stage.append(frame); stage.scrollTop = keep;
    }

    /* ---------- side panel ---------- */
    function counter(len, max) { return h('span', { class: 'sb-count' + (len > max ? ' over' : '') }, `${len} / ${max}`); }
    function renderSide() {
      side.replaceChildren();
      const tabs = [['add', '➕ Add'], ['page', '🔎 Page & SEO']]; if (S.list?.role === 'admin') tabs.push(['style', '🎨 Style']);
      side.append(h('div', { class: 'sb-tabs', role: 'tablist' }, tabs.map(([k, l]) => h('button', { type: 'button', role: 'tab', class: S.tab === k ? 'on' : '', 'aria-selected': S.tab === k, onclick: () => { S.tab = k; renderSide(); } }, l))));
      const pane = h('div', { class: 'sb-pane' }); side.append(pane);
      if (!S.list) return;
      if (S.tab === 'add') {
        if (S.readonly) { pane.append(h('p', { class: 'sb-lab' }, 'View only'), h('p', { style: 'color:var(--mut)' }, 'Only an owner or admin can change this website.')); return; }
        pane.append(h('p', { style: 'margin:0;color:var(--mut)' }, 'Drag a section onto the page, or click it to add it.'));
        const lib = h('div', { class: 'sb-lib' });
        for (const t of enabledTypes()) { const def = customDefs().find(c => c.type === t); const card = h('div', { class: 'sb-card', draggable: 'true', tabindex: '0', role: 'button', 'aria-label': 'Add ' + labelOf(t) }, h('span', { html: '' }), h('b', {}, labelOf(t)));
          const sv = document.createElement('div'); sv.innerHTML = def ? `<svg viewBox="0 0 120 52" aria-hidden="true">${rect(10, 10, 60, 6, '#2f7de1')}${rect(10, 22, 100, 3)}${rect(10, 29, 80, 3)}${rect(10, 38, 24, 8, '#2f7de1', 4)}</svg>` : svgThumb(t); card.firstChild.replaceWith(sv.firstChild);
          card.addEventListener('dragstart', e => { e.dataTransfer.setData('text/f2b-new', t); e.dataTransfer.effectAllowed = 'copy'; setTimeout(() => stage.classList.add('sb-dragging'), 0); });
          card.addEventListener('dragend', () => { stage.classList.remove('sb-dragging'); clearOver(); });
          const add = () => { if (!S.page) { toast('Choose or create a page first.', 'err'); return; } const b = addBlock(t); structural(); requestAnimationFrame(() => stage.querySelector(`[data-id="${b.id}"]`)?.scrollIntoView({ behavior: 'smooth', block: 'center' })); };
          card.addEventListener('click', add); card.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); add(); } });
          lib.append(card); }
        pane.append(lib);
      } else if (S.tab === 'page') {
        if (!S.page) { pane.append(h('p', { style: 'color:var(--mut)' }, 'Choose a page first.')); return; }
        const seo = S.page.seo, ro = S.readonly, disabled = ro ? true : false;
        const bind = (obj, key, el) => { el.addEventListener('input', () => { obj[key] = el.value; typed(); updateSeoBits(); }); return el; };
        const pageName = bind(S.page, 'title', h('input', { value: S.page.title || '', maxlength: 120, disabled }));
        const addr = h('input', { value: S.page.url || '', disabled: disabled || S.slug === 'home', placeholder: '/roof-repair/', 'aria-label': 'Page address' }); addr.addEventListener('input', () => { S.page.url = addr.value.toLowerCase().replace(/[^a-z0-9\-/]/g, '-'); typed(); updateSeoBits(); });
        const titleIn = bind(seo, 'title', h('input', { value: seo.title || '', disabled, 'aria-label': 'SEO title' }));
        const descIn = bind(seo, 'description', h('textarea', { rows: 4, disabled, 'aria-label': 'SEO description' }, seo.description || ''));
        const kwIn = bind(seo, 'focusKeyword', h('input', { value: seo.focusKeyword || '', disabled, placeholder: 'e.g. roofers galway' }));
        const tc = h('span'), dc = h('span'), g = h('div', { class: 'sb-google' }), checks = h('div', { class: 'sb-checks' });
        const host = (S.list.previewUrl || '').replace(/^https?:\/\//, '').replace(/\/$/, '') || 'yourwebsite.com';
        function updateSeoBits() {
          const t = (seo.title || '').length, d = (seo.description || '').length;
          tc.replaceChildren(counter(t, SEO_T)); dc.replaceChildren(counter(d, SEO_D));
          const pathShown = (S.page.url || '/').replace(/\/$/, '').split('/').filter(Boolean).join(' › ');
          g.replaceChildren(h('div', { class: 'u' }, host + (pathShown ? ' › ' + pathShown : '')), h('div', { class: 't' }, (seo.title || S.page.title || 'Page title').slice(0, 70) + ((seo.title || '').length > 70 ? '…' : '')), h('div', { class: 'd' }, (seo.description || 'Add a description so people know what to expect.').slice(0, 170)));
          const kw = (seo.focusKeyword || '').trim().toLowerCase(); const c = (ok, text) => h('div', { class: ok ? 'ok' : 'no' }, (ok ? '✓ ' : '○ ') + text);
          checks.replaceChildren(...(kw ? [c((seo.title || '').toLowerCase().includes(kw), 'Keyword is in the SEO title'), c((seo.description || '').toLowerCase().includes(kw), 'Keyword is in the description'), c((S.page.url || '').replace(/-/g, ' ').includes(kw) || (S.page.url || '').includes(kw.replace(/\s+/g, '-')), 'Keyword is in the page address'), c(JSON.stringify(S.page.blocks).toLowerCase().includes(kw), 'Keyword appears on the page')] : [h('div', { class: 'no' }, 'Add a focus keyword to see SEO checks.')]));
          renderTop();
        }
        pane.append(h('div', { class: 'sb-field' }, h('label', {}, 'Page name (only you see this)'), pageName),
          h('div', { class: 'sb-field' }, h('label', {}, 'Page address'), addr, S.slug === 'home' ? h('small', { style: 'color:var(--mut)' }, 'The home page always lives at /') : null),
          h('div', { class: 'sb-field' }, h('div', { style: 'display:flex;justify-content:space-between' }, h('label', {}, 'SEO title'), tc), titleIn),
          h('div', { class: 'sb-field' }, h('div', { style: 'display:flex;justify-content:space-between' }, h('label', {}, 'SEO description'), dc), descIn),
          h('div', { class: 'sb-field' }, h('label', {}, 'Focus keyword'), kwIn),
          h('div', { class: 'sb-lab' }, 'How it looks on Google'), g, checks);
        updateSeoBits();
      } else if (S.tab === 'style') {
        const c = clone(S.config), t = c.theme;
        const field = (label, el) => h('div', { class: 'sb-field' }, h('label', {}, label), el);
        pane.append(h('p', { style: 'margin:0;color:var(--mut)' }, 'Style and sections for this client’s site. Only owners and admins see this.'),
          field('Business name', h('input', { value: t.name || '', maxlength: 60, oninput: e => { t.name = e.target.value; } })),
          h('div', { class: 'sb-col2' }, field('Main colour', h('input', { type: 'color', value: t.primary, oninput: e => { t.primary = e.target.value; } })), field('Dark colour', h('input', { type: 'color', value: t.secondary, oninput: e => { t.secondary = e.target.value; } }))),
          field('Font', h('select', { onchange: e => { t.font = e.target.value; } }, [['system', 'Clean (default)'], ['serif', 'Classic serif'], ['rounded', 'Friendly rounded'], ['luxury', 'Elegant (Cormorant + Jost)']].map(([v, l]) => h('option', { value: v, selected: t.font === v }, l)))),
          field('Corner roundness', h('input', { type: 'range', min: 0, max: 28, value: t.radius ?? 12, oninput: e => { t.radius = +e.target.value; } })),
          h('div', { class: 'sb-lab' }, 'Sections available for this client'),
          ...Object.keys(LABELS).map(k => h('label', { class: 'sb-check' }, h('input', { type: 'checkbox', checked: c.blocks.includes(k), onchange: e => { c.blocks = e.target.checked ? [...new Set([...c.blocks, k])] : c.blocks.filter(x => x !== k); } }), LABELS[k])),
          h('details', {}, h('summary', {}, 'Advanced: custom sections (JSON)'), h('textarea', { rows: 8, style: 'width:100%;font-family:ui-monospace,monospace;font-size:12px', spellcheck: false, oninput: e => { try { c.custom = JSON.parse(e.target.value || '[]'); e.target.style.borderColor = ''; } catch { e.target.style.borderColor = 'var(--danger)'; } } }, JSON.stringify(c.custom || [], null, 2)),
            h('small', { style: 'color:var(--mut)' }, 'Each section: { "type": "pricing", "label": "Pricing", "fields": [{ "key": "title", "label": "Heading", "kind": "text" }] }. Kinds: text, textarea, image, link. Add its type to the list above to switch it on.')),
          h('button', { type: 'button', class: 'sb-btn primary', onclick: async () => { c.custom.forEach(x => { if (x.type && !c.blocks.includes(x.type)) c.blocks.push(x.type); }); try { await api('builder-save', {}, { slug: '_config', page: c, baseSha: S.list.configSha }); toast('Style saved'); await loadList(true); } catch (e) { toast(e.message, 'err'); } } }, 'Save style'));
      }
    }

    /* ---------- top bar ---------- */
    function renderTop() {
      if (!top) return;
      const L = S.list, ro = S.readonly;
      const over = S.page && ((S.page.seo.title || '').length > SEO_T || (S.page.seo.description || '').length > SEO_D);
      const sel = h('select', { 'aria-label': 'Page', onchange: e => switchPage(e.target.value) }, !S.slug ? h('option', { value: '' }, 'Choose a page…') : null, ...(L?.pages || []).map(p => h('option', { value: p.slug, selected: p.slug === S.slug }, `${p.title || p.slug}  ${p.url}`)), S.isNew ? h('option', { value: S.slug, selected: true }, `${S.page.title} (new)`) : null);
      top.replaceChildren(...[
        h('button', { type: 'button', class: 'sb-btn', onclick: close }, '← Back'), h('b', {}, '🧱 ' + (opts.name || 'Visual builder')), sel,
        L?.role !== 'client' && L?.canWrite ? h('button', { type: 'button', class: 'sb-btn', onclick: () => newPageDialog(false) }, '＋ New page') : null,
        L?.canWrite && S.page ? h('button', { type: 'button', class: 'sb-btn', onclick: () => newPageDialog(true) }, '⧉ Duplicate page') : null,
        h('span', { class: 'grow' }),
        S.page ? h('div', { class: 'sb-seg', role: 'group', 'aria-label': 'View' }, [['edit', '✏️ Edit'], ['site', '🌐 Preview site']].map(([k, l]) => h('button', { type: 'button', class: S.mode === k ? 'on' : '', onclick: () => { S.mode = k; renderTop(); renderCanvas(); } }, l))) : null,
        h('div', { class: 'sb-seg', role: 'group', 'aria-label': 'Preview size' }, [['desktop', '🖥 Desktop'], ['tablet', '▭ Tablet'], ['mobile', '📱 Mobile']].map(([k, l]) => h('button', { type: 'button', class: S.vp === k ? 'on' : '', onclick: () => { S.vp = k; renderTop(); frame?.classList.remove('vp-desktop', 'vp-tablet', 'vp-mobile'); frame?.classList.add('vp-' + k); } }, l))),
        h('button', { type: 'button', class: 'sb-btn icon', title: 'Undo (Ctrl+Z)', 'aria-label': 'Undo', disabled: ro || !S.undo.length && S.json === json(), onclick: doUndo }, '↶'),
        h('button', { type: 'button', class: 'sb-btn icon', title: 'Redo (Ctrl+Shift+Z)', 'aria-label': 'Redo', disabled: ro || !S.redo.length, onclick: doRedo }, '↷'),
        S.page && !S.isNew ? h('button', { type: 'button', class: 'sb-btn', onclick: showHistory }, '🕘 History') : null,
        ro ? h('span', { class: 'sb-btn', style: 'cursor:default' }, '👀 View only') : null,
        !ro ? h('button', { type: 'button', class: 'sb-btn primary', id: 'sb-save', disabled: !S.page || (!S.dirty && !S.isNew) || S.saving || over, title: over ? 'The SEO title or description is too long' : '', onclick: save }, S.saving ? 'Saving…' : (S.dirty || S.isNew) ? h('span', {}, h('span', { class: 'sb-dot' }), 'Save to preview') : 'Saved ✓') : null,
        h('button', { type: 'button', class: 'sb-btn', disabled: true, title: 'Available once the site goes live' }, '🚀 Publish to live')].filter(Boolean));
    }

    /* ---------- dialogs ---------- */
    function modal(title, body, actions) {
      const m = h('div', { class: 'sb-modal', onmousedown: e => { if (e.target === m) m.remove(); } }, h('div', { class: 'sb-dialog', role: 'dialog', 'aria-label': title }, h('h3', {}, title), body, h('div', { class: 'row' }, actions)));
      root.append(m); return m;
    }
    function newPageDialog(duplicate) {
      const name = h('input', { value: duplicate ? (S.page.title + ' copy') : '', placeholder: 'e.g. Gutter repair', maxlength: 120 });
      const url = h('input', { placeholder: '/gutter-repair/' });
      let touched = false; url.addEventListener('input', () => { touched = true; });
      name.addEventListener('input', () => { if (!touched) url.value = '/' + name.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') + '/'; }); if (duplicate) name.dispatchEvent(new Event('input'));
      const err = h('p', { style: 'color:var(--danger);margin:0' });
      const m = modal(duplicate ? 'Duplicate this page' : 'Add a new page', h('div', { style: 'display:grid;gap:12px' }, h('div', { class: 'sb-field' }, h('label', {}, 'Page name'), name), h('div', { class: 'sb-field' }, h('label', {}, 'Page address (URL)'), url), err),
        [h('button', { type: 'button', class: 'sb-btn', onclick: () => m.remove() }, 'Cancel'), h('button', { type: 'button', class: 'sb-btn primary', onclick: () => {
          const slug = url.value.replace(/\//g, ' ').trim().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
          if (!name.value.trim() || !slug) { err.textContent = 'Give the page a name and an address.'; return; }
          if ((S.list.pages.some(p => p.slug === slug)) || slug === 'home' || slug.startsWith('_')) { err.textContent = 'A page with that address already exists.'; return; }
          if (S.dirty && !confirm('You have unsaved changes on this page. Leave them behind?')) return;
          const base = duplicate ? clone(S.page) : { blocks: [], seo: { title: '', description: '', focusKeyword: '' } };
          S.page = { v: 1, slug, title: name.value.trim(), url: '/' + slug + '/', seo: duplicate ? { ...base.seo, title: '', description: '' } : base.seo, blocks: (base.blocks || []).map(b => ({ ...b, id: uid() })) };
          S.slug = slug; S.isNew = true; S.baseSha = null; S.dirty = true; S.undo = []; S.redo = []; S.snap = json(); S.sel = null; S.history = []; S.tab = 'add'; m.remove(); renderTop(); renderCanvas(); renderSide();
        } }, duplicate ? 'Create copy' : 'Create page')]);
      name.focus();
    }
    async function showHistory() {
      const body = h('div', { class: 'sb-hist' }, h('small', {}, 'Loading…'));
      const m = modal('Version history', body, [h('button', { type: 'button', class: 'sb-btn', onclick: () => m.remove() }, 'Close')]);
      try {
        const r = await api('builder-read', { slug: S.slug }); S.history = r.history || [];
        body.replaceChildren(...(S.history.length ? S.history.map(v => h('div', { class: 'h' }, h('div', {}, h('b', {}, `Version ${v.version}`), ' · ', v.actor || 'Unknown', h('br'), h('small', {}, new Date(v.created_at).toLocaleString() + ' · ' + (v.message || ''))),
          S.list.role === 'admin' ? h('button', { type: 'button', class: 'sb-btn', onclick: async () => { if (!confirm(`Restore version ${v.version} of this page? The current version stays in the history.`)) return; try { await api('restore', {}, { path: 'src/content/builder/' + S.slug + '.json', version: v.version }); m.remove(); toast('Restored version ' + v.version); await openPage(S.slug); } catch (e) { toast(e.message, 'err'); } } }, 'Restore') : null)) : [h('small', {}, 'No saved versions yet.')]));
      } catch (e) { body.replaceChildren(h('p', { style: 'color:var(--danger)' }, e.message)); }
    }

    /* ---------- load / save ---------- */
    async function loadList(keepPage) {
      const r = await api('builder-list'); S.list = r; S.list.clientName = opts.name; S.config = r.config; S.readonly = !r.canWrite;
      if (!keepPage) { S.slug = null; S.page = null; }
      renderTop(); renderSide(); renderCanvas();
    }
    async function openPage(slug) {
      const r = await api('builder-read', { slug });
      S.slug = slug; S.page = r.page; S.baseSha = r.sha; S.isNew = false; S.dirty = false; S.undo = []; S.redo = []; S.snap = json(); S.sel = null; S.history = r.history || [];
      S.page.seo = S.page.seo || { title: '', description: '', focusKeyword: '' }; S.page.blocks = S.page.blocks || [];
      await loadList(true); renderTop(); renderCanvas(); renderSide();
    }
    async function switchPage(slug) {
      if (!slug || slug === S.slug) return;
      if (S.dirty && !confirm('You have unsaved changes on this page. Leave them behind?')) { renderTop(); return; }
      try { await openPage(slug); } catch (e) { toast(e.message, 'err'); renderTop(); }
    }
    async function doImportLive() {
      const url = (window.prompt('Website address to import', S.list.previewUrl || 'https://') || '').trim(); if (!url || url === 'https://') return;
      try {
        const cs = getComputedStyle(document.documentElement), hex = v => (/^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim() : '');
        toast('Reading the website…'); const r = await api('builder-import-live', {}, { url, businessName: opts.name || '', primary: hex(cs.getPropertyValue('--brand-primary')), secondary: hex(cs.getPropertyValue('--brand-secondary')) });
        toast(`Imported ${r.imported} pages`); await loadList(); const first = S.list.pages[0]; if (first) await openPage(first.slug);
      } catch (e) { toast(e.message, 'err'); }
    }
    async function doTemplate(t) {
      try {
        const cs = getComputedStyle(document.documentElement), hex = v => (/^#[0-9a-f]{6}$/i.test(v.trim()) ? v.trim() : '');
        const r = await api('builder-template', {}, { sourceClientId: t.id, businessName: opts.name || '', primary: hex(cs.getPropertyValue('--brand-primary')), secondary: hex(cs.getPropertyValue('--brand-secondary')) });
        toast(`Created ${r.imported} pages from the ${t.name} template`); await loadList(); const first = S.list.pages[0]; if (first) await openPage(first.slug);
      } catch (e) { toast(e.message, 'err'); }
    }
    async function doImport() {
      try { const r = await api('builder-import', {}, {}); toast(`Created ${r.imported} pages from the current website`); await loadList(); const first = S.list.pages[0]; if (first) await openPage(first.slug); } catch (e) { toast(e.message, 'err'); }
    }
    window.addEventListener('message', e => {
      const d = e.data || {}; if (!d.f2b || !S.rawFrame || e.source !== S.rawFrame.contentWindow) return;
      if (d.f2b === 'dirty') { if (!S.dirty) { S.dirty = true; renderTop(); } }
      else if (d.f2b === 'img' && editing()) { const next = prompt('Paste the new picture address (https://…). Leave empty to cancel.', d.src || ''); if (next && /^https?:\/\//.test(next.trim())) S.rawFrame.contentWindow.postMessage({ f2b: 'setimg', idx: d.idx, src: next.trim() }, '*'); }
      else if (d.f2b === 'html' && S.rawWait) { S.rawWait(d.body); S.rawWait = null; }
    });
    const collectRaw = () => new Promise((res, rej) => { if (!S.rawFrame?.contentWindow) return rej(new Error('The page is still loading.')); const t = setTimeout(() => { S.rawWait = null; rej(new Error('Could not read the page. Try again.')); }, 4000); S.rawWait = b => { clearTimeout(t); res(b); }; S.rawFrame.contentWindow.postMessage({ f2b: 'collect' }, '*'); });
    async function save() {
      if (!S.page || S.saving) return; S.saving = true; renderTop();
      try {
        if (S.page.raw && S.rawFrame) { S.page.raw.body = await collectRaw(); }
        clearTimeout(typingTimer); pushHistory();
        const r = await api('builder-save', {}, { slug: S.slug, page: S.page, baseSha: S.baseSha, message: S.isNew ? undefined : undefined, allowNew: true });
        if (r.unchanged) { S.dirty = false; toast('Nothing to save'); }
        else { S.baseSha = r.sha; S.dirty = false; S.isNew = false; if (r.page) { S.page.url = r.page.url; } toast(r.needsApproval ? 'Saved · sent to F2B Media for approval' : `Saved to preview · version ${r.version}`); await loadList(true); }
      } catch (e) { toast(e.message, 'err'); if (e.status === 409) { S.banner = h('div', { class: 'sb-banner err' }, e.message, ' ', h('button', { type: 'button', class: 'sb-btn', onclick: async () => { S.banner = null; try { await openPage(S.slug); } catch (er) { toast(er.message, 'err'); } } }, 'Reload page')); renderCanvas(); } }
      finally { S.saving = false; renderTop(); }
    }
    function close() {
      if (S.dirty && !confirm('You have unsaved changes. Close the builder without saving?')) return;
      document.removeEventListener('keydown', onKey, true); window.removeEventListener('beforeunload', onUnload); root.remove(); style.remove(); document.body.style.overflow = ''; opts.onClose?.();
    }
    const onUnload = e => { if (S.dirty) { e.preventDefault(); e.returnValue = ''; } };
    const onKey = e => {
      if (e.key === 'Escape' && !root.querySelector('.sb-modal')) { close(); return; }
      const mod = e.ctrlKey || e.metaKey; const ed = e.target.closest?.('[contenteditable],input,textarea,select');
      if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); if (!S.readonly && S.dirty) save(); return; }
      if (mod && !ed && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? doRedo() : doUndo(); }
      else if (mod && !ed && e.key.toLowerCase() === 'y') { e.preventDefault(); doRedo(); }
    };

    /* ---------- mount ---------- */
    top = h('div', { class: 'sb-top' }); side = h('div', { class: 'sb-side' }); stage = h('div', { class: 'sb-stage' });
    stage.addEventListener('dragover', autoScroll);
    root.append(top, h('div', { class: 'sb-main' }, side, stage));
    document.head.append(style); document.body.append(root); document.body.style.overflow = 'hidden';
    document.addEventListener('keydown', onKey, true); window.addEventListener('beforeunload', onUnload);
    renderTop(); stage.append(h('div', { class: 'sb-empty' }, h('h3', {}, 'Loading your site…')));
    (async () => {
      try {
        await loadList();
        const want = opts.page && S.list.pages.find(p => p.slug === opts.page) ? opts.page : (S.list.pages.find(p => p.slug === 'home') || S.list.pages[0])?.slug;
        if (want) await openPage(want);
      } catch (e) { stage.replaceChildren(h('div', { class: 'sb-empty' }, h('h3', {}, 'The builder could not open'), h('p', {}, e.status === 404 ? 'Website content has not been imported for this client yet.' : e.message), h('button', { type: 'button', class: 'sb-btn', onclick: close }, 'Close'))); }
    })();
    return { close, state: S };
  }

  window.f2bSiteBuilder = { open, version: 1 };
})();
