// One-time-token ingest used to copy an existing website's pages into the visual builder as exact, editable pages.
import { env } from "cloudflare:workers";
import { d1Store } from "@/lib/site-content/site-content-core";
import { normalizePage, pathForSlug } from "@/lib/site-content/site-builder-core";

export const dynamic = "force-dynamic";
const CORS = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "content-type", "Access-Control-Allow-Methods": "POST, OPTIONS" };
const out = (obj: unknown, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "content-type": "application/json", ...CORS } });
class Err extends Error { constructor(public status: number, m: string) { super(m); } }
export async function OPTIONS() { return new Response(null, { status: 204, headers: CORS }); }

export async function POST(request: Request) {
  if (!env.DB) return out({ error: "Not available." }, 503);
  let body: any; try { body = JSON.parse(await request.text()); } catch { return out({ error: "Bad request." }, 400); }
  const token = String(body?.token || ""), clientId = String(body?.clientId || ""), slug = String(body?.slug || "");
  if (!/^[A-Za-z0-9]{32,80}$/.test(token) || !/^[\w-]{6,80}$/.test(clientId) || !/^[a-z0-9][a-z0-9-]{0,60}$/.test(slug)) return out({ error: "Bad request." }, 400);
  await env.DB.prepare("CREATE TABLE IF NOT EXISTS site_import_tokens (token TEXT PRIMARY KEY, client_id TEXT NOT NULL, expires_at TEXT NOT NULL)").run();
  const row = await env.DB.prepare("SELECT client_id, expires_at FROM site_import_tokens WHERE token = ?1").bind(token).first<{ client_id: string; expires_at: string }>();
  if (!row || row.client_id !== clientId || row.expires_at < new Date().toISOString()) return out({ error: "This import link has expired." }, 403);
  try {
    if (Array.isArray(body.patches)) {
      const store0 = d1Store(env.DB, env.BUCKET, clientId);
      const cur = await store0.read(pathForSlug(slug));
      if (!cur?.text) return out({ error: "Page not found." }, 404);
      const pg = JSON.parse(cur.text); let b = String(pg?.raw?.body || ""), n = 0;
      let bi = 0; const bands = body.bands as string[][] | undefined;
      if (Array.isArray(bands)) b = b.replace(/<section class="f2b-photo-band"><div>[\s\S]*?<\/div><\/section>/g, (m) => { const t = bands[bi++]; if (!t || t.length !== 3 || t.some((x) => !/^\/images\/[\w./-]+$/.test(x))) return m; n++; return '<section class="f2b-photo-band"><div>' + t.map((x) => `<img loading="lazy" src="${x}" alt="Interior design project by Red Island Interiors">`).join("") + "</div></section>"; });
      for (const pt of body.patches.slice(0, 40)) { const f = String(pt?.find || ""); if (f && b.includes(f)) { b = b.replace(f, () => String(pt.replace ?? "")); n++; } }
      if (!n) return out({ ok: true, applied: 0 });
      pg.raw.body = b;
      const c0 = await store0.commit({ changes: [{ path: pathForSlug(slug), text: JSON.stringify(pg) }], message: `Updated images and sections on /${slug === "home" ? "" : slug}`, actor: "Website import", kind: "import-builder" });
      return out({ ok: true, applied: n, of: body.patches.length, version: c0.version });
    }
    const seo = body.seo || {};
    const page = normalizePage(Err as any, { title: String(body.title || slug).slice(0, 120), url: String(body.url || "/"), seo: { title: String(seo.title || "").slice(0, 60), description: String(seo.description || "").slice(0, 155), focusKeyword: "" }, blocks: [], raw: body.raw }, slug);
    const store = d1Store(env.DB, env.BUCKET, clientId);
    const c = await store.commit({ changes: [{ path: pathForSlug(slug), text: JSON.stringify(page) }], message: `Copied page /${slug === "home" ? "" : slug} from the live site`, actor: "Website import", kind: "import-builder" });
    return out({ ok: true, version: c.version, bytes: JSON.stringify(page).length });
  } catch (e: any) { return out({ error: String(e?.message || e).slice(0, 200) }, e?.status || 500); }
}
