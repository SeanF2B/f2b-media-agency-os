// A lead's journey from live records only: how they first found the business (website page, Google Ads
// campaign, organic search, Instagram/Facebook, WhatsApp, SMS…) and every touch after that.
// Nothing here is estimated: each event is a real row (contact, form submission, conversation, deal, booking).
import { classifyLeadChannel } from "./lead-attribution.ts";

export type HistoryEvent = {
  at: string;
  kind: "contact" | "form" | "conversation" | "deal" | "booking";
  channel: string; // short label shown as a chip: "Google Ads", "Instagram", "WhatsApp", "Website", …
  title: string;
  detail?: string;
  page?: string;
  campaign?: string;
  source?: string;
  medium?: string;
  referrer?: string;
  clickId?: boolean;
};
export type LeadHistory = { contact: { id: string; name: string; phone: string; email: string; source: string; createdAt: string } | null; firstTouch: HistoryEvent | null; events: HistoryEvent[] };

const s = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v));
const digits = (v: string) => v.replace(/\D/g, "").slice(-9);
const host = (raw: string) => { try { return new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).hostname.replace(/^www\./, ""); } catch { return ""; } };

/** One readable channel name from the tracking fields a form sent (UTM, click ID, referrer). */
export function touchLabel(t: { utm_source?: string; utm_medium?: string; utm_campaign?: string; referrer?: string; click_id?: string; channel?: string; crmSource?: string }): string {
  const src = s(t.utm_source).toLowerCase(), ref = host(s(t.referrer)).toLowerCase();
  if (/instagram|^ig$/.test(src) || /instagram\.com$/.test(ref)) return "Instagram";
  if (/facebook|^fb$|meta/.test(src) || /facebook\.com$|fb\.com$|^l\.facebook/.test(ref)) return "Facebook";
  if (/tiktok/.test(src) || /tiktok\.com$/.test(ref)) return "TikTok";
  if (/whatsapp/.test(src) || /whatsapp\.com$|wa\.me$/.test(ref)) return "WhatsApp";
  if (/linkedin/.test(src) || /linkedin\.com$|lnkd\.in$/.test(ref)) return "LinkedIn";
  const ch = s(t.channel) || classifyLeadChannel({ gclid: s(t.click_id) || undefined, utm_source: t.utm_source, utm_medium: t.utm_medium, utm_campaign: t.utm_campaign, referrer: t.referrer, crmSource: t.crmSource });
  if (ch === "google_ads") return "Google Ads";
  if (ch === "seo") return /bing/.test(src + ref) ? "Bing search" : "Google search";
  if (/gbp|google.?business|maps/.test(src)) return "Google Business";
  if (src) return src.charAt(0).toUpperCase() + src.slice(1);
  if (ref) return ref;
  return "Direct / unknown";
}

