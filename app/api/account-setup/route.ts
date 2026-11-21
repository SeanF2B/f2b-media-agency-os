// Account setup gate: what the signed-in person still has to link before the OS opens.
// Everyone: a calendar + Facebook/Instagram for posts (Operations). Messaging is optional.
// Agency admins also link every business integration that isn't linked yet (Google Ads, Search Console, …).
// Only steps the person can actually complete right now are required, so nobody is locked out by a
// connection that isn't available yet (e.g. the Meta app still in review).
import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";
import { loadSettings } from "@/lib/conversations/core";
import { listMetaPages, metaMessagingConfigured } from "@/lib/conversations/meta";

export const dynamic = "force-dynamic";

type Item = { id: string; section: "operations" | "messaging" | "business" | "account"; name: string; detail: string; linked: boolean; required: boolean; available: boolean; href?: string; action?: "createFeed" | "whatsapp" };
const json = (b: unknown, status = 200) => Response.json(b, { status, headers: { "Cache-Control": "no-store" } });

async function count(sql: string, ...args: unknown[]) {
  try { return Number((await env.DB!.prepare(sql).bind(...args).first<{ n: number }>())?.n || 0); } catch { return 0; }
}

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return json({ error: "Sign in first." }, 401);
  if (!env.DB) return json({ items: [], blocked: false });
  const row = await env.DB.prepare("SELECT owner_id, data FROM workspace_documents WHERE id = ?1").bind("f2b-agency").first<{ owner_id: string; data: string }>();
  let ws: any = {}; try { ws = JSON.parse(row?.data || "{}"); } catch { /* empty */ }
  const ownerId = row?.owner_id || ws.ownerId || "";
  const me = (ws.staff || []).find((s: any) => !s?.isBot && String(s?.email || "").trim().toLowerCase() === user.email);
  if (!me) return json({ items: [], blocked: false });
  const isOwner = me.id === ownerId;
  const scope: string[] | null = Array.isArray(me.clientAccessIds) ? me.clientAccessIds.map(String) : null;
  const subAccount = me.staffType === "subaccount" || /^Sub-account /.test(String(me.role || ""));
  const agencyAdmin = !subAccount && (isOwner || me.role === "Admin" || me.role === "Owner");
  // Sub-account Admin: manages their own business's connections (WhatsApp, Facebook & Instagram) and sees its Google links.
  const accountAdmin = subAccount && /admin/i.test(String(me.role || "")) && Array.isArray(scope) && scope.length === 1;
  const canSetUpWhatsApp = agencyAdmin || accountAdmin;
  const accounts = scope && scope.length ? scope : [""];
  const googleKeys = Boolean(env.GOOGLE_ADS_CLIENT_ID && env.GOOGLE_ADS_CLIENT_SECRET);
  const metaReady = metaMessagingConfigured();

  const [googleCal, feed, pages, settings, ownerCal] = await Promise.all([
    count("SELECT COUNT(*) AS n FROM sched_google_connections WHERE owner_id = ?1 AND staff_id = ?2", ownerId, me.id),
    count("SELECT COUNT(*) AS n FROM sched_staff_settings WHERE owner_id = ?1 AND staff_id = ?2 AND COALESCE(ics_token,'') <> ''", ownerId, me.id),
    listMetaPages(ownerId).catch(() => [] as Awaited<ReturnType<typeof listMetaPages>>),
    loadSettings(ownerId).then((r) => r.settings).catch(() => null),
    // The owner's Google Calendar (task dates) counts as their calendar too.
    isOwner ? count("SELECT COUNT(*) AS n FROM google_calendar_connections WHERE owner_id = ?1", ownerId) : Promise.resolve(0),
  ]);
  const myPages = pages.filter((p) => p.status === "connected" && accounts.includes(p.clientId || ""));
  const canConnectMeta = metaReady && (agencyAdmin || (accounts.length === 1 && accounts[0] !== "" && /manager|admin/i.test(String(me.role || ""))));
  const metaHref = `/api/meta-messaging/connect?clientId=${encodeURIComponent(accounts.length === 1 ? (accounts[0] || "agency") : "agency")}&posting=1`;
  const waNumbers = settings?.hasToken ? (settings.numbers || []).filter((n: any) => n.channel === "whatsapp" && accounts.includes(n.clientId || "")) : [];

  const items: Item[] = [
    { id: "calendar", section: "operations", name: "Your calendar", detail: googleCal || ownerCal ? "Google Calendar connected" : feed ? "Apple / Outlook calendar linked" : "Connect Google Calendar, or link your Apple / Outlook calendar, so bookings land in it.", linked: Boolean(googleCal || feed || ownerCal), required: true, available: true, href: googleKeys ? `/api/scheduling?connect=${encodeURIComponent(me.id)}` : undefined, action: "createFeed" },
    { id: "social", section: "operations", name: "Facebook & Instagram for posts", detail: myPages.length ? `Connected: ${myPages.map((p) => p.pageName).join(", ")}` : !metaReady ? "Coming soon: F2B is finishing the Facebook connection." : canConnectMeta ? "Connect the business Facebook Page (and its Instagram) so scheduled posts publish." : "Your manager connects the business Facebook Page.", linked: myPages.length > 0, required: canConnectMeta, available: canConnectMeta, href: canConnectMeta ? metaHref : undefined },
    { id: "msg-whatsapp", section: "messaging", name: "WhatsApp", detail: waNumbers.length ? `Live on ${waNumbers.map((n: any) => n.number).join(", ")}` : canSetUpWhatsApp ? "Link your existing WhatsApp number or buy a new one." : "Your manager sets up WhatsApp.", linked: waNumbers.length > 0, required: false, available: canSetUpWhatsApp, action: canSetUpWhatsApp ? "whatsapp" : undefined },
    { id: "msg-instagram", section: "messaging", name: "Instagram messages", detail: myPages.some((p) => p.igId) ? "Instagram DMs come into Conversations" : "Comes with the Facebook Page connection.", linked: myPages.some((p) => p.igId), required: false, available: canConnectMeta, href: canConnectMeta ? metaHref : undefined },
    { id: "msg-facebook", section: "messaging", name: "Facebook Messenger", detail: myPages.length ? "Messenger chats come into Conversations" : "Comes with the Facebook Page connection.", linked: myPages.length > 0, required: false, available: canConnectMeta, href: canConnectMeta ? metaHref : undefined },
  ];

  if (accountAdmin) {
    // The business's Google connections are linked by F2B through the agency login; show where each stands.
    const client = (ws.clients || []).find((c: any) => String(c.id) === scope![0]) || {};
    const g = (id: string, name: string, linked: unknown, what: string): Item => ({ id, section: "account", name, detail: linked ? "Linked" : `F2B links this for you. ${what}`, linked: Boolean(linked), required: false, available: false });
    items.push(
      g("google-ads", "Google Ads", client.googleAdsAccountId, "Ad results show on your Dashboard."),
      g("search-console", "Google Search Console", client.googleSearchConsoleAccountId, "Search rankings and clicks."),
      g("ga4", "Google Analytics", client.googleAnalyticsAccountId, "Website visitors."),
      g("business-profile", "Google Business Profile", client.googleBusinessProfileLocationId, "Maps listing and reviews."),
    );
  }
  if (agencyAdmin) {
    const [ads, gsc, ga4, meta, gbp, drive, gmail] = await Promise.all([
      count("SELECT COUNT(*) AS n FROM google_ads_connections WHERE owner_id = ?1", ownerId),
      count("SELECT COUNT(*) AS n FROM google_search_console_connections WHERE owner_id = ?1", ownerId),
      count("SELECT COUNT(*) AS n FROM google_search_console_connections WHERE owner_id = ?1 AND granted_scopes LIKE '%analytics.readonly%'", ownerId),
      count("SELECT COUNT(*) AS n FROM meta_ads_connections WHERE owner_id = ?1", ownerId),
      count("SELECT COUNT(*) AS n FROM gbp_connections WHERE owner_id = ?1", ownerId),
      count("SELECT COUNT(*) AS n FROM google_drive_connections WHERE owner_id = ?1", ownerId),
      count("SELECT COUNT(*) AS n FROM bookkeeping_gmail WHERE owner_id = ?1", ownerId),
    ]);
    const biz = (id: string, name: string, linked: number, available: boolean, href: string, detail: string): Item => ({ id, section: "business", name, detail: linked ? "Linked" : available ? detail : "Not available yet: waiting on F2B setup.", linked: linked > 0, required: available, available, href: available ? href : undefined });
    items.push(
      biz("google-ads", "Google Ads", ads, googleKeys, "/api/google-ads/connect", "Campaign results and AI suggestions."),
      biz("search-console", "Google Search Console", gsc, googleKeys, "/api/search-console/connect", "Rankings and clicks for each site."),
      biz("ga4", "Google Analytics", ga4, googleKeys, "/api/search-console/connect", "Website visitors for each client."),
      biz("business-profile", "Business Profile posting", gbp, googleKeys, "/api/gbp/connect", "Lets scheduled posts and review replies publish to Google (reporting is already linked)."),
      biz("meta-ads", "Meta Ads", meta, metaReady, "/api/meta-ads/connect", "Facebook and Instagram ad results."),
      biz("google-drive", "Google Drive", drive, googleKeys, "/api/media-library/drive", "Bring photos and files into Media."),
      biz("gmail", "Gmail receipts", gmail, googleKeys, "/api/bookkeeping-email/connect?scope=agency", "Receipts and supplier invoices into Books."),
    );
  }
  const blocked = items.some((i) => i.required && !i.linked);
  return json({ name: String(me.name || "").split("|")[0].trim(), staffId: me.id, isOwner, agencyAdmin, accountAdmin, accountId: accountAdmin ? scope![0] : "", blocked, items });
}
