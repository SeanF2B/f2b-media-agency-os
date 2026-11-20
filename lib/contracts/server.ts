import { env } from "cloudflare:workers";
import { agencyBrand, emailList, renderDocumentEmail, savedCompanyEmail, sendDocumentEmail } from "@/lib/document-email";
import { canonicalText, CONTRACT_CSS, defaultData, renderContractBody, sanitizeData, sha256Hex, cleanSignatureImage, totals, money, type ContractData, type ContractSignature } from "./core";

// Client contracts — storage, sending and signing. Agency admins only (a client's contract with F2B is
// private to the agency and never shown inside the client's sub-account). Signed contracts are frozen:
// the exact HTML that was signed is kept in R2 (D1 fallback) with a SHA-256 fingerprint, and the record
// is filed on the client's profile (Client workroom → Contracts).

type Row = Record<string, any>;
export class ContractError extends Error { constructor(message: string, readonly status = 400) { super(message); } }
const nowIso = () => new Date().toISOString();
const parse = <T,>(value: unknown, fallback: T): T => { try { return value ? JSON.parse(String(value)) as T : fallback; } catch { return fallback; } };
const clip = (value: unknown, n: number) => String(value ?? "").trim().slice(0, n);
const token = () => `${crypto.randomUUID().replace(/-/g, "")}${crypto.randomUUID().replace(/-/g, "").slice(0, 12)}`;

function db(): D1Database { if (!env.DB) throw new ContractError("The workspace database is unavailable.", 503); return env.DB; }
function bucket(): R2Bucket | null { return (env as unknown as { BUCKET?: R2Bucket }).BUCKET || null; }

export const CONTRACTS_SCHEMA_SQL = `CREATE TABLE IF NOT EXISTS contracts (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  reference TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  data TEXT NOT NULL DEFAULT '{}',
  monthly_total REAL NOT NULL DEFAULT 0,
  share_token TEXT,
  sent_at TEXT,
  viewed_at TEXT,
  signed_at TEXT,
  signature TEXT,
  signed_html_key TEXT NOT NULL DEFAULT '',
  signed_html TEXT,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS contracts_client_idx ON contracts(owner_id, client_id, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS contracts_share_token_idx ON contracts(share_token);
CREATE TABLE IF NOT EXISTS contract_settings (
  owner_id TEXT PRIMARY KEY NOT NULL,
  defaults TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
)`;
let ready: Promise<void> | null = null;
export function ensureContractSchema() {
  if (!ready) {
    const d = db();
    ready = d.batch(CONTRACTS_SCHEMA_SQL.split(/;\s*\n/).map((s) => s.trim()).filter(Boolean).map((s) => d.prepare(s))).then(() => undefined).catch((error) => { ready = null; throw error; });
  }
  return ready;
}

// ============================ access ============================
type Staff = { id: string; email: string; role: string; isBot?: boolean; name?: string; staffType?: string };
type Client = { id: string; name: string; currency?: string; company?: string; contact?: string; email?: string; logo?: string; address?: string; services?: Array<{ name: string; fee?: number; campaignName?: string }> };
export type ContractContext = { ownerId: string; workspace: Row; userEmail: string; userName: string; clients: Client[] };
export async function contractContext(user: { userId: string; email: string }): Promise<ContractContext> {
  const row = await db().prepare("SELECT owner_id, data FROM workspace_documents WHERE id = 'f2b-agency'").first<{ owner_id: string; data: string }>();
  if (!row?.data) throw new ContractError("The workspace is unavailable.", 503);
  const workspace = parse<Row>(row.data, {});
  const ownerId = String(workspace.ownerId || row.owner_id || "");
  const owner = workspace.ownerId === user.userId || row.owner_id === user.userId;
  const staff = ((workspace.staff || []) as Staff[]).find((s) => !s.isBot && (s.id === user.userId || s.email?.toLowerCase() === user.email.toLowerCase()));
  const admin = owner || (["Owner", "Admin"].includes(staff?.role || "") && staff?.staffType !== "subaccount");
  if (!admin) throw new ContractError("Only agency admins can manage contracts.", 403);
  await ensureContractSchema();
  return { ownerId, workspace, userEmail: user.email, userName: staff?.name || user.email, clients: (workspace.clients || []) as Client[] };
}
function clientOf(ctx: ContractContext, clientId: string) {
  const client = ctx.clients.find((c) => c.id === clientId);
  if (!client) throw new ContractError("Choose a client first.", 404);
  return client;
}

