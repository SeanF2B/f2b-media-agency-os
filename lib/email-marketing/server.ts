// Email marketing: templates, AI-assisted campaigns (multi-step with wait periods) sent to the
// CRM's own contacts through Resend. Low D1 reads: every query is index-backed and the sender
// processes at most 80 due recipients per cron tick in one Resend batch call.
import { cleanBlocks, cleanStyle, renderEmailHtml, renderEmailText, type EmailBlock, type EmailStyle } from "./render";
import { logSystemEmail } from "../email-log";

type Stmt = { bind(...values: unknown[]): Stmt; run(): Promise<unknown>; first<T = Record<string, unknown>>(): Promise<T | null>; all<T = Record<string, unknown>>(): Promise<{ results?: T[] }> };
export type Db = { prepare(sql: string): Stmt; batch(statements: Stmt[]): Promise<unknown> };
export type MailEnv = { DB?: Db; RESEND_API_KEY?: string; TASK_NOTIFICATION_FROM?: string; GOOGLE_ADS_TOKEN_ENCRYPTION_KEY?: string; TASK_APP_URL?: string };

export type CampaignStep = { id: string; subject: string; preheader: string; waitDays: number; blocks: EmailBlock[] };
export type Audience = { tags: string[]; tagMode: "any" | "all" };
export type Campaign = { id: string; clientId: string; name: string; goal: string; status: "draft" | "running" | "paused" | "completed"; audience: Audience; steps: CampaignStep[]; style: EmailStyle; fromName: string; replyTo: string; footer: string; stats: { enrolled?: number; sent?: number; failed?: number; unsubscribed?: number }; createdAt: string; updatedAt: string; launchedAt: string };
export type Template = { id: string; clientId: string; name: string; subject: string; preheader: string; blocks: EmailBlock[]; style: EmailStyle; updatedAt: string };

const SCHEMA = [
  "CREATE TABLE IF NOT EXISTS email_templates (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, client_id TEXT NOT NULL DEFAULT '', name TEXT NOT NULL, subject TEXT NOT NULL DEFAULT '', preheader TEXT NOT NULL DEFAULT '', blocks TEXT NOT NULL, style TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS email_templates_scope_idx ON email_templates(owner_id, client_id, updated_at DESC)",
  "CREATE TABLE IF NOT EXISTS email_campaigns (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, client_id TEXT NOT NULL DEFAULT '', name TEXT NOT NULL, goal TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'draft', audience TEXT NOT NULL DEFAULT '{}', steps TEXT NOT NULL DEFAULT '[]', style TEXT NOT NULL DEFAULT '{}', from_name TEXT NOT NULL DEFAULT '', reply_to TEXT NOT NULL DEFAULT '', footer TEXT NOT NULL DEFAULT '', stats TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL, updated_at TEXT NOT NULL, launched_at TEXT NOT NULL DEFAULT '')",
  "CREATE INDEX IF NOT EXISTS email_campaigns_scope_idx ON email_campaigns(owner_id, client_id, updated_at DESC)",
  "CREATE TABLE IF NOT EXISTS email_campaign_recipients (campaign_id TEXT NOT NULL, contact_id TEXT NOT NULL, owner_id TEXT NOT NULL, email TEXT NOT NULL, first_name TEXT NOT NULL DEFAULT '', last_name TEXT NOT NULL DEFAULT '', company TEXT NOT NULL DEFAULT '', step INTEGER NOT NULL DEFAULT 0, next_at TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'active', last_error TEXT NOT NULL DEFAULT '', PRIMARY KEY (campaign_id, contact_id))",
  "CREATE INDEX IF NOT EXISTS email_campaign_recipients_due_idx ON email_campaign_recipients(status, next_at)",
  "CREATE INDEX IF NOT EXISTS email_campaign_recipients_contact_idx ON email_campaign_recipients(owner_id, contact_id)",
  "CREATE TABLE IF NOT EXISTS crm_flags (owner_id TEXT NOT NULL, kind TEXT NOT NULL, ref_id TEXT NOT NULL, flag TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (owner_id, kind, ref_id, flag))",
];
let ready: Promise<void> | null = null;
export function ensureEmailSchema(db: Db) {
  ready ||= (async () => { for (const sql of SCHEMA) await db.prepare(sql).run(); })().catch((error) => { ready = null; throw error; });
  return ready;
}

