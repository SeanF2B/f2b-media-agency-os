import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";
import { fullTeamPermissions, getTeamPermissions, type TeamPermissions } from "@/lib/access-permissions";
import { buildClientReport } from "@/lib/client-report-data";
import { listBookings } from "@/lib/scheduling/server";
import { metaAdsConnectionExists, readDirectMetaAdsInsights } from "@/lib/meta-ads-direct";
import { summarizeMetaAdsTotals } from "@/lib/meta-ads-performance";

// Dashboard tiles: marketing results for one client (from the same cached reads as client reports),
// upcoming appointments and emails the system sent. One request per dashboard load.
export const dynamic = "force-dynamic";
const reply = (body: Record<string, unknown>, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
type Staff = { id: string; email: string; role: string; isBot?: boolean; permissions?: Partial<TeamPermissions>; clientAccessIds?: string[]; limitClientAccess?: boolean };
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const avg = (values: number[]) => values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10 : null;

export async function GET(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return reply({ error: "Sign in first." }, 401);
  if (!env.DB) return reply({ error: "The workspace database is unavailable." }, 503);
  const db = env.DB;
  const row = await db.prepare("SELECT data FROM workspace_documents WHERE id = 'f2b-agency'").first<{ data: string }>();
  if (!row?.data) return reply({ error: "The workspace is unavailable." }, 503);
  const workspace = JSON.parse(row.data) as { ownerId?: string; staff?: Staff[]; clients?: Array<{ id: string; name: string; googleAdsAccountId?: string; metaAdsAccountId?: string }> };
  const ownerId = String(workspace.ownerId || "");
  const owner = ownerId === user.userId;
  const staff = (workspace.staff || []).find((item) => !item.isBot && (item.id === user.userId || item.email?.toLowerCase() === user.email.toLowerCase()));
  const admin = owner || ["Owner", "Admin"].includes(staff?.role || "");
  if (!admin && !staff) return reply({ error: "You do not have access." }, 403);
  const permissions = owner ? fullTeamPermissions : getTeamPermissions(staff?.role || "Viewer", staff?.permissions);
  const allowedIds = admin || !staff?.limitClientAccess ? null : staff.clientAccessIds || [];
  const url = new URL(request.url);
  let clientId = (url.searchParams.get("clientId") || "").slice(0, 120);
  const allClients = clientId === "all" && !allowedIds;
  if (clientId === "all" && !allClients) clientId = "";
  if (clientId && !allClients && !(workspace.clients || []).some((client) => client.id === clientId)) clientId = "";
  if (clientId && allowedIds && !allowedIds.includes(clientId)) return reply({ error: "You do not have access to this client." }, 403);
  const scope: string | null = allClients ? null : clientId || (allowedIds ? allowedIds[0] || "none" : null);

  type Totals = { spend: number; clicks: number; impressions: number; conversions: number };
  const adsBlock = (now: Totals | null, before: Totals | null) => now ? {
    adSpend: { value: now.spend, previous: before?.spend ?? null }, adClicks: { value: now.clicks, previous: before?.clicks ?? null },
    impressions: { value: now.impressions, previous: before?.impressions ?? null }, conversions: { value: now.conversions, previous: before?.conversions ?? null },
    cpc: now.clicks ? { value: now.spend / now.clicks, previous: before && before.clicks ? before.spend / before.clicks : null } : null,
    costPerConversion: now.conversions ? { value: now.spend / now.conversions, previous: before && before.conversions ? before.spend / before.conversions : null } : null,
  } : { adSpend: null, adClicks: null, impressions: null, conversions: null, cpc: null, costPerConversion: null };
  // Meta Ads totals (last 30 days) for the given clients' mapped ad accounts.
  const metaFor = async (ids: string[]) => {
    const linked = (workspace.clients || []).filter((c) => ids.includes(c.id) && c.metaAdsAccountId);
    if (!linked.length) return { meta: null, metaNote: "No Meta Ads account linked" };
    if (!(await metaAdsConnectionExists(ownerId).catch(() => false))) return { meta: null, metaNote: "Meta Ads isn’t connected" };
    const window = { start: day(-30), end: day(0) };
    const rows = await Promise.all(linked.map((c) => readDirectMetaAdsInsights(ownerId, c.metaAdsAccountId!, window, "campaigns").then((r) => summarizeMetaAdsTotals(r)).catch(() => null)));
    const ok = rows.filter((r): r is NonNullable<typeof r> => Boolean(r));
    if (!ok.length) return { meta: null, metaNote: "Meta didn’t return data" };
    const t = ok.reduce((a, r) => ({ spend: a.spend + r.spend, impressions: a.impressions + r.impressions, clicks: a.clicks + r.clicks, leads: a.leads + r.leads }), { spend: 0, impressions: 0, clicks: 0, leads: 0 });
    return { meta: { ...t, cpc: t.clicks ? t.spend / t.clicks : null, costPerLead: t.leads ? t.spend / t.leads : null, accounts: ok.length, linkedAccounts: linked.length }, metaNote: "" };
  };
  const marketing = async () => {
    if (!clientId || !(admin || permissions.reports)) return null;
    const period = { start: day(-30), end: day(0) };
    if (allClients) {
      // Agency view: Google Ads totals across every client with a linked account.
      const linked = (workspace.clients || []).filter((c) => c.googleAdsAccountId);
      const reports = await Promise.all(linked.map((c) => buildClientReport(db as never, workspace as never, c.id, "ads", period).catch(() => null)));
      const zero = (): Totals => ({ spend: 0, clicks: 0, impressions: 0, conversions: 0 });
      const now = zero(), before = zero(); let withData = 0, withPrev = 0, leads = 0, currency = "EUR";
      for (const r of reports) {
        if (!r) continue;
        if (r.attribution.status === "ok") leads += Object.values(r.attribution.data!.allChannels || {}).reduce((a, b) => a + (Number(b) || 0), 0);
        if (r.ads?.status !== "ok" || !r.ads.data) continue;
        withData++; currency = r.client.currency || currency;
        const c = r.ads.data.current, p = r.ads.data.previous;
        now.spend += c.spend; now.clicks += c.clicks; now.impressions += c.impressions; now.conversions += c.conversions;
        if (p) { withPrev++; before.spend += p.spend; before.clicks += p.clicks; before.impressions += p.impressions; before.conversions += p.conversions; }
      }
      const meta = await metaFor((workspace.clients || []).map((c) => c.id));
      return { ...meta, scope: "all", accounts: withData, linkedAccounts: linked.length, currency, ...adsBlock(withData ? now : null, withPrev ? before : null), adsNote: linked.length ? "No Google Ads data returned yet" : "No client has a Google Ads account linked",
        visits: null, visitsNote: "Pick a client to see website visits", calls: null, profileClicks: null, businessNote: "Pick a client", leads: { value: leads, previous: null },
        google: null, rankNote: "Pick a client to see rankings", chatgpt: null, aiNote: "Pick a client", bing: null, bingNote: "Bing rank tracking isn’t set up yet" };
    }
    const [seo, ads] = await Promise.all([
      buildClientReport(db as never, workspace as never, clientId, "seo", period).catch(() => null),
      buildClientReport(db as never, workspace as never, clientId, "ads", period).catch(() => null),
    ]);
    const ok = <T,>(section?: { status: string; data?: T; note?: string }) => section?.status === "ok" ? section.data || null : null;
    const why = (section?: { status: string; note?: string }) => section && section.status !== "ok" ? section.note || "Not connected" : "";
    const traffic = ok(seo?.traffic), ranks = ok(seo?.rankings), biz = ok(seo?.business), ai = ok(seo?.aiVisibility), adsData = ok(ads?.ads);
    const positions = (ranks?.keywords || []).map((k) => k.position).filter((p): p is number => typeof p === "number" && p > 0);
    const prevPositions = (ranks?.keywords || []).map((k) => k.previousPosition).filter((p): p is number => typeof p === "number" && p > 0);
    const chatgpt = ai?.platforms.find((p) => p.platform === "chatgpt");
    const leadsNow = seo?.attribution.status === "ok" ? Object.values(seo.attribution.data!.allChannels || {}).reduce((a, b) => a + (Number(b) || 0), 0) : null;
    const meta = await metaFor([clientId]);
    return {
      ...meta,
      currency: seo?.client.currency || ads?.client.currency || "EUR",
      visits: traffic ? { value: traffic.current, previous: traffic.previous, metric: traffic.metric } : null, visitsNote: why(seo?.traffic),
      ...adsBlock(adsData ? adsData.current : null, adsData?.previous || null), adsNote: why(ads?.ads),
      calls: biz && biz.calls != null ? { value: biz.calls, previous: biz.previous?.calls ?? null } : null,
      profileClicks: biz && biz.websiteClicks != null ? { value: biz.websiteClicks, previous: biz.previous?.websiteClicks ?? null } : null, businessNote: why(seo?.business),
      leads: leadsNow != null ? { value: leadsNow, previous: null } : null,
      google: positions.length ? { position: avg(positions), previous: avg(prevPositions), tracked: positions.length, top3: positions.filter((p) => p <= 3).length } : null, rankNote: why(seo?.rankings) || (ranks && !positions.length ? "No ranking checks yet" : ""),
      chatgpt: chatgpt ? { share: chatgpt.share, previous: chatgpt.previousShare, prompts: chatgpt.prompts, mentioned: chatgpt.mentioned } : null, aiNote: why(seo?.aiVisibility),
      bing: null, bingNote: "Bing rank tracking isn’t set up yet",
    };
  };
  const appointments = async () => {
    try {
      const list = await listBookings(db as never, ownerId, scope, new Date().toISOString(), new Date(Date.now() + 21 * 86_400_000).toISOString());
      return list.filter((b) => !/cancel/i.test(b.status)).slice(0, 8).map((b) => ({ id: b.id, name: b.name, start: b.start, clientId: b.clientId, channel: b.channel, meetLink: b.meetLink }));
    } catch { return []; }
  };
  const emails = async () => {
    try {
      const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
      const where = scope === null ? "" : " AND t.client_id=?3";
      const bind = scope === null ? [ownerId, since] : [ownerId, since, scope];
      const recent = (await db.prepare(`SELECT m.body, m.created_at, t.contact, t.contact_name FROM conv_messages m JOIN conv_threads t ON t.id=m.thread_id WHERE m.owner_id=?1 AND t.channel='email' AND m.direction='out' AND m.created_at>=?2${where} ORDER BY m.created_at DESC LIMIT 6`).bind(...bind).all<{ body: string; created_at: string; contact: string; contact_name: string }>()).results || [];
      const total = (await db.prepare(`SELECT COUNT(*) AS n FROM conv_messages m JOIN conv_threads t ON t.id=m.thread_id WHERE m.owner_id=?1 AND t.channel='email' AND m.direction='out' AND m.created_at>=?2${where}`).bind(...bind).first<{ n: number }>())?.n || 0;
      return { total, recent: recent.map((r) => ({ to: r.contact_name || r.contact, subject: (r.body.split("\n")[0] || "").slice(0, 90), at: r.created_at })) };
    } catch { return { total: 0, recent: [] }; }
  };
  const [m, a, e] = await Promise.all([marketing(), appointments(), emails()]);
  return reply({ clientId, marketing: m, appointments: a, emails: e });
}
