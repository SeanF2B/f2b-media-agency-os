// Messaging connections: per sub-account channels (Launchpad → Messaging) and per-person messaging settings (Team cards).
import { env } from "cloudflare:workers";
import { authorizeAdmin, authorizeAdminOrSubAccount, respond } from "@/lib/settings-auth";
import { loadSettings } from "@/lib/conversations/core";
import { connectPages, disconnectPage, DEFAULT_STAFF_MESSAGING, getStaffMessaging, listMetaPages, metaMessagingConfigured, sanitizeStaffMessaging, saveStaffMessaging } from "@/lib/conversations/meta";
import { metaVerifyToken } from "@/lib/conversations/meta-rules";

export const dynamic = "force-dynamic";
const clientKey = (v: unknown) => { const s = String(v ?? "").replace(/[^A-Za-z0-9_-]/g, "").slice(0, 100); return s === "agency" ? "" : s; };

/** Which channels each sub-account has live ("" = agency). */
async function channelMap(ownerId: string) {
  const [{ settings }, pages] = await Promise.all([loadSettings(ownerId), listMetaPages(ownerId)]);
  const map: Record<string, { whatsapp: string[]; sms: string[]; messenger: string[]; instagram: string[] }> = {};
  const at = (id: string) => (map[id] ||= { whatsapp: [], sms: [], messenger: [], instagram: [] });
  const twilioReady = settings.hasToken && Boolean(settings.accountSid);
  if (twilioReady) for (const n of settings.numbers) at(n.clientId || "")[n.channel].push(n.number);
  for (const p of pages.filter((x) => x.status === "connected")) { at(p.clientId).messenger.push(p.pageName); if (p.igId) at(p.clientId).instagram.push(p.igUsername ? `@${p.igUsername}` : "Instagram"); }
  return { map, pages };
}

export async function GET(request: Request) {
  const url = new URL(request.url), view = url.searchParams.get("view") || "overview";
  if (view === "staff") {
    // Team cards: each person's channel switches + what's actually connected (calendars included). Readable by anyone who can open Conversations.
    const auth = await authorizeAdminOrSubAccount("see team connections", "Conversations");
    if (auth.error) return auth.error;
    try {
      const [{ map }, staffMessaging] = await Promise.all([channelMap(auth.ownerId), getStaffMessaging(auth.ownerId)]);
      const google = ((await env.DB!.prepare("SELECT staff_id, account_email FROM sched_google_connections WHERE owner_id=?1").bind(auth.ownerId).all<{ staff_id: string; account_email: string }>().catch(() => ({ results: [] }))).results || []);
      const feeds = ((await env.DB!.prepare("SELECT staff_id FROM sched_staff_settings WHERE owner_id=?1 AND COALESCE(ics_token,'')<>''").bind(auth.ownerId).all<{ staff_id: string }>().catch(() => ({ results: [] }))).results || []);
      const scoped = auth.scope ? Object.fromEntries(Object.entries(map).filter(([k]) => auth.scope!.includes(k))) : map;
      return respond({ channels: scoped, staff: staffMessaging, defaults: DEFAULT_STAFF_MESSAGING, google: Object.fromEntries(google.map((g) => [g.staff_id, g.account_email || "connected"])), feeds: feeds.map((f) => f.staff_id), emailReady: Boolean(env.RESEND_API_KEY && env.TASK_NOTIFICATION_FROM), canEdit: !auth.scope });
    } catch (e) { console.error("meta-messaging staff", e); return respond({ error: "Could not load team connections." }, 503); }
  }
  const auth = await authorizeAdmin("manage messaging connections");
  if (auth.error) return auth.error;
  try {
    const { map, pages } = await channelMap(auth.ownerId);
    return respond({
      configured: metaMessagingConfigured(),
      webhook: { url: `${url.origin}/api/marketing-public/meta`, verifyToken: env.META_APP_SECRET ? await metaVerifyToken(env.META_APP_SECRET) : "" },
      channels: map, pages, emailReady: Boolean(env.RESEND_API_KEY && env.TASK_NOTIFICATION_FROM), emailFrom: String(env.TASK_NOTIFICATION_FROM || ""),
    });
  } catch (e) { console.error("meta-messaging overview", e); return respond({ error: e instanceof Error ? e.message : "Could not load messaging connections." }, 503); }
}

export async function POST(request: Request) {
  let b: Record<string, unknown>; try { b = await request.json(); } catch { return respond({ error: "Send a valid request." }, 400); }
  const action = String(b.action || "");
  const auth = await authorizeAdmin("manage messaging connections");
  if (auth.error) return auth.error;
  try {
    if (action === "pick") {
      const ids = (Array.isArray(b.pageIds) ? b.pageIds : []).map((x) => String(x).replace(/\D/g, "")).filter(Boolean).slice(0, 20);
      if (!ids.length) return respond({ error: "Pick at least one Page." }, 400);
      return respond(await connectPages(auth.ownerId, clientKey(b.clientId), ids));
    }
    if (action === "disconnect") { await disconnectPage(auth.ownerId, clientKey(b.clientId), String(b.pageId || "").replace(/\D/g, "")); return respond({ ok: true }); }
    if (action === "staff-save") {
      const staffId = String(b.staffId || "").slice(0, 100);
      if (!staffId) return respond({ error: "Pick a teammate." }, 400);
      const data = sanitizeStaffMessaging(b.data);
      await saveStaffMessaging(auth.ownerId, staffId, data);
      return respond({ data });
    }
    return respond({ error: "Unknown action." }, 400);
  } catch (e) { return respond({ error: e instanceof Error ? e.message : "That didn't work." }, 400); }
}
