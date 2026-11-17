import { env } from "cloudflare:workers";
import { inflateSync } from "fflate";
import { fullTeamPermissions, getTeamPermissions, type TeamPermissions } from "@/lib/access-permissions";
import { aiConfigured, aiEndpoint, aiHeaders, aiModel, resolveAiProvider } from "@/lib/ai-provider";
import { listClientReports, readClientReportHtml } from "@/lib/client-report-archive";
import * as E from "@/lib/onboarding/engine.mjs";
import { extractWebsiteCached, sourceTextOf } from "@/lib/onboarding/server";
import { outputText, rawHtml, safeHttps, siteSignals } from "@/lib/onboarding/extract";
import { mergeCatalogue, type CatalogueService } from "./catalogue";
import { AI_COPY_INSTRUCTIONS, AI_COPY_SCHEMA, buildDeck, sanitizeDeck, type AiCopy, type ProposalBrand, type ProposalDeck, type ProposalInputs, type ProposalSource, type ProposalUpload, type SelectedService, type Slide } from "./deck";

// Proposal Studio — server side. One table of proposals per agency, reusing the onboarding engine's cached
// website extraction and upload checks, the client report archive, the CRM, the configured AI provider
// (OpenRouter/OpenAI) and R2 for screenshots and uploads. Lives under Operations → Reports → Proposals.

type Row = Record<string, any>;
export class ProposalError extends Error { constructor(message: string, readonly status = 400) { super(message); } }
const nowIso = () => new Date().toISOString();
const uid = (prefix: string) => `${prefix}_${crypto.randomUUID().replace(/-/g, "").slice(0, 18)}`;
const parse = <T,>(value: unknown, fallback: T): T => { try { return value ? JSON.parse(String(value)) as T : fallback; } catch { return fallback; } };
const clip = (value: unknown, n: number) => String(value ?? "").trim().slice(0, n);

function db(): D1Database {
  if (!env.DB) throw new ProposalError("The workspace database is unavailable.", 503);
  return env.DB;
}
function bucket(): R2Bucket | null { return (env as unknown as { BUCKET?: R2Bucket }).BUCKET || null; }

export const PROPOSALS_SCHEMA_SQL = `CREATE TABLE IF NOT EXISTS proposals (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  client_id TEXT,
  contact_id TEXT,
  business_name TEXT NOT NULL DEFAULT '',
  website TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  brand TEXT NOT NULL DEFAULT '{}',
  inputs TEXT NOT NULL DEFAULT '{}',
  services TEXT NOT NULL DEFAULT '[]',
  deck TEXT NOT NULL DEFAULT '',
  uploads TEXT NOT NULL DEFAULT '[]',
  share_token TEXT,
  view_count INTEGER NOT NULL DEFAULT 0,
  viewed_at TEXT,
  approved_at TEXT,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS proposals_owner_updated_idx ON proposals(owner_id, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS proposals_share_token_idx ON proposals(share_token);
CREATE TABLE IF NOT EXISTS proposal_settings (
  owner_id TEXT PRIMARY KEY NOT NULL,
  catalogue TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL
)`;
let schemaReady: Promise<void> | null = null;
export function ensureProposalSchema() {
  if (!schemaReady) {
    const database = db();
    schemaReady = database.batch(PROPOSALS_SCHEMA_SQL.split(/;\s*\n/).map((sql) => sql.trim()).filter(Boolean).map((sql) => database.prepare(sql))).then(() => undefined).catch((error) => { schemaReady = null; throw error; });
  }
  return schemaReady;
}

// ============================ access ============================
type Staff = { id: string; email: string; role: string; isBot?: boolean; permissions?: Partial<TeamPermissions>; clientAccessIds?: string[]; limitClientAccess?: boolean; name?: string };
export type ProposalContext = { ownerId: string; workspace: Row; userEmail: string; userName: string; admin: boolean; allowedClient: (id: string) => boolean };
export async function proposalContext(user: { userId: string; email: string }): Promise<ProposalContext> {
  const row = await db().prepare("SELECT owner_id, data FROM workspace_documents WHERE id = 'f2b-agency'").first<{ owner_id: string; data: string }>();
  if (!row?.data) throw new ProposalError("The workspace is unavailable.", 503);
  const workspace = parse<Row>(row.data, {});
  const ownerId = String(workspace.ownerId || row.owner_id || "");
  const owner = workspace.ownerId === user.userId || row.owner_id === user.userId;
  const staff = ((workspace.staff || []) as Staff[]).find((item) => !item.isBot && (item.id === user.userId || item.email?.toLowerCase() === user.email.toLowerCase()));
  const admin = owner || ["Owner", "Admin"].includes(staff?.role || "");
  const permissions = owner ? fullTeamPermissions : getTeamPermissions(staff?.role || "Viewer", staff?.permissions);
  if (!admin && !permissions.reports) throw new ProposalError("You don't have permission to use proposals.", 403);
  if (!admin && (staff as Row)?.staffType === "subaccount") throw new ProposalError("Proposals are available in the agency view only.", 403);
  const allowedClient = (id: string) => admin || !staff?.limitClientAccess || (staff.clientAccessIds || []).includes(id);
  await ensureProposalSchema();
  return { ownerId, workspace, userEmail: user.email, userName: staff?.name || user.email, admin, allowedClient };
}

