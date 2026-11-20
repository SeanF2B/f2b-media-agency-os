// Website lead relay for client sites whose edge Worker calls this app through a Cloudflare service binding.
// Service-binding requests never pass Cloudflare Access and carry no `request.cf`; public internet requests
// always have `request.cf` and are stopped by Access before they get here. Both checks are required.
//
// POST /internal/site-lead        JSON lead  → CRM contact + opportunity (+ note, tags, form log) → email to the business
// POST /internal/site-lead/photo  raw image  → R2 (site-leads/<client>/<id>.<ext>)               → { key }
// GET  /api/site-lead-photo?key=  team-only (Access identity required) photo viewer for CRM notes / emails
import { logFormSubmission } from "../lib/form-submission-log";
import { logSystemEmail } from "../lib/email-log";
import { estimateFor, formSettingsFor } from "../lib/site-forms";

type Env = Cloudflare.Env & { DB?: D1Database; BUCKET?: R2Bucket; RESEND_API_KEY?: string; TASK_NOTIFICATION_FROM?: string };

type SiteConfig = { clientId: string; siteKeyId: string; name: string; brandColor: string; dark: string; logoUrl: string; phone: string; website: string; notify: string[] };
// One entry per client site that relays leads here. Pipeline/stage come from the site's lead_site_keys row.
const SITES: Record<string, SiteConfig> = {
  "pro-roofers": {
    clientId: "a93e6dbd-0d34-46ec-ba5a-6be474d15882",
    siteKeyId: "site-pro-roofers",
    name: "Pro Roofers Galway",
    brandColor: "#C22026",
    dark: "#1E2A47",
    logoUrl: "https://proroofersgalway.ie/images/logo.webp",
    phone: "089 953 2637",
    website: "https://proroofersgalway.ie",
    notify: ["proroofersgalway@gmail.com"],
  },
  "aldo-handyman": {
    clientId: "ed835385-b970-4488-86e7-4de67d5015cf",
    siteKeyId: "site-aldo-handyman",
    name: "Aldo Handyman",
    brandColor: "#f5821f",
    dark: "#13213f",
    logoUrl: "https://aldohandyman.ie/img/icon-192.png",
    phone: "083 885 8183",
    website: "https://aldohandyman.ie",
    notify: ["aldobraha7@gmail.com"],
  },
};

