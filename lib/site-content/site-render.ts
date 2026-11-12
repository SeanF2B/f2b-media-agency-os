// Renders builder pages (JSON blocks) to a complete, responsive, SEO-ready HTML page.
// Used by the public preview route so the visual builder edits are the site itself (no separate site codebase needed).
const esc = (v: any) => String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
const arr = (v: any) => (Array.isArray(v) ? v : []);
const paras = (t: any) => String(t ?? "").split(/\n{2,}/).map((x) => `<p>${esc(x).replace(/\n/g, "<br>")}</p>`).join("");

export type RenderCtx = { clientId: string; base: string; theme: { primary: string; secondary: string; font: string; radius: number; name: string }; pages: Array<{ slug: string; title: string; url: string }>; phone: string; current: string };

const img = (ctx: RenderCtx, p: any) => { const s = String(p || ""); if (!s) return ""; if (/^https:\/\//.test(s)) return s; return `${ctx.base}?c=${encodeURIComponent(ctx.clientId)}&img=${encodeURIComponent(s)}`; };
const href = (ctx: RenderCtx, link: any) => {
  const l = String(link || "#"); if (!l.startsWith("/")) return esc(l);
  const hit = ctx.pages.find((p) => p.url === l || p.url === (l.endsWith("/") ? l : l + "/"));
  return hit ? esc(`${ctx.base}?c=${encodeURIComponent(ctx.clientId)}&p=${encodeURIComponent(hit.slug)}`) : "#contact";
};

const blocks: Record<string, (p: any, c: RenderCtx) => string> = {
  hero: (p, c) => `<section class="hero"${p.image ? ` style="background-image:linear-gradient(90deg,rgba(0,0,0,.62),rgba(0,0,0,.25)),url('${esc(img(c, p.image))}')"` : ""}><div class="wrap"><p class="eyebrow">${esc(p.eyebrow)}</p><h1>${esc(p.title)}</h1><p class="lead">${esc(p.text)}</p>${p.buttonText ? `<a class="btn" href="${href(c, p.buttonLink)}">${esc(p.buttonText)}</a>` : ""}</div></section>`,
  stats: (p) => `<section class="stats"><div class="wrap grid">${arr(p.items).map((i) => `<div><b>${esc(i.value)}</b><span>${esc(i.label)}</span></div>`).join("")}</div></section>`,
  services: (p, c) => `<section class="sec"><div class="wrap"><h2>${esc(p.title)}</h2>${p.intro ? `<p class="intro">${esc(p.intro)}</p>` : ""}<div class="cards">${arr(p.items).map((i) => `<a class="card" href="${href(c, i.link)}">${i.image ? `<img loading="lazy" src="${esc(img(c, i.image))}" alt="${esc(i.title)}">` : ""}<h3>${esc(i.title)}</h3><p>${esc(i.text)}</p></a>`).join("")}</div></div></section>`,
  features: (p) => `<section class="sec alt"><div class="wrap"><h2>${esc(p.title)}</h2>${p.intro ? `<p class="intro">${esc(p.intro)}</p>` : ""}<div class="cards">${arr(p.items).map((i) => `<div class="card plain"><h3>${esc(i.title)}</h3><p>${esc(i.text)}</p></div>`).join("")}</div></div></section>`,
  steps: (p) => `<section class="sec"><div class="wrap"><h2>${esc(p.title)}</h2><ol class="steps">${arr(p.items).map((i) => `<li><h3>${esc(i.title)}</h3><p>${esc(i.text)}</p></li>`).join("")}</ol></div></section>`,
  text: (p) => `<section class="sec"><div class="wrap narrow">${p.title ? `<h2>${esc(p.title)}</h2>` : ""}${paras(p.text)}</div></section>`,
  imagetext: (p, c) => `<section class="sec"><div class="wrap split ${p.side === "right" ? "rev" : ""}">${p.image ? `<img loading="lazy" src="${esc(img(c, p.image))}" alt="${esc(p.title)}">` : ""}<div><h2>${esc(p.title)}</h2>${paras(p.text)}${p.buttonText ? `<a class="btn" href="${href(c, p.buttonLink)}">${esc(p.buttonText)}</a>` : ""}</div></div></section>`,
  image: (p, c) => `<section class="sec"><div class="wrap">${p.image ? `<figure><img loading="lazy" src="${esc(img(c, p.image))}" alt="${esc(p.caption)}">${p.caption ? `<figcaption>${esc(p.caption)}</figcaption>` : ""}</figure>` : ""}</div></section>`,
  gallery: (p, c) => `<section class="sec alt"><div class="wrap"><h2>${esc(p.title)}</h2><div class="gal">${arr(p.images).filter(Boolean).map((i) => `<img loading="lazy" src="${esc(img(c, i))}" alt="">`).join("")}</div></div></section>`,
  reviews: (p) => `<section class="sec"><div class="wrap"><h2>${esc(p.title)}</h2><div class="cards">${arr(p.items).map((i) => `<blockquote class="card plain"><div class="stars">${"★".repeat(Math.max(1, Math.min(5, +i.rating || 5)))}</div><p>${esc(i.text)}</p><footer>${esc(i.name)}${i.source ? ` · ${esc(i.source)}` : ""}</footer></blockquote>`).join("")}</div></div></section>`,
  faq: (p) => `<section class="sec alt"><div class="wrap narrow"><h2>${esc(p.title)}</h2>${arr(p.items).map((i) => `<details><summary>${esc(i.q)}</summary><p>${esc(i.a)}</p></details>`).join("")}</div></section>`,
  cta: (p, c) => `<section class="cta"><div class="wrap"><h2>${esc(p.title)}</h2><p>${esc(p.text)}</p><a class="btn light" href="${href(c, p.buttonLink)}">${esc(p.buttonText)}</a></div></section>`,
  contact: (p, c) => `<section class="sec" id="contact"><div class="wrap narrow"><h2>${esc(p.title)}</h2><p>${esc(p.text)}</p><form method="post" action="${esc(c.base)}?c=${encodeURIComponent(c.clientId)}&lead=1" class="form"><input name="name" placeholder="Your name" required><input name="phone" placeholder="Phone" required><input name="email" type="email" placeholder="Email"><textarea name="message" rows="4" placeholder="How can we help?"></textarea><input name="website" class="hp" tabindex="-1" autocomplete="off"><button class="btn" type="submit">${esc(p.buttonText || "Send message")}</button></form></div></section>`,
};

export function renderPage(page: any, ctx: RenderCtx): string {
  const t = ctx.theme, seo = page.seo || {};
  const font = t.font === "serif" ? "Georgia,serif" : t.font === "rounded" ? 'ui-rounded,"Segoe UI",system-ui,sans-serif' : 'system-ui,-apple-system,"Segoe UI",Roboto,sans-serif';
  const nav = ctx.pages.map((p) => `<a href="${esc(`${ctx.base}?c=${encodeURIComponent(ctx.clientId)}&p=${encodeURIComponent(p.slug)}`)}"${p.slug === ctx.current ? ' class="on"' : ""}>${esc(p.title)}</a>`).join("");
  const body = arr(page.blocks).map((b: any) => (blocks[b.type] ? blocks[b.type](b.props || {}, ctx) : "")).join("\n");
  const title = seo.title || `${page.title}${t.name ? " | " + t.name : ""}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>${seo.description ? `<meta name="description" content="${esc(seo.description)}">` : ""}<meta name="robots" content="noindex"><meta property="og:title" content="${esc(title)}">${seo.description ? `<meta property="og:description" content="${esc(seo.description)}">` : ""}<style>
:root{--p:${t.primary};--s:${t.secondary};--r:${t.radius}px}*{box-sizing:border-box}body{margin:0;font:16px/1.65 ${font};color:#1c2430}img{max-width:100%;display:block}a{color:inherit}
.wrap{max-width:1120px;margin:0 auto;padding:0 20px}.narrow{max-width:760px}header.top{background:var(--s);color:#fff;position:sticky;top:0;z-index:5}header.top .wrap{display:flex;align-items:center;justify-content:space-between;gap:16px;min-height:64px;flex-wrap:wrap}header.top b{font-size:18px}header.top nav{display:flex;gap:16px;flex-wrap:wrap}header.top nav a{text-decoration:none;opacity:.85;font-weight:600;font-size:14px}header.top nav a.on,header.top nav a:hover{opacity:1;text-decoration:underline}.call{background:var(--p);color:#fff;padding:8px 16px;border-radius:99px;text-decoration:none;font-weight:700}
.hero{background:var(--s) center/cover;color:#fff;padding:96px 0}.hero h1{font-size:clamp(32px,5vw,56px);line-height:1.1;margin:8px 0 14px;max-width:780px}.lead{font-size:20px;max-width:640px;opacity:.95}.eyebrow{text-transform:uppercase;letter-spacing:.12em;font-weight:800;font-size:12px;opacity:.9}
.btn{display:inline-block;background:var(--p);color:#fff;padding:13px 26px;border-radius:var(--r);font-weight:800;text-decoration:none;border:0;font:inherit;font-weight:800;cursor:pointer;margin-top:12px}.btn.light{background:#fff;color:var(--s)}
.stats{background:var(--p);color:#fff}.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(160px,1fr));gap:12px;padding:22px 20px;text-align:center}.stats b{display:block;font-size:26px}.stats span{opacity:.9;font-size:14px}
.sec{padding:64px 0}.alt{background:#f4f6f9}h2{font-size:clamp(26px,3.4vw,38px);margin:0 0 12px}.intro{color:#4d5b6a;margin-top:0}.cards{display:grid;grid-template-columns:repeat(auto-fit,minmax(250px,1fr));gap:18px;margin-top:22px}.card{background:#fff;border:1px solid #e3e8ee;border-radius:var(--r);overflow:hidden;text-decoration:none;display:block}.card img{width:100%;aspect-ratio:4/3;object-fit:cover}.card h3,.card p{margin:12px 16px}.card.plain{padding:6px 0}.stars{color:#f5a623;margin:12px 16px 0}blockquote{margin:0}footer{margin:0 16px 14px;font-weight:700;font-size:14px}
.steps{counter-reset:s;list-style:none;padding:0;display:grid;grid-template-columns:repeat(auto-fit,minmax(220px,1fr));gap:18px}.steps li{counter-increment:s;background:#fff;border:1px solid #e3e8ee;border-radius:var(--r);padding:18px}.steps li:before{content:counter(s);display:grid;place-items:center;width:34px;height:34px;border-radius:50%;background:var(--p);color:#fff;font-weight:800;margin-bottom:8px}
.split{display:grid;grid-template-columns:1fr 1fr;gap:32px;align-items:center}.split.rev img{order:2}.split img{border-radius:var(--r)}@media(max-width:760px){.split{grid-template-columns:1fr}.split.rev img{order:0}.hero{padding:64px 0}}
.gal{display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:10px;margin-top:18px}.gal img{width:100%;aspect-ratio:1;object-fit:cover;border-radius:var(--r)}details{background:#fff;border:1px solid #e3e8ee;border-radius:var(--r);padding:14px 18px;margin:10px 0}summary{font-weight:700;cursor:pointer}figure{margin:0}figcaption{color:#4d5b6a;font-size:14px;margin-top:6px}
.cta{background:var(--s);color:#fff;text-align:center;padding:64px 0}.cta p{max-width:560px;margin:0 auto 6px;opacity:.95}.form{display:grid;gap:10px;margin-top:14px}.form input,.form textarea{font:inherit;padding:12px 14px;border:1px solid #cfd8e2;border-radius:var(--r);width:100%}.hp{position:absolute;left:-9999px}
footer.site{background:#10161d;color:#b9c4d0;padding:28px 0;font-size:14px;text-align:center}
</style></head><body><header class="top"><div class="wrap"><b>${esc(t.name || "")}</b><nav>${nav}</nav>${ctx.phone ? `<a class="call" href="tel:${esc(ctx.phone.replace(/[^+\d]/g, ""))}">${esc(ctx.phone)}</a>` : ""}</div></header>
${body}
<footer class="site"><div class="wrap">© ${new Date().getFullYear()} ${esc(t.name || "")}</div></footer></body></html>`;
}
