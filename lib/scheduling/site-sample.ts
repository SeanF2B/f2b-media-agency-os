// Sample-data helpers: read a client's own website HTML for their team (names, portraits, their work) and a gallery.
// Pure functions (no fetching) so they can be tested against saved pages.

export type TeamSample = { team: string[]; photos: Record<string, string>; work: Record<string, string[]> };

const NAME = /^([A-Z][A-Za-zÀ-ÿ'’.-]{1,20}( [A-Z][A-Za-zÀ-ÿ'’.-]{1,20}){0,2}|[A-Z]{2,4})$/;
const NOT_NAME = /^(Navigation|Main Navigation|Nav|Recent|Recent Posts|Recent Comments|Recent Projects|Contacts?|Red|Categories|Archives|Search|Sidebar|Footer|Header|Skip|Next|Previous|Close|Open|More|Projects?|Our Projects|Latest|Latest News|Popular|Related|Share|Tags|Info|Links|Useful Links|Quick Links|Company|Support|Help|Login|Log In|Sign In|Cart|Account|Interiors?|Kitchens?|Bathrooms?|Bedrooms?|Showroom|Products?|Collections?|Inspiration|Ideas|Design|Designs|Home|About|About Us|Contact|Contact Us|Book|Booking|Book Now|Gallery|Shop|Blog|News|Reviews?|Services?|Prices?|Pricing|Faqs?|Team|Our Team|Meet The Team|Artists?|Our Artists|Guest Artists?|Resident Artists?|Meet|Menu|Aftercare|Piercing|Piercings|Tattoo|Tattoos|Read More|Learn More|Instagram|Facebook|Tiktok|Email|Phone|Call|Opening Hours|Hours|Address|Location|Find Us|Privacy|Terms|Cookie|Get In Touch|Follow Us|Studio|Welcome|Testimonials|Portfolio|Styles|View|Social|Quick Links|Quick Contact|Our Work|Ireland|England|Birmingham|Dublin|Galway|Cork|London|Uk|Ie|Faq|Black Poppy|Apex Ink)$/i;
const SERVICE = /(repair|install|replace|clean|survey|inspect|consult|design|fitting|quote|service|maintenance|roof|gutter|chimney|kitchen|bathroom|tattoo|piercing|treatment|massage|facial|colour|color|lesson|session|assessment|removal|painting|realism|fine line|cover)/i;
// Headings that end the resident team (guests, galleries, footers).
const STOP = /^(guest artists?|our work|gallery|tattoo gallery|reviews?|testimonials|instagram|hours|opening hours|quick links|social|contact|address|location|faqs?)\b/i;
const BAD_IMG = /logo|no\+bg|no-bg|icon|\.svg|sprite|placeholder|data:image|empty_|blank|spacer|payment|insta\.|avatar-default|gravatar|emoji|flag/i;

export const htmlText = (h: string) => h.replace(/<[^>]+>/g, " ").replace(/&amp;/g, "&").replace(/&#0?39;|&rsquo;|&#8217;/g, "'").replace(/&[a-z#0-9]+;/gi, " ").replace(/[​﻿]/g, "").replace(/\s+/g, " ").trim();
const strip = (h: string) => h.replace(/<script\b[\s\S]*?<\/script>|<style\b[\s\S]*?<\/style>|<noscript\b[\s\S]*?<\/noscript>/gi, (m) => " ".repeat(m.length));
const abs = (src: string, page: string) => { try { return new URL(src.replace(/&amp;/g, "&").trim(), page).href.replace(/^http:/, "https:"); } catch { return ""; } };

type Img = { at: number; src: string; alt: string };
export function pageImages(html: string, pageUrl: string): Img[] {
  const out: Img[] = [];
  for (const m of strip(html).matchAll(/<img\b[^>]*>/gi)) {
    const tag = m[0];
    const raw = /\b(?:data-src|data-lazy-src|data-original)="([^"]+)"/i.exec(tag)?.[1] || /\ssrc="([^"]+)"/i.exec(tag)?.[1] || /\bsrcset="([^"\s]+)/i.exec(tag)?.[1] || "";
    if (!raw || BAD_IMG.test(raw)) continue;
    const w = Number(/\bwidth="(\d+)"/i.exec(tag)?.[1] || 0); if (w && w < 80) continue;
    const src = abs(raw, pageUrl); if (src) out.push({ at: m.index || 0, src, alt: /\balt="([^"]*)"/i.exec(tag)?.[1] || "" });
  }
  return out;
}

