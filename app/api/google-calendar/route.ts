import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getChatGPTUser();
  if (!user || !env.DB) return Response.json({ connected: false, error: "Sign in to check Google Calendar." }, { status: 401, headers: { "Cache-Control": "no-store" } });
  const row = await env.DB.prepare("SELECT data FROM workspace_documents WHERE id = 'f2b-agency'").first<{ data: string }>();
  if (!row) return Response.json({ connected: false }, { headers: { "Cache-Control": "no-store" } });
  const data = JSON.parse(row.data);
  const admin = data.ownerId === user.userId || data.staff?.some((person: { email?: string; role?: string }) => person.email?.toLowerCase() === user.email.toLowerCase() && ["Owner", "Admin"].includes(person.role || ""));
  if (!admin) return Response.json({ connected: false, error: "Only an agency owner or admin can manage the calendar connection." }, { status: 403, headers: { "Cache-Control": "no-store" } });
  const saved = await env.DB.prepare("SELECT account_email, connected_at FROM google_calendar_connections WHERE owner_id = ?1").bind(data.ownerId).first<{ account_email: string; connected_at: string }>();
  const counts = await env.DB.prepare("SELECT COUNT(*) AS synced FROM google_calendar_task_events WHERE owner_id = ?1").bind(data.ownerId).first<{ synced: number }>();
  return Response.json({ connected: Boolean(saved), accountEmail: saved?.account_email || "", connectedAt: saved?.connected_at || "", syncedCount: counts?.synced || 0, available: Boolean(env.GOOGLE_ADS_CLIENT_ID && env.GOOGLE_ADS_CLIENT_SECRET && env.GOOGLE_ADS_TOKEN_ENCRYPTION_KEY) }, { headers: { "Cache-Control": "no-store" } });
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user || !env.DB) return Response.json({ error: "Sign in before syncing task dates." }, { status: 401 });
  const workspaceRow = await env.DB.prepare("SELECT data FROM workspace_documents WHERE id = 'f2b-agency'").first<{ data: string }>();
  if (!workspaceRow) return Response.json({ error: "Workspace is unavailable." }, { status: 503 });
  const workspace = JSON.parse(workspaceRow.data);
  const member = workspace.staff?.find((person: { id: string; email?: string; role?: string }) => person.email?.toLowerCase() === user.email.toLowerCase());
  const admin = workspace.ownerId === user.userId || Boolean(member && ["Owner", "Admin"].includes(member.role || ""));
  if (!admin && !member) return Response.json({ error: "You do not have access to sync workspace task dates." }, { status: 403 });
  try {
    const body = await request.json() as { taskIds?: unknown };
    const requestedTaskIds = Array.isArray(body.taskIds) ? [...new Set(body.taskIds.filter((id): id is string => typeof id === "string" && id.length <= 128))].slice(0, 100) : [];
    const taskIds = admin ? requestedTaskIds : requestedTaskIds.filter((id) => workspace.tasks?.some((task: { id: string; assigneeId?: string }) => task.id === id && task.assigneeId === member.id));
    if (!taskIds.length) return Response.json({ synced: 0, removed: 0, connected: false });
    const { syncGoogleCalendarTasks } = await import("@/lib/google-calendar");
    return Response.json(await syncGoogleCalendarTasks(workspace.ownerId, workspace, taskIds), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not sync task dates with Google Calendar." }, { status: 502 });
  }
}