export async function loadLeadHistory(db: D1Database, ownerId: string, q: { contactId?: string; phone?: string; email?: string; clientId?: string | null }): Promise<LeadHistory> {
  const scoped = q.clientId !== undefined && q.clientId !== null; // a sub-account only sees its own records
  const scope = s(q.clientId);
  let contact: LeadHistory["contact"] = null;
  if (q.contactId) {
    const row = await db.prepare("SELECT id, client_id, first_name, last_name, email, phone, source, created_at FROM crm_contacts WHERE owner_id=?1 AND id=?2").bind(ownerId, q.contactId).first<Record<string, unknown>>().catch(() => null);
    if (row && (!scoped || s(row.client_id) === scope)) contact = { id: s(row.id), name: `${s(row.first_name)} ${s(row.last_name)}`.trim(), phone: s(row.phone), email: s(row.email), source: s(row.source), createdAt: s(row.created_at) };
  }
  const email = (contact?.email || s(q.email)).trim().toLowerCase();
  const phone = digits(contact?.phone || s(q.phone));
  if (!contact && (email || phone)) {
    const row = await db.prepare(`SELECT id, client_id, first_name, last_name, email, phone, source, created_at FROM crm_contacts WHERE owner_id=?1 AND ((?2<>'' AND lower(email)=?2) OR (?3<>'' AND phone LIKE '%' || ?3))${scoped ? " AND client_id=?4" : ""} ORDER BY created_at LIMIT 1`).bind(...[ownerId, email, phone, ...(scoped ? [scope] : [])]).first<Record<string, unknown>>().catch(() => null);
    if (row) contact = { id: s(row.id), name: `${s(row.first_name)} ${s(row.last_name)}`.trim(), phone: s(row.phone), email: s(row.email), source: s(row.source), createdAt: s(row.created_at) };
  }
  const cid = contact?.id || "";
  const em = (contact?.email || email).toLowerCase(), ph = digits(contact?.phone || phone);
  if (!cid && !em && !ph) return { contact: null, firstTouch: null, events: [] };
  const clientSql = (col: string, n: number) => (scoped ? ` AND ${col}=?${n}` : "");
  const bindScope = scoped ? [scope] : [];

  const [forms, threads, deals, bookings] = await Promise.all([
    db.prepare(`SELECT created_at, form_name, page_url, source, channel, utm_source, utm_medium, utm_campaign, click_id, referrer FROM form_submission_log WHERE owner_id=?1 AND ((?2<>'' AND contact_id=?2) OR (?3<>'' AND lower(email)=?3) OR (?4<>'' AND phone LIKE '%' || ?4))${clientSql("client_id", 5)} ORDER BY created_at LIMIT 50`).bind(ownerId, cid, em, ph, ...bindScope).all<Record<string, unknown>>().then((r) => r.results || []).catch(() => []),
    db.prepare(`SELECT channel, contact, created_at, last_at, status FROM conv_threads WHERE owner_id=?1 AND ((?2<>'' AND lower(contact)=?2) OR (?3<>'' AND contact LIKE '%' || ?3))${clientSql("client_id", 4)} ORDER BY created_at LIMIT 20`).bind(ownerId, em, ph, ...bindScope).all<Record<string, unknown>>().then((r) => r.results || []).catch(() => []),
    cid ? db.prepare(`SELECT title, value, currency, source, created_at FROM crm_opportunities WHERE owner_id=?1 AND contact_id=?2 ORDER BY created_at LIMIT 20`).bind(ownerId, cid).all<Record<string, unknown>>().then((r) => r.results || []).catch(() => []) : Promise.resolve([]),
    db.prepare(`SELECT start_at, status, source, channel, created_at FROM sched_bookings WHERE owner_id=?1 AND ((?2<>'' AND contact_id=?2) OR (?3<>'' AND lower(email)=?3) OR (?4<>'' AND phone LIKE '%' || ?4))${clientSql("client_id", 5)} ORDER BY start_at LIMIT 20`).bind(ownerId, cid, em, ph, ...bindScope).all<Record<string, unknown>>().then((r) => r.results || []).catch(() => []),
  ]);

  const events: HistoryEvent[] = [];
  if (contact) events.push({ at: contact.createdAt, kind: "contact", channel: contact.source || "CRM", title: "Contact created", detail: contact.source ? `Source: ${contact.source}` : undefined });
  for (const f of forms) {
    const label = touchLabel({ utm_source: s(f.utm_source), utm_medium: s(f.utm_medium), utm_campaign: s(f.utm_campaign), referrer: s(f.referrer), click_id: s(f.click_id), channel: s(f.channel) });
    events.push({ at: s(f.created_at), kind: "form", channel: label === "Direct / unknown" ? "Website" : label, title: `Filled in “${s(f.form_name) || "a form"}”`, page: s(f.page_url) || undefined, campaign: s(f.utm_campaign) || undefined, source: s(f.utm_source) || undefined, medium: s(f.utm_medium) || undefined, referrer: s(f.referrer) || undefined, clickId: Boolean(s(f.click_id)) });
  }
  for (const t of threads) {
    const ch = s(t.channel).toLowerCase(); const name = ch === "whatsapp" ? "WhatsApp" : ch === "instagram" ? "Instagram" : ch === "messenger" || ch === "facebook" ? "Facebook" : ch === "email" ? "Email" : "SMS";
    events.push({ at: s(t.created_at), kind: "conversation", channel: name, title: ch === "email" ? "First email" : `First ${name} message`, detail: s(t.status) === "closed" ? "Conversation closed" : undefined });
  }
  for (const d of deals) events.push({ at: s(d.created_at), kind: "deal", channel: "Pipeline", title: `Deal created: ${s(d.title)}`, detail: [Number(d.value) ? `${s(d.currency) || "EUR"} ${Math.round(Number(d.value))}` : "", s(d.source) ? `source ${s(d.source)}` : ""].filter(Boolean).join(" · ") || undefined });
  for (const b of bookings) events.push({ at: s(b.created_at) || s(b.start_at), kind: "booking", channel: s(b.source) === "public" ? "Online booking" : "Scheduling", title: `Appointment ${s(b.status) === "completed" ? "showed" : s(b.status) === "no_show" ? "no-show" : s(b.status)}`, detail: `For ${s(b.start_at).slice(0, 16).replace("T", " ")}${s(b.channel) ? ` · ${s(b.channel)}` : ""}` });
  events.sort((a, b) => a.at.localeCompare(b.at));
  // First touch: the earliest event that actually says where they came from (a form with tracking or a message), else the earliest event.
  const firstTouch = events.find((e) => e.kind === "form" || e.kind === "conversation") || events[0] || null;
  return { contact, firstTouch, events };
}
