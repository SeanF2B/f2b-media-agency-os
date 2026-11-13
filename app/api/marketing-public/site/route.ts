// Public render of a client's visual-builder website (noindex). Under /api/marketing-public so the existing Access bypass covers it.
import { env } from "cloudflare:workers";
import { d1Store, getSite, workingImage } from "@/lib/site-content/site-content-core";
import { BUILDER_DIR, CONFIG_PATH, DEFAULT_CONFIG, isBuilderPath, normalizeConfig } from "@/lib/site-content/site-builder-core";
import { renderPage, renderRaw } from "@/lib/site-content/site-render";
import { leadToCrm } from "@/lib/conversations/core";
import { consumeMarketingSubmissionRateLimit } from "@/lib/marketing-public-rate-limit";
import { logFormSubmission } from "@/lib/form-submission-log";
import { readSubmittedTouch } from "@/lib/lead-attribution";

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
  if (owner) await logFormSubmission(env.DB, { id: crypto.randomUUID(), ownerId: owner.owner_id, clientId: c, source: "site-lead", formKey: `site:${c}:contact`, formName: String(form.get("form_name") || "Website contact form").slice(0, 120), pageUrl: String(form.get("page") || request.headers.get("referer") || ""), name, email, phone, message, touch: readSubmittedTouch((key) => String(form.get(key) || "")), createdAt: new Date().toISOString() });
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
  const estimate = estimateFromAnswers(answers);
  const notes = [estimate ? `Website estimate: €${estimate.toLocaleString("en-IE")}` : "", answers, message && `Notes: ${message}`, page && `Page: ${page}`].filter(Boolean).join("\n").slice(0, 2000);
  const existing = await db.prepare("SELECT id FROM crm_contacts WHERE owner_id=?1 AND client_id=?2 AND ((?3<>'' AND lower(email)=?3) OR phone=?4) ORDER BY updated_at DESC LIMIT 1").bind(ownerId, c, email, phone).first<{ id: string }>();
  const contactId = existing?.id || crypto.randomUUID();
  const pipeline = await db.prepare("SELECT id FROM crm_pipelines WHERE owner_id=?1 AND client_id=?2 AND archived=0 ORDER BY created_at LIMIT 1").bind(ownerId, c).first<{ id: string }>();
  const stage = pipeline ? await db.prepare("SELECT id FROM crm_pipeline_stages WHERE owner_id=?1 AND pipeline_id=?2 AND category='open' ORDER BY position LIMIT 1").bind(ownerId, pipeline.id).first<{ id: string }>() : null;
  const stmts = [db.prepare("INSERT INTO crm_contacts (id, owner_id, client_id, first_name, last_name, email, phone, company, source, notes, created_at, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,'',?8,?9,?10,?10) ON CONFLICT(id) DO UPDATE SET email=CASE WHEN excluded.email<>'' THEN excluded.email ELSE crm_contacts.email END, phone=excluded.phone, source=excluded.source, updated_at=excluded.updated_at WHERE crm_contacts.owner_id=excluded.owner_id")
    .bind(contactId, ownerId, c, first, last, email, phone, source, notes, now)];
  const { projectType, projectLocation } = projectDetails(s("form", 80) || s("form_name", 80), `${answers}\n${message}`, s("location", 160));
  if (pipeline && stage) stmts.push(db.prepare("INSERT INTO crm_opportunities (id, owner_id, pipeline_id, stage_id, contact_id, client_id, title, value, currency, source, notes, created_at, updated_at, project_type, project_location) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,'EUR',?9,?10,?11,?11,?12,?13)")
    .bind(crypto.randomUUID(), ownerId, pipeline.id, stage.id, contactId, c, `Consultation · ${name}`.slice(0, 200), estimate, estimate ? WEBSITE_ESTIMATE_SOURCE : source, notes, now, projectType, projectLocation));
  await db.batch(stmts);
  {
    // The live site may put "Form: interior-design" / "Booked from: <url>" inside its answers.
    const blob = [answers, message].join("\n");
    const line = (label: string) => (blob.match(new RegExp(`^${label}:\\s*(.+)$`, "mi"))?.[1] || "").trim();
    const formSlug = (s("form", 80) || s("form_name", 80) || line("Form") || "book-a-consultation").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    const formName = s("form_name", 120) || formSlug.replace(/-/g, " ").replace(/^./, (char) => char.toUpperCase());
    const cleanAnswers = blob.split(/^Pages viewed/mi)[0].split("\n").filter((row) => !/^(Form|Booked from|Page|Ref):/i.test(row.trim())).join("\n").trim();
    await logFormSubmission(db, { id: crypto.randomUUID(), ownerId, clientId: c, source: "site-form", formKey: `site:${c}:${formSlug}`, formName, pageUrl: page || line("Booked from") || line("Page") || request.headers.get("referer") || "", name, email, phone, message: cleanAnswers, contactId, touch: readSubmittedTouch((key) => String(form.get(key) || "")), createdAt: now });
  }
  return ok();
}