// ============================ records ============================
export type ContractRecord = {
  id: string; clientId: string; reference: string; title: string; status: string; data: ContractData; monthlyTotal: number;
  shareToken: string | null; sentAt: string | null; viewedAt: string | null; signedAt: string | null; signature: ContractSignature | null;
  createdBy: string; createdAt: string; updatedAt: string;
};
function fromRow(row: Row): ContractRecord {
  const sig = parse<ContractSignature | null>(row.signature, null);
  return {
    id: row.id, clientId: row.client_id, reference: row.reference, title: row.title, status: row.status, data: sanitizeData(parse(row.data, {}), defaultData()), monthlyTotal: Number(row.monthly_total || 0),
    shareToken: row.share_token || null, sentAt: row.sent_at || null, viewedAt: row.viewed_at || null, signedAt: row.signed_at || null,
    signature: sig ? { ...sig, image: sig.image ? "stored" : "" } : null, createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}

export async function getDefaults(ownerId: string) {
  const row = await db().prepare("SELECT defaults FROM contract_settings WHERE owner_id = ?1").bind(ownerId).first<Row>();
  return parse<Partial<ContractData["parties"]> & { subscriptionDiscountPct?: number; currency?: string }>(row?.defaults, {});
}
async function saveDefaults(ownerId: string, data: ContractData) {
  const p = data.parties;
  const defaults = { providerName: p.providerName, providerAddress: p.providerAddress, providerEmail: p.providerEmail, providerSigner: p.providerSigner, governingLaw: p.governingLaw, subscriptionDiscountPct: data.terms.subscriptionDiscountPct };
  await db().prepare("INSERT INTO contract_settings (owner_id, defaults, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(owner_id) DO UPDATE SET defaults = ?2, updated_at = ?3").bind(ownerId, JSON.stringify(defaults), nowIso()).run();
}

/** A fresh draft for a client: their current services and fees, contact details and the saved agency details. */
export async function draftFor(ctx: ContractContext, clientId: string): Promise<ContractData> {
  const client = clientOf(ctx, clientId);
  const saved = await getDefaults(ctx.ownerId);
  const settings = (ctx.workspace.settings || {}) as Row;
  const base = defaultData();
  const currency = ["EUR", "GBP", "USD"].includes(String(client.currency)) ? String(client.currency) : (settings.currency === "GBP" || settings.taxSettings?.country === "UK" ? "GBP" : "EUR");
  const brandName = String(settings.branding?.name || settings.agencyName || "F2B Media");
  return sanitizeData({
    ...base,
    services: (client.services || []).map((s) => ({ name: s.name, monthlyFee: Number(s.fee || 0), setupFee: 0, notes: s.campaignName ? `Campaign: ${s.campaignName}` : "" })),
    terms: { ...base.terms, currency: currency as "EUR", subscriptionDiscountPct: saved.subscriptionDiscountPct ?? base.terms.subscriptionDiscountPct },
    parties: { ...base.parties, providerName: saved.providerName || brandName, providerAddress: saved.providerAddress || "", providerEmail: saved.providerEmail || String(settings.companyEmail || settings.adminEmail || ""), providerSigner: saved.providerSigner || ctx.userName, governingLaw: saved.governingLaw || (currency === "GBP" ? "England and Wales" : "Ireland"), clientName: client.company || client.name, clientAddress: client.address || "", signerName: client.contact || "", signerEmail: client.email || "" },
  });
}

export async function listContracts(ctx: ContractContext, clientId: string) {
  const rows = await db().prepare("SELECT id, client_id, reference, title, status, monthly_total, share_token, sent_at, viewed_at, signed_at, json_extract(signature, '$.name') AS signer, json_extract(data, '$.terms.currency') AS currency, created_by, created_at, updated_at FROM contracts WHERE owner_id = ?1 AND client_id = ?2 ORDER BY updated_at DESC LIMIT 50").bind(ctx.ownerId, clip(clientId, 80)).all<Row>();
  return (rows.results || []).map((r) => ({ id: r.id, clientId: r.client_id, reference: r.reference, title: r.title, status: r.status, monthlyTotal: Number(r.monthly_total || 0), shared: Boolean(r.share_token), sentAt: r.sent_at, viewedAt: r.viewed_at, signedAt: r.signed_at, signer: r.signer || "", currency: r.currency || "EUR", createdBy: r.created_by, createdAt: r.created_at, updatedAt: r.updated_at }));
}
/** Count of signed contracts per client — for the badge on the workroom icon. */
export async function contractCounts(ctx: ContractContext) {
  const rows = await db().prepare("SELECT client_id, COUNT(*) AS n FROM contracts WHERE owner_id = ?1 AND status != 'void' GROUP BY client_id").bind(ctx.ownerId).all<Row>();
  return Object.fromEntries((rows.results || []).map((r) => [r.client_id, Number(r.n)]));
}
export async function getContract(ctx: ContractContext, id: string) {
  const row = await db().prepare("SELECT * FROM contracts WHERE owner_id = ?1 AND id = ?2").bind(ctx.ownerId, clip(id, 60)).first<Row>();
  if (!row) throw new ContractError("That contract could not be found.", 404);
  return fromRow(row);
}

async function nextReference(ownerId: string) {
  const year = new Date().getUTCFullYear();
  const row = await db().prepare("SELECT COUNT(*) AS n FROM contracts WHERE owner_id = ?1 AND created_at >= ?2").bind(ownerId, `${year}-01-01`).first<Row>();
  return `F2B-${year}-${String(Number(row?.n || 0) + 1).padStart(3, "0")}`;
}

export async function createContract(ctx: ContractContext, clientId: string, input?: Partial<ContractData>) {
  clientOf(ctx, clientId);
  const data = sanitizeData(input, await draftFor(ctx, clientId));
  const id = `ctr_${crypto.randomUUID().replace(/-/g, "").slice(0, 18)}`, now = nowIso();
  await db().prepare("INSERT INTO contracts (id, owner_id, client_id, reference, title, status, data, monthly_total, created_by, created_at, updated_at) VALUES (?1,?2,?3,?4,?5,'draft',?6,?7,?8,?9,?9)")
    .bind(id, ctx.ownerId, clientId, await nextReference(ctx.ownerId), data.title, JSON.stringify(data), totals(data).monthly, ctx.userName, now).run();
  await saveDefaults(ctx.ownerId, data).catch(() => undefined);
  return getContract(ctx, id);
}

export async function updateContract(ctx: ContractContext, id: string, input: Partial<ContractData>) {
  const current = await getContract(ctx, id);
  if (current.status === "signed") throw new ContractError("This contract has been signed and can't be changed. Create a new one instead.", 409);
  if (current.status === "void") throw new ContractError("This contract has been cancelled.", 409);
  const data = sanitizeData(input, current.data);
  // Editing a sent contract keeps the same link but the client sees the new version.
  await db().prepare("UPDATE contracts SET data = ?3, title = ?4, monthly_total = ?5, updated_at = ?6 WHERE owner_id = ?1 AND id = ?2 AND status NOT IN ('signed','void')")
    .bind(ctx.ownerId, current.id, JSON.stringify(data), data.title, totals(data).monthly, nowIso()).run();
  await saveDefaults(ctx.ownerId, data).catch(() => undefined);
  return getContract(ctx, id);
}

export async function voidContract(ctx: ContractContext, id: string) {
  const current = await getContract(ctx, id);
  if (current.status === "signed") throw new ContractError("Signed contracts are kept on file and can't be cancelled here. End the agreement by notice instead.", 409);
  await db().prepare("UPDATE contracts SET status = 'void', share_token = NULL, updated_at = ?3 WHERE owner_id = ?1 AND id = ?2").bind(ctx.ownerId, current.id, nowIso()).run();
  return getContract(ctx, id);
}
export async function deleteContract(ctx: ContractContext, id: string) {
  const current = await getContract(ctx, id);
  if (current.status === "signed") throw new ContractError("Signed contracts are kept on file and can't be deleted.", 409);
  await db().prepare("DELETE FROM contracts WHERE owner_id = ?1 AND id = ?2 AND status != 'signed'").bind(ctx.ownerId, current.id).run();
}

function validateReady(data: ContractData) {
  if (!data.services.length) throw new ContractError("Pick at least one service.");
  if (!data.parties.clientName) throw new ContractError("Add the client's business name.");
  if (!data.parties.signerName) throw new ContractError("Add the name of the person signing for the client.");
}

export async function shareLink(ctx: ContractContext, id: string, origin: string) {
  const current = await getContract(ctx, id);
  if (current.status === "void") throw new ContractError("This contract has been cancelled.", 409);
  validateReady(current.data);
  let t = current.shareToken;
  if (!t) {
    t = token();
    await db().prepare("UPDATE contracts SET share_token = ?3, status = CASE WHEN status = 'draft' THEN 'sent' ELSE status END, sent_at = COALESCE(sent_at, ?4), updated_at = ?4 WHERE owner_id = ?1 AND id = ?2").bind(ctx.ownerId, current.id, t, nowIso()).run();
  }
  return { url: `${origin}/f/contract/${t}`, contract: await getContract(ctx, id) };
}

/** Details for the shared "Send by email" pop-up (components/send-document-email.tsx → /api/document-email). */
export async function contractEmailInfo(ctx: ContractContext, id: string, origin: string, createLink: boolean) {
  const c = await getContract(ctx, id);
  if (c.status === "void") throw new ContractError("This contract has been cancelled.", 409);
  const client = clientOf(ctx, c.clientId);
  const link = c.status === "signed" || createLink ? (await shareLink(ctx, id, origin)).url : `${origin}/f/contract/preview`;
  const tot = totals(c.data);
  const signed = c.status === "signed";
  return {
    clientId: c.clientId, client, to: c.data.parties.signerEmail, toName: c.data.parties.signerName || c.data.parties.clientName,
    docTitle: `${c.data.title} · ${c.data.parties.clientName}`, docSubtitle: `${money(tot.monthly, c.data.terms.currency)}/month · Ref. ${c.reference}`, link,
    buttonLabel: signed ? "View signed contract" : "Review & sign", subject: signed ? `Your signed agreement – ${c.data.parties.clientName}` : `Your agreement with us – please sign`,
    intro: signed ? `Please find your signed ${c.data.title.toLowerCase()} below. You can download or print it as a PDF from the link at any time.` : `Please find your ${c.data.title.toLowerCase()} below. It covers the services we've agreed, how billing works and our data protection terms.\n\nYou can read and sign it online in a couple of minutes, and a signed copy is emailed to you straight away.`,
  };
}
export async function markSent(ctx: ContractContext, id: string) {
  await db().prepare("UPDATE contracts SET sent_at = ?3, updated_at = ?3 WHERE owner_id = ?1 AND id = ?2").bind(ctx.ownerId, clip(id, 60), nowIso()).run();
}

export async function readSignedHtml(ownerId: string, id: string) {
  const row = await db().prepare("SELECT signed_html_key, signed_html FROM contracts WHERE owner_id = ?1 AND id = ?2 AND status = 'signed'").bind(ownerId, clip(id, 60)).first<Row>();
  if (!row) return null;
  if (row.signed_html) return String(row.signed_html);
  const b = bucket();
  return row.signed_html_key && b ? (await (await b.get(row.signed_html_key))?.text()) || null : null;
}

export function contractPage(title: string, body: string, extra = "") {
  return `<!doctype html><html lang="en-IE"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${title.replace(/[<>&"]/g, "")}</title>
<link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&display=swap" rel="stylesheet"><style>body{margin:0;background:#0d0f14;padding:28px 14px 60px;font-family:Poppins,system-ui,sans-serif}${CONTRACT_CSS}${extra}</style></head><body>${body}</body></html>`;
}

/** The OS preview (and the frozen signed copy) of a contract. */
export async function contractHtml(ctx: ContractContext, id: string, origin: string) {
  const c = await getContract(ctx, id);
  if (c.status === "signed") { const html = await readSignedHtml(ctx.ownerId, c.id); if (html) return html; }
  const client = ctx.clients.find((x) => x.id === c.clientId);
  return contractPage(c.data.title, renderContractBody(c.data, { reference: c.reference, agencySignedAt: c.sentAt || undefined, agencyLogo: `${origin}/f2b-login-logo.png`, clientLogo: client?.logo && /^https:\/\//.test(client.logo) ? client.logo : "" }));
}

// ============================ public (signing) ============================
export async function getByToken(t: string) {
  if (!/^[a-f0-9]{44}$/.test(t)) return null;
  await ensureContractSchema();
  const row = await db().prepare("SELECT * FROM contracts WHERE share_token = ?1 AND status != 'void'").bind(t).first<Row>();
  return row ? { record: fromRow(row), ownerId: String(row.owner_id) } : null;
}
export async function markViewed(ownerId: string, id: string) {
  await db().prepare("UPDATE contracts SET viewed_at = COALESCE(viewed_at, ?3), status = CASE WHEN status = 'sent' THEN 'viewed' ELSE status END WHERE owner_id = ?1 AND id = ?2").bind(ownerId, id, nowIso()).run();
}
async function workspaceRow() {
  const row = await db().prepare("SELECT data FROM workspace_documents WHERE id = 'f2b-agency'").first<{ data: string }>();
  return parse<Row>(row?.data, {});
}

/** Records the signature, freezes the signed HTML and emails both sides a copy. */
export async function signByToken(t: string, input: { name?: unknown; image?: unknown; agree?: unknown }, meta: { ip: string; country: string; userAgent: string; origin: string }) {
  const found = await getByToken(t);
  if (!found) throw new ContractError("This contract link is no longer available.", 404);
  const { record: c, ownerId } = found;
  if (c.status === "signed") return { already: true, record: c };
  const name = clip(input.name, 120).replace(/[\u0000-\u001f]/g, "");
  const image = cleanSignatureImage(input.image);
  if (name.length < 2) throw new ContractError("Type your full name.");
  if (!image) throw new ContractError("Draw your signature in the box.");
  if (input.agree !== true && input.agree !== "on" && input.agree !== "1") throw new ContractError("Tick the box to confirm you agree to the terms.");
  const signedAt = nowIso();
  const hash = await sha256Hex(canonicalText(c.data));
  const signature: ContractSignature = { name, image, signedAt, ip: clip(meta.ip, 64), country: clip(meta.country, 4), userAgent: clip(meta.userAgent, 300), hash };
  const ws = await workspaceRow();
  const client = ((ws.clients || []) as Client[]).find((x) => x.id === c.clientId);
  const html = contractPage(`${c.data.title} (signed)`, renderContractBody(c.data, { signature, reference: c.reference, agencySignedAt: c.sentAt || undefined, agencyLogo: `${meta.origin}/f2b-login-logo.png`, clientLogo: client?.logo && /^https:\/\//.test(client.logo) ? client.logo : "" }));
  const b = bucket();
  const key = b ? `contracts/${ownerId}/${c.clientId}/${c.id}-signed.html` : "";
  if (b) await b.put(key, html, { httpMetadata: { contentType: "text/html; charset=utf-8", cacheControl: "private, no-store" } });
  const res = await db().prepare("UPDATE contracts SET status = 'signed', signed_at = ?3, signature = ?4, signed_html_key = ?5, signed_html = ?6, updated_at = ?3 WHERE owner_id = ?1 AND id = ?2 AND status != 'signed' AND status != 'void'")
    .bind(ownerId, c.id, signedAt, JSON.stringify(signature), key, b ? null : html).run();
  if (!res.meta?.changes) return { already: true, record: c };
  // Copies to the signer and the agency (best effort — the signature is already saved).
  try {
    const brand = agencyBrand(ws, meta.origin, await savedCompanyEmail(db(), ownerId).catch(() => ""));
    const link = `${meta.origin}/f/contract/${t}`;
    const to = emailList(c.data.parties.signerEmail), cc = emailList(brand.email || c.data.parties.providerEmail);
    const message = `Hi ${name.split(/\s+/)[0]},\n\nThanks for signing your ${c.data.title.toLowerCase()} with ${brand.name}. Your signed copy is available at the link below — you can download or print it as a PDF at any time.\n\nWe'll be in touch about next steps.\n\nKind regards,\n${brand.name}`;
    const mail = renderDocumentEmail({ brand, message, link, buttonLabel: "View signed contract", docTitle: `${c.data.title} · signed`, docSubtitle: `Signed by ${name} · Ref. ${c.reference}` });
    if (to.length || cc.length) await sendDocumentEmail(db(), { ownerId, clientId: c.clientId, brand, to: to.length ? to : cc, cc: to.length ? cc : [], subject: `Signed: ${c.data.title} – ${c.data.parties.clientName}`, html: mail, text: `${message}\n\n${link}`, toName: name, idempotencyKey: `contract-signed/${c.id}` });
  } catch (error) { console.error("contract signed email", error); }
  return { already: false, record: { ...c, status: "signed", signedAt } };
}
