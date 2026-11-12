import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../../../chatgpt-auth";
import { getTeamPermissions, type TeamPermissions } from "@/lib/access-permissions";
import { isBacklinkOutreachStatus, isDateOnly, validateBacklinkOutreachInput } from "@/lib/backlink-outreach";

export const dynamic = "force-dynamic";
const respond = (body: Record<string, unknown>, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

async function accessFor(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return { response: respond({ status: "unauthorized", message: "Sign in to manage backlink follow-ups." }, 401) };
  if (!env.DB) return { response: respond({ status: "unavailable", message: "The workspace database is unavailable." }, 503) };
  const clientId = new URL(request.url).searchParams.get("clientId") || "";
  const row = await env.DB.prepare("SELECT data FROM workspace_documents WHERE id = ?1").bind("f2b-agency").first<{ data: string }>();
  if (!row?.data) return { response: respond({ status: "unavailable", message: "The workspace is unavailable." }, 503) };
  const workspace = JSON.parse(row.data) as { ownerId?: string; staff?: Array<{ id: string; email?: string; isBot?: boolean; role?: string; permissions?: Partial<TeamPermissions>; clientAccessIds?: string[] }>; clients?: Array<{ id: string }> };
  const owner = workspace.ownerId === user.userId;
  const staff = (workspace.staff || []).find((item) => !item.isBot && (item.id === user.userId || item.email?.toLowerCase() === user.email.toLowerCase()));
  const admin = owner || ["Owner", "Admin"].includes(staff?.role || "");
  const permissions = owner ? { clients: true } : getTeamPermissions(staff?.role || "Viewer", staff?.permissions);
  const client = (workspace.clients || []).find((item) => item.id === clientId);
  if (!client) return { response: respond({ status: "not_found", message: "Choose a client in this workspace." }, 404) };
  if (!admin && (!permissions.clients || (Array.isArray(staff?.clientAccessIds) && !staff.clientAccessIds.includes(clientId)))) return { response: respond({ status: "forbidden", message: "Only an owner or admin with access to this client can manage backlink follow-ups." }, 403) };
  return { ownerId: String(workspace.ownerId || user.userId), clientId, db: env.DB };
}

export async function GET(request: Request) {
  const context = await accessFor(request);
  if ("response" in context) return context.response;
  try {
    const result = await context.db.prepare("SELECT outreach_id AS id, source_url AS sourceUrl, source_domain AS sourceDomain, target_url AS targetUrl, anchor, status, note, follow_up_date AS followUpDate, created_at AS createdAt, updated_at AS updatedAt FROM seo_backlink_outreach WHERE owner_id = ?1 AND client_id = ?2 ORDER BY updated_at DESC LIMIT 200").bind(context.ownerId, context.clientId).all<Record<string, unknown>>();
    return respond({ status: "connected", opportunities: result.results || [] });
  } catch (error) {
    console.error("Backlink outreach list failed", error instanceof Error ? error.message : "unknown error");
    return respond({ status: "unavailable", message: "Backlink follow-up storage is not ready. Apply the Agency OS database migrations and try again." }, 503);
  }
}

export async function POST(request: Request) {
  const context = await accessFor(request);
  if ("response" in context) return context.response;
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return respond({ status: "invalid_request", message: "The follow-up details are not valid." }, 400); }
  const validated = validateBacklinkOutreachInput(body);
  if ("error" in validated) return respond({ status: "invalid_request", message: validated.error }, 400);
  const status = isBacklinkOutreachStatus(body.status) ? body.status : "To review";
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 2000) : validated.value.note || "";
  const followUpDate = isDateOnly(body.followUpDate) ? body.followUpDate : null;
  const now = new Date().toISOString();
  try {
    await context.db.prepare("INSERT OR IGNORE INTO seo_backlink_outreach (outreach_id, owner_id, client_id, source_url, source_domain, target_url, anchor, status, note, follow_up_date, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?11)").bind(crypto.randomUUID(), context.ownerId, context.clientId, validated.value.sourceUrl, validated.value.sourceDomain, validated.value.targetUrl, validated.value.anchor || "", status, note, followUpDate, now).run();
    const record = await context.db.prepare("SELECT outreach_id AS id, source_url AS sourceUrl, source_domain AS sourceDomain, target_url AS targetUrl, anchor, status, note, follow_up_date AS followUpDate, created_at AS createdAt, updated_at AS updatedAt FROM seo_backlink_outreach WHERE owner_id = ?1 AND client_id = ?2 AND source_url = ?3 AND target_url = ?4 LIMIT 1").bind(context.ownerId, context.clientId, validated.value.sourceUrl, validated.value.targetUrl).first<Record<string, unknown>>();
    if (!record) return respond({ status: "unavailable", message: "Could not save this backlink follow-up." }, 503);
    return respond({ status: "saved", opportunity: record });
  } catch (error) {
    console.error("Backlink outreach create failed", error instanceof Error ? error.message : "unknown error");
    return respond({ status: "unavailable", message: "Backlink follow-up storage is not ready. Apply the Agency OS database migrations and try again." }, 503);
  }
}

export async function PATCH(request: Request) {
  const context = await accessFor(request);
  if ("response" in context) return context.response;
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return respond({ status: "invalid_request", message: "The follow-up update is not valid." }, 400); }
  const id = typeof body.id === "string" ? body.id.slice(0, 80) : "";
  if (!id) return respond({ status: "invalid_request", message: "Choose a saved follow-up first." }, 400);
  const current = await context.db.prepare("SELECT status, note, follow_up_date FROM seo_backlink_outreach WHERE outreach_id = ?1 AND owner_id = ?2 AND client_id = ?3").bind(id, context.ownerId, context.clientId).first<{ status: string; note: string; follow_up_date: string | null }>();
  if (!current) return respond({ status: "not_found", message: "This follow-up is no longer available." }, 404);
  const status = isBacklinkOutreachStatus(body.status) ? body.status : current.status;
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 2000) : current.note;
  const followUpDate = body.followUpDate === null ? null : isDateOnly(body.followUpDate) ? body.followUpDate : current.follow_up_date;
  await context.db.prepare("UPDATE seo_backlink_outreach SET status = ?1, note = ?2, follow_up_date = ?3, updated_at = ?4 WHERE outreach_id = ?5 AND owner_id = ?6 AND client_id = ?7").bind(status, note, followUpDate, new Date().toISOString(), id, context.ownerId, context.clientId).run();
  const record = await context.db.prepare("SELECT outreach_id AS id, source_url AS sourceUrl, source_domain AS sourceDomain, target_url AS targetUrl, anchor, status, note, follow_up_date AS followUpDate, created_at AS createdAt, updated_at AS updatedAt FROM seo_backlink_outreach WHERE outreach_id = ?1 AND owner_id = ?2 AND client_id = ?3").bind(id, context.ownerId, context.clientId).first<Record<string, unknown>>();
  return respond({ status: "saved", opportunity: record });
}
