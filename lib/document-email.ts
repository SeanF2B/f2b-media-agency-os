// "Send by email" for generated reports, audits, keyword reports and proposals.
// One branded email template (agency logo + colours), a preview of exactly what will be sent,
// CC to the company email, and a public view link (/f/report/<token> or /f/proposal/<token>).
import { env } from "cloudflare:workers";
import { logSystemEmail } from "@/lib/email-log";

type Db = D1Database;
export type DocKind = "report" | "proposal";
export type EmailBrand = { name: string; logo: string; primary: string; secondary: string; email: string };

const SHARES_SQL = "CREATE TABLE IF NOT EXISTS document_shares (token TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL, kind TEXT NOT NULL, ref_id TEXT NOT NULL, client_id TEXT NOT NULL DEFAULT '', theme TEXT NOT NULL DEFAULT 'dark', created_at TEXT NOT NULL)";
const SHARES_IDX = "CREATE INDEX IF NOT EXISTS document_shares_ref_idx ON document_shares(owner_id, kind, ref_id)";
let ready: Promise<unknown> | null = null;
export function ensureDocumentShares(db: Db) {
  ready ||= db.batch([db.prepare(SHARES_SQL), db.prepare(SHARES_IDX)]).catch((error) => { ready = null; throw error; });
  return ready;
}

/** Reuses the existing link for this saved report (and theme) so clients never get a pile of different URLs. */
export async function reportShareToken(db: Db, ownerId: string, clientId: string, archiveId: string, theme: "dark" | "light") {
  await ensureDocumentShares(db);
  const existing = await db.prepare("SELECT token FROM document_shares WHERE owner_id = ?1 AND kind = 'report' AND ref_id = ?2 AND theme = ?3 LIMIT 1").bind(ownerId, archiveId, theme).first<{ token: string }>();
  if (existing?.token) return existing.token;
  const token = `${crypto.randomUUID().replace(/-/g, "")}${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}`;
  await db.prepare("INSERT INTO document_shares (token, owner_id, kind, ref_id, client_id, theme, created_at) VALUES (?1,?2,'report',?3,?4,?5,?6)").bind(token, ownerId, archiveId, clientId, theme, new Date().toISOString()).run();
  return token;
}
export async function readShare(db: Db, token: string) {
  if (!/^[a-f0-9]{40}$/.test(token)) return null;
  await ensureDocumentShares(db);
  return db.prepare("SELECT owner_id, kind, ref_id, client_id, theme FROM document_shares WHERE token = ?1").bind(token).first<{ owner_id: string; kind: string; ref_id: string; client_id: string; theme: string }>();
}

const hex = (value: unknown, fallback: string) => typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value.trim()) ? value.trim() : fallback;
export function agencyBrand(workspace: { settings?: Record<string, any> }, origin: string, savedEmail = ""): EmailBrand {
  const s = workspace.settings || {};
  const b = s.branding || {};
  // Email clients block data: images, so an uploaded (data URL) logo falls back to the hosted F2B logo.
  const logo = typeof b.logo === "string" && /^https:\/\//.test(b.logo) ? b.logo : typeof b.logo === "string" && b.logo.startsWith("/") ? `${origin}${b.logo}` : `${origin}/f2b-login-logo.png`;
  return { name: String(b.name || s.agencyName || "F2B Media").slice(0, 60), logo, primary: hex(b.primary, "#0a78b0"), secondary: hex(b.secondary, "#111827"), email: companyEmail(workspace, savedEmail) };
}
export function companyEmail(workspace: { settings?: Record<string, any> }, saved = "") {
  const s = workspace.settings || {};
  return String(saved || s.companyEmail || s.adminEmail || "").trim().toLowerCase();
}
// The company CC address lives in its own row so a workspace save from an open tab can never wipe it.
const SETTINGS_SQL = "CREATE TABLE IF NOT EXISTS document_email_settings (owner_id TEXT PRIMARY KEY NOT NULL, company_email TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL)";
export async function savedCompanyEmail(db: Db, ownerId: string) {
  await db.prepare(SETTINGS_SQL).run();
  return (await db.prepare("SELECT company_email FROM document_email_settings WHERE owner_id = ?1").bind(ownerId).first<{ company_email: string }>())?.company_email || "";
}
export async function rememberCompanyEmail(db: Db, ownerId: string, email: string) {
  await db.prepare(SETTINGS_SQL).run();
  await db.prepare("INSERT INTO document_email_settings (owner_id, company_email, updated_at) VALUES (?1,?2,?3) ON CONFLICT(owner_id) DO UPDATE SET company_email = excluded.company_email, updated_at = excluded.updated_at").bind(ownerId, email, new Date().toISOString()).run();
}

