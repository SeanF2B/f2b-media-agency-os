import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";
import { fullTeamPermissions, getTeamPermissions, type TeamPermissions } from "@/lib/access-permissions";
import { buildClientReport } from "@/lib/client-report-data";
import { listBookings } from "@/lib/scheduling/server";

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
  const workspace = JSON.parse(row.data) as { ownerId?: string; staff?: Staff[]; clients?: Array<{ id: string; name: string }> };
  const ownerId = String(workspace.ownerId || "");
  const owner = ownerId === user.userId;
  const staff = (workspace.staff || []).find((item) => !item.isBot && (item.id === user.userId || item.email?.toLowerCase() === user.email.toLowerCase()));
  const admin = owner || ["Owner", "Admin"].includes(staff?.role || "");
  if (!admin && !staff) return reply({ error: "You do not have access." }, 403);
  const permissions = owner ? fullTeamPermissions : getTeamPermissions(staff?.role || "Viewer", staff?.permissions);
  const allowedIds = admin || !staff?.limitClientAccess ? null : staff.clientAccessIds || [];
  const url = new URL(request.url);
  let clientId = (url.searchParams.get("clientId") || "").slice(0, 120);
  if (clientId && !(workspace.clients || []).some((client) => client.id === clientId)) clientId = "";
  if (clientId && allowedIds && !allowedIds.includes(clientId)) return reply({ error: "You do not have access to this client." }, 403);
  const scope: string | null = clientId || (allowedIds ? allowedIds[0] || "none" : null);

  const marketing = async () => {
    if (!clientId || !(admin || permissions.reports)) return null;
    const period = { start: day(-30), end: day(0) };
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
    return {
      currency: seo?.client.currency || ads?.client.currency || "EUR",
      visits: traffic ? { value: traffic.current, previous: traffic.previous, metric: traffic.metric } : null, visitsNote: why(seo?.traffic),
      adSpend: adsData ? { value: adsData.current.spend, previous: adsData.previous?.spend ?? null } : null,
      adClicks: adsData ? { value: adsData.current.clicks, previous: adsData.previous?.clicks ?? null } : null, adsNote: why(ads?.ads),
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
