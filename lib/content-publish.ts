import { env } from "cloudflare:workers";
import { graph, listMetaPages, pageTokenFor } from "@/lib/conversations/meta";
import { decryptGoogleAdsRefreshToken, encryptRefreshToken } from "@/lib/google-ads-direct";

// Content calendar publishing, using the connections the OS already has:
//  · Facebook Page + Instagram: the client's Page connected in Launchpad → Messaging (needs the posting
//    permissions pages_manage_posts + instagram_content_publish, added to that same connection).
//  · Google Business Profile: one Google sign-in with the Business Profile permission (Launchpad).
// LinkedIn and TikTok stay "Ready to post" (no connection in the OS).
type Db = D1Database;
type Row = { id: string; owner_id?: string; client_id: string; post_at: string; platforms: string; caption: string; images: string; status: string; publish_result?: string };
type Result = Record<string, { ok: boolean; id?: string; url?: string; error?: string; at: string; manual?: boolean }>;

let ready: Promise<unknown> | null = null;
export function ensureContentTables(db: Db) {
  ready ||= (async () => {
    await db.prepare("CREATE TABLE IF NOT EXISTS social_posts (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, client_id TEXT NOT NULL, post_at TEXT NOT NULL, platforms TEXT NOT NULL DEFAULT '[]', caption TEXT NOT NULL DEFAULT '', images TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'draft', created_at TEXT NOT NULL, updated_at TEXT NOT NULL)").run();
    await db.prepare("CREATE INDEX IF NOT EXISTS social_posts_client ON social_posts (owner_id, client_id, post_at)").run();
    for (const col of ["created_by TEXT NOT NULL DEFAULT ''", "created_by_name TEXT NOT NULL DEFAULT ''", "author_type TEXT NOT NULL DEFAULT 'agency'", "review_note TEXT NOT NULL DEFAULT ''", "reviewed_by TEXT NOT NULL DEFAULT ''", "reviewed_at TEXT NOT NULL DEFAULT ''", "publish_result TEXT NOT NULL DEFAULT '{}'", "attempts INTEGER NOT NULL DEFAULT 0"]) {
      try { await db.prepare(`ALTER TABLE social_posts ADD COLUMN ${col}`).run(); } catch { /* already there */ }
    }
    await db.prepare("CREATE INDEX IF NOT EXISTS social_posts_due ON social_posts (status, post_at)").run();
    await db.prepare("CREATE TABLE IF NOT EXISTS gbp_connections (owner_id TEXT PRIMARY KEY, enc_token TEXT NOT NULL, token_iv TEXT NOT NULL, account_email TEXT NOT NULL DEFAULT '', connected_at TEXT NOT NULL)").run();
    await db.prepare("CREATE TABLE IF NOT EXISTS gbp_locations (owner_id TEXT NOT NULL, location TEXT NOT NULL, account TEXT NOT NULL, title TEXT NOT NULL DEFAULT '', website TEXT NOT NULL DEFAULT '', client_id TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL, PRIMARY KEY (owner_id, location))").run();
  })().catch((e) => { ready = null; throw e; });
  return ready;
}