const parse = <T,>(text: unknown, fallback: T): T => { try { return text ? JSON.parse(String(text)) as T : fallback; } catch { return fallback; } };
const str = (v: unknown, n: number) => String(v ?? "").trim().slice(0, n);
export function cleanSteps(input: unknown): CampaignStep[] {
  return (Array.isArray(input) ? input : []).slice(0, 8).map((raw, index) => {
    const s = (raw || {}) as Record<string, unknown>;
    return { id: str(s.id, 24) || `s${Math.random().toString(36).slice(2, 9)}`, subject: str(s.subject, 200), preheader: str(s.preheader, 200), waitDays: index === 0 ? 0 : Math.min(60, Math.max(0, Math.round(Number(s.waitDays) || 0))), blocks: cleanBlocks(s.blocks) };
  });
}
export function cleanAudience(input: unknown): Audience {
  const a = (input || {}) as Record<string, unknown>;
  return { tags: (Array.isArray(a.tags) ? a.tags : []).map((t) => str(t, 60)).filter(Boolean).slice(0, 20), tagMode: a.tagMode === "all" ? "all" : "any" };
}
type CampaignRow = { id: string; client_id: string; name: string; goal: string; status: string; audience: string; steps: string; style: string; from_name: string; reply_to: string; footer: string; stats: string; created_at: string; updated_at: string; launched_at: string };
export const toCampaign = (r: CampaignRow): Campaign => ({ id: r.id, clientId: r.client_id, name: r.name, goal: r.goal, status: (["draft", "running", "paused", "completed"].includes(r.status) ? r.status : "draft") as Campaign["status"], audience: cleanAudience(parse(r.audience, {})), steps: cleanSteps(parse(r.steps, [])), style: cleanStyle(parse(r.style, {})), fromName: r.from_name, replyTo: r.reply_to, footer: r.footer, stats: parse(r.stats, {}), createdAt: r.created_at, updatedAt: r.updated_at, launchedAt: r.launched_at });
type TemplateRow = { id: string; client_id: string; name: string; subject: string; preheader: string; blocks: string; style: string; updated_at: string };
export const toTemplate = (r: TemplateRow): Template => ({ id: r.id, clientId: r.client_id, name: r.name, subject: r.subject, preheader: r.preheader, blocks: cleanBlocks(parse(r.blocks, [])), style: cleanStyle(parse(r.style, {})), updatedAt: r.updated_at });

export async function listForScope(db: Db, ownerId: string, clientId: string) {
  await ensureEmailSchema(db);
  const [templates, campaigns] = await Promise.all([
    db.prepare("SELECT id, client_id, name, subject, preheader, blocks, style, updated_at FROM email_templates WHERE owner_id=?1 AND client_id=?2 ORDER BY updated_at DESC LIMIT 100").bind(ownerId, clientId).all<TemplateRow>(),
    db.prepare("SELECT * FROM email_campaigns WHERE owner_id=?1 AND client_id=?2 ORDER BY updated_at DESC LIMIT 100").bind(ownerId, clientId).all<CampaignRow>(),
  ]);
  return { templates: (templates.results || []).map(toTemplate), campaigns: (campaigns.results || []).map(toCampaign) };
}

