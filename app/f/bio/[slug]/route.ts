import { env } from "cloudflare:workers";
import { LINK_BIO_SQL, renderLinkBioHtml, type LinkBioPage } from "@/lib/link-bio";

// Public Link in bio page: /f/bio/<slug>. Buttons go through ?go=<linkId> so clicks are counted, then redirect.
// One indexed read per visit; views/clicks are single atomic UPDATEs (no read-modify-write).
type RouteContext = { params: Promise<{ slug: string }> };
let ready: Promise<unknown> | null = null;
const ensure = (db: D1Database) => (ready ??= db.batch(LINK_BIO_SQL.map((sql) => db.prepare(sql))).catch((error) => { ready = null; throw error; }));

const notFound = () => new Response(`<!doctype html><html lang="en-IE"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Page not found</title></head><body style="font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;color:#334155"><p>This page isn’t available.</p></body></html>`, { status: 404, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });

export async function GET(request: Request, context: RouteContext) {
  const { slug: rawSlug } = await context.params;
  const slug = String(rawSlug || "").toLowerCase();
  if (!/^[a-z0-9-]{3,40}$/.test(slug) || !env.DB) return notFound();
  await ensure(env.DB);
  const row = await env.DB.prepare("SELECT id, data FROM link_bio_pages WHERE slug=?1 AND published=1").bind(slug).first<{ id: string; data: string }>();
  if (!row) return notFound();
  let page: LinkBioPage;
  try { page = JSON.parse(row.data) as LinkBioPage; } catch { return notFound(); }
  const url = new URL(request.url);
  const go = url.searchParams.get("go") || "";
  if (go) {
    const link = page.links.find((item) => item.id === go && item.enabled);
    if (!link || !/^[a-z0-9]{4,12}$/.test(go)) return Response.redirect(`${url.origin}/f/bio/${slug}`, 302);
    await env.DB.prepare(`UPDATE link_bio_pages SET clicks = json_set(COALESCE(clicks,'{}'), '$.' || ?2, COALESCE(json_extract(clicks, '$.' || ?2), 0) + 1) WHERE id=?1`).bind(row.id, go).run().catch(() => null);
    return new Response(null, { status: 302, headers: { Location: link.url, "Cache-Control": "no-store", "Referrer-Policy": "strict-origin-when-cross-origin" } });
  }
  const bot = /bot|crawl|spider|preview|facebookexternalhit|slurp/i.test(request.headers.get("user-agent") || "");
  if (!bot) await env.DB.prepare("UPDATE link_bio_pages SET views = views + 1 WHERE id=?1").bind(row.id).run().catch(() => null);
  const canonical = `${url.origin}/f/bio/${slug}`;
  const html = renderLinkBioHtml(page, { canonical, hrefFor: (link) => /^https?:/i.test(link.url) ? `/f/bio/${slug}?go=${link.id}` : link.url });
  return new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store" } });
}
