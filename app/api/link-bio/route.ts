import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";
import { LINK_BIO_SQL, defaultPage, sanitizePage, type LinkBioClient, type LinkBioPage } from "@/lib/link-bio";

// Operations → Sites → Link in bio. Agency owner/admin only; one page per client, scoped to the workspace owner.
export const dynamic = "force-dynamic";
const reply = (error: string, status = 400) => Response.json({ error }, { status, headers: { "Cache-Control": "no-store" } });

let ready: Promise<unknown> | null = null;
const ensure = (db: D1Database) => (ready ??= db.batch(LINK_BIO_SQL.map((sql) => db.prepare(sql))).catch((error) => { ready = null; throw error; }));

async function context() {
  const user = await getChatGPTUser();
  if (!user) return { response: reply("Sign in before opening Link in bio.", 401) };
  if (!env.DB) return { response: reply("The private workspace database is unavailable.", 503) };
  const row = await env.DB.prepare(`SELECT json_object('ownerId', owner_id,
      'clients', json(COALESCE((SELECT json_group_array(json_object('id', json_extract(value,'$.id'), 'name', json_extract(value,'$.name'), 'logo', json_extract(value,'$.logo'), 'color', json_extract(value,'$.color'), 'brand', json_extract(value,'$.branding.primary'), 'website', COALESCE(json_extract(value,'$.website'), json_extract(value,'$.wordpressSiteUrl'), ''), 'phone', json_extract(value,'$.phone'), 'email', json_extract(value,'$.email'))) FROM json_each(data,'$.clients')), '[]')),
      'staff', json(COALESCE((SELECT json_group_array(json_object('email', json_extract(value,'$.email'), 'role', json_extract(value,'$.role'), 'isBot', json_extract(value,'$.isBot'))) FROM json_each(data,'$.staff')), '[]'))) AS data
    FROM workspace_documents WHERE id = 'f2b-agency'`).first<{ data: string }>();
  if (!row?.data) return { response: reply("The agency workspace could not be found.", 503) };
  const ws = JSON.parse(row.data) as { ownerId?: string; clients?: LinkBioClient[]; staff?: Array<{ email?: string; role?: string; isBot?: boolean }> };
  const admin = ws.ownerId === user.userId || ws.staff?.some((p) => !p.isBot && p.email?.toLowerCase() === user.email.toLowerCase() && ["Owner", "Admin"].includes(p.role || ""));
  if (!admin) return { response: reply("Only an agency owner or admin can manage Link in bio pages.", 403) };
  await ensure(env.DB);
  return { db: env.DB, ownerId: String(ws.ownerId || ""), clients: ws.clients || [], email: user.email };
}

type Row = { client_id: string; slug: string; data: string; published: number; views: number; clicks: string; updated_at: string; updated_by: string };
const parse = <T,>(value: string, fallback: T): T => { try { return JSON.parse(value) as T; } catch { return fallback; } };
const shape = (r: Row) => ({ clientId: r.client_id, slug: r.slug, page: parse<LinkBioPage | null>(r.data, null), published: Boolean(r.published), views: r.views || 0, clicks: parse<Record<string, number>>(r.clicks, {}), updatedAt: r.updated_at, updatedBy: r.updated_by });

export async function GET(request: Request) {
  const ctx = await context();
  if ("response" in ctx) return ctx.response;
  const { db, ownerId, clients } = ctx;
  const origin = new URL(request.url).origin;
  const clientId = new URL(request.url).searchParams.get("clientId") || "";
  if (clientId) {
    const client = clients.find((c) => c.id === clientId);
    if (!client) return reply("That client could not be found.", 404);
    const r = await db.prepare("SELECT client_id, slug, data, published, views, clicks, updated_at, updated_by FROM link_bio_pages WHERE owner_id=?1 AND client_id=?2").bind(ownerId, clientId).first<Row>();
    return Response.json({ origin, saved: r ? shape(r) : null, starter: defaultPage(client) }, { headers: { "Cache-Control": "no-store" } });
  }
  const rows = await db.prepare("SELECT client_id, slug, data, published, views, clicks, updated_at, updated_by FROM link_bio_pages WHERE owner_id=?1 LIMIT 300").bind(ownerId).all<Row>();
  return Response.json({ origin, pages: (rows.results || []).map((r) => { const s = shape(r); return { clientId: s.clientId, slug: s.slug, published: s.published, views: s.views, clicks: Object.values(s.clicks).reduce((a, b) => a + (Number(b) || 0), 0), links: s.page?.links.filter((l) => l.enabled).length || 0, updatedAt: s.updatedAt }; }) }, { headers: { "Cache-Control": "no-store" } });
}

/** Save (and optionally publish/unpublish) a client's page. */
export async function PUT(request: Request) {
  const ctx = await context();
  if ("response" in ctx) return ctx.response;
  const { db, ownerId, clients, email } = ctx;
  const body = await request.json().catch(() => null) as { clientId?: string; page?: unknown; published?: boolean } | null;
  const client = clients.find((c) => c.id === body?.clientId);
  if (!client) return reply("Pick a client first.", 404);
  let page: LinkBioPage;
  try { page = sanitizePage(body?.page, client); } catch (reason) { return reply(reason instanceof Error ? reason.message : "This page couldn’t be saved."); }
  const taken = await db.prepare("SELECT owner_id, client_id FROM link_bio_pages WHERE slug=?1").bind(page.slug).first<{ owner_id: string; client_id: string }>();
  if (taken && !(taken.owner_id === ownerId && taken.client_id === client.id)) return reply(`The link name “${page.slug}” is already used. Try another.`, 409);
  const now = new Date().toISOString();
  await db.prepare(`INSERT INTO link_bio_pages (id, owner_id, client_id, slug, data, published, updated_at, updated_by) VALUES (?1,?2,?3,?4,?5,?6,?7,?8)
    ON CONFLICT(owner_id, client_id) DO UPDATE SET slug=excluded.slug, data=excluded.data, published=excluded.published, updated_at=excluded.updated_at, updated_by=excluded.updated_by`)
    .bind(crypto.randomUUID(), ownerId, client.id, page.slug, JSON.stringify(page), body?.published ? 1 : 0, now, email).run();
  const r = await db.prepare("SELECT client_id, slug, data, published, views, clicks, updated_at, updated_by FROM link_bio_pages WHERE owner_id=?1 AND client_id=?2").bind(ownerId, client.id).first<Row>();
  return Response.json({ saved: r ? shape(r) : null }, { headers: { "Cache-Control": "no-store" } });
}

export async function DELETE(request: Request) {
  const ctx = await context();
  if ("response" in ctx) return ctx.response;
  const clientId = new URL(request.url).searchParams.get("clientId") || "";
  if (!clientId) return reply("Pick a client first.");
  await ctx.db.prepare("DELETE FROM link_bio_pages WHERE owner_id=?1 AND client_id=?2").bind(ctx.ownerId, clientId).run();
  return Response.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
}