// Contacts in this sub-account (or the agency's own contacts when clientId is "") that have an email.
const SCOPE_SQL = "c.owner_id=?1 AND (c.client_id=?2 OR (?2='' AND (c.client_id IS NULL OR c.client_id=''))) AND c.email LIKE '%@%'";
const NOT_FLAGGED = "NOT EXISTS (SELECT 1 FROM crm_flags f WHERE f.owner_id=c.owner_id AND f.kind='contact' AND f.ref_id=c.id AND f.flag IN ('dnd','spam'))";
function audienceQuery(audience: Audience, select: string) {
  const tags = audience.tags;
  const tagSql = !tags.length ? "" : audience.tagMode === "all"
    ? ` AND (SELECT COUNT(DISTINCT lower(t.tag)) FROM crm_contact_tags t WHERE t.owner_id=c.owner_id AND t.contact_id=c.id AND lower(t.tag) IN (${tags.map((_, i) => `lower(?${i + 3})`).join(",")}))=${tags.length}`
    : ` AND EXISTS (SELECT 1 FROM crm_contact_tags t WHERE t.owner_id=c.owner_id AND t.contact_id=c.id AND lower(t.tag) IN (${tags.map((_, i) => `lower(?${i + 3})`).join(",")}))`;
  return { sql: `SELECT ${select} FROM crm_contacts c WHERE ${SCOPE_SQL} AND ${NOT_FLAGGED}${tagSql}`, params: tags };
}
export async function audienceCount(db: Db, ownerId: string, clientId: string, audience: Audience) {
  await ensureEmailSchema(db);
  const q = audienceQuery(audience, "COUNT(*) AS n");
  try { return Number((await db.prepare(q.sql).bind(ownerId, clientId, ...q.params).first<{ n: number }>())?.n || 0); } catch { return 0; }
}
export async function scopeTags(db: Db, ownerId: string, clientId: string) {
  try {
    const rows = await db.prepare(`SELECT t.tag AS tag, COUNT(*) AS n FROM crm_contact_tags t JOIN crm_contacts c ON c.id=t.contact_id WHERE t.owner_id=?1 AND ${SCOPE_SQL} GROUP BY lower(t.tag) ORDER BY n DESC LIMIT 200`).bind(ownerId, clientId).all<{ tag: string; n: number }>();
    return (rows.results || []).map((r) => ({ tag: r.tag, count: Number(r.n) }));
  } catch { return []; }
}

/** Enrols the audience (up to 5,000 contacts) and starts the campaign. Re-launching never double-enrols. */
export async function launchCampaign(db: Db, ownerId: string, campaign: Campaign) {
  if (!campaign.steps.length || !campaign.steps[0].subject || !campaign.steps[0].blocks.length) throw new Error("Add a subject and some content to the first email first.");
  const q = audienceQuery(campaign.audience, "c.id, c.email, c.first_name, c.last_name, c.company");
  const contacts = (await db.prepare(`${q.sql} LIMIT 5000`).bind(ownerId, campaign.clientId, ...q.params).all<{ id: string; email: string; first_name: string; last_name: string; company: string }>()).results || [];
  if (!contacts.length) throw new Error("No contacts match this audience (contacts need an email address and must not be marked Do Not Disturb or spam).");
  const now = new Date().toISOString();
  for (let i = 0; i < contacts.length; i += 90) {
    await db.batch(contacts.slice(i, i + 90).map((c) => db.prepare("INSERT OR IGNORE INTO email_campaign_recipients (campaign_id, contact_id, owner_id, email, first_name, last_name, company, step, next_at, status) VALUES (?1,?2,?3,?4,?5,?6,?7,0,?8,'active')").bind(campaign.id, c.id, ownerId, c.email.trim().toLowerCase(), c.first_name, c.last_name, c.company, now)));
  }
  const stats = { ...campaign.stats, enrolled: contacts.length };
  await db.prepare("UPDATE email_campaigns SET status='running', launched_at=CASE WHEN launched_at='' THEN ?3 ELSE launched_at END, stats=?4, updated_at=?3 WHERE id=?1 AND owner_id=?2").bind(campaign.id, ownerId, now, JSON.stringify(stats)).run();
  return contacts.length;
}
export async function setCampaignPaused(db: Db, ownerId: string, id: string, paused: boolean) {
  const now = new Date().toISOString();
  await db.batch([
    db.prepare("UPDATE email_campaigns SET status=?3, updated_at=?4 WHERE id=?1 AND owner_id=?2 AND status IN ('running','paused')").bind(id, ownerId, paused ? "paused" : "running", now),
    db.prepare(`UPDATE email_campaign_recipients SET status=?2 WHERE campaign_id=?1 AND status=?3`).bind(id, paused ? "paused" : "active", paused ? "active" : "paused"),
  ]);
}

