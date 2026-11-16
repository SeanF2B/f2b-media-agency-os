// Social post planner: schedule posts per client on a calendar, write them with AI, attach Media Library images.
// Posts are stored here; when the time comes they show as "Ready to post" (auto-publishing needs the social account connected).
import { env } from "cloudflare:workers";
import { authorizeAdminOrSubAccount, respond } from "@/lib/settings-auth";
import { aiEndpoint, aiHeaders, aiModel, resolveAiProvider } from "@/lib/ai-provider";

export const dynamic = "force-dynamic";
const TABLE = "CREATE TABLE IF NOT EXISTS social_posts (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, client_id TEXT NOT NULL, post_at TEXT NOT NULL, platforms TEXT NOT NULL DEFAULT '[]', caption TEXT NOT NULL DEFAULT '', images TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'draft', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)";
const INDEX = "CREATE INDEX IF NOT EXISTS social_posts_client ON social_posts (owner_id, client_id, post_at)";
const PLATFORMS = ["facebook", "instagram", "google", "linkedin", "tiktok"];
type Row = { id: string; client_id: string; post_at: string; platforms: string; caption: string; images: string; status: string; updated_at: string };
const parse = <T,>(v: string, d: T): T => { try { return JSON.parse(v) as T; } catch { return d; } };
const toPost = (r: Row) => ({ id: r.id, clientId: r.client_id, postAt: r.post_at, platforms: parse<string[]>(r.platforms, []), caption: r.caption, images: parse<string[]>(r.images, []), status: r.status, updatedAt: r.updated_at });
const outputText = (r: any) => typeof r?.output_text === "string" ? r.output_text.trim() : (r?.output || []).flatMap((i: any) => i.content || []).filter((p: any) => p.type === "output_text").map((p: any) => p.text).join("\n").trim();

async function ready() { await env.DB!.prepare(TABLE).run(); await env.DB!.prepare(INDEX).run(); }
function scopeOk(allowed: string[] | null, clientId: string) { return Boolean(clientId) && (!allowed || allowed.includes(clientId)); }

export async function GET(request: Request) {
  const auth = await authorizeAdminOrSubAccount("plan social posts", "CRM");
  if (auth.error) return auth.error;
  const url = new URL(request.url); const clientId = url.searchParams.get("clientId") || "";
  if (!scopeOk(auth.scope, clientId)) return respond({ error: "Pick a client first." }, 400);
  try {
    await ready();
    const from = url.searchParams.get("from") || new Date(Date.now() - 40 * 86400_000).toISOString();
    const to = url.searchParams.get("to") || new Date(Date.now() + 80 * 86400_000).toISOString();
    const rows = (await env.DB!.prepare("SELECT * FROM social_posts WHERE owner_id=?1 AND client_id=?2 AND post_at>=?3 AND post_at<=?4 ORDER BY post_at").bind(auth.ownerId, clientId, from, to).all<Row>()).results || [];
    return respond({ posts: rows.map(toPost) });
  } catch (e) { console.error("social GET", e); return respond({ error: "Could not load social posts." }, 503); }
}

export async function POST(request: Request) {
  const auth = await authorizeAdminOrSubAccount("plan social posts", "CRM");
  if (auth.error) return auth.error;
  let b: any; try { b = await request.json(); } catch { return respond({ error: "Send a valid request." }, 400); }
  const clientId = String(b.clientId || "").slice(0, 100);
  if (!scopeOk(auth.scope, clientId)) return respond({ error: "Pick a client first." }, 400);
  try {
    await ready();
    const action = String(b.action || "");
    if (action === "save") {
      const p = b.post || {}; const now = new Date().toISOString();
      const id = typeof p.id === "string" && p.id ? p.id.slice(0, 60) : crypto.randomUUID();
      const postAt = Number.isFinite(Date.parse(p.postAt)) ? new Date(p.postAt).toISOString() : now;
      const platforms = (Array.isArray(p.platforms) ? p.platforms : []).map(String).filter((x: string) => PLATFORMS.includes(x)).slice(0, 5);
      const images = (Array.isArray(p.images) ? p.images : []).map(String).filter((u: string) => /^(https:\/\/|\/api\/marketing-public\/media|\/media\/)/.test(u)).slice(0, 10);
      const status = ["draft", "scheduled", "posted"].includes(p.status) ? p.status : "draft";
      await env.DB!.prepare("INSERT INTO social_posts (id, owner_id, client_id, post_at, platforms, caption, images, status, created_at, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?9) ON CONFLICT(id) DO UPDATE SET post_at=excluded.post_at, platforms=excluded.platforms, caption=excluded.caption, images=excluded.images, status=excluded.status, updated_at=excluded.updated_at WHERE social_posts.owner_id=excluded.owner_id")
        .bind(id, auth.ownerId, clientId, postAt, JSON.stringify(platforms), String(p.caption || "").slice(0, 5000), JSON.stringify(images), status, now).run();
      return respond({ id });
    }
    if (action === "delete") { await env.DB!.prepare("DELETE FROM social_posts WHERE id=?1 AND owner_id=?2 AND client_id=?3").bind(String(b.id || ""), auth.ownerId, clientId).run(); return respond({ ok: true }); }
    if (action === "generate") {
      // AI writes post captions (one, or a batch for a plan) in the client's voice.
      const provider = await resolveAiProvider(env as any, auth.ownerId);
      const endpoint = provider ? aiEndpoint(env as any, "responses", provider) : null;
      if (!provider || !endpoint) return respond({ error: "Add an AI key in Settings → APIs to generate posts." }, 400);
      const count = Math.min(12, Math.max(1, Number(b.count) || 1));
      const instructions = [
        `You write social media posts for ${String(b.clientName || "a local business")}.`,
        b.about ? `About the business: ${String(b.about).slice(0, 1500)}` : "",
        `Platforms: ${(Array.isArray(b.platforms) && b.platforms.length ? b.platforms : ["facebook", "instagram"]).join(", ")}.`,
        "Each post: a hook first line, 2-4 short lines, a clear call to action, then 3-6 relevant hashtags. Warm, local, human. No made-up prices, offers or awards. Emojis sparingly.",
        `Return ONLY JSON: {"posts":[{"caption":"...","idea":"short label"}]} with exactly ${count} posts, each a different angle (behind the scenes, customer story, tip, offer reminder, before/after, team, FAQ).`,
      ].filter(Boolean).join("\n");
      const input = String(b.prompt || "Write engaging posts for this month.").slice(0, 1500);
      const res = await fetch(endpoint, { method: "POST", headers: aiHeaders(env as any, provider)!, body: JSON.stringify({ model: aiModel(env as any, undefined, provider), instructions, input, max_output_tokens: 2400 }), signal: AbortSignal.timeout(45000) });
      if (!res.ok) return respond({ error: "The AI couldn't write posts right now. Try again." }, 502);
      const text = outputText(await res.json());
      const json = parse<{ posts?: Array<{ caption?: string; idea?: string }> }>(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1), {});
      const posts = (json.posts || []).map((p) => ({ caption: String(p.caption || "").slice(0, 3000), idea: String(p.idea || "").slice(0, 80) })).filter((p) => p.caption);
      if (!posts.length) return respond({ error: "The AI reply couldn't be read. Try again." }, 502);
      return respond({ posts });
    }
    return respond({ error: "Unknown action." }, 400);
  } catch (e) { console.error("social POST", e); return respond({ error: "Something went wrong." }, 400); }
}