// ============================ catalogue ============================
export async function getCatalogue(ownerId: string): Promise<CatalogueService[]> {
  const row = await db().prepare("SELECT catalogue FROM proposal_settings WHERE owner_id = ?1").bind(ownerId).first<Row>();
  return mergeCatalogue(parse(row?.catalogue, []));
}
export async function saveCatalogue(ownerId: string, items: Partial<CatalogueService>[]) {
  const merged = mergeCatalogue(items);
  await db().prepare("INSERT INTO proposal_settings (owner_id, catalogue, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(owner_id) DO UPDATE SET catalogue = ?2, updated_at = ?3")
    .bind(ownerId, JSON.stringify(merged).slice(0, 60_000), nowIso()).run();
  return merged;
}

// ============================ records ============================
export type ProposalRecord = {
  id: string; clientId: string | null; contactId: string | null; businessName: string; website: string; title: string; status: string;
  brand: ProposalBrand; inputs: ProposalInputs; services: SelectedService[]; deck: ProposalDeck | null; uploads: ProposalUpload[];
  shareToken: string | null; viewCount: number; viewedAt: string | null; approvedAt: string | null; createdBy: string; createdAt: string; updatedAt: string;
};
export const emptyBrand = (name = "", website = ""): ProposalBrand => ({ businessName: name, website, logo: "", colours: [], description: "", services: "", areas: "", audience: "", screenshotDesktop: "", screenshotMobile: "", images: [] });
export const emptyInputs = (currency = "EUR"): ProposalInputs => ({ goal: "", audience: "", discoveryNotes: "", requirements: "", instructions: "", startMonth: "", currency, terms: "", sources: [] });
function fromRow(row: Row): ProposalRecord {
  return {
    id: row.id, clientId: row.client_id || null, contactId: row.contact_id || null, businessName: row.business_name, website: row.website, title: row.title, status: row.status,
    brand: { ...emptyBrand(), ...parse<Partial<ProposalBrand>>(row.brand, {}) }, inputs: { ...emptyInputs(), ...parse<Partial<ProposalInputs>>(row.inputs, {}) },
    services: parse<SelectedService[]>(row.services, []), deck: sanitizeDeck(parse(row.deck, null)), uploads: parse<ProposalUpload[]>(row.uploads, []),
    shareToken: row.share_token || null, viewCount: Number(row.view_count || 0), viewedAt: row.viewed_at || null, approvedAt: row.approved_at || null, createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at,
  };
}
export async function listProposals(ownerId: string) {
  const rows = await db().prepare("SELECT id, client_id, contact_id, business_name, website, title, status, json_extract(brand, '$.logo') AS logo, view_count, viewed_at, approved_at, share_token IS NOT NULL AS shared, created_by, created_at, updated_at FROM proposals WHERE owner_id = ?1 ORDER BY updated_at DESC LIMIT 100").bind(ownerId).all<Row>();
  return (rows.results || []).map((row) => ({ id: row.id, clientId: row.client_id, contactId: row.contact_id, businessName: row.business_name, website: row.website, title: row.title, status: row.status, logo: String(row.logo || "").startsWith("r2:") ? "" : row.logo || "", viewCount: Number(row.view_count || 0), viewedAt: row.viewed_at, approvedAt: row.approved_at, shared: Boolean(row.shared), createdBy: row.created_by, createdAt: row.created_at, updatedAt: row.updated_at }));
}
export async function getProposal(ownerId: string, id: string) {
  const row = await db().prepare("SELECT * FROM proposals WHERE owner_id = ?1 AND id = ?2").bind(ownerId, clip(id, 40)).first<Row>();
  if (!row) throw new ProposalError("That proposal could not be found.", 404);
  return fromRow(row);
}
export async function getProposalByToken(token: string) {
  if (!/^[A-Za-z0-9_-]{20,64}$/.test(token)) return null;
  await ensureProposalSchema();
  const row = await db().prepare("SELECT * FROM proposals WHERE share_token = ?1").bind(token).first<Row>();
  return row ? { ...fromRow(row), ownerId: String(row.owner_id) } : null;
}

