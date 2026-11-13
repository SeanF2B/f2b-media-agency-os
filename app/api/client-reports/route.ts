import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";
import { fullTeamPermissions, getTeamPermissions, type TeamPermissions } from "@/lib/access-permissions";
import { buildClientReport, type ReportType } from "@/lib/client-report-data";
import { renderClientReportHtml } from "@/lib/client-report-render";
import { listClientReports, readClientReportHtml, saveClientReport } from "@/lib/client-report-archive";
import { resolveAgencyLogoUrl } from "@/lib/report-branding";

// Visual SEO / Google Ads client reports. GET builds a live report (cached API reads) as JSON or HTML;
// ?history=1 lists saved reports; ?archiveId= returns a saved report's HTML. POST saves one to history.
export const dynamic = "force-dynamic";
const reply = (body: Record<string, unknown>, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
type Staff = { id: string; email: string; role: string; isBot?: boolean; permissions?: Partial<TeamPermissions>; clientAccessIds?: string[]; limitClientAccess?: boolean };

async function context(clientId: string) {
  const user = await getChatGPTUser();
  if (!user) return { response: reply({ error: "Sign in first." }, 401) };
  if (!env.DB) return { response: reply({ error: "The workspace database is unavailable." }, 503) };
  const row = await env.DB.prepare("SELECT data FROM workspace_documents WHERE id = 'f2b-agency'").first<{ data: string }>();
  if (!row?.data) return { response: reply({ error: "The workspace is unavailable." }, 503) };
  const workspace = JSON.parse(row.data) as { ownerId?: string; staff?: Staff[]; clients?: Array<{ id: string }> };
  const owner = workspace.ownerId === user.userId;
  const staff = (workspace.staff || []).find((item) => !item.isBot && (item.id === user.userId || item.email?.toLowerCase() === user.email.toLowerCase()));
  const admin = owner || ["Owner", "Admin"].includes(staff?.role || "");
  const permissions = owner ? fullTeamPermissions : getTeamPermissions(staff?.role || "Viewer", staff?.permissions);
  if (!admin && !permissions.reports) return { response: reply({ error: "You do not have permission to view client reports." }, 403) };
  if (!(workspace.clients || []).some((client) => client.id === clientId)) return { response: reply({ error: "Choose a client in this workspace." }, 404) };
  if (!admin && staff?.limitClientAccess && !(staff.clientAccessIds || []).includes(clientId)) return { response: reply({ error: "You do not have access to this client." }, 403) };
  return { db: env.DB, workspace, ownerId: String(workspace.ownerId || "") };
}

const validDate = (value: string) => /^\d{4}-\d{2}-\d{2}$/.test(value) && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
function readPeriod(url: URL | Record<string, unknown>) {
  const get = (key: string) => String(url instanceof URL ? url.searchParams.get(key) || "" : url[key] || "");
  const type = get("type") === "ads" ? "ads" : get("type") === "seo" ? "seo" : "";
  const start = get("start"), end = get("end");
  if (!type) return { error: "Choose an SEO or Google Ads report." };
  if (!validDate(start) || !validDate(end) || start > end) return { error: "Choose a valid reporting period." };
  const today = new Date().toISOString().slice(0, 10);
  if (start > today) return { error: "The reporting period cannot start in the future." };
  if ((Date.parse(end) - Date.parse(start)) / 86_400_000 > 366) return { error: "Choose a period of one year or less." };
  return { type: type as ReportType, start, end: end > today ? today : end };
}

export async function GET(request: Request) {
  const url = new URL(request.url);
  const ctx = await context(url.searchParams.get("clientId") || "");
  if ("response" in ctx) return ctx.response;
  const origin = url.origin;
  if (url.searchParams.get("history") === "1") return reply({ reports: await listClientReports(ctx.db, ctx.ownerId, url.searchParams.get("clientId") || "") });
  const archiveId = url.searchParams.get("archiveId");
  if (archiveId) {
    const html = await readClientReportHtml(ctx.db, env.BUCKET as never, ctx.ownerId, archiveId.slice(0, 80));
    return html ? new Response(html, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex" } }) : reply({ error: "That saved report could not be found." }, 404);
  }
  const period = readPeriod(url);
  if ("error" in period) return reply({ error: period.error }, 400);
  try {
    const report = await buildClientReport(ctx.db, ctx.workspace as never, url.searchParams.get("clientId") || "", period.type, { start: period.start, end: period.end });
    if (url.searchParams.get("format") === "html") return new Response(renderClientReportHtml(report, { origin, agencyIconUrl: resolveAgencyLogoUrl(origin) }), { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "private, no-store", "X-Robots-Tag": "noindex" } });
    return reply({ report });
  } catch (error) { return reply({ error: error instanceof Error ? error.message : "The report could not be built." }, 500); }
}

export async function POST(request: Request) {
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return reply({ error: "Invalid request." }, 400); }
  const ctx = await context(String(body.clientId || ""));
  if ("response" in ctx) return ctx.response;
  const period = readPeriod(body);
  if ("error" in period) return reply({ error: period.error }, 400);
  try {
    const saved = await saveClientReport(ctx.db, env.BUCKET as never, ctx.workspace as never, String(body.clientId), period.type, { start: period.start, end: period.end }, "manual", new URL(request.url).origin);
    return reply({ ok: true, id: saved.id, reports: await listClientReports(ctx.db, ctx.ownerId, String(body.clientId)) });
  } catch (error) { return reply({ error: error instanceof Error ? error.message : "The report could not be saved." }, 500); }
}