const appOrigin = () => String(env.TASK_APP_URL || "https://f2b-media-agency-os.f2b-media.workers.dev").replace(/\/$/, "");
const absolute = (u: string) => /^https?:\/\//.test(u) ? u : `${appOrigin()}${u.startsWith("/") ? "" : "/"}${u}`;
const parse = <T,>(v: string | undefined, d: T): T => { try { return JSON.parse(v || "") as T; } catch { return d; } };
const metaError = (e: unknown) => { const m = e instanceof Error ? e.message : String(e); return /messaging permission|app review|Advanced Access|\(#10\)|\(#200\)|permission/i.test(m) ? "Facebook hasn't given this app posting permission yet. Reconnect the Page in Launchpad → Messaging (the new connection asks for posting) — Meta also needs to approve posting for the app." : m; };

// ---------- Facebook / Instagram ----------
async function pageFor(ownerId: string, clientId: string) {
  const pages = await listMetaPages(ownerId, clientId).catch(() => [] as Array<{ pageId: string; igId: string; status: string }>);
  const page = (pages as Array<{ pageId: string; igId: string; status: string; clientId?: string }>).find((p) => p.status === "connected" && (!p.clientId || p.clientId === clientId));
  if (!page) return null;
  const tok = await pageTokenFor(ownerId, page.pageId);
  return tok ? { pageId: page.pageId, igId: page.igId, token: tok.token } : null;
}
const isVideoUrl = (u: string) => { try { return /\.(mp4|mov|m4v|webm)(?:$|[?&#])/i.test(decodeURIComponent(u)); } catch { return false; } };
/** Video drafts carry the AI's filming plan after this marker; it is never posted. */
const stripPlan = (caption: string) => { const i = caption.indexOf("🎬 Video plan (not posted):"); return (i >= 0 ? caption.slice(0, i) : caption).replace(/\s*-{3,}\s*$/, "").trim(); };
async function postFacebook(ownerId: string, clientId: string, caption: string, images: string[]) {
  const p = await pageFor(ownerId, clientId);
  if (!p) throw new Error("No Facebook Page is connected for this client. Connect it in Launchpad → Messaging.");
  const video = images.find(isVideoUrl);
  if (video) { const r = await graph<{ id?: string }>("POST", `${p.pageId}/videos`, p.token, { file_url: absolute(video), description: caption }); const id = r.id || ""; return { id, url: id ? `https://www.facebook.com/${id}` : "" }; }
  images = images.filter((u) => !isVideoUrl(u));
  if (images.length === 1) { const r = await graph<{ id?: string; post_id?: string }>("POST", `${p.pageId}/photos`, p.token, { url: absolute(images[0]), caption }); const id = r.post_id || r.id || ""; return { id, url: id ? `https://www.facebook.com/${id}` : "" }; }
  if (images.length > 1) {
    const media: string[] = [];
    for (const img of images.slice(0, 10)) { const r = await graph<{ id: string }>("POST", `${p.pageId}/photos`, p.token, { url: absolute(img), published: "false" }); media.push(r.id); }
    const params: Record<string, string> = { message: caption }; media.forEach((id, i) => { params[`attached_media[${i}]`] = JSON.stringify({ media_fbid: id }); });
    const r = await graph<{ id: string }>("POST", `${p.pageId}/feed`, p.token, params); return { id: r.id, url: `https://www.facebook.com/${r.id}` };
  }
  const r = await graph<{ id: string }>("POST", `${p.pageId}/feed`, p.token, { message: caption }); return { id: r.id, url: `https://www.facebook.com/${r.id}` };
}
async function postInstagram(ownerId: string, clientId: string, caption: string, images: string[]) {
  const p = await pageFor(ownerId, clientId);
  if (!p?.igId) throw new Error("No Instagram business account is linked to this client's Facebook Page.");
  if (!images.length) throw new Error("Instagram posts need at least one image or video.");
  let creation: string;
  const video = images.find(isVideoUrl);
  if (video) {
    // Reels: Instagram processes the video first; wait until it's ready (up to ~60s) before publishing.
    creation = (await graph<{ id: string }>("POST", `${p.igId}/media`, p.token, { media_type: "REELS", video_url: absolute(video), caption, share_to_feed: "true" })).id;
    for (let i = 0; i < 12; i++) { const st = await graph<{ status_code?: string }>("GET", creation, p.token, { fields: "status_code" }).catch(() => ({} as { status_code?: string })); if (st.status_code === "FINISHED") break; if (st.status_code === "ERROR") throw new Error("Instagram couldn't process this video (use MP4, H.264, under 90 seconds)."); await new Promise((r) => setTimeout(r, 5000)); }
  } else if (images.length === 1) creation = (await graph<{ id: string }>("POST", `${p.igId}/media`, p.token, { image_url: absolute(images[0]), caption })).id;
  else {
    const children: string[] = [];
    for (const img of images.slice(0, 10)) children.push((await graph<{ id: string }>("POST", `${p.igId}/media`, p.token, { image_url: absolute(img), is_carousel_item: "true" })).id);
    creation = (await graph<{ id: string }>("POST", `${p.igId}/media`, p.token, { media_type: "CAROUSEL", children: children.join(","), caption })).id;
  }
  const r = await graph<{ id: string }>("POST", `${p.igId}/media_publish`, p.token, { creation_id: creation });
  const link = await graph<{ permalink?: string }>("GET", r.id, p.token, { fields: "permalink" }).catch(() => ({} as { permalink?: string }));
  return { id: r.id, url: link.permalink || "" };
}

// ---------- Google Business Profile ----------
export async function saveGbpConnection(ownerId: string, refreshToken: string, email: string) {
  await ensureContentTables(env.DB!);
  const e = await encryptRefreshToken(refreshToken);
  await env.DB!.prepare("INSERT INTO gbp_connections (owner_id, enc_token, token_iv, account_email, connected_at) VALUES (?1,?2,?3,?4,?5) ON CONFLICT(owner_id) DO UPDATE SET enc_token=excluded.enc_token, token_iv=excluded.token_iv, account_email=excluded.account_email, connected_at=excluded.connected_at").bind(ownerId, e.ciphertext, e.iv, email, new Date().toISOString()).run();
}
export async function gbpConnection(ownerId: string) { await ensureContentTables(env.DB!); return env.DB!.prepare("SELECT account_email, connected_at FROM gbp_connections WHERE owner_id=?1").bind(ownerId).first<{ account_email: string; connected_at: string }>(); }
async function gbpToken(ownerId: string) {
  const row = await env.DB!.prepare("SELECT enc_token, token_iv FROM gbp_connections WHERE owner_id=?1").bind(ownerId).first<{ enc_token: string; token_iv: string }>();
  if (!row) throw new Error("Google Business Profile isn't connected. Connect it in Launchpad.");
  const refresh = await decryptGoogleAdsRefreshToken(row.token_iv, row.enc_token);
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: env.GOOGLE_ADS_CLIENT_ID!, client_secret: env.GOOGLE_ADS_CLIENT_SECRET!, refresh_token: refresh, grant_type: "refresh_token" }), signal: AbortSignal.timeout(15000) });
  const j = await r.json() as { access_token?: string; error?: string };
  if (!r.ok || !j.access_token) throw new Error(j.error === "invalid_grant" ? "Google Business Profile access expired. Reconnect it in Launchpad." : "Google Business Profile access couldn't be refreshed.");
  return j.access_token;
}
async function gapi<T>(url: string, token: string, init?: RequestInit): Promise<T> {
  const r = await fetch(url, { ...init, headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json", ...(init?.headers || {}) }, signal: AbortSignal.timeout(20000) });
  const j = await r.json().catch(() => ({})) as T & { error?: { message?: string; status?: string } };
  if (!r.ok) throw new Error((j as any)?.error?.status === "PERMISSION_DENIED" ? "Google hasn't given access to this Business Profile (check the API is enabled and this Google login manages the profile)." : (j as any)?.error?.message || `Google returned HTTP ${r.status}.`);
  return j;
}
const host = (u: string) => { try { return new URL(/^https?:/.test(u) ? u : `https://${u}`).hostname.replace(/^www\./, "").toLowerCase(); } catch { return ""; } };
/** Refresh the list of Business Profile locations and match them to clients by website (or name). */
export async function syncGbpLocations(ownerId: string, clients: Array<{ id: string; name: string; website?: string; googleBusinessLocation?: string }>) {
  const token = await gbpToken(ownerId);
  const accounts = await gapi<{ accounts?: Array<{ name: string }> }>("https://mybusinessaccountmanagement.googleapis.com/v1/accounts?pageSize=20", token);
  const now = new Date().toISOString(); let n = 0;
  for (const a of accounts.accounts || []) {
    const locs = await gapi<{ locations?: Array<{ name: string; title?: string; websiteUri?: string }> }>(`https://mybusinessbusinessinformation.googleapis.com/v1/${a.name}/locations?readMask=name,title,websiteUri&pageSize=100`, token).catch(() => ({ locations: [] }));
    for (const l of locs.locations || []) {
      const match = clients.find((c) => c.googleBusinessLocation === l.name) || clients.find((c) => c.website && l.websiteUri && host(c.website) === host(l.websiteUri)) || clients.find((c) => l.title && c.name.toLowerCase() === l.title.toLowerCase());
      await env.DB!.prepare("INSERT INTO gbp_locations (owner_id, location, account, title, website, client_id, updated_at) VALUES (?1,?2,?3,?4,?5,?6,?7) ON CONFLICT(owner_id, location) DO UPDATE SET account=excluded.account, title=excluded.title, website=excluded.website, client_id=CASE WHEN gbp_locations.client_id <> '' THEN gbp_locations.client_id ELSE excluded.client_id END, updated_at=excluded.updated_at")
        .bind(ownerId, l.name, a.name, l.title || "", l.websiteUri || "", match?.id || "", now).run();
      n++;
    }
  }
  return n;
}
async function locationFor(ownerId: string, clientId: string) {
  return env.DB!.prepare("SELECT location, account, title FROM gbp_locations WHERE owner_id=?1 AND client_id=?2 LIMIT 1").bind(ownerId, clientId).first<{ location: string; account: string; title: string }>();
}
async function postGoogle(ownerId: string, clientId: string, caption: string, images: string[]) {
  const loc = await locationFor(ownerId, clientId);
  if (!loc) throw new Error("This client isn't matched to a Google Business Profile location yet. Open Launchpad → Google Business Profile to match it.");
  const token = await gbpToken(ownerId);
  const locId = loc.location.replace(/^locations\//, "");
  const body: Record<string, unknown> = { languageCode: "en", summary: caption.slice(0, 1500), topicType: "STANDARD" };
  images = images.filter((u) => !isVideoUrl(u));
  if (images.length) body.media = images.slice(0, 1).map((u) => ({ mediaFormat: "PHOTO", sourceUrl: absolute(u) }));
  const r = await gapi<{ name?: string; searchUrl?: string }>(`https://mybusiness.googleapis.com/v4/${loc.account}/locations/${locId}/localPosts`, token, { method: "POST", body: JSON.stringify(body) });
  return { id: r.name || "", url: r.searchUrl || "" };
}
/** Live posts on the client's Google Business Profile (for the Dashboard). */
export async function listGooglePosts(ownerId: string, clientId: string) {
  const loc = await locationFor(ownerId, clientId);
  if (!loc) return { connected: Boolean(await gbpConnection(ownerId)), matched: false, posts: [] as Array<{ id: string; summary: string; image: string; at: string; url: string; state: string }> };
  const token = await gbpToken(ownerId);
  const r = await gapi<{ localPosts?: Array<{ name: string; summary?: string; media?: Array<{ googleUrl?: string; sourceUrl?: string }>; createTime?: string; searchUrl?: string; state?: string }> }>(`https://mybusiness.googleapis.com/v4/${loc.account}/locations/${loc.location.replace(/^locations\//, "")}/localPosts?pageSize=20`, token);
  return { connected: true, matched: true, posts: (r.localPosts || []).map((p) => ({ id: p.name, summary: p.summary || "", image: p.media?.[0]?.googleUrl || p.media?.[0]?.sourceUrl || "", at: p.createTime || "", url: p.searchUrl || "", state: p.state || "" })) };
}

// ---------- Publish one post ----------
export async function publishPost(db: Db, ownerId: string, row: Row) {
  await ensureContentTables(db);
  const platforms = parse<string[]>(row.platforms, []), images = parse<string[]>(row.images, []);
  row = { ...row, caption: stripPlan(row.caption) };
  const prev = parse<Result>(row.publish_result, {});
  const result: Result = { ...prev };
  for (const p of platforms) {
    if (prev[p]?.ok) continue; // already out on this platform
    const at = new Date().toISOString();
    try {
      if (p === "facebook") result[p] = { ok: true, ...(await postFacebook(ownerId, row.client_id, row.caption, images)), at };
      else if (p === "instagram") result[p] = { ok: true, ...(await postInstagram(ownerId, row.client_id, row.caption, images)), at };
      else if (p === "google") result[p] = { ok: true, ...(await postGoogle(ownerId, row.client_id, row.caption, images)), at };
      else result[p] = { ok: false, manual: true, error: "Post this one by hand (no LinkedIn / TikTok connection).", at };
    } catch (e) { result[p] = { ok: false, error: p === "google" ? (e instanceof Error ? e.message : String(e)) : metaError(e), at }; }
  }
  const auto = platforms.filter((p) => !result[p]?.manual);
  const allOk = auto.length > 0 && auto.every((p) => result[p]?.ok);
  const anyFail = auto.some((p) => result[p] && !result[p].ok);
  const status = allOk && !platforms.some((p) => result[p]?.manual) ? "posted" : anyFail ? "failed" : row.status;
  await db.prepare("UPDATE social_posts SET publish_result=?2, status=?3, attempts=attempts+1, updated_at=?4 WHERE id=?1").bind(row.id, JSON.stringify(result), status, new Date().toISOString()).run();
  return { status, result };
}

/** Cron: publish approved posts that are due (up to 10 per run; failed ones retry up to 3 times). */
export async function processContentPublishing(now = new Date()) {
  if (!env.DB) return;
  await ensureContentTables(env.DB);
  const due = (await env.DB.prepare("SELECT * FROM social_posts WHERE status IN ('scheduled','failed') AND attempts < 3 AND post_at <= ?1 ORDER BY post_at LIMIT 10").bind(now.toISOString()).all<Row & { owner_id: string }>()).results || [];
  for (const row of due) {
    const platforms = parse<string[]>(row.platforms, []);
    if (!platforms.some((p) => ["facebook", "instagram", "google"].includes(p))) continue; // manual-only posts stay "Ready to post"
    await publishPost(env.DB, row.owner_id, row).catch((e) => console.error("content publish", e));
  }
}