const STATUSES = new Set(["draft", "ready", "sent", "viewed", "approved", "declined"]);
function cleanBrand(input: Partial<ProposalBrand> | undefined, base: ProposalBrand): ProposalBrand {
  const src = { ...base, ...(input || {}) };
  const asset = (value: unknown) => { const v = String(value || ""); return /^r2:[\w.-]{1,120}$/.test(v) || /^https:\/\/[^\s"'<>]{4,1500}$/.test(v) ? v : ""; };
  return {
    businessName: clip(src.businessName, 120), website: clip(src.website, 300), logo: asset(src.logo),
    colours: (Array.isArray(src.colours) ? src.colours : []).map(String).filter((c) => /^#[0-9a-f]{6}$/i.test(c)).slice(0, 6),
    description: clip(src.description, 1200), services: clip(src.services, 600), areas: clip(src.areas, 300), audience: clip(src.audience, 400),
    screenshotDesktop: asset(src.screenshotDesktop), screenshotMobile: asset(src.screenshotMobile), images: (Array.isArray(src.images) ? src.images : []).map(asset).filter(Boolean).slice(0, 24),
  };
}
function cleanInputs(input: Partial<ProposalInputs> | undefined, base: ProposalInputs): ProposalInputs {
  const src = { ...base, ...(input || {}) };
  return {
    goal: clip(src.goal, 1500), audience: clip(src.audience, 600), discoveryNotes: clip(src.discoveryNotes, 8000), requirements: clip(src.requirements, 4000), instructions: clip(src.instructions, 3000),
    startMonth: /^\d{4}-\d{2}$/.test(String(src.startMonth || "")) ? String(src.startMonth) : "", currency: ["EUR", "GBP", "USD"].includes(String(src.currency)) ? String(src.currency) : "EUR", terms: clip(src.terms, 600),
    sources: (Array.isArray(src.sources) ? src.sources : []).slice(0, 12).map((item: ProposalSource) => ({ id: clip(item.id, 80), label: clip(item.label, 160), kind: (["audit", "report", "notes", "crm", "upload"].includes(item.kind) ? item.kind : "notes") as ProposalSource["kind"], text: clip(item.text, 6000) })).filter((item) => item.text),
  };
}
function cleanServices(input: unknown, catalogue: CatalogueService[]): SelectedService[] {
  const keys = new Map(catalogue.map((item) => [item.key, item]));
  const seen = new Set<string>();
  return (Array.isArray(input) ? input : []).map((raw: Row) => {
    const def = keys.get(String(raw?.key || ""));
    if (!def || seen.has(def.key)) return null;
    seen.add(def.key);
    const num = (value: unknown, fallback: number) => Number.isFinite(Number(value)) && value !== "" && value !== null ? Math.max(0, Math.round(Number(value))) : fallback;
    return { key: def.key, setupFee: num(raw.setupFee, def.setupFee), monthlyFee: num(raw.monthlyFee, def.monthlyFee), addon: typeof raw.addon === "boolean" ? raw.addon : Boolean(def.addon) };
  }).filter((item): item is SelectedService => Boolean(item)).slice(0, 20);
}

export async function createProposal(ctx: ProposalContext, input: { clientId?: string; contactId?: string; businessName?: string; website?: string }) {
  const clients = (ctx.workspace.clients || []) as Row[];
  const client = input.clientId ? clients.find((item) => item.id === input.clientId) : null;
  if (input.clientId && (!client || !ctx.allowedClient(client.id))) throw new ProposalError("Choose a client you have access to.", 403);
  let name = clip(input.businessName || client?.name || "", 120), website = clip(input.website || client?.codexUrl || client?.website || "", 300), contactId: string | null = null;
  let notes = "";
  if (input.contactId) {
    const contact = await db().prepare("SELECT id, first_name, last_name, email, company, notes FROM crm_contacts WHERE owner_id = ?1 AND id = ?2 AND client_id IS NULL").bind(ctx.ownerId, clip(input.contactId, 60)).first<Row>();
    if (!contact) throw new ProposalError("That prospect could not be found in the agency CRM.", 404);
    contactId = contact.id;
    name = name || clip(contact.company || `${contact.first_name} ${contact.last_name}`, 120);
    if (!website && contact.email && !/@(gmail|yahoo|hotmail|outlook|icloud|live|eircom|aol|proton)\./i.test(contact.email)) website = `https://${String(contact.email).split("@")[1]}`;
    notes = clip(contact.notes, 4000);
  }
  if (!name) throw new ProposalError("Choose a client or prospect, or enter the business name.");
  const brand = emptyBrand(name, website ? (safeHttps(website)?.toString() || "") : "");
  if (client?.logo && /^https:\/\//.test(client.logo)) brand.logo = client.logo;
  if (client) brand.services = ((client.services || []) as Row[]).map((s) => s.name).filter(Boolean).join(", ");
  const inputs = emptyInputs(client?.currency || ctx.workspace.settings?.currency || "EUR");
  if (notes) inputs.discoveryNotes = notes;
  const next = new Date(); next.setMonth(next.getMonth() + 1);
  inputs.startMonth = `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, "0")}`;
  const id = uid("prop");
  const now = nowIso();
  await db().prepare("INSERT INTO proposals (id, owner_id, client_id, contact_id, business_name, website, title, status, brand, inputs, services, deck, uploads, created_by, created_at, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,'draft',?8,?9,'[]','','[]',?10,?11,?11)")
    .bind(id, ctx.ownerId, client?.id || null, contactId, name, brand.website, `${name} — Proposal`, JSON.stringify(brand), JSON.stringify(inputs), ctx.userName, now).run();
  return getProposal(ctx.ownerId, id);
}

export async function updateProposal(ctx: ProposalContext, id: string, patch: Row) {
  const current = await getProposal(ctx.ownerId, id);
  const catalogue = await getCatalogue(ctx.ownerId);
  const brand = patch.brand ? cleanBrand(patch.brand, current.brand) : current.brand;
  const inputs = patch.inputs ? cleanInputs(patch.inputs, current.inputs) : current.inputs;
  const services = patch.services ? cleanServices(patch.services, catalogue) : current.services;
  const deck = patch.deck !== undefined ? (patch.deck === null ? null : sanitizeDeck(patch.deck)) : current.deck;
  const status = patch.status && STATUSES.has(String(patch.status)) ? String(patch.status) : current.status;
  const title = patch.title !== undefined ? clip(patch.title, 160) || current.title : current.title;
  await db().prepare("UPDATE proposals SET business_name = ?3, website = ?4, title = ?5, status = ?6, brand = ?7, inputs = ?8, services = ?9, deck = ?10, approved_at = CASE WHEN ?6 = 'approved' AND approved_at IS NULL THEN ?11 ELSE approved_at END, updated_at = ?11 WHERE owner_id = ?1 AND id = ?2")
    .bind(ctx.ownerId, current.id, brand.businessName || current.businessName, brand.website, title, status, JSON.stringify(brand), JSON.stringify(inputs), JSON.stringify(services), deck ? JSON.stringify(deck).slice(0, 400_000) : "", nowIso()).run();
  return getProposal(ctx.ownerId, current.id);
}
export async function deleteProposal(ctx: ProposalContext, id: string) {
  const current = await getProposal(ctx.ownerId, id);
  const store = bucket();
  if (store) { const listed = await store.list({ prefix: `proposals/${ctx.ownerId}/${current.id}/`, limit: 200 }); if (listed.objects.length) await store.delete(listed.objects.map((item) => item.key)); }
  await db().prepare("DELETE FROM proposals WHERE owner_id = ?1 AND id = ?2").bind(ctx.ownerId, current.id).run();
}
export async function duplicateProposal(ctx: ProposalContext, id: string) {
  const current = await getProposal(ctx.ownerId, id);
  const newId = uid("prop"), now = nowIso();
  await db().prepare("INSERT INTO proposals (id, owner_id, client_id, contact_id, business_name, website, title, status, brand, inputs, services, deck, uploads, created_by, created_at, updated_at) SELECT ?3, owner_id, client_id, contact_id, business_name, website, title || ' (copy)', 'draft', brand, inputs, services, deck, '[]', ?4, ?5, ?5 FROM proposals WHERE owner_id = ?1 AND id = ?2")
    .bind(ctx.ownerId, current.id, newId, ctx.userName, now).run();
  return getProposal(ctx.ownerId, newId);
}
export async function shareProposal(ctx: ProposalContext, id: string, enable: boolean) {
  const current = await getProposal(ctx.ownerId, id);
  const token = enable ? current.shareToken || `${crypto.randomUUID().replace(/-/g, "")}${crypto.randomUUID().replace(/-/g, "").slice(0, 8)}` : null;
  await db().prepare("UPDATE proposals SET share_token = ?3, status = CASE WHEN ?3 IS NOT NULL AND status IN ('draft','ready') THEN 'sent' ELSE status END, updated_at = ?4 WHERE owner_id = ?1 AND id = ?2").bind(ctx.ownerId, current.id, token, nowIso()).run();
  return getProposal(ctx.ownerId, current.id);
}
/** Public share page view counter (one small write per view). */
export async function recordView(id: string, ownerId: string) {
  await db().prepare("UPDATE proposals SET view_count = view_count + 1, viewed_at = ?3, status = CASE WHEN status = 'sent' THEN 'viewed' ELSE status END WHERE owner_id = ?1 AND id = ?2").bind(ownerId, id, nowIso()).run().catch(() => undefined);
}
export async function approveByToken(token: string) {
  const found = await getProposalByToken(token);
  if (!found) return null;
  await db().prepare("UPDATE proposals SET status = 'approved', approved_at = COALESCE(approved_at, ?2), updated_at = ?2 WHERE id = ?1").bind(found.id, nowIso()).run();
  return found;
}

// ============================ assets (R2) ============================
const ASSET_NAME = /^[\w.-]{1,120}$/;
export async function readAsset(ownerId: string, proposalId: string, name: string) {
  const store = bucket();
  if (!store || !ASSET_NAME.test(name) || !/^prop_[a-z0-9]{6,30}$/.test(proposalId)) return null;
  return store.get(`proposals/${ownerId}/${proposalId}/${name}`);
}
async function putAsset(ownerId: string, proposalId: string, name: string, bytes: ArrayBuffer | Uint8Array, contentType: string) {
  const store = bucket();
  if (!store) throw new ProposalError("File storage is unavailable right now.", 503);
  await store.put(`proposals/${ownerId}/${proposalId}/${name}`, bytes, { httpMetadata: { contentType, cacheControl: "private, max-age=86400" } });
  return `r2:${name}`;
}

/** Real screenshot of the live site (desktop or phone viewport) via the WordPress.com mShots renderer, cached in R2. */
async function captureScreenshot(ownerId: string, proposalId: string, website: string, mobile: boolean) {
  const url = safeHttps(website);
  if (!url) return "";
  const shotUrl = `https://s.wordpress.com/mshots/v1/${encodeURIComponent(url.toString())}?${mobile ? "vpw=390&vph=844&w=390&h=844" : "vpw=1440&vph=900&w=1440&h=900"}`;
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const response = await fetch(shotUrl, { signal: AbortSignal.timeout(10_000), headers: { "User-Agent": "F2B-AgencyOS-Proposals/1.0" } });
      const type = response.headers.get("content-type") || "";
      if (response.ok && /image\/(jpeg|png|webp)/.test(type)) {
        const bytes = await response.arrayBuffer();
        if (bytes.byteLength > 6_000 && bytes.byteLength < 6_000_000) return putAsset(ownerId, proposalId, `screenshot-${mobile ? "mobile" : "desktop"}-${Date.now().toString(36)}.jpg`, bytes, type.split(";")[0]);
      }
    } catch { /* retry below */ }
    await new Promise((resolve) => setTimeout(resolve, 2_500));
  }
  return "";
}
/** Photo URLs from the home page (og:image, large <img>/srcset), skipping icons, logos, tracking pixels and SVGs. */
function collectImages(html: string, base: URL) {
  const abs = (value: string) => { try { const u = new URL(value.trim().split(/\s+/)[0], base); return u.protocol === "https:" ? u.toString() : ""; } catch { return ""; } };
  const found: string[] = [];
  const og = html.match(/<meta[^>]+property=["']og:image["'][^>]*content=["']([^"']+)["']/i)?.[1];
  if (og) found.push(abs(og));
  for (const match of html.matchAll(/<img\b[^>]*>/gi)) {
    const tag = match[0];
    if (/logo|icon|avatar|sprite|pixel|badge|emoji|spinner|loader/i.test(tag)) continue;
    const srcset = tag.match(/\s(?:data-)?srcset=["']([^"']+)["']/i)?.[1];
    const best = srcset ? srcset.split(",").map((part) => part.trim()).sort((a, b) => (parseInt(b.split(/\s+/)[1] || "0", 10) || 0) - (parseInt(a.split(/\s+/)[1] || "0", 10) || 0))[0] : "";
    const src = best || tag.match(/\s(?:data-src|data-lazy-src|src)=["']([^"']+)["']/i)?.[1] || "";
    const width = Number(tag.match(/\swidth=["']?(\d+)/i)?.[1] || 0);
    if (width && width < 240) continue;
    if (src && !/\.svg(\?|$)|^data:|\.gif(\?|$)/i.test(src)) found.push(abs(src));
  }
  for (const match of html.matchAll(/background-image:\s*url\(["']?([^"')]+)["']?\)/gi)) if (!/\.svg/i.test(match[1])) found.push(abs(match[1]));
  return [...new Set(found.filter(Boolean))].slice(0, 16);
}

/** Pulls the business's website: profile text (cached AI extraction), logo, colours, photos and live screenshots. */
export async function extractForProposal(ctx: ProposalContext, id: string, website?: string) {
  const current = await getProposal(ctx.ownerId, id);
  const target = safeHttps(website || current.brand.website || current.website);
  if (!target) throw new ProposalError("Enter the business's website address first.");
  const [profileResult, html] = await Promise.all([
    extractWebsiteCached(ctx.ownerId, target.toString(), current.businessName).catch((error) => ({ error: error instanceof Error ? error.message : "Couldn't read the website." })),
    rawHtml(target).catch(() => ""),
  ]);
  if (!html && "error" in profileResult) throw new ProposalError(profileResult.error, 422);
  const signals = html ? siteSignals(html, target) : null;
  const profile = "profile" in profileResult ? profileResult.profile as Row : {};
  const value = (key: string) => String(profile?.[key]?.value || "").trim();
  const [desktop, mobile] = await Promise.all([captureScreenshot(ctx.ownerId, current.id, target.toString(), false), captureScreenshot(ctx.ownerId, current.id, target.toString(), true)]);
  const images = html ? collectImages(html, target) : [];
  const brand: ProposalBrand = {
    ...current.brand,
    businessName: current.brand.businessName || value("businessName") || current.businessName,
    website: target.toString(),
    logo: current.brand.logo || value("logo") || (signals?.logo && /^https:\/\//.test(signals.logo) ? signals.logo : ""),
    colours: [value("primaryColour"), value("secondaryColour"), ...(signals?.topColours || [])].filter((c) => /^#[0-9a-f]{6}$/i.test(c)).filter((c, i, all) => all.indexOf(c) === i).slice(0, 6),
    description: value("description") || current.brand.description,
    services: value("services") || current.brand.services,
    areas: value("serviceAreas") || current.brand.areas,
    audience: value("targetCustomers") || current.brand.audience,
    screenshotDesktop: desktop || current.brand.screenshotDesktop,
    screenshotMobile: mobile || current.brand.screenshotMobile,
    images: [...new Set([...current.brand.images.filter((src) => src.startsWith("r2:upload")), ...images])].slice(0, 24),
  };
  const siteText = sourceTextOf(profile as never);
  const inputs = { ...current.inputs };
  if (siteText && !inputs.sources.some((source) => source.id === "website")) inputs.sources = [{ id: "website", label: `Website text · ${target.hostname}`, kind: "notes" as const, text: siteText.slice(0, 6000) }, ...inputs.sources].slice(0, 12);
  if (!inputs.audience && brand.audience) inputs.audience = brand.audience;
  const updated = await updateProposal(ctx, current.id, { brand, inputs });
  return { proposal: updated, found: { pages: Boolean(siteText), images: images.length, screenshots: [desktop, mobile].filter(Boolean).length, logo: Boolean(brand.logo) } };
}

// ============================ imports ============================
export async function listSources(ctx: ProposalContext, proposal: ProposalRecord) {
  const out: Array<{ ref: string; label: string; kind: ProposalSource["kind"]; date: string }> = [];
  if (proposal.clientId && ctx.allowedClient(proposal.clientId)) {
    const reports = await listClientReports(db(), ctx.ownerId, proposal.clientId).catch(() => [] as Row[]);
    for (const item of (reports as Row[]).slice(0, 20)) out.push({ ref: `archive:${item.id}`, label: `${/audit/.test(item.type) ? "Audit" : "Report"} · ${item.type} · ${item.periodStart} – ${item.periodEnd}`, kind: /audit/.test(item.type) ? "audit" : "report", date: item.createdAt });
    for (const run of ((ctx.workspace.auditRuns || []) as Row[]).filter((item) => item.clientId === proposal.clientId).slice(0, 10)) out.push({ ref: `audit:${run.id}`, label: `${run.service} audit · ${run.period}`, kind: "audit", date: run.createdAt });
    if (((ctx.workspace.notes || []) as Row[]).some((note) => note.clientId === proposal.clientId)) out.push({ ref: `notes:${proposal.clientId}`, label: "Client notes", kind: "notes", date: "" });
  }
  if (proposal.contactId) out.push({ ref: `contact:${proposal.contactId}`, label: "CRM notes & activity", kind: "crm", date: "" });
  const domain = E.normaliseDomain(proposal.brand.website || proposal.website);
  if (domain) {
    const audits = await db().prepare("SELECT id, created_at FROM onboarding_audits WHERE owner_id = ?1 AND domain = ?2 AND status = 'done' ORDER BY created_at DESC LIMIT 3").bind(ctx.ownerId, domain).all<Row>().catch(() => ({ results: [] as Row[] }));
    for (const row of audits.results || []) out.push({ ref: `onb:${row.id}`, label: `Website audit · ${domain}`, kind: "audit", date: row.created_at });
  }
  return out;
}
const htmlText = (html: string) => String(E.htmlToText(html) || "").replace(/\s+\n/g, "\n").replace(/[ \t]{2,}/g, " ");
export async function importSource(ctx: ProposalContext, id: string, ref: string) {
  const current = await getProposal(ctx.ownerId, id);
  const [kind, key] = [ref.split(":")[0], ref.slice(ref.indexOf(":") + 1)];
  let source: ProposalSource | null = null;
  if (kind === "archive" && current.clientId) {
    const html = await readClientReportHtml(db(), env.BUCKET as never, ctx.ownerId, clip(key, 80));
    if (html) source = { id: ref, label: "Saved report", kind: "report", text: htmlText(html).slice(0, 6000) };
  } else if (kind === "audit") {
    const run = ((ctx.workspace.auditRuns || []) as Row[]).find((item) => item.id === key && item.clientId === current.clientId);
    if (run) source = { id: ref, label: `${run.service} audit · ${run.period}`, kind: "audit", text: [run.summary, ...Object.entries(run.metrics || {}).filter(([, v]) => v !== null).map(([k, v]) => `${k}: ${v}`), ...((run.findings || []) as Row[]).map((f) => `${f.title || ""}: ${f.detail || f.description || ""}`)].join("\n").slice(0, 6000) };
  } else if (kind === "notes" && key === current.clientId) {
    const notes = ((ctx.workspace.notes || []) as Row[]).filter((note) => note.clientId === key).slice(-20).map((note) => `${String(note.createdAt || "").slice(0, 10)}: ${note.body}`);
    source = { id: ref, label: "Client notes", kind: "notes", text: notes.join("\n").slice(0, 6000) };
  } else if (kind === "contact" && key === current.contactId) {
    const contact = await db().prepare("SELECT notes FROM crm_contacts WHERE owner_id = ?1 AND id = ?2").bind(ctx.ownerId, key).first<Row>();
    const acts = await db().prepare("SELECT activity_type, body, created_at FROM crm_activities WHERE owner_id = ?1 AND contact_id = ?2 ORDER BY created_at DESC LIMIT 15").bind(ctx.ownerId, key).all<Row>().catch(() => ({ results: [] as Row[] }));
    source = { id: ref, label: "CRM notes & activity", kind: "crm", text: [contact?.notes || "", ...(acts.results || []).map((a) => `${String(a.created_at).slice(0, 10)} ${a.activity_type}: ${a.body}`)].join("\n").slice(0, 6000) };
  } else if (kind === "onb") {
    const row = await db().prepare("SELECT domain, result, data FROM onboarding_audits WHERE owner_id = ?1 AND id = ?2").bind(ctx.ownerId, clip(key, 60)).first<Row>();
    if (row) source = { id: ref, label: `Website audit · ${row.domain}`, kind: "audit", text: JSON.stringify(parse(row.result, {})).replace(/[{}"\[\]]/g, " ").replace(/\s{2,}/g, " ").slice(0, 6000) };
  }
  if (!source || !source.text.trim()) throw new ProposalError("That source has no readable content.", 404);
  const inputs = { ...current.inputs, sources: [source, ...current.inputs.sources.filter((item) => item.id !== source!.id)].slice(0, 12) };
  return updateProposal(ctx, current.id, { inputs });
}

export async function uploadFile(ctx: ProposalContext, id: string, file: { name: string; type: string; bytes: Uint8Array }) {
  const current = await getProposal(ctx.ownerId, id);
  if (current.uploads.length >= 30) throw new ProposalError("This proposal has reached its upload limit (30 files).", 413);
  const check = E.validateUpload(file.name, file.type, file.bytes) as { ok: boolean; kind?: string; mime?: string; error?: string };
  if (!check.ok) throw new ProposalError(check.error || "That file type isn't supported.", 415);
  const image = ["png", "jpeg", "jpg", "webp", "svg"].includes(String(check.kind));
  let text = "";
  if (check.kind === "pdf") text = String(E.pdfText(file.bytes, (data: Uint8Array) => inflateSync(data)) || "");
  else if (check.kind === "html") text = htmlText(new TextDecoder().decode(file.bytes));
  else if (check.kind === "text") text = new TextDecoder().decode(file.bytes);
  const uploadId = uid("up").slice(0, 16);
  const ext = (file.name.match(/\.(\w{2,5})$/)?.[1] || check.kind || "bin").toLowerCase();
  const name = `upload-${uploadId}.${ext}`;
  await putAsset(ctx.ownerId, current.id, name, file.bytes, String(check.mime || "application/octet-stream"));
  const upload: ProposalUpload = { id: name, name: clip(file.name, 120), kind: String(check.kind), size: file.bytes.byteLength, image };
  const uploads = [...current.uploads, upload];
  const brand = image ? { ...current.brand, images: [`r2:${name}`, ...current.brand.images].slice(0, 24) } : current.brand;
  const inputs = text.trim() ? { ...current.inputs, sources: [{ id: `upload:${name}`, label: `Document · ${upload.name}`, kind: "upload" as const, text: text.slice(0, 6000) }, ...current.inputs.sources].slice(0, 12) } : current.inputs;
  await db().prepare("UPDATE proposals SET uploads = ?3 WHERE owner_id = ?1 AND id = ?2").bind(ctx.ownerId, current.id, JSON.stringify(uploads)).run();
  return updateProposal(ctx, current.id, { brand, inputs });
}

// ============================ AI ============================
async function aiCall(ownerId: string, body: Row, timeoutMs: number) {
  const provider = await resolveAiProvider(env, ownerId);
  if (!aiConfigured(env, provider)) throw new ProposalError("Connect an AI provider in Settings → API Keys to use AI.", 503);
  const response = await fetch(aiEndpoint(env, "responses", provider)!, {
    method: "POST", headers: aiHeaders(env, provider)!,
    body: JSON.stringify({ model: aiModel(env, undefined, provider), store: false, ...(provider?.name === "OpenRouter" ? { reasoning: { effort: "low" } } : {}), ...body }),
    signal: AbortSignal.timeout(timeoutMs),
  }).catch((error) => { throw new ProposalError(error instanceof Error && error.name === "TimeoutError" ? "The AI took too long. Try again." : "The AI didn't respond. Try again.", 502); });
  const payload = await response.json().catch(() => null) as Row | null;
  if (!response.ok) throw new ProposalError(payload?.error?.message || "The AI didn't respond. Try again.", 502);
  return outputText(payload);
}
function briefFor(proposal: ProposalRecord, catalogue: CatalogueService[]) {
  const defs = new Map(catalogue.map((item) => [item.key, item]));
  return {
    business: { name: proposal.brand.businessName, website: proposal.brand.website, description: proposal.brand.description, services: proposal.brand.services, areas: proposal.brand.areas, audience: proposal.brand.audience },
    goal: proposal.inputs.goal, targetAudience: proposal.inputs.audience, discoveryCallNotes: proposal.inputs.discoveryNotes, clientRequirements: proposal.inputs.requirements, agencyInstructions: proposal.inputs.instructions,
    coreServices: proposal.services.filter((item) => !item.addon).map((item) => ({ key: item.key, name: defs.get(item.key)?.name, catalogueSummary: defs.get(item.key)?.summary, deliverables: defs.get(item.key)?.deliverables })),
    optionalAddons: proposal.services.filter((item) => item.addon).map((item) => defs.get(item.key)?.name),
    importedSources: proposal.inputs.sources.map((source) => ({ label: source.label, kind: source.kind, text: source.text.slice(0, 3500) })),
  };
}
/** Writes the whole deck: AI copy merged onto the deterministic structure (falls back to catalogue copy). */
export async function generateDeck(ctx: ProposalContext, id: string) {
  const current = await getProposal(ctx.ownerId, id);
  if (!current.services.length) throw new ProposalError("Select at least one service first.");
  const catalogue = await getCatalogue(ctx.ownerId);
  let ai: Partial<AiCopy> | null = null, warning = "";
  try {
    const text = await aiCall(ctx.ownerId, { instructions: AI_COPY_INSTRUCTIONS, input: JSON.stringify(briefFor(current, catalogue)).slice(0, 40_000), text: { format: { type: "json_schema", name: "proposal_copy", strict: true, schema: AI_COPY_SCHEMA } }, max_output_tokens: 4000 }, 75_000);
    ai = JSON.parse(text || "{}") as Partial<AiCopy>;
  } catch (error) { warning = `${error instanceof Error ? error.message : "AI copy unavailable."} The proposal was built from your service catalogue instead — edit any text directly.`; }
  const contact = [ctx.workspace.settings?.adminEmail || "hello@f2bmedia.com", "f2bmedia.com"].join(" · ");
  const deck = buildDeck({ brand: current.brand, inputs: current.inputs, services: current.services, catalogue, ai, agencyContact: contact });
  if (current.deck?.accent) deck.accent = current.deck.accent;
  const proposal = await updateProposal(ctx, current.id, { deck, status: current.status === "draft" ? "ready" : current.status });
  return { proposal, warning };
}
const FIELD_HINTS: Record<string, string> = {
  goal: "The proposal's goal statement: 35–55 words on what we'll achieve for them.",
  audience: "Their target audience as a short comma-separated list of 2–5 groups.",
  discoveryNotes: "Tidy bullet-point discovery call notes from what's known (don't invent facts).",
  requirements: "The client's requirements as short bullet points.",
  instructions: "Short instructions for writing this proposal (tone, emphasis, what to highlight).",
  description: "2–3 sentences on what the business does and what makes it different.",
  services: "The business's own services as a comma-separated list.",
  areas: "Towns/counties they serve, comma-separated.",
  terms: "Payment terms in one or two sentences.",
};
/** ✨ AI Suggest for one field (wizard inputs, brand fields or any slide text). */
export async function suggestField(ctx: ProposalContext, id: string, input: { field: string; label?: string; current?: string; slideKind?: string; mode?: string }) {
  const current = await getProposal(ctx.ownerId, id);
  const catalogue = await getCatalogue(ctx.ownerId);
  const mode = ["suggest", "improve", "shorter", "alternatives"].includes(String(input.mode)) ? String(input.mode) : (input.current ? "improve" : "suggest");
  const instructions = [
    "You help an Irish digital marketing agency (F2B Media) write a client proposal. UK/Irish English. Plain, confident, specific; no buzzwords, emojis or exclamation marks.",
    "Use only facts from the brief. Never invent numbers, results, prices or client names.",
    mode === "improve" ? "Improve the current text: clearer and more persuasive, same meaning and similar length." : mode === "shorter" ? "Rewrite the current text much shorter." : mode === "alternatives" ? "Write 3 different alternatives separated by a line containing only ---." : "Write the text for this field.",
    `Field: ${clip(input.label || input.field, 120)}.${FIELD_HINTS[input.field] ? ` ${FIELD_HINTS[input.field]}` : ""}${input.slideKind ? ` It appears on the "${clip(input.slideKind, 30)}" slide; match the length of the current text.` : ""}`,
    "Reply with the text only — no quotes, labels or commentary.",
  ].join("\n");
  const text = await aiCall(ctx.ownerId, { instructions, input: JSON.stringify({ brief: briefFor(current, catalogue), currentText: clip(input.current, 3000) }).slice(0, 30_000), max_output_tokens: mode === "alternatives" ? 900 : 500 }, 30_000);
  const suggestions = String(text || "").split(/\n-{3,}\n/).map((item) => item.trim().replace(/^["“]|["”]$/g, "")).filter(Boolean).slice(0, 3);
  if (!suggestions.length) throw new ProposalError("AI didn't return a suggestion. Try again.", 422);
  return { suggestions };
}
/** Same-shape merge: only replaces strings where the original had strings (keeps structure and ids safe). */
function mergeShape(original: unknown, next: unknown): unknown {
  if (typeof original === "string") return typeof next === "string" && next.trim() ? next.slice(0, 2000) : original;
  if (Array.isArray(original)) {
    if (!Array.isArray(next)) return original;
    const template = original[0];
    return next.slice(0, Math.max(original.length + 3, 3)).map((item, index) => mergeShape(original[index] ?? template, item)).filter((item) => item !== undefined && item !== null);
  }
  if (original && typeof original === "object") {
    if (!next || typeof next !== "object") return original;
    return Object.fromEntries(Object.entries(original as Row).map(([key, value]) => [key, mergeShape(value, (next as Row)[key])]));
  }
  return original;
}
/** Rewrites one slide's text with an instruction ("make it punchier", "focus on kitchens"…). */
export async function rewriteSlide(ctx: ProposalContext, id: string, slideId: string, instruction: string) {
  const current = await getProposal(ctx.ownerId, id);
  const slide = current.deck?.slides.find((item) => item.id === slideId);
  if (!current.deck || !slide) throw new ProposalError("That slide could not be found.", 404);
  const catalogue = await getCatalogue(ctx.ownerId);
  const editable = Object.fromEntries(Object.entries(slide.data).filter(([key]) => !["serviceKey", "images"].includes(key)));
  const text = await aiCall(ctx.ownerId, {
    instructions: `${AI_COPY_INSTRUCTIONS}\nRewrite ONE slide of an existing proposal. Return ONLY a JSON object with exactly the same keys and structure as slideData (same array item shapes; you may add or remove list items). Follow the agency's instruction.`,
    input: JSON.stringify({ instruction: clip(instruction || "Make this slide more specific and persuasive for this business.", 600), slideKind: slide.kind, slideData: editable, brief: briefFor(current, catalogue) }).slice(0, 36_000),
    max_output_tokens: 1500,
  }, 45_000);
  const json = String(text || "").match(/\{[\s\S]*\}/)?.[0];
  let parsed: unknown = null;
  try { parsed = json ? JSON.parse(json) : null; } catch { parsed = null; }
  if (!parsed) throw new ProposalError("AI didn't return a usable slide. Try again.", 422);
  const merged: Slide = { ...slide, data: { ...slide.data, ...(mergeShape(editable, parsed) as Row) } };
  const deck = { ...current.deck, slides: current.deck.slides.map((item) => item.id === slideId ? merged : item) };
  return updateProposal(ctx, current.id, { deck });
}

// ============================ CRM pickers ============================
export async function searchProspects(ctx: ProposalContext, query: string) {
  const q = clip(query, 60).toLowerCase();
  const rows = q
    ? await db().prepare("SELECT id, first_name, last_name, email, company FROM crm_contacts WHERE owner_id = ?1 AND client_id IS NULL AND (lower(company) LIKE ?2 OR lower(first_name || ' ' || last_name) LIKE ?2 OR lower(email) LIKE ?2) ORDER BY updated_at DESC LIMIT 15").bind(ctx.ownerId, `%${q}%`).all<Row>()
    : await db().prepare("SELECT id, first_name, last_name, email, company FROM crm_contacts WHERE owner_id = ?1 AND client_id IS NULL ORDER BY updated_at DESC LIMIT 15").bind(ctx.ownerId).all<Row>();
  return (rows.results || []).map((row) => ({ id: row.id, name: `${row.first_name} ${row.last_name}`.trim(), company: row.company, email: row.email }));
}