// ---------- Unsubscribe tokens (signed; only the server can make one) ----------
const enc = new TextEncoder();
const b64url = (bytes: ArrayBuffer | Uint8Array) => btoa(String.fromCharCode(...new Uint8Array(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
const fromB64url = (text: string) => { try { return decodeURIComponent(escape(atob(text.replace(/-/g, "+").replace(/_/g, "/")))); } catch { return ""; } };
async function sign(secret: string, value: string) {
  const key = await crypto.subtle.importKey("raw", enc.encode(`email-unsub:${secret}`), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return b64url(await crypto.subtle.sign("HMAC", key, enc.encode(value))).slice(0, 32);
}
export async function makeUnsubToken(secret: string, ownerId: string, contactId: string, campaignId: string) {
  const value = `${ownerId}|${contactId}|${campaignId}`;
  return `${b64url(enc.encode(unescape(encodeURIComponent(value))))}.${await sign(secret, value)}`;
}
export async function readUnsubToken(secret: string, token: string) {
  const [id, mac] = String(token || "").split(".");
  const value = id ? fromB64url(id) : "";
  if (!value || !mac || (await sign(secret, value)) !== mac) return null;
  const [ownerId, contactId, campaignId] = value.split("|");
  return ownerId && contactId ? { ownerId, contactId, campaignId: campaignId || "" } : null;
}
/** Marks the contact Do Not Disturb (respected by every campaign) and stops their campaign emails. */
export async function unsubscribeContact(db: Db, ownerId: string, contactId: string, campaignId: string) {
  await ensureEmailSchema(db);
  const now = new Date().toISOString();
  await db.batch([
    db.prepare("INSERT OR IGNORE INTO crm_flags (owner_id, kind, ref_id, flag, created_at) VALUES (?1,'contact',?2,'dnd',?3)").bind(ownerId, contactId, now),
    db.prepare("UPDATE email_campaign_recipients SET status='unsubscribed' WHERE owner_id=?1 AND contact_id=?2 AND status IN ('active','paused')").bind(ownerId, contactId),
  ]);
  if (campaignId) {
    const row = await db.prepare("SELECT stats FROM email_campaigns WHERE id=?1 AND owner_id=?2").bind(campaignId, ownerId).first<{ stats: string }>();
    if (row) { const stats = parse<Campaign["stats"]>(row.stats, {}); stats.unsubscribed = (stats.unsubscribed || 0) + 1; await db.prepare("UPDATE email_campaigns SET stats=?3 WHERE id=?1 AND owner_id=?2").bind(campaignId, ownerId, JSON.stringify(stats)).run(); }
  }
}

// ---------- Sending ----------
const appOrigin = (env: MailEnv) => { try { return new URL(env.TASK_APP_URL || "https://f2b-media-agency-os.f2b-media.workers.dev").origin; } catch { return "https://f2b-media-agency-os.f2b-media.workers.dev"; } };
export function fromHeader(env: MailEnv, fromName: string) {
  const base = String(env.TASK_NOTIFICATION_FROM || "");
  const address = (base.match(/<([^>]+)>/)?.[1] || base).trim();
  const name = fromName.replace(/[<>"\r\n]/g, "").trim();
  return name && address ? `${name} <${address}>` : base;
}
const sample = { first_name: "Alex", last_name: "Murphy", company: "Sample Ltd", email: "alex@example.com" };
export async function sendTestEmail(env: MailEnv, to: string, doc: { subject: string; preheader?: string; blocks: EmailBlock[]; style: EmailStyle }, fromName = "", footer = "") {
  if (!env.RESEND_API_KEY || !env.TASK_NOTIFICATION_FROM) throw new Error("Email sending isn't set up on the server (RESEND_API_KEY and TASK_NOTIFICATION_FROM).");
  const html = renderEmailHtml(doc, sample, { sender: footer, unsubscribeUrl: `${appOrigin(env)}/api/marketing-public/email-unsubscribe?t=test` });
  const response = await fetch("https://api.resend.com/emails", { method: "POST", headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json" }, body: JSON.stringify({ from: fromHeader(env, fromName), to: [to], subject: `[Test] ${doc.subject.replace(/\{\{[^}]+\}\}/g, (m) => m.includes("first_name") ? sample.first_name : "")}`, html, text: renderEmailText(doc, sample) }), signal: AbortSignal.timeout(15_000) });
  if (!response.ok) { const detail = await response.json().catch(() => null) as { message?: string } | null; throw new Error(`The email provider returned HTTP ${response.status}: ${detail?.message || "not accepted"}.`); }
}

type DueRow = { campaign_id: string; contact_id: string; owner_id: string; email: string; first_name: string; last_name: string; company: string; step: number };
/** Cron: sends the next email to up to 80 due recipients in one Resend batch call. */
export async function processEmailCampaigns(env: MailEnv, now = new Date()) {
  const db = env.DB;
  if (!db || !env.RESEND_API_KEY || !env.TASK_NOTIFICATION_FROM) return;
  try { await ensureEmailSchema(db); } catch { return; }
  const nowIso = now.toISOString();
  const due = (await db.prepare("SELECT campaign_id, contact_id, owner_id, email, first_name, last_name, company, step FROM email_campaign_recipients WHERE status='active' AND next_at<=?1 ORDER BY next_at LIMIT 80").bind(nowIso).all<DueRow>()).results || [];
  if (!due.length) return;
  const ids = [...new Set(due.map((r) => r.campaign_id))];
  const campaigns = new Map(((await db.prepare(`SELECT * FROM email_campaigns WHERE id IN (${ids.map((_, i) => `?${i + 1}`).join(",")})`).bind(...ids).all<CampaignRow & { owner_id: string }>()).results || []).map((r) => [r.id, { ...toCampaign(r), ownerId: r.owner_id }]));
  // Last-second safety: anyone marked DND/spam since enrolment is skipped.
  const flagged = new Set<string>();
  const contactIds = [...new Set(due.map((r) => r.contact_id))];
  for (let i = 0; i < contactIds.length; i += 90) {
    const part = contactIds.slice(i, i + 90);
    const rows = (await db.prepare(`SELECT ref_id FROM crm_flags WHERE owner_id=?1 AND kind='contact' AND flag IN ('dnd','spam') AND ref_id IN (${part.map((_, j) => `?${j + 2}`).join(",")})`).bind(due[0].owner_id, ...part).all<{ ref_id: string }>()).results || [];
    rows.forEach((r) => flagged.add(r.ref_id));
  }
  const secret = String(env.GOOGLE_ADS_TOKEN_ENCRYPTION_KEY || "");
  const updates: Stmt[] = [];
  const sendList: Array<{ row: DueRow; payload: Record<string, unknown>; subject: string; text: string }> = [];
  for (const row of due) {
    const campaign = campaigns.get(row.campaign_id);
    if (!campaign || campaign.status !== "running") { updates.push(db.prepare("UPDATE email_campaign_recipients SET status=?3 WHERE campaign_id=?1 AND contact_id=?2").bind(row.campaign_id, row.contact_id, campaign?.status === "paused" ? "paused" : "stopped")); continue; }
    if (flagged.has(row.contact_id)) { updates.push(db.prepare("UPDATE email_campaign_recipients SET status='unsubscribed' WHERE campaign_id=?1 AND contact_id=?2").bind(row.campaign_id, row.contact_id)); continue; }
    const step = campaign.steps[row.step];
    if (!step) { updates.push(db.prepare("UPDATE email_campaign_recipients SET status='done' WHERE campaign_id=?1 AND contact_id=?2").bind(row.campaign_id, row.contact_id)); continue; }
    const vars = { first_name: row.first_name, last_name: row.last_name, company: row.company, email: row.email };
    const unsubscribeUrl = secret ? `${appOrigin(env)}/api/marketing-public/email-unsubscribe?t=${await makeUnsubToken(secret, row.owner_id, row.contact_id, row.campaign_id)}` : "";
    const doc = { subject: step.subject, preheader: step.preheader, blocks: step.blocks, style: campaign.style };
    const subject = renderEmailText({ ...doc, blocks: [{ id: "s", type: "text", text: step.subject }] }, vars).trim();
    const text = renderEmailText(doc, vars, unsubscribeUrl);
    sendList.push({ row, subject, text, payload: { from: fromHeader(env, campaign.fromName), to: [row.email], subject, html: renderEmailHtml(doc, vars, { sender: campaign.footer, unsubscribeUrl }), text, ...(campaign.replyTo ? { reply_to: campaign.replyTo } : {}), ...(unsubscribeUrl ? { headers: { "List-Unsubscribe": `<${unsubscribeUrl}>`, "List-Unsubscribe-Post": "List-Unsubscribe=One-Click" } } : {}) } });
  }
  const sentByCampaign = new Map<string, { sent: number; failed: number }>();
  if (sendList.length) {
    const key = `emailcamp/${sendList.map((item) => `${item.row.campaign_id}:${item.row.contact_id}:${item.row.step}`).sort().join(",")}`;
    const digest = b64url(await crypto.subtle.digest("SHA-256", enc.encode(key))).slice(0, 40);
    let ok = false, error = "";
    try {
      const response = await fetch("https://api.resend.com/emails/batch", { method: "POST", headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": `emailcamp-${digest}` }, body: JSON.stringify(sendList.map((item) => item.payload)), signal: AbortSignal.timeout(25_000) });
      ok = response.ok;
      if (!ok) error = `HTTP ${response.status}: ${((await response.json().catch(() => null)) as { message?: string } | null)?.message || "not accepted"}`.slice(0, 300);
    } catch (reason) { error = reason instanceof Error ? reason.message.slice(0, 300) : "Send failed"; }
    for (const { row } of sendList) {
      const campaign = campaigns.get(row.campaign_id)!;
      const tally = sentByCampaign.get(row.campaign_id) || { sent: 0, failed: 0 };
      if (ok) {
        tally.sent++;
        const next = campaign.steps[row.step + 1];
        updates.push(next
          ? db.prepare("UPDATE email_campaign_recipients SET step=?3, next_at=?4, last_error='' WHERE campaign_id=?1 AND contact_id=?2").bind(row.campaign_id, row.contact_id, row.step + 1, new Date(now.getTime() + next.waitDays * 86_400_000).toISOString())
          : db.prepare("UPDATE email_campaign_recipients SET step=?3, status='done', last_error='' WHERE campaign_id=?1 AND contact_id=?2").bind(row.campaign_id, row.contact_id, row.step + 1));
      } else {
        tally.failed++;
        // Retry in an hour; the error shows on the campaign.
        updates.push(db.prepare("UPDATE email_campaign_recipients SET next_at=?3, last_error=?4 WHERE campaign_id=?1 AND contact_id=?2").bind(row.campaign_id, row.contact_id, new Date(now.getTime() + 3_600_000).toISOString(), error));
      }
      sentByCampaign.set(row.campaign_id, tally);
    }
    if (ok) for (const item of sendList.slice(0, 40)) await logSystemEmail(db as never, { ownerId: item.row.owner_id, clientId: campaigns.get(item.row.campaign_id)?.clientId || null, to: item.row.email, name: `${item.row.first_name} ${item.row.last_name}`.trim(), subject: item.subject, text: item.text.slice(0, 1500), kind: "Campaigns" });
  }
  for (const [id, tally] of sentByCampaign) {
    const campaign = campaigns.get(id)!;
    const stats = { ...campaign.stats, sent: (campaign.stats.sent || 0) + tally.sent, failed: (campaign.stats.failed || 0) + tally.failed };
    updates.push(db.prepare("UPDATE email_campaigns SET stats=?2, updated_at=?3 WHERE id=?1").bind(id, JSON.stringify(stats), nowIso));
  }
  for (let i = 0; i < updates.length; i += 90) await db.batch(updates.slice(i, i + 90));
  // Campaigns with nobody left to email are marked completed.
  for (const id of ids) {
    const left = await db.prepare("SELECT 1 AS x FROM email_campaign_recipients WHERE campaign_id=?1 AND status IN ('active','paused') LIMIT 1").bind(id).first();
    if (!left && campaigns.get(id)?.status === "running") await db.prepare("UPDATE email_campaigns SET status='completed', updated_at=?2 WHERE id=?1").bind(id, nowIso).run();
  }
}