const esc = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const readableOn = (bg: string) => { const n = parseInt(bg.slice(1), 16); const l = (0.299 * ((n >> 16) & 255) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255; return l > 0.62 ? "#111827" : "#ffffff"; };

export function renderDocumentEmail(p: { brand: EmailBrand; message: string; link: string; buttonLabel: string; docTitle: string; docSubtitle?: string; clientLogo?: string }) {
  const { brand } = p;
  const paragraphs = p.message.trim().split(/\n{2,}/).map((block) => `<p style="margin:0 0 14px;font-size:15px;line-height:1.6;color:#1f2937">${esc(block).replace(/\n/g, "<br>")}</p>`).join("");
  const headFg = readableOn(brand.secondary), btnFg = readableOn(brand.primary);
  return `<!doctype html><html lang="en-IE"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(p.docTitle)}</title></head>
<body style="margin:0;padding:0;background:#f1f3f6;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#f1f3f6;padding:28px 12px"><tr><td align="center">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:600px;background:#ffffff;border-radius:16px;overflow:hidden;box-shadow:0 4px 18px rgba(15,23,42,.08)">
<tr><td style="background:${brand.secondary};padding:22px 28px" align="left"><img src="${esc(brand.logo)}" alt="${esc(brand.name)}" height="40" style="display:block;height:40px;max-width:200px;object-fit:contain;border:0"></td></tr>
<tr><td style="padding:28px 28px 8px">${paragraphs}</td></tr>
<tr><td style="padding:6px 28px 26px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #e5e7eb;border-radius:14px"><tr>
    ${p.clientLogo ? `<td width="64" style="padding:16px 0 16px 16px" valign="middle"><img src="${esc(p.clientLogo)}" alt="" width="48" height="48" style="display:block;width:48px;height:48px;object-fit:contain;border-radius:10px;border:1px solid #eef0f3;background:#fff"></td>` : ""}
    <td style="padding:16px" valign="middle"><div style="font-size:16px;font-weight:700;color:#111827">${esc(p.docTitle)}</div>${p.docSubtitle ? `<div style="font-size:13px;color:#6b7280;margin-top:3px">${esc(p.docSubtitle)}</div>` : ""}</td>
  </tr><tr><td colspan="2" style="padding:0 16px 16px"><a href="${esc(p.link)}" style="display:block;background:${brand.primary};color:${btnFg};text-decoration:none;text-align:center;font-weight:700;font-size:15px;padding:13px 18px;border-radius:10px">${esc(p.buttonLabel)}</a></td></tr></table>
</td></tr>
<tr><td style="background:${brand.secondary};color:${headFg};padding:16px 28px;font-size:12.5px;line-height:1.5;opacity:.96"><b>${esc(brand.name)}</b>${brand.email ? ` · <a href="mailto:${esc(brand.email)}" style="color:${headFg}">${esc(brand.email)}</a>` : ""}</td></tr>
</table></td></tr></table></body></html>`;
}

export const cleanEmail = (value: unknown) => { const email = String(value || "").trim().toLowerCase(); return /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(email) && email.length <= 200 ? email : ""; };
export const emailList = (value: unknown) => [...new Set(String(value || "").split(/[,;\s]+/).map(cleanEmail).filter(Boolean))].slice(0, 10);

export async function sendDocumentEmail(db: Db, p: { ownerId: string; clientId?: string; brand: EmailBrand; to: string[]; cc: string[]; subject: string; html: string; text: string; toName?: string; idempotencyKey: string }) {
  if (!env.RESEND_API_KEY || !env.TASK_NOTIFICATION_FROM) throw new Error("Email sending isn't set up on the server yet.");
  const address = /<([^>]+)>/.exec(env.TASK_NOTIFICATION_FROM)?.[1] || env.TASK_NOTIFICATION_FROM;
  const from = `${p.brand.name.replace(/["<>]/g, "")} <${address}>`;
  const cc = p.cc.filter((email) => !p.to.includes(email));
  const response = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${env.RESEND_API_KEY}`, "Content-Type": "application/json", "Idempotency-Key": p.idempotencyKey },
    body: JSON.stringify({ from, to: p.to, ...(cc.length ? { cc } : {}), reply_to: p.brand.email || cc[0] || undefined, subject: p.subject, html: p.html, text: p.text }),
  });
  if (!response.ok) {
    const detail = await response.json().catch(() => ({})) as { message?: string };
    throw new Error(detail.message ? `Email couldn't be sent: ${detail.message}` : "Email couldn't be sent. Try again.");
  }
  for (const email of p.to) await logSystemEmail(db as never, { ownerId: p.ownerId, clientId: p.clientId, to: email, name: p.toName, subject: p.subject, text: p.text, kind: "Reports" });
}
