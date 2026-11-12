// Turns an existing static website (HTML) into visual-builder pages so any AI-built site can be managed in the Agency OS.
const dec = (s: string) => s.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
const strip = (s: string) => dec(s.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " ").replace(/[ \t\r\f]+/g, " ").replace(/\s*\n\s*/g, "\n")).trim();
const one = (re: RegExp, s: string) => { const m = s.match(re); return m ? m[1] : ""; };
const all = (re: RegExp, s: string) => [...s.matchAll(re)];
const id = () => "b" + Math.random().toString(36).slice(2, 10);
const b = (type: string, props: Record<string, any>) => ({ id: id(), type, props });

function abs(src: string, base: URL): string {
  const s = dec(src.trim()); if (!s || s.startsWith("data:")) return "";
  try { const u = new URL(s, base); return u.origin === base.origin ? u.pathname + u.search : u.href; } catch { return ""; }
}
const imgOf = (html: string, base: URL) => {
  const m = html.match(/<img[^>]+src=["']([^"']+)["']/i) || html.match(/url\(["']?([^"')]+)["']?\)/i);
  return m ? abs(m[1], base) : "";
};
const linkOf = (html: string, base: URL) => {
  const m = html.match(/<a[^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i); if (!m) return { text: "", link: "" };
  let href = m[1]; try { const u = new URL(dec(href), base); href = u.origin === base.origin ? u.pathname : u.href; } catch { /* keep */ }
  return { text: strip(m[2]).slice(0, 60), link: href };
};

function sectionBlocks(html: string, base: URL, first: boolean): any[] {
  const out: any[] = [];
  const h1 = strip(one(/<h1[^>]*>([\s\S]*?)<\/h1>/i, html)), h2 = strip(one(/<h2[^>]*>([\s\S]*?)<\/h2>/i, html));
  const ps = all(/<p[^>]*>([\s\S]*?)<\/p>/gi, html).map((m) => strip(m[1])).filter((t) => t.length > 1);
  const h3s = all(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, html);
  const details = all(/<details[^>]*>([\s\S]*?)<\/details>/gi, html);
  const quotes = all(/<blockquote[^>]*>([\s\S]*?)<\/blockquote>/gi, html);
  const lower = html.toLowerCase().slice(0, 400);
  if (h1 && (first || !h2)) {
    const l = linkOf(html, base);
    out.push(b("hero", { eyebrow: "", title: h1.slice(0, 140), text: (ps[0] || "").slice(0, 300), buttonText: l.text, buttonLink: l.link || "#contact", image: imgOf(html, base) }));
    return out;
  }
  if (details.length >= 2) { out.push(b("faq", { title: h2 || "Frequently asked questions", items: details.map((d) => ({ q: strip(one(/<summary[^>]*>([\s\S]*?)<\/summary>/i, d[1])), a: strip(d[1].replace(/<summary[\s\S]*?<\/summary>/i, "")) })).filter((i) => i.q) })); return out; }
  if (quotes.length >= 2 || /review|testimonial/.test(lower)) {
    const items = quotes.map((q) => ({ name: strip(one(/<(?:footer|cite|figcaption)[^>]*>([\s\S]*?)<\/(?:footer|cite|figcaption)>/i, q[1])).slice(0, 80) || "Customer", text: strip(q[1].replace(/<(footer|cite|figcaption)[\s\S]*?<\/\1>/gi, "")).slice(0, 400), rating: 5, source: "" })).filter((i) => i.text);
    if (items.length) { out.push(b("reviews", { title: h2 || "What our customers say", items })); return out; }
  }
  if (h3s.length >= 3) {
    const idx = h3s.map((m) => m.index as number), chunks = h3s.map((m, i) => html.slice(idx[i], idx[i + 1] ?? html.length));
    const items = chunks.map((c) => { const l = linkOf(c, base); return { title: strip(one(/<h3[^>]*>([\s\S]*?)<\/h3>/i, c)).slice(0, 90), text: strip(one(/<p[^>]*>([\s\S]*?)<\/p>/i, c)).slice(0, 300), image: imgOf(c, base), link: l.link }; });
    const withImg = items.filter((i) => i.image).length >= items.length / 2;
    out.push(b(withImg ? "services" : "features", { title: h2 || "", intro: ps[0] && !items.some((i) => i.text === ps[0]) ? ps[0].slice(0, 300) : "", items }));
    return out;
  }
  if (h2 || ps.length) {
    const img = imgOf(html, base), l = linkOf(html, base);
    if (/call to action|cta|get a free|book a|request a/i.test(h2) && ps.length <= 2 && l.text) { out.push(b("cta", { title: h2, text: ps[0] || "", buttonText: l.text, buttonLink: l.link || "#contact" })); return out; }
    if (img) out.push(b("imagetext", { title: h2, text: ps.join("\n\n").slice(0, 1800), image: img, side: "left", buttonText: l.text, buttonLink: l.link }));
    else out.push(b("text", { title: h2, text: ps.join("\n\n").slice(0, 3000) }));
  }
  return out;
}

export function htmlToPage(html: string, pageUrl: string) {
  const base = new URL(pageUrl);
  const clean = html.replace(/<!--[\s\S]*?-->/g, "").replace(/<(script|style|svg|noscript|template)[\s\S]*?<\/\1>/gi, "");
  const title = strip(one(/<title[^>]*>([\s\S]*?)<\/title>/i, clean));
  const description = dec(one(/<meta[^>]+name=["']description["'][^>]+content=["']([^"']*)["']/i, clean) || one(/<meta[^>]+content=["']([^"']*)["'][^>]+name=["']description["']/i, clean));
  const main = one(/<main[^>]*>([\s\S]*?)<\/main>/i, clean) || one(/<body[^>]*>([\s\S]*?)<\/body>/i, clean) || clean;
  const body = main.replace(/<(header|nav|footer)[\s\S]*?<\/\1>/gi, "");
  let parts = all(/<section[^>]*>([\s\S]*?)<\/section>/gi, body).map((m) => m[0]);
  if (!parts.length) parts = [body];
  const blocks: any[] = []; parts.forEach((p, i) => blocks.push(...sectionBlocks(p, base, i === 0)));
  return { title: title.split(/\s[|–—-]\s/)[0].slice(0, 100) || "Page", seoTitle: title.slice(0, 60), description: description.slice(0, 155), blocks: blocks.slice(0, 40) };
}

export function internalLinks(html: string, base: URL): string[] {
  const nav = one(/<nav[^>]*>([\s\S]*?)<\/nav>/i, html) || html, set = new Set<string>();
  for (const m of all(/<a[^>]+href=["']([^"'#?]+)["']/gi, nav)) {
    try { const u = new URL(dec(m[1]), base); if (u.origin === base.origin && !/\.(pdf|jpg|png|webp|svg|xml|txt|css|js)$/i.test(u.pathname) && !u.pathname.startsWith("/api/")) set.add(u.pathname.endsWith("/") || u.pathname === "" ? u.pathname || "/" : u.pathname + "/"); } catch { /* skip */ }
  }
  set.delete("/"); return [...set].slice(0, 14);
}

export async function importLiveSite(origin: string, fetcher: typeof fetch = fetch) {
  const base = new URL(origin), pages: any[] = [];
  const get = async (path: string) => { const r = await fetcher(new URL(path, base).href, { headers: { "User-Agent": "F2B-Agency-OS-Importer", Accept: "text/html" }, redirect: "follow" }); if (!r.ok) throw new Error(`${path} returned ${r.status}`); const t = await r.text(); return t.slice(0, 1_500_000); };
  const homeHtml = await get("/");
  const homePage = htmlToPage(homeHtml, base.href); pages.push({ slug: "home", url: "/", title: "Home", seo: { title: homePage.seoTitle, description: homePage.description, focusKeyword: "" }, blocks: homePage.blocks });
  const slugs = new Set(["home"]);
  for (const path of internalLinks(homeHtml, base)) {
    try { const html = await get(path); const p = htmlToPage(html, new URL(path, base).href); if (!p.blocks.length) continue; let slug = path.replace(/^\/|\/$/g, "").replace(/[^\w-]+/g, "-").slice(0, 60) || "page"; while (slugs.has(slug)) slug += "-2"; slugs.add(slug); pages.push({ slug, url: path, title: p.title, seo: { title: p.seoTitle, description: p.description, focusKeyword: "" }, blocks: p.blocks }); } catch { /* skip page */ }
  }
  return pages;
}