// Rough job price from the website form answers. Opportunities created with an estimate get
// source WEBSITE_ESTIMATE_SOURCE; the CRM shows an "Estimate" tag beside the value until someone edits it.
// Starter figures (EUR): adjust here when Red Island confirm their real ranges.
const WEBSITE_ESTIMATE_SOURCE = "website estimate";
const ESTIMATE_BASE: Record<string, number> = {
  "Design only": 3000, "Design and delivery": 15000, "Not sure yet": 6000,
  "One-off self-build": 20000, "Bought off-plan": 10000,
  "Whole house": 25000, "Main living spaces": 12000, "Joinery and storage": 8000,
  "Kitchen & living": 12000, "Bedrooms & bathrooms": 8000, "The whole home": 25000,
  "Kitchen and living": 12000, "Bedroom suite": 8000, "Both": 18000,
  "Full renovation": 15000, "Interior revamp": 6000, "Extension build": 10000,
  "Interior design": 6000, "Renovation / extension": 15000, "New build": 20000,
  "Every room": 20000, "Key living areas": 10000, "Ground floor": 12000,
  "Full house renovation": 20000, "Refurbishment": 8000, "Reconfiguration": 12000,
};
const ESTIMATE_FACTOR: Record<string, number> = { "Need trades sourced": 1.15 };
function estimateFromAnswers(answers: string) {
  const picked = answers.split("\n").map((line) => line.trim()).filter(Boolean)
    .map((line) => Object.keys({ ...ESTIMATE_BASE, ...ESTIMATE_FACTOR }).filter((opt) => line.endsWith(` ${opt}`)).sort((a, b) => b.length - a.length)[0]).filter(Boolean) as string[];
  const base = picked.map((opt) => ESTIMATE_BASE[opt] || 0).find((v) => v > 0) || 0;
  if (!base) return 0;
  return Math.round(picked.reduce((total, opt) => total * (ESTIMATE_FACTOR[opt] || 1), base) / 100) * 100;
}

// Project type / location for the pipeline card, from the form name and the answers.
function projectDetails(formField: string, blob: string, locationField: string) {
  const rows = blob.split(/^Pages viewed/mi)[0].split("\n").map((row) => row.trim()).filter(Boolean);
  const value = (test: RegExp) => { const row = rows.find((item) => test.test(item.split(/[?:]/)[0] || "")); return row ? row.replace(/^[^?:]*[?:]\s*/, "").trim() : ""; };
  const form = (formField || value(/^form$/i)).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const generic = !form || /book|consult|contact|enquir|quote/.test(form);
  const firstAnswer = rows.find((row) => /\?\s*\S/.test(row) && !/^(notes|form|booked from|page|ref)\b/i.test(row))?.replace(/^[^?]*\?\s*/, "") || "";
  const projectType = (generic ? firstAnswer : form.replace(/^./, (char) => char.toUpperCase())).slice(0, 120);
  const projectLocation = (locationField || value(/location|area|county|town|city|address|eircode|where is/i)).slice(0, 160);
  return { projectType, projectLocation };
}
