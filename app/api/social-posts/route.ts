// Content calendar (top-bar Content tab): posts per client for Facebook, Instagram, Google Business, LinkedIn and
// TikTok. Every post records who made it. Sub-account staff's posts wait for agency approval before they're
// scheduled. Scheduled posts auto-publish to Facebook / Instagram / Google Business when those are connected
// (lib/content-publish.ts, cron); otherwise they show as "Ready to post".
import { env } from "cloudflare:workers";
import { authorizeAdminOrSubAccount, respond } from "@/lib/settings-auth";
import { aiEndpoint, aiHeaders, aiModel, resolveAiProvider } from "@/lib/ai-provider";
import { getChatGPTUser } from "../../chatgpt-auth";
import { ensureContentTables, publishPost } from "@/lib/content-publish";

export const dynamic = "force-dynamic";
const PLATFORMS = ["facebook", "instagram", "google", "linkedin", "tiktok"];
const STATUSES = ["draft", "pending", "scheduled", "posted", "failed", "rejected"];
type Row = { id: string; client_id: string; post_at: string; platforms: string; caption: string; images: string; status: string; updated_at: string; created_at: string; created_by: string; created_by_name: string; author_type: string; review_note: string; reviewed_by: string; reviewed_at: string; publish_result: string };
const parse = <T,>(v: string, d: T): T => { try { return JSON.parse(v) as T; } catch { return d; } };
const toPost = (r: Row) => ({ id: r.id, clientId: r.client_id, postAt: r.post_at, platforms: parse<string[]>(r.platforms, []), caption: r.caption, images: parse<string[]>(r.images, []), status: r.status, updatedAt: r.updated_at, createdAt: r.created_at, createdBy: r.created_by || "", createdByName: r.created_by_name || r.created_by || "", authorType: r.author_type || "agency", reviewNote: r.review_note || "", reviewedBy: r.reviewed_by || "", reviewedAt: r.reviewed_at || "", publish: parse<Record<string, { ok: boolean; id?: string; url?: string; error?: string; at?: string }>>(r.publish_result || "{}", {}) });
const outputText = (r: any) => typeof r?.output_text === "string" ? r.output_text.trim() : (r?.output || []).flatMap((i: any) => i.content || []).filter((p: any) => p.type === "output_text").map((p: any) => p.text).join("\n").trim();
function scopeOk(allowed: string[] | null, clientId: string) { return Boolean(clientId) && (!allowed || allowed.includes(clientId)); }

async function who() {
  const user = await getChatGPTUser();
  const row = await env.DB!.prepare("SELECT data FROM workspace_documents WHERE id='f2b-agency'").first<{ data: string }>();
  let name = user?.displayName || user?.email || "";
  try { const w = JSON.parse(row?.data || "{}"); const s = (w.staff || []).find((x: any) => !x.isBot && String(x.email || "").toLowerCase() === String(user?.email || "").toLowerCase()); if (s?.name) name = s.name; } catch { /* empty */ }
  return { email: String(user?.email || "").toLowerCase(), name };
}

export async function GET(request: Request) {
  const auth = await authorizeAdminOrSubAccount("plan social posts", "CRM");
  if (auth.error) return auth.error;
  const url = new URL(request.url); const clientId = url.searchParams.get("clientId") || "";
  const all = clientId === "all" && !auth.scope;
  if (!all && !scopeOk(auth.scope, clientId)) return respond({ error: "Pick a client first." }, 400);
  try {
    await ensureContentTables(env.DB!);
    const from = url.searchParams.get("from") || new Date(Date.now() - 40 * 86400_000).toISOString();
    const to = url.searchParams.get("to") || new Date(Date.now() + 80 * 86400_000).toISOString();
    const status = url.searchParams.get("status") || "", by = (url.searchParams.get("createdBy") || "").toLowerCase();
    let sql = `SELECT * FROM social_posts WHERE owner_id=?1 AND post_at>=?2 AND post_at<=?3${all ? "" : " AND client_id=?4"}`;
    const args: unknown[] = [auth.ownerId, from, to, ...(all ? [] : [clientId])];
    if (status && STATUSES.includes(status)) { sql += ` AND status=?${args.length + 1}`; args.push(status); }
    if (by) { sql += ` AND created_by=?${args.length + 1}`; args.push(by); }
    const rows = (await env.DB!.prepare(`${sql} ORDER BY post_at LIMIT 1000`).bind(...args).all<Row>()).results || [];
    const pending = all || !auth.scope ? ((await env.DB!.prepare(`SELECT COUNT(*) AS n FROM social_posts WHERE owner_id=?1 AND status='pending'${all ? "" : " AND client_id=?2"}`).bind(auth.ownerId, ...(all ? [] : [clientId])).first<{ n: number }>())?.n || 0) : 0;
    return respond({ posts: rows.map(toPost), pending, canApprove: !auth.scope });
  } catch (e) { console.error("social GET", e); return respond({ error: "Could not load posts." }, 503); }
}

