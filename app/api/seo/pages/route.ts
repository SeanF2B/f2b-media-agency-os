import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { autoLinkGoogleProperties } from "@/lib/google-auto-link";
import { isSubAccountRole } from "@/lib/access-permissions";
import { hasGoogleSearchConsoleConnection, readGoogleSearchConsoleRows, type GoogleSearchConsoleRow } from "@/lib/google-search-console-direct";

// SEO → Performance → Pages: every known page of a client's site with its target keywords (saved here,
// per client and page) and organic Google clicks/impressions from Search Console for the chosen period
// vs the previous equal period. Read-only towards Google and the website; only keyword targets are saved.
export const dynamic = "force-dynamic";
const respond = (body: Record<string, unknown>, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
type Client = { id: string; name: string; website?: string; wordpressSiteUrl?: string; googleSearchConsoleAccountId?: string; linkReason?: string };
const TABLE = "CREATE TABLE IF NOT EXISTS seo_page_targets (owner_id TEXT NOT NULL, client_id TEXT NOT NULL, page_key TEXT NOT NULL, url TEXT NOT NULL, primary_kw TEXT NOT NULL DEFAULT '', supporting TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL, PRIMARY KEY (owner_id, client_id, page_key))";
let ready: Promise<unknown> | null = null;

async function context(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return { error: respond({ error: "Sign in first." }, 401) };
  if (!env.DB) return { error: respond({ error: "The workspace database is unavailable." }, 503) };
  const row = await env.DB.prepare("SELECT owner_id, data FROM workspace_documents WHERE id = ?1").bind("f2b-agency").first<{ owner_id: string; data: string }>();
  if (!row) return { error: respond({ error: "The workspace is unavailable." }, 503) };
  const data = JSON.parse(row.data) as { ownerId?: string; staff?: Array<{ id?: string; email?: string; role?: string; staffType?: string; isBot?: boolean }>; clients?: Client[] };
  const owner = data.ownerId === user.userId || row.owner_id === user.userId;
  const me = (data.staff || []).find((item) => !item.isBot && (item.id === user.userId || item.email?.toLowerCase() === user.email.toLowerCase()));
  if (!owner && !me) return { error: respond({ error: "Only workspace members can see SEO pages." }, 403) };
  // Agency-level staff only: sub-account staff can't read or change page keyword targets.
  if (!owner && me && (me.staffType === "subaccount" || isSubAccountRole(me.role))) return { error: respond({ error: "Only agency staff can manage SEO pages." }, 403) };
  const url = new URL(request.url);
  const clientId = url.searchParams.get("clientId") || "";
  let client = (data.clients || []).find((c) => c.id === clientId);
  if (!client) return { error: respond({ error: "Choose a client." }, 404) };
  // Not linked yet: try the automatic Google property match now (throttled), then use the fresh value.
  if (!String(client.googleSearchConsoleAccountId || "").trim()) {
    try {
      const summary = await autoLinkGoogleProperties(env.DB, 10 * 60_000);
      const hit = summary?.linked.find((l) => l.clientId === client!.id && l.searchConsole);
      if (hit) client = { ...client, googleSearchConsoleAccountId: hit.searchConsole };
      else { const why = summary?.stillMissing.find((m) => m.clientId === client!.id)?.reason; if (why) client = { ...client, linkReason: why }; }
    } catch { /* fall through to the normal "not linked" message */ }
  }
  ready ||= env.DB.prepare(TABLE).run().catch((e) => { ready = null; throw e; });
  await ready;
  return { db: env.DB, ownerId: row.owner_id, client, url };
}

/** Page key = lower-case path with a trailing slash ("/", "/roof-repairs/"). */
function pageKey(value: string) {
  try { const u = new URL(/^https?:\/\//i.test(value) ? value : `https://x.invalid${value.startsWith("/") ? "" : "/"}${value}`); let p = decodeURIComponent(u.pathname).toLowerCase().replace(/\/{2,}/g, "/"); if (!p.endsWith("/")) p += "/"; return p; } catch { return "/"; }
}
const iso = (d: Date) => d.toISOString().slice(0, 10);
function windows(start: string, end: string) {
  const valid = (v: string) => /^\d{4}-\d{2}-\d{2}$/.test(v);
  const today = new Date(Date.now() - 2 * 86_400_000); // Search Console lags ~2 days
  const e = valid(end) ? new Date(`${end}T00:00:00Z`) : today;
  const s = valid(start) ? new Date(`${start}T00:00:00Z`) : new Date(e.getTime() - 27 * 86_400_000);
  const days = Math.max(1, Math.round((e.getTime() - s.getTime()) / 86_400_000) + 1);
  const pe = new Date(s.getTime() - 86_400_000), ps = new Date(pe.getTime() - (days - 1) * 86_400_000);
  return { current: { start: iso(s), end: iso(e) }, previous: { start: iso(ps), end: iso(pe) }, days };
}
const siteOrigin = (client: Client, previewUrl?: string) => { const raw = String(client.website || client.wordpressSiteUrl || previewUrl || "").trim(); try { return raw ? new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`).origin : ""; } catch { return ""; } };

async function searchConsole(ownerId: string, client: Client, range: { start: string; end: string }) {
  const property = String(client.googleSearchConsoleAccountId || "").trim();
  if (!property) return { status: "not_mapped" as const, rows: [] as GoogleSearchConsoleRow[], message: client.linkReason || "No Search Console property is linked to this client." };
  if (!(await hasGoogleSearchConsoleConnection(ownerId))) return { status: "missing_connection" as const, rows: [] as GoogleSearchConsoleRow[], message: "Search Console isn’t connected." };
  try { return { status: "connected" as const, rows: await readGoogleSearchConsoleRows(ownerId, property, range.start, range.end), message: "" }; }
  catch (e) { return { status: "unavailable" as const, rows: [] as GoogleSearchConsoleRow[], message: e instanceof Error ? e.message.slice(0, 300) : "Search Console data couldn’t be read." }; }
}

export async function GET(request: Request) {
  const ctx = await context(request); if ("error" in ctx) return ctx.error;
  const { db, ownerId, client, url } = ctx;
  const w = windows(url.searchParams.get("start") || "", url.searchParams.get("end") || "");
  const detail = url.searchParams.get("page");

  if (detail) {
    // Actual Google searches for one page (Search Console queries for that URL).
    const key = pageKey(detail);
    const sc = await searchConsole(ownerId, client, w.current);
    const map = new Map<string, { query: string; clicks: number; impressions: number; posWeighted: number }>();
    for (const row of sc.rows) {
      if (pageKey(row.page) !== key || !row.query) continue;
      const item = map.get(row.query) || { query: row.query, clicks: 0, impressions: 0, posWeighted: 0 };
      item.clicks += row.clicks; item.impressions += row.impressions; item.posWeighted += row.position * row.impressions;
      map.set(row.query, item);
    }
    const queries = [...map.values()].map((q) => ({ query: q.query, clicks: q.clicks, impressions: q.impressions, ctr: q.impressions ? q.clicks / q.impressions : 0, position: q.impressions ? q.posWeighted / q.impressions : null })).sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions).slice(0, 200);
    return respond({ status: sc.status, message: sc.message, period: w.current, queries });
  }

  // Known pages: the website builder's pages (title + focus keyword) for this client.
  const siteRow = await db.prepare("SELECT preview_url FROM site_content_sites WHERE client_id = ?1").bind(client.id).first<{ preview_url: string }>().catch(() => null);
  const origin = siteOrigin(client, siteRow?.preview_url);
  const files = ((await db.prepare("SELECT path, text FROM site_content_files WHERE client_id = ?1 AND path LIKE 'src/content/builder/%.json' AND path <> 'src/content/builder/_config.json' LIMIT 300").bind(client.id).all<{ path: string; text: string | null }>().catch(() => ({ results: [] }))).results || []);
  const pages = new Map<string, { key: string; url: string; title: string; focus: string; known: boolean }>();
  for (const f of files) {
    const slug = f.path.replace(/^src\/content\/builder\//, "").replace(/\.json$/, "");
    let doc: { name?: string; title?: string; seo?: { title?: string; focusKeyword?: string } } = {};
    try { doc = f.text ? JSON.parse(f.text) : {}; } catch { doc = {}; }
    const path = slug === "home" || slug === "index" ? "/" : `/${slug}/`;
    pages.set(pageKey(path), { key: pageKey(path), url: origin ? `${origin}${path}` : path, title: String(doc.seo?.title || doc.title || doc.name || slug).slice(0, 160), focus: String(doc.seo?.focusKeyword || "").slice(0, 120), known: true });
  }
  // Saved keyword targets.
  const targets = new Map(((await db.prepare("SELECT page_key, url, primary_kw, supporting, updated_at FROM seo_page_targets WHERE owner_id = ?1 AND client_id = ?2").bind(ownerId, client.id).all<{ page_key: string; url: string; primary_kw: string; supporting: string; updated_at: string }>()).results || []).map((r) => [r.page_key, r]));
  // Search Console clicks/impressions: this period vs the previous equal period.
  const [cur, prev] = await Promise.all([searchConsole(ownerId, client, w.current), client.googleSearchConsoleAccountId ? searchConsole(ownerId, client, w.previous) : Promise.resolve(null)]);
  const sum = (rows: GoogleSearchConsoleRow[]) => { const m = new Map<string, { url: string; clicks: number; impressions: number }>(); for (const r of rows) { const k = pageKey(r.page); const it = m.get(k) || { url: r.page, clicks: 0, impressions: 0 }; it.clicks += r.clicks; it.impressions += r.impressions; m.set(k, it); } return m; };
  const curMap = sum(cur.rows), prevMap = sum(prev?.rows || []);
  for (const [k, v] of curMap) if (!pages.has(k)) pages.set(k, { key: k, url: v.url, title: "", focus: "", known: false });
  for (const [k, t] of targets) if (!pages.has(k)) pages.set(k, { key: k, url: t.url, title: "", focus: "", known: false });
  const connected = cur.status === "connected";
  const list = [...pages.values()].map((p) => {
    const c = curMap.get(p.key), pv = prevMap.get(p.key), t = targets.get(p.key);
    return { key: p.key, url: p.url, title: p.title || p.key, known: p.known, primary: t?.primary_kw || "", supporting: t?.supporting || "", suggested: !t?.primary_kw && p.focus ? p.focus : "", targetsUpdatedAt: t?.updated_at || "",
      clicks: connected ? c?.clicks ?? 0 : null, impressions: connected ? c?.impressions ?? 0 : null, prevClicks: connected && prev?.status === "connected" ? pv?.clicks ?? 0 : null };
  }).sort((a, b) => (b.clicks ?? -1) - (a.clicks ?? -1) || (b.impressions ?? -1) - (a.impressions ?? -1) || a.key.localeCompare(b.key)).slice(0, 500);
  return respond({ status: cur.status, message: cur.message, period: w.current, previous: w.previous, origin, pages: list });
}

export async function POST(request: Request) {
  const ctx = await context(request); if ("error" in ctx) return ctx.error;
  let body: { url?: string; primary?: string; supporting?: string };
  try { body = await request.json() as typeof body; } catch { return respond({ error: "Send the page and keywords." }, 400); }
  const pageUrl = String(body.url || "").trim().slice(0, 1000);
  if (!pageUrl) return respond({ error: "Choose a page." }, 400);
  const now = new Date().toISOString();
  const primary = String(body.primary || "").replace(/\s+/g, " ").trim().slice(0, 120);
  const supporting = String(body.supporting || "").split(/[\n,]/).map((k) => k.replace(/\s+/g, " ").trim()).filter(Boolean).slice(0, 30).join("\n");
  await ctx.db.prepare("INSERT INTO seo_page_targets (owner_id, client_id, page_key, url, primary_kw, supporting, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7) ON CONFLICT(owner_id, client_id, page_key) DO UPDATE SET url=excluded.url, primary_kw=excluded.primary_kw, supporting=excluded.supporting, updated_at=excluded.updated_at").bind(ctx.ownerId, ctx.client.id, pageKey(pageUrl), pageUrl, primary, supporting, now).run();
  // Keep the SEO plan (Setup → Keyword research) in step: the primary keyword points at this page.
  if (primary) {
    try {
      const row = await ctx.db.prepare("SELECT data FROM setup_drafts WHERE owner_id=?1 AND client_id=?2 AND kind='seo'").bind(ctx.ownerId, ctx.client.id).first<{ data: string }>();
      const draft = row ? JSON.parse(row.data) as { brief?: unknown; steps?: Record<string, { rows: Array<Record<string, string>>; status: string }> } : { brief: {}, steps: {} };
      draft.steps = draft.steps || {};
      const step = draft.steps.keywords || { rows: [], status: "draft" };
      const hit = step.rows.find((r) => String(r.keyword || "").toLowerCase() === primary.toLowerCase());
      if (hit) hit.targetPage = pageUrl;
      else step.rows.push({ id: `r${crypto.randomUUID().slice(0, 8)}`, source: "Page target", topic: "", keyword: primary, location: "", intent: "", targetPage: pageUrl, volume: "" });
      if (step.status === "empty") step.status = "draft";
      draft.steps.keywords = step;
      await ctx.db.prepare("INSERT INTO setup_drafts (owner_id, client_id, kind, data, updated_at) VALUES (?1,?2,'seo',?3,?4) ON CONFLICT(owner_id, client_id, kind) DO UPDATE SET data=excluded.data, updated_at=excluded.updated_at").bind(ctx.ownerId, ctx.client.id, JSON.stringify(draft), now).run();
    } catch { /* the plan table may not exist yet; the page target is saved regardless */ }
  }
  return respond({ ok: true, updatedAt: now, primary, supporting });
}
