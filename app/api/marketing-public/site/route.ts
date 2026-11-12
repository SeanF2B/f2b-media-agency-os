// Public render of a client's visual-builder website (noindex). Under /api/marketing-public so the existing Access bypass covers it.
import { env } from "cloudflare:workers";
import { d1Store, getSite, workingImage } from "@/lib/site-content/site-content-core";
import { BUILDER_DIR, CONFIG_PATH, DEFAULT_CONFIG, isBuilderPath, normalizeConfig } from "@/lib/site-content/site-builder-core";
import { renderPage, renderRaw } from "@/lib/site-content/site-render";
import { leadToCrm } from "@/lib/conversations/core";

export const dynamic = "force-dynamic";
const CLIENT_RE = /^[\w-]{6,80}$/;
const J = (t: string) => { try { return JSON.parse(t); } catch { return null; } };
const html = (body: string, status = 200) => new Response(body, { status, headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" } });
class Err extends Error { constructor(public status: number, m: string) { super(m); } }

export async function GET(request: Request) {
  const url = new URL(request.url), c = url.searchParams.get("c") || "";
  if (!CLIENT_RE.test(c) || !env.DB) return html("Not found", 404);
  const site = await getSite(env.DB, c); if (!site) return html("Not found", 404);
  const img = url.searchParams.get("img");
  if (img) {
    if (!/^\/[\w./-]{1,200}$/.test(img) || img.includes("..")) return html("Bad image", 400);
    const w = await workingImage(env, c, img);
    if (w) return new Response(w.body, { headers: { "content-type": w.contentType, "cache-control": "private, max-age=300", "x-content-type-options": "nosniff" } });
    const prev = String(site.preview_url || "").replace(/\/$/, "");
    if (/^https:\/\/[^/]+$/.test(prev)) return Response.redirect(prev + img, 302);
    return html("Not found", 404);
  }
  const store = d1Store(env.DB, env.BUCKET, c);
  const files = (await store.list()).filter((f: any) => isBuilderPath(f.path) && f.path !== CONFIG_PATH);
  const pages: any[] = [];
  for (const f of files) { const r = await store.read(f.path); const d = r ? J(r.text) : null; if (d) pages.push({ ...d, slug: f.path.slice(BUILDER_DIR.length, -5) }); }
  if (!pages.length) return html("<p style='font:16px system-ui;padding:40px'>No builder pages yet. Open the Website builder and start from the template.</p>", 404);
  pages.sort((a, b) => (a.slug === "home" ? -1 : b.slug === "home" ? 1 : a.title.localeCompare(b.title)));
  const cfgFile = await store.read(CONFIG_PATH), cfg = normalizeConfig(Err as any, (cfgFile && J(cfgFile.text)) || DEFAULT_CONFIG);
  const siteJson = await store.read("src/content/settings/site.json"), phone = cfg.theme.phone || (siteJson && J(siteJson.text)?.business?.phoneDisplay) || "";
  const slug = url.searchParams.get("p") || "home", page = pages.find((p) => p.slug === slug) || pages[0];
  if (page.raw) return html(renderRaw(page, { clientId: c, base: url.pathname, theme: { ...cfg.theme, name: cfg.theme.name || "" } as any, pages: pages.map((p) => ({ slug: p.slug, title: p.title, url: p.url })), phone, current: page.slug, edit: url.searchParams.get("edit") === "1" }));
  return html(renderPage(page, { clientId: c, base: url.pathname, theme: { ...cfg.theme, name: cfg.theme.name || "" } as any, pages: pages.map((p) => ({ slug: p.slug, title: p.title, url: p.url })), phone, current: page.slug }));
}

export async function POST(request: Request) {
  const url = new URL(request.url), c = url.searchParams.get("c") || "";
  if (!CLIENT_RE.test(c) || !env.DB || url.searchParams.get("lead") !== "1") return html("Not found", 404);
  const form = await request.formData();
  if (String(form.get("website") || "")) return html("Thanks!");
  const name = String(form.get("name") || "").slice(0, 120), phone = String(form.get("phone") || "").slice(0, 40), email = String(form.get("email") || "").slice(0, 160), message = String(form.get("message") || "").slice(0, 2000);
  if (!name || !phone) return html("Please add your name and phone number.", 400);
  const owner = await env.DB.prepare("SELECT owner_id FROM workspace_documents WHERE id='f2b-agency'").first<{ owner_id: string }>();
  if (owner) await leadToCrm(owner.owner_id, { clientId: c, channel: "sms", contact: phone, name, firstMessage: `Website enquiry${email ? ` (${email})` : ""}: ${message}` });
  return html("<p style='font:18px system-ui;padding:48px;text-align:center'>Thanks — we'll be in touch shortly.</p>");
}