export async function POST(request: Request) {
  const auth = await authorizeAdminOrSubAccount("plan social posts", "CRM");
  if (auth.error) return auth.error;
  let b: any; try { b = await request.json(); } catch { return respond({ error: "Send a valid request." }, 400); }
  const clientId = String(b.clientId || "").slice(0, 100);
  if (!scopeOk(auth.scope, clientId)) return respond({ error: "Pick a client first." }, 400);
  const agency = !auth.scope;
  try {
    await ensureContentTables(env.DB!);
    const action = String(b.action || "");
    const me = await who();
    const now = new Date().toISOString();
    const existing = async (id: string) => env.DB!.prepare("SELECT * FROM social_posts WHERE id=?1 AND owner_id=?2 AND client_id=?3").bind(id, auth.ownerId, clientId).first<Row>();
    if (action === "save") {
      const p = b.post || {};
      const id = typeof p.id === "string" && p.id ? p.id.slice(0, 60) : crypto.randomUUID();
      const prev = p.id ? await existing(id) : null;
      if (prev && !agency && prev.status === "posted") return respond({ error: "This post has already gone out." }, 400);
      const postAt = Number.isFinite(Date.parse(p.postAt)) ? new Date(p.postAt).toISOString() : now;
      const platforms = (Array.isArray(p.platforms) ? p.platforms : []).map(String).filter((x: string) => PLATFORMS.includes(x)).slice(0, 5);
      const images = (Array.isArray(p.images) ? p.images : []).map(String).filter((u: string) => /^(https:\/\/|\/api\/marketing-public\/media|\/media\/|\/api\/media-library)/.test(u)).slice(0, 10);
      let status = STATUSES.includes(p.status) ? p.status : "draft";
      // Sub-account posts need agency approval before they can be scheduled; edits to an approved post re-submit it.
      if (!agency && (status === "scheduled" || status === "posted")) status = "pending";
      if (!agency && status === "rejected") status = "draft";
      await env.DB!.prepare(`INSERT INTO social_posts (id, owner_id, client_id, post_at, platforms, caption, images, status, created_at, updated_at, created_by, created_by_name, author_type) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?9,?10,?11,?12)
        ON CONFLICT(id) DO UPDATE SET post_at=excluded.post_at, platforms=excluded.platforms, caption=excluded.caption, images=excluded.images, status=excluded.status, updated_at=excluded.updated_at`)
        .bind(id, auth.ownerId, clientId, postAt, JSON.stringify(platforms), String(p.caption || "").slice(0, 5000), JSON.stringify(images), status, now, me.email, me.name, agency ? "agency" : "subaccount").run();
      return respond({ id, status, note: status === "pending" ? "Sent to the agency for approval." : "" });
    }
    if (action === "approve" || action === "reject") {
      if (!agency) return respond({ error: "Only agency staff can approve posts." }, 403);
      const prev = await existing(String(b.id || "")); if (!prev) return respond({ error: "Post not found." }, 404);
      await env.DB!.prepare("UPDATE social_posts SET status=?4, review_note=?5, reviewed_by=?6, reviewed_at=?7, updated_at=?7 WHERE id=?1 AND owner_id=?2 AND client_id=?3")
        .bind(prev.id, auth.ownerId, clientId, action === "approve" ? "scheduled" : "rejected", String(b.note || "").slice(0, 500), me.name || me.email, now).run();
      return respond({ ok: true });
    }
    if (action === "publish") {
      if (!agency) return respond({ error: "Only agency staff can publish now." }, 403);
      const prev = await existing(String(b.id || "")); if (!prev) return respond({ error: "Post not found." }, 404);
      const result = await publishPost(env.DB!, auth.ownerId, prev);
      return respond({ ok: true, result });
    }
    if (action === "mark-posted") {
      const prev = await existing(String(b.id || "")); if (!prev) return respond({ error: "Post not found." }, 404);
      if (!agency && prev.status !== "scheduled") return respond({ error: "Only approved posts can be marked as posted." }, 400);
      await env.DB!.prepare("UPDATE social_posts SET status='posted', updated_at=?4 WHERE id=?1 AND owner_id=?2 AND client_id=?3").bind(prev.id, auth.ownerId, clientId, now).run();
      return respond({ ok: true });
    }
    if (action === "delete") {
      const prev = await existing(String(b.id || "")); if (!prev) return respond({ ok: true });
      if (!agency && (prev.created_by !== me.email || ["scheduled", "posted"].includes(prev.status))) return respond({ error: "You can delete your own drafts and posts awaiting approval." }, 403);
      await env.DB!.prepare("DELETE FROM social_posts WHERE id=?1 AND owner_id=?2 AND client_id=?3").bind(prev.id, auth.ownerId, clientId).run();
      return respond({ ok: true });
    }
    if (action === "generate") {
      // AI writes post captions (one, or a batch for a plan) in the client's voice.
      const provider = await resolveAiProvider(env as any, auth.ownerId);
      const endpoint = provider ? aiEndpoint(env as any, "responses", provider) : null;
      if (!provider || !endpoint) return respond({ error: "Add an AI key in Settings → APIs to generate posts." }, 400);
      const briefs = (Array.isArray(b.briefs) ? b.briefs : []).map((x: unknown) => String(x || "").slice(0, 200)).filter(Boolean).slice(0, 12);
      const count = briefs.length || Math.min(12, Math.max(1, Number(b.count) || 1));
      const instructions = [
        `You write social media posts for ${String(b.clientName || "a local business")}.`,
        b.about ? `About the business: ${String(b.about).slice(0, 1500)}` : "",
        `Platforms: ${(Array.isArray(b.platforms) && b.platforms.length ? b.platforms : ["facebook", "instagram"]).join(", ")}.`,
        "Each post: a hook first line, 2-4 short lines, a clear call to action, then 3-6 relevant hashtags. Warm, local, human. No made-up prices, offers or awards. Emojis sparingly.",
        briefs.length
          ? `Write exactly ${count} posts, in this order, each following its brief:\n${briefs.map((x: string, i: number) => `${i + 1}. ${x}`).join("\n")}\nWhen a brief names a service, the whole post is about that service. For VIDEO posts the caption suits a Reel, and add "videoPlan": a 15-30 second filming plan of 3-5 short numbered shots (hook first, what to film, on-screen text), plain text. Photo posts have no videoPlan.\nReturn ONLY JSON: {"posts":[{"caption":"...","idea":"short label","videoPlan":"..."}]}.`
          : `Return ONLY JSON: {"posts":[{"caption":"...","idea":"short label"}]} with exactly ${count} posts, each a different angle (behind the scenes, customer story, tip, offer reminder, before/after, team, FAQ).`,
      ].filter(Boolean).join("\n");
      const input = String(b.prompt || "Write engaging posts for this month.").slice(0, 1500);
      const res = await fetch(endpoint, { method: "POST", headers: aiHeaders(env as any, provider)!, body: JSON.stringify({ model: aiModel(env as any, undefined, provider), instructions, input, max_output_tokens: briefs.length ? 4200 : 2400 }), signal: AbortSignal.timeout(45000) });
      if (!res.ok) return respond({ error: "The AI couldn't write posts right now. Try again." }, 502);
      const text = outputText(await res.json());
      const json = parse<{ posts?: Array<{ caption?: string; idea?: string; videoPlan?: string }> }>(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1), {});
      const posts = (json.posts || []).map((p) => ({ caption: String(p.caption || "").slice(0, 3000), idea: String(p.idea || "").slice(0, 80), videoPlan: String(p.videoPlan || "").slice(0, 1200) })).filter((p) => p.caption);
      if (!posts.length) return respond({ error: "The AI reply couldn't be read. Try again." }, 502);
      return respond({ posts });
    }
    return respond({ error: "Unknown action." }, 400);
  } catch (e) { console.error("social POST", e); return respond({ error: e instanceof Error ? e.message : "Something went wrong." }, 400); }
}
