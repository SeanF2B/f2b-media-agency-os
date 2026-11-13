// Public render of a client's visual-builder website (noindex). Under /api/marketing-public so the existing Access bypass covers it.
import { env } from "cloudflare:workers";
import { d1Store, getSite, workingImage } from "@/lib/site-content/site-content-core";
import { BUILDER_DIR, CONFIG_PATH, DEFAULT_CONFIG, isBuilderPath, normalizeConfig } from "@/lib/site-content/site-builder-core";
import { renderPage, renderRaw } from "@/lib/site-content/site-render";
import { leadToCrm } from "@/lib/conversations/core";
import { consumeMarketingSubmissionRateLimit } from "@/lib/marketing-public-rate-limit";

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
  if (page.raw) return html(renderRaw(page, { clientId: c, base: url.pathname, theme: { ...cfg.theme, name: cfg.theme.name || "" } as any, pages: pages.map((p) => ({ slug: p.slug, title: p.title, url: p.url })), phone, current: page.slug, edit: url.searchParams.get("edit") === "1", publish: url.searchParams.get("export") === "1" }));
  return html(renderPage(page, { clientId: c, base: url.pathname, theme: { ...cfg.theme, name: cfg.theme.name || "" } as any, pages: pages.map((p) => ({ slug: p.slug, title: p.title, url: p.url })), phone, current: page.slug }));
}

export async function POST(request: Request) {
  const url = new URL(request.url), c = url.searchParams.get("c") || "";
  if (CLIENT_RE.test(c) && env.DB && url.searchParams.get("lead") === "site") return siteFormLead(request, c);
  if (!CLIENT_RE.test(c) || !env.DB || url.searchParams.get("lead") !== "1") return html("Not found", 404);
  const form = await request.formData();
  if (String(form.get("website") || "")) return html("Thanks!");
  const name = String(form.get("name") || "").slice(0, 120), phone = String(form.get("phone") || "").slice(0, 40), email = String(form.get("email") || "").slice(0, 160), message = String(form.get("message") || "").slice(0, 2000);
  if (!name || !phone) return html("Please add your name and phone number.", 400);
  const owner = await env.DB.prepare("SELECT owner_id FROM workspace_documents WHERE id='f2b-agency'").first<{ owner_id: string }>();
  if (owner) await leadToCrm(owner.owner_id, { clientId: c, channel: "sms", contact: phone, name, firstMessage: `Website enquiry${email ? ` (${email})` : ""}: ${message}` });
  return html("<p style='font:18px system-ui;padding:48px;text-align:center'>Thanks — we'll be in touch shortly.</p>");
}

// Website booking form → CRM contact + opportunity in the client's first open stage ("New lead").
// Only enabled for sub-accounts listed here (posted cross-origin from the client's site via sendBeacon).
const SITE_FORM_CLIENTS = new Set(["24e59da5-e0c9-4620-9424-db227dc5c4d0"]); // Red Island Interiors
async function siteFormLead(request: Request, c: string) {
  const cors = { "Access-Control-Allow-Origin": "*", "Cache-Control": "no-store" };
  const ok = (status = 200) => new Response(null, { status, headers: cors });
  if (!SITE_FORM_CLIENTS.has(c)) return ok(404);
  if (Number(request.headers.get("content-length") || 0) > 20_000) return ok(413);
  let form: FormData; try { form = await request.formData(); } catch { return ok(400); }
  if (String(form.get("website") || "")) return ok();
  const s = (k: string, n: number) => String(form.get(k) || "").trim().slice(0, n);
  const name = s("name", 120), phone = s("phone", 40), email = s("email", 160).toLowerCase(), message = s("message", 2000), answers = s("answers", 1000), page = s("page", 300);
  if (name.length < 2 || phone.replace(/[^0-9+]/g, "").length < 7) return ok(400);
  const db = env.DB!;
  const acct = await db.prepare("SELECT owner_id FROM client_accounts WHERE client_id=?1").bind(c).first<{ owner_id: string }>();
  if (!acct) return ok(404);
  const ownerId = acct.owner_id;
  if (!(await consumeMarketingSubmissionRateLimit(db, ownerId, `site-lead:${c}`))) return ok(429);
  const now = new Date().toISOString(), source = "Website form · Book a consultation";
  const parts = name.split(/\s+/), first = parts[0] || name, last = parts.slice(1).join(" ");
  const notes = [answers, message && `Notes: ${message}`, page && `Page: ${page}`].filter(Boolean).join("\n").slice(0, 2000);
  const existing = await db.prepare("SELECT id FROM crm_contacts WHERE owner_id=?1 AND client_id=?2 AND ((?3<>'' AND lower(email)=?3) OR phone=?4) ORDER BY updated_at DESC LIMIT 1").bind(ownerId, c, email, phone).first<{ id: string }>();
  const contactId = existing?.id || crypto.randomUUID();
  const pipeline = await db.prepare("SELECT id FROM crm_pipelines WHERE owner_id=?1 AND client_id=?2 AND archived=0 ORDER BY created_at LIMIT 1").bind(ownerId, c).first<{ id: string }>();
  const stage = pipeline ? await db.prepare("SELECT id FROM crm_pipeline_stages WHERE owner_id=?1 AND pipeline_id=?2 AND category='open' ORDER BY position LIMIT 1").bind(ownerId, pipeline.id).first<{ id: string }>() : null;
  const stmts = [db.prepare("INSERT INTO crm_contacts (id, owner_id, client_id, first_name, last_name, email, phone, company, source, notes, created_at, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,'',?8,?9,?10,?10) ON CONFLICT(id) DO UPDATE SET email=CASE WHEN excluded.email<>'' THEN excluded.email ELSE crm_contacts.email END, phone=excluded.phone, source=excluded.source, updated_at=excluded.updated_at WHERE crm_contacts.owner_id=excluded.owner_id")
    .bind(contactId, ownerId, c, first, last, email, phone, source, notes, now)];
  if (pipeline && stage) stmts.push(db.prepare("INSERT INTO crm_opportunities (id, owner_id, pipeline_id, stage_id, contact_id, client_id, title, value, currency, source, notes, created_at, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,0,'EUR',?8,?9,?10,?10)")
    .bind(crypto.randomUUID(), ownerId, pipeline.id, stage.id, contactId, c, `Consultation · ${name}`.slice(0, 200), source, notes, now));
  await db.batch(stmts);
  return ok();
}