/** The site's team / artists page link (same host only). */
export function findTeamHref(html: string, pageUrl: string): string {
  const hrefs = [...html.matchAll(/href="([^"#]+)"/gi)].map((m) => m[1]).filter((h) => !/\.(css|js|png|jpe?g|webp|svg|xml)(\?|$)|wp-json|feed\//i.test(h));
  const hit = hrefs.find((h) => /\/(meet-the-team|meet-the-artists|our-team|the-team|team|artists?|our-artists|resident-artists|staff|people)\/?(\?|$)/i.test(h)) || hrefs.find((h) => /\/about(-us)?\/?(\?|$)/i.test(h));
  if (!hit) return "";
  const url = abs(hit, pageUrl);
  try { return new URL(url).host.replace(/^www\./, "") === new URL(pageUrl).host.replace(/^www\./, "") ? url : ""; } catch { return ""; }
}

/** The site's gallery / portfolio page link (same host only). */
export function findGalleryHref(html: string, pageUrl: string): string {
  const hit = [...html.matchAll(/href="([^"#]+)"/gi)].map((m) => m[1]).find((h) => /\/(tattoo-gallery|studio-gallery|gallery|portfolio|our-work|work)\/?(\?|$)/i.test(h));
  if (!hit) return "";
  const url = abs(hit, pageUrl);
  try { return new URL(url).host.replace(/^www\./, "") === new URL(pageUrl).host.replace(/^www\./, "") ? url : ""; } catch { return ""; }
}

/** Team names with their portrait and the photos of their work that follow them on the page. */
export function parseTeam(html: string, pageUrl: string, max = 6): TeamSample {
  const clean = strip(html);
  const imgs = pageImages(html, pageUrl);
  const heads: Array<{ at: number; t: string }> = [];
  for (const m of clean.matchAll(/<(h1|h2|h3|h4|h5|h6|strong|figcaption)\b[^>]*>([\s\S]{1,600}?)<\/\1>/gi)) {
    const t = htmlText(m[2]); if (t) heads.push({ at: m.index || 0, t });
  }
  const names: Array<{ at: number; name: string }> = [];
  let stopAt = Infinity;
  for (const h of heads) {
    if (names.length && STOP.test(h.t)) { stopAt = h.at; break; } // resident team is over
    const t = h.t.replace(/\s*(\(|[-–|:@]).*$/, "").trim();
    if (!NAME.test(t) || NOT_NAME.test(t) || SERVICE.test(t) || names.some((n) => n.name === t)) continue;
    names.push({ at: h.at, name: t });
    if (names.length >= max) break;
  }
  const photos: Record<string, string> = {}; const used = new Set<string>();
  // Sites put portraits consistently either just before or just after each name: work out which side this page uses.
  const gap = (n: { at: number }, side: 1 | -1) => Math.min(2000, ...imgs.map((x) => (x.at - n.at) * side).filter((d) => d > 0));
  const side: 1 | -1 = names.reduce((t, n) => t + gap(n, 1) - gap(n, -1), 0) <= 0 ? 1 : -1;
  // Portrait: an image whose alt names them, else the nearest unused image on that side (within ~2000 characters), else either side.
  for (const n of names) {
    const byAlt = imgs.find((x) => !used.has(x.src) && x.alt.trim().toLowerCase() === n.name.toLowerCase());
    const pick = (ok: (d: number) => boolean) => imgs.filter((x) => !used.has(x.src) && ok(x.at - n.at)).sort((a, z) => Math.abs(a.at - n.at) - Math.abs(z.at - n.at))[0];
    const near = byAlt || pick((d) => d * side > 0 && Math.abs(d) < 2000) || pick((d) => Math.abs(d) < 2000);
    if (near) { photos[n.name] = near.src; used.add(near.src); }
  }
  const work: Record<string, string[]> = {};
  names.forEach((n, i) => {
    const end = Math.min(names[i + 1]?.at ?? n.at + 30000, stopAt);
    const list = [...new Set(imgs.filter((x) => x.at > n.at && x.at < end && !used.has(x.src)).map((x) => x.src))].slice(0, 12);
    if (list.length) work[n.name] = list;
  });
  // Few names but none with a heading? Fall back to image alt text that looks like a name.
  if (names.length < 2) for (const x of imgs) {
    const t = htmlText(x.alt).replace(/\s*[-–|:].*$/, "").trim();
    if (names.length >= max || !NAME.test(t) || NOT_NAME.test(t) || SERVICE.test(t) || names.some((n) => n.name === t)) continue;
    names.push({ at: x.at, name: t }); photos[t] = x.src;
  }
  return { team: names.map((n) => n.name), photos, work };
}

/** Photos of work from a gallery page (largest images first in page order, no duplicates). */
export function parseGallery(html: string, pageUrl: string, max = 24): string[] {
  return [...new Set(pageImages(html, pageUrl).map((x) => x.src))].slice(0, max);
}