// Any other client site (and every future one) can relay with ?client=<client id> or ?site=<client slug>.
// Name, phone and colours come from the client's record; who gets the email comes from Operations → Forms
// (notify list), then the client's own email, then the agency inbox so a lead is never sent nowhere.
async function resolveSite(env: Env, url: URL): Promise<SiteConfig | null> {
  const key = url.searchParams.get("site") || "";
  if (SITES[key]) return SITES[key];
  const db = env.DB; if (!db) return null;
  const byId = url.searchParams.get("client") || "";
  const acct = /^[0-9a-f-]{36}$/.test(byId)
    ? await db.prepare("SELECT client_id, slug FROM client_accounts WHERE client_id=?1").bind(byId).first<{ client_id: string; slug: string }>()
    : key ? await db.prepare("SELECT client_id, slug FROM client_accounts WHERE slug=?1").bind(key).first<{ client_id: string; slug: string }>() : null;
  if (!acct) return null;
  const known = Object.values(SITES).find((site) => site.clientId === acct.client_id);
  if (known) return known;
  const doc = await db.prepare("SELECT data FROM workspace_documents WHERE id='f2b-agency'").first<{ data: string }>();
  const client = ((doc ? JSON.parse(doc.data) : {}).clients || []).find((c: { id?: string }) => c.id === acct.client_id) as { name?: string; email?: string; phone?: string; color?: string; website?: string; branding?: { primary?: string; accent?: string; secondary?: string } } | undefined;
  const hex = (v?: string) => (v && /^#[0-9a-f]{6}$/i.test(v) ? v : "");
  return {
    clientId: acct.client_id,
    siteKeyId: `site-${acct.slug}`,
    name: client?.name || acct.slug,
    brandColor: hex(client?.branding?.accent) || hex(client?.branding?.primary) || "#2563eb",
    dark: hex(client?.branding?.secondary) || "#0f172a",
    logoUrl: "",
    phone: client?.phone || "",
    website: client?.website || "",
    notify: client?.email && /@/.test(client.email) ? [client.email] : [],
  };
}
const TEST_INBOX = "sean@f2bmedia.com";
const photoUrl = (key: string) => `${APP_URL}/api/marketing-public/lead-photo?key=${encodeURIComponent(key)}`;
const APP_URL = "https://f2b-media-agency-os.f2b-media.workers.dev";

const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json", "cache-control": "no-store" } });
const esc = (s: unknown) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
const cut = (v: unknown, n: number) => String(v ?? "").replace(/[\u0000-\u0008\u000b-\u001f]/g, "").trim().slice(0, n);
const titleCase = (s: string) => s.replace(/\b\w/g, (c) => c.toUpperCase());

export function isInternalCall(request: Request) {
  return !(request as Request & { cf?: unknown }).cf && !request.headers.get("cf-access-jwt-assertion") && request.headers.get("x-f2b-relay") === "edge";
}

export async function handleSiteLeadRoutes(request: Request, env: Env, url: URL, identityEmail: string | undefined, internal: boolean): Promise<Response | null> {
  if (url.pathname === "/api/site-lead-photo" && request.method === "GET") {
    if (!identityEmail) return new Response("Not found", { status: 404 });
    const key = url.searchParams.get("key") || "";
    if (!/^site-leads\/[\w-]{6,80}\/[\w.-]{6,120}$/.test(key) || !env.BUCKET) return new Response("Not found", { status: 404 });
    const obj = await env.BUCKET.get(key);
    if (!obj) return new Response("Not found", { status: 404 });
    return new Response(obj.body, { headers: { "content-type": obj.httpMetadata?.contentType || "image/jpeg", "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff" } });
  }
  if (!url.pathname.startsWith("/internal/site-lead")) return null;
  if (!internal) return new Response("Not found", { status: 404 });
  if (request.method !== "POST") return json({ ok: false, error: "method" }, 405);
  const site = await resolveSite(env, url);
  if (!site || !env.DB) return json({ ok: false, error: "unknown_site" }, 404);
  if (url.pathname === "/internal/site-lead/photo") return savePhoto(request, env, site);
  if (url.pathname === "/internal/site-lead") return saveLead(request, env, site);
  return json({ ok: false, error: "not_found" }, 404);
}

async function savePhoto(request: Request, env: Env, site: SiteConfig) {
  if (!env.BUCKET) return json({ ok: false, error: "storage" }, 503);
  const type = (request.headers.get("content-type") || "").split(";")[0].trim();
  if (!/^image\/(jpeg|png|webp)$/.test(type)) return json({ ok: false, error: "type" }, 415);
  const body = await request.arrayBuffer();
  if (!body.byteLength || body.byteLength > 8 * 1024 * 1024) return json({ ok: false, error: "size" }, 413);
  const key = `site-leads/${site.clientId}/${crypto.randomUUID()}.${type.split("/")[1].replace("jpeg", "jpg")}`;
  await env.BUCKET.put(key, body, { httpMetadata: { contentType: type } });
  return json({ ok: true, key });
}

const JOB_LABELS: Record<string, string> = { leak: "Roof leak", "roof-repair": "Roof repair", "flat-roof": "Flat roof", "new-roof": "New roof / replacement", gutters: "Gutters", "fascia-soffit": "Fascia & soffit", cleaning: "Roof cleaning", "verge-ridge": "Dry verge / ridge", other: "Something else" };
const URGENCY: Record<string, string> = { emergency: "🚨 Leaking now", urgent: "Urgent (this week)", soon: "Next few weeks", planning: "Planning / getting quotes", asap: "As soon as possible", month: "Within the next month", week: "This week" };
const PROPERTY: Record<string, string> = { detached: "Detached house", "semi-terraced": "Semi-detached / terraced", bungalow: "Bungalow", apartment: "Apartment / multi-unit", commercial: "Commercial / agricultural" };
const QUESTION: Record<string, string> = { leaking: "Leaking now?", problem: "Problem", size: "Size", covering: "Covering", project: "Project", need: "Needs", roof: "Roof covering", part: "Part" };

function normPhone(v: string) {
  let d = v.replace(/[^\d+]/g, "");
  if (d.startsWith("00")) d = "+" + d.slice(2);
  if (d.startsWith("+3530")) d = "+353" + d.slice(5);
  if (/^0\d{8,10}$/.test(d)) d = "+353" + d.slice(1);
  return d;
}
const prettyPhone = (p: string) => (p.startsWith("+353") ? "0" + p.slice(4) : p).replace(/^(0\d{2})(\d{3})(\d+)$/, "$1 $2 $3");

async function saveLead(request: Request, env: Env, site: SiteConfig) {
  const db = env.DB!;
  let b: Record<string, unknown>;
  try { b = await request.json() as Record<string, unknown>; } catch { return json({ ok: false, error: "invalid_json" }, 400); }
  const kind = b.kind === "contact" ? "contact" : "quote";
  const name = cut(b.name, 120), email = cut(b.email, 160).toLowerCase(), phoneRaw = cut(b.phone, 40), phone = normPhone(phoneRaw);
  if (name.length < 2 || phone.replace(/\D/g, "").length < 7) return json({ ok: false, error: "validation" }, 400);
  // Sites send their own readable labels (jobLabel / service / urgencyLabel); the roofing codes are the fallback.
  const jobType = cut(b.jobType, 40), job = cut(b.jobLabel || b.service, 80) || JOB_LABELS[jobType] || (jobType && jobType !== "other" ? titleCase(jobType.replace(/[-_]+/g, " ").replace(/\b(cork|dublin|galway)\b/gi, "").trim()) : "") || (kind === "contact" ? "General enquiry" : "Website enquiry");
  const town = cut(b.town, 80), urgency = cut(b.urgencyLabel, 80) || URGENCY[cut(b.urgency, 20)] || "", property = PROPERTY[cut(b.propertyType, 20)] || "";
  const details = cut(b.details || b.message, 2000), page = cut(b.page, 500);
  const answers = (b.answers && typeof b.answers === "object" && !Array.isArray(b.answers)) ? Object.entries(b.answers as Record<string, unknown>).slice(0, 10).map(([k, v]) => [QUESTION[k] || titleCase(k.replace(/[-_]/g, " ")), cut(v, 120)] as [string, string]).filter(([, v]) => v) : [];
  const photos = Array.isArray(b.photos) ? (b.photos as unknown[]).map((p) => String(p)).filter((p) => p.startsWith(`site-leads/${site.clientId}/`)).slice(0, 4) : [];
  const touch = (b.attribution && typeof b.attribution === "object" ? b.attribution : {}) as Record<string, string>;
  const t = (k: string) => cut(touch[k], 300);
  const submissionId = cut(b.submissionId, 80).replace(/[^\w.-]/g, "") || crypto.randomUUID();
  const subKey = `site:${site.siteKeyId}:${submissionId}`;

  const keyRow = await db.prepare("SELECT pipeline_id, stage_id FROM lead_site_keys WHERE id=?1").bind(site.siteKeyId).first<{ pipeline_id: string; stage_id: string }>();
  const acct = await db.prepare("SELECT owner_id FROM client_accounts WHERE client_id=?1").bind(site.clientId).first<{ owner_id: string }>();
  if (!acct) return json({ ok: false, error: "no_account" }, 500);
  const owner = acct.owner_id;
  const dup = await db.prepare("SELECT id, contact_id FROM crm_opportunities WHERE owner_id=?1 AND source_submission_id=?2").bind(owner, subKey).first<{ id: string; contact_id: string }>();
  if (dup) return json({ ok: true, duplicate: true, id: dup.id, delivered: true });

  // Settings saved in Operations → Forms (notify list, landing stage) override the built-in defaults.
  const formCfg = await formSettingsFor(db, owner, `site:${site.clientId}:${kind === "contact" ? "contact" : "quote"}`);
  const notifyTo = formCfg?.notify?.length ? formCfg.notify : site.notify.length ? site.notify : [TEST_INBOX];
  const cfgStage = formCfg?.stageId ? await db.prepare("SELECT s.id, s.pipeline_id FROM crm_pipeline_stages s JOIN crm_pipelines p ON p.id=s.pipeline_id AND p.owner_id=s.owner_id WHERE s.owner_id=?1 AND s.id=?2 AND p.archived=0").bind(owner, formCfg.stageId).first<{ id: string; pipeline_id: string }>() : null;
  let stage = cfgStage || (keyRow ? await db.prepare("SELECT s.id, s.pipeline_id FROM crm_pipeline_stages s JOIN crm_pipelines p ON p.id=s.pipeline_id AND p.owner_id=s.owner_id WHERE s.owner_id=?1 AND s.id=?2 AND p.archived=0").bind(owner, keyRow.stage_id).first<{ id: string; pipeline_id: string }>() : null);
  if (!stage) {
    const pipe = await db.prepare("SELECT id FROM crm_pipelines WHERE owner_id=?1 AND client_id=?2 AND archived=0 ORDER BY created_at LIMIT 1").bind(owner, site.clientId).first<{ id: string }>();
    const st = pipe ? await db.prepare("SELECT id FROM crm_pipeline_stages WHERE owner_id=?1 AND pipeline_id=?2 AND category='open' ORDER BY position LIMIT 1").bind(owner, pipe.id).first<{ id: string }>() : null;
    stage = pipe && st ? { id: st.id, pipeline_id: pipe.id } : null;
  }

  const estimate = kind === "quote" ? estimateFor(formCfg, jobType) : 0;
  const now = new Date().toISOString();
  const existing = await db.prepare("SELECT id FROM crm_contacts WHERE owner_id=?1 AND client_id=?2 AND ((?3<>'' AND lower(email)=?3) OR phone=?4 OR phone=?5) ORDER BY updated_at DESC LIMIT 1").bind(owner, site.clientId, email, phone, phoneRaw).first<{ id: string }>();
  const contactId = existing?.id || crypto.randomUUID();
  const oppId = crypto.randomUUID();
  const [first, ...rest] = name.split(/\s+/);
  const source = kind === "contact" ? "Website contact form" : "Website quote form";
  const title = `${job}${town ? ` · ${town}` : ""} · ${name}`.slice(0, 200);
  const channel = t("gclid") || t("gbraid") || t("wbraid") || /cpc|ppc|paid/i.test(t("utm_medium")) ? "Google Ads" : /google|bing|duckduckgo/i.test(t("referrer")) ? "Google search" : t("utm_source") ? titleCase(t("utm_source")) : t("referrer") ? "Referral" : "Direct";

  // Neat, scannable note on the opportunity card (same order as the email).
  const lines = [
    `${kind === "contact" ? "📨 Contact form" : "🏠 Quote request"} · ${site.name} website`,
    "",
    `Job: ${job}`,
    estimate ? `Rough estimate: €${estimate.toLocaleString("en-IE")}` : "",
    ...answers.map(([q, a]) => `${q}: ${a}`),
    urgency && `When: ${urgency}`,
    property && `Property: ${property}`,
    town && `Location: ${town}`,
    details && `\nDetails:\n${details}`,
    "",
    `Name: ${name}`,
    `Phone: ${prettyPhone(phone)}`,
    email && `Email: ${email}`,
    photos.length ? `Photos: ${photos.length} attached (see email / links below)` : "",
    ...photos.map((k, i) => `  Photo ${i + 1}: ${photoUrl(k)}`),
    "",
    `Source: ${channel}${t("utm_campaign") ? ` · ${t("utm_campaign")}` : ""}`,
    page && `Page: ${page}`,
  ].filter((x): x is string => typeof x === "string" && (x !== "" || true));
  const notes = lines.join("\n").replace(/\n{3,}/g, "\n\n").trim().slice(0, 4000);
  const tags = ["Website lead", job, urgency.includes("Leaking") ? "Emergency" : "", channel].filter(Boolean);

  const stmts = [
    db.prepare("INSERT INTO crm_contacts (id, owner_id, client_id, first_name, last_name, email, phone, company, source, notes, created_at, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,'',?8,?9,?10,?10) ON CONFLICT(id) DO UPDATE SET first_name=CASE WHEN excluded.first_name<>'' THEN excluded.first_name ELSE crm_contacts.first_name END, last_name=CASE WHEN excluded.last_name<>'' THEN excluded.last_name ELSE crm_contacts.last_name END, email=CASE WHEN excluded.email<>'' THEN excluded.email ELSE crm_contacts.email END, phone=excluded.phone, source=excluded.source, updated_at=excluded.updated_at WHERE crm_contacts.owner_id=excluded.owner_id")
      .bind(contactId, owner, site.clientId, first || name, rest.join(" "), email, phone, source, town ? `Location: ${town}` : "", now),
  ];
  if (stage) {
    stmts.push(db.prepare("INSERT INTO crm_opportunities (id, owner_id, pipeline_id, stage_id, contact_id, client_id, title, value, currency, source, source_submission_id, notes, created_at, updated_at, project_type, project_location) VALUES (?1,?2,?3,?4,?5,?6,?7,?14,'EUR',?8,?9,?10,?11,?11,?12,?13)")
      .bind(oppId, owner, stage.pipeline_id, stage.id, contactId, site.clientId, title, source, subKey, notes, now, job, town, estimate));
    stmts.push(db.prepare("INSERT INTO crm_activities (id, owner_id, opportunity_id, contact_id, activity_type, body, created_by, created_at) VALUES (?1,?2,?3,?4,'note',?5,?6,?7)")
      .bind(crypto.randomUUID(), owner, oppId, contactId, notes, `${site.name} website`, now));
  }
  await db.batch(stmts);
  await db.batch(tags.map((tag) => db.prepare("INSERT OR IGNORE INTO crm_contact_tags (owner_id, contact_id, tag, created_at) VALUES (?1,?2,?3,?4)").bind(owner, contactId, tag.slice(0, 60), now))).catch(() => undefined);
  await logFormSubmission(db, { id: `site-${submissionId}`, ownerId: owner, clientId: site.clientId, source: "site-form", formKey: `site:${site.clientId}:${kind === "contact" ? "contact" : "quote"}`, formName: kind === "contact" ? "Contact form" : "Free quote form", pageUrl: page, name, email, phone, message: notes, contactId, touch: { gclid: t("gclid"), gbraid: t("gbraid"), wbraid: t("wbraid"), utm_source: t("utm_source"), utm_medium: t("utm_medium"), utm_campaign: t("utm_campaign"), referrer: t("referrer") }, createdAt: now });

  // Email the business. The lead is already saved, so an email failure never loses it.
  const emailStatus = b.skipEmail === true ? "not sent: the website already emailed this lead"
    : await emailBusiness(env, site, { ownerId: owner, to: notifyTo, test: b.test === true, idempotencyKey: `site-lead/${subKey}`, replyTo: email, mail: { kind, job, answers, urgency, property, town, details, name, phone, email, photos, channel, page, when: now } });
  if (stage) await db.prepare("INSERT INTO crm_activities (id, owner_id, opportunity_id, contact_id, activity_type, body, created_by, created_at) VALUES (?1,?2,?3,?4,'note',?5,?6,?7)")
    .bind(crypto.randomUUID(), owner, oppId, contactId, `✉️ Lead email ${emailStatus}`, `${site.name} website`, new Date().toISOString()).run().catch(() => undefined);
  return json({ ok: true, id: oppId, contactId, delivered: true, email: emailStatus });
}

/** Sends the branded lead email to the business and copies the exact email into System emails + Conversations. */
export async function emailBusiness(env: Env, site: SiteConfig, o: { ownerId: string; to: string[]; test?: boolean; idempotencyKey: string; replyTo?: string; mail: MailIn }) {
  if (!env.RESEND_API_KEY || !env.TASK_NOTIFICATION_FROM) return "not sent: email is not configured on the server";
  try {
    const mail = leadEmail(site, o.mail);
    // Test leads (flag set only by an authorised edge-Worker test) go to the agency, not the client.
    const to = o.test ? [TEST_INBOX] : o.to.length ? o.to : [TEST_INBOX];
    if (o.test) mail.subject = `TEST – ${mail.subject}`;
    const fromAddr = (env.TASK_NOTIFICATION_FROM.match(/<([^>]+)>/)?.[1] || env.TASK_NOTIFICATION_FROM).trim();
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": o.idempotencyKey },
      body: JSON.stringify({ from: `${site.name.replace(/[<>"]/g, "")} Website <${fromAddr}>`, to, subject: mail.subject, html: mail.html, text: mail.text, ...(o.replyTo ? { reply_to: o.replyTo } : {}) }),
      signal: AbortSignal.timeout(20_000),
    });
    const out = await res.json().catch(() => null) as { id?: string; message?: string } | null;
    if (res.ok && env.DB) await logSystemEmail(env.DB as never, { ownerId: o.ownerId, clientId: site.clientId, to: to.join(", "), subject: mail.subject, text: mail.text, html: mail.html, kind: "Leads & forms" }).catch(() => undefined);
    return res.ok ? `sent to ${to.join(", ")} (${out?.id || "accepted"})` : `failed: HTTP ${res.status} ${out?.message || ""}`.trim();
  } catch (e) { return `failed: ${e instanceof Error ? e.message : "error"}`; }
}
/** Site settings for a client by id (any client, including future ones). */
export function siteForClient(env: Env, clientId: string) {
  return resolveSite(env, new URL(`https://x/?client=${encodeURIComponent(clientId)}`));
}
export type { MailIn as SiteLeadMail };
type MailIn = { kind: string; job: string; answers: [string, string][]; urgency: string; property: string; town: string; details: string; name: string; phone: string; email: string; photos: string[]; channel: string; page: string; when: string };
function leadEmail(site: SiteConfig, m: MailIn) {
  const urgent = /leaking|as soon as possible|emergency|urgent/i.test(m.urgency);
  const subject = `${/leaking/i.test(m.urgency) ? "🚨 URGENT – " : urgent ? "⚡ " : ""}New ${m.kind === "contact" ? "enquiry" : "quote request"}: ${m.job}${m.town ? ` in ${m.town}` : ""} – ${m.name}`;
  const when = new Date(m.when).toLocaleString("en-IE", { timeZone: "Europe/Dublin", weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  const tel = m.phone.replace(/[^\d+]/g, "");
  const wa = tel.replace(/^\+/, "");
  const rows: [string, string][] = [["Job", m.job], ...m.answers, ...(m.urgency ? [["When", m.urgency] as [string, string]] : []), ...(m.property ? [["Property", m.property] as [string, string]] : []), ...(m.town ? [["Location", m.town] as [string, string]] : [])];
  const row = ([k, v]: [string, string]) => `<tr><td style="padding:9px 0;color:#64748b;font-size:14px;width:120px;vertical-align:top">${esc(k)}</td><td style="padding:9px 0;color:#0f172a;font-size:15px;font-weight:600">${esc(v)}</td></tr>`;
  const btn = (href: string, label: string, bg: string) => `<a href="${href}" style="display:inline-block;background:${bg};color:#fff;text-decoration:none;font-weight:700;font-size:15px;padding:12px 20px;border-radius:999px;margin:0 8px 8px 0">${label}</a>`;
  const html = `<!doctype html><html><body style="margin:0;background:#f1f5f9;font-family:-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif">
<div style="max-width:560px;margin:0 auto;padding:24px 14px">
<div style="background:${site.dark};border-radius:18px 18px 0 0;padding:20px 24px;color:#fff;border-bottom:4px solid ${site.brandColor}">
<div style="font-size:12px;letter-spacing:.12em;text-transform:uppercase;opacity:.75">${esc(site.name)} · Website</div>
<div style="font-size:22px;font-weight:800;margin-top:6px">${/leaking/i.test(m.urgency) ? "🚨 " : urgent ? "⚡ " : ""}New ${m.kind === "contact" ? "enquiry" : "quote request"}</div>
<div style="font-size:14px;opacity:.85;margin-top:4px">${esc(when)}</div></div>
${urgent ? `<div style="background:#fff7ed;color:#b45309;font-weight:700;padding:12px 24px;border-left:4px solid ${site.brandColor}">${/leaking/i.test(m.urgency) ? "Customer says it is leaking now – call back as soon as you can." : "Customer wants this done as soon as possible – a quick call back wins the job."}</div>` : ""}
<div style="background:#fff;padding:22px 24px">
<div style="font-size:20px;font-weight:800;color:#0f172a">${esc(m.name)}</div>
<div style="font-size:16px;margin:4px 0 16px"><a href="tel:${esc(tel)}" style="color:${site.brandColor};font-weight:700;text-decoration:none">${esc(prettyPhone(m.phone))}</a>${m.email ? ` · <a href="mailto:${esc(m.email)}" style="color:#334155">${esc(m.email)}</a>` : ""}</div>
${btn(`tel:${esc(tel)}`, "📞 Call now", site.brandColor)}${btn(`https://wa.me/${esc(wa)}`, "WhatsApp", "#16a34a")}${m.email ? btn(`mailto:${esc(m.email)}?subject=${encodeURIComponent(`Your ${m.job.toLowerCase()} quote – ${site.name}`)}`, "Reply by email", "#334155") : ""}
<div style="border-top:1px solid #e2e8f0;margin-top:14px;padding-top:6px"><table style="width:100%;border-collapse:collapse">${rows.map(row).join("")}</table></div>
${m.details ? `<div style="margin-top:12px;background:#f8fafc;border-radius:12px;padding:14px 16px;color:#0f172a;font-size:15px;line-height:1.55;white-space:pre-wrap">${esc(m.details)}</div>` : ""}
${m.photos.length ? `<div style="margin-top:14px"><div style="font-size:13px;color:#64748b;margin-bottom:8px">Photos from the customer (tap to open full size)</div>${m.photos.map((k) => `<a href="${esc(photoUrl(k))}"><img src="${esc(photoUrl(k))}" width="120" height="120" alt="Job photo" style="width:120px;height:120px;object-fit:cover;border-radius:10px;margin:0 6px 6px 0;border:0"></a>`).join("")}</div>` : ""}
</div>
<div style="background:#fff;border-top:1px solid #e2e8f0;border-radius:0 0 18px 18px;padding:14px 24px;color:#64748b;font-size:12px;line-height:1.6">
Came from: <b style="color:#334155">${esc(m.channel)}</b>${m.page ? ` · <a href="${esc(m.page)}" style="color:#64748b">${esc(m.page.replace(/^https?:\/\/(www\.)?/, "").split("?")[0])}</a>` : ""}<br>
Saved to your CRM as a new lead. Reply to this email to answer the customer directly.</div>
<div style="text-align:center;color:#94a3b8;font-size:11px;padding:14px 0">Sent by your website${site.website ? ` · ${esc(site.website.replace(/^https?:\/\/(www\.)?/, "").replace(/\/$/, ""))}` : ""}</div>
</div></body></html>`;
  const text = [subject, "", `${m.name} – ${prettyPhone(m.phone)}${m.email ? ` – ${m.email}` : ""}`, "", ...rows.map(([k, v]) => `${k}: ${v}`), m.details ? `\nDetails:\n${m.details}` : "", m.photos.length ? `\nPhotos:\n${m.photos.map((k, i) => `Photo ${i + 1}: ${photoUrl(k)}`).join("\n")}` : "", "", `Came from: ${m.channel}${m.page ? ` (${m.page})` : ""}`].join("\n");
  return { subject, html, text };
}
