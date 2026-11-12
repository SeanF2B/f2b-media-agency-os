import { getChatGPTUser } from "../../../chatgpt-auth";
import { env } from "cloudflare:workers";
import { fullTeamPermissions, getTeamPermissions, type TeamPermissions } from "@/lib/access-permissions";
import { canViewAiAssignedTask, isAiAssignedTask } from "@/lib/ai-task-access";

export const dynamic = "force-dynamic";

type Staff = { id: string; name: string; email: string; role: string; isBot?: boolean; permissions?: Partial<TeamPermissions>; clientAccessIds?: string[]; aiModeAccess?: string[] };
type LiveTask = { id: string; clientId: string; assigneeId: string; aiMode?: string; service?: string; [key: string]: unknown };

function canManage(data: { ownerId?: string; staff?: Staff[] }, user: { userId: string; email: string }) {
  return data.ownerId === user.userId || data.staff?.some((member) => !member.isBot && member.email?.toLowerCase() === user.email.toLowerCase() && ["Owner", "Admin"].includes(member.role));
}

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in with ChatGPT to open AI task updates." }, { status: 401 });
  if (!env.DB) return Response.json({ error: "The private workspace database is not connected yet." }, { status: 503 });

  try {
    // Extract only the task, team, and client fragments needed for live AI cards.
    // This avoids parsing and serializing the full workspace on every short poll.
    const row = await env.DB.prepare(`
      SELECT
        json_extract(data, '$.ownerId') AS owner_id,
        json_extract(data, '$.staff') AS staff_json,
        (SELECT json_group_array(json(value))
          FROM json_each(data, '$.tasks')
          WHERE json_extract(value, '$.assigneeId') LIKE 'f2b-ai-agent%') AS tasks_json,
        (SELECT json_group_array(json_object(
          'id', json_extract(client.value, '$.id'),
          'name', json_extract(client.value, '$.name'),
          'color', json_extract(client.value, '$.color'),
          'logo', json_extract(client.value, '$.logo'),
          'googleAdsAccountId', json_extract(client.value, '$.googleAdsAccountId')
        ))
          FROM json_each(data, '$.clients') AS client
          WHERE json_extract(client.value, '$.id') IN (
            SELECT json_extract(task.value, '$.clientId')
            FROM json_each(data, '$.tasks') AS task
            WHERE json_extract(task.value, '$.assigneeId') LIKE 'f2b-ai-agent%'
          )) AS clients_json
      FROM workspace_documents WHERE id = ?1
    `).bind("f2b-agency").first<{ owner_id: string | null; staff_json: string | null; tasks_json: string | null; clients_json: string | null }>();

    if (!row) return Response.json({ tasks: [], clients: [] });
    const staff = row.staff_json ? JSON.parse(row.staff_json) as Staff[] : [];
    const data = { ownerId: row.owner_id || undefined, staff };
    const manager = canManage(data, user);
    const profile = staff.find((member) => !member.isBot && (member.id === user.userId || member.email?.toLowerCase() === user.email.toLowerCase()));
    if (data.ownerId !== user.userId && !profile) return Response.json({ error: "Your account is not on the F2B team yet." }, { status: 403 });

    const permissions = data.ownerId === user.userId ? fullTeamPermissions : getTeamPermissions(profile?.role || "Viewer", profile?.permissions);
    const allowedClientIds = Array.isArray(profile?.clientAccessIds) ? new Set(profile.clientAccessIds) : null;
    const allowedAiModes = manager ? ["Google Ads", "SEO", "Audit", "Research", "Setup", "Sites"] : Array.isArray(profile?.aiModeAccess) ? profile.aiModeAccess : ["Google Ads", "SEO", "Audit", "Research", "Setup", "Sites"];
    const allTasks = row.tasks_json ? JSON.parse(row.tasks_json) as LiveTask[] : [];
    const tasks = allTasks.filter((task) => isAiAssignedTask(task)
      && canViewAiAssignedTask(task, permissions, allowedAiModes)
      && (!allowedClientIds || !task.clientId || allowedClientIds.has(task.clientId)));
    const taskClientIds = new Set(tasks.map((task) => task.clientId).filter(Boolean));
    const clients = row.clients_json ? (JSON.parse(row.clients_json) as Array<{ id: string }>).filter((client) => taskClientIds.has(client.id)) : [];

    return Response.json({ tasks, clients }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not refresh AI task progress." }, { status: 500 });
  }
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in with ChatGPT to control AI tasks." }, { status: 401 });
  if (!env.DB) return Response.json({ error: "The private workspace database is not connected yet." }, { status: 503 });

  let body: { taskId?: string; action?: string };
  try { body = await request.json() as typeof body; } catch { return Response.json({ error: "Invalid cancellation request." }, { status: 400 }); }
  if (body.action !== "cancel" || typeof body.taskId !== "string" || !body.taskId.trim()) return Response.json({ error: "Choose a task that is currently running." }, { status: 400 });

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const row = await env.DB.prepare("SELECT data, updated_at FROM workspace_documents WHERE id = ?1").bind("f2b-agency").first<{ data: string; updated_at: string }>();
    if (!row?.data) return Response.json({ error: "The workspace could not be loaded." }, { status: 404 });
    let data: any;
    try { data = JSON.parse(row.data); } catch { return Response.json({ error: "The workspace data could not be read." }, { status: 500 }); }
    if (!canManage(data, user)) return Response.json({ error: "Only an owner or admin can cancel a Connors run." }, { status: 403 });
    const task = (data.tasks || []).find((item: LiveTask) => item.id === body.taskId && isAiAssignedTask(item));
    if (!task || task.aiRunState !== "running") return Response.json({ error: "This task is no longer running, so there is nothing to cancel." }, { status: 409 });
    if (task.aiCancelRequestedAt) return Response.json({ task, message: "Connors is already stopping at the next safe checkpoint." });

    const at = new Date().toISOString();
    const actor = data.staff?.find((member: Staff) => !member.isBot && (member.id === user.userId || member.email?.toLowerCase() === user.email.toLowerCase()));
    const updatedTask = { ...task, aiCancelRequestedAt: at, aiCancelRequestedBy: actor?.name || user.email, aiProgressText: "Stopping safely…", aiProgressAt: at };
    const client = data.clients?.find((item: any) => item.id === task.clientId);
    const event = { id: crypto.randomUUID(), title: "AI task cancellation requested", detail: `${task.title} · ${client?.name || "Client"} · ${task.aiMode || task.service}`, icon: "⏹️", at, actor: actor?.name || user.email, actorAvatar: actor?.avatar || "", staffId: user.userId, clientId: task.clientId, taskId: task.id, service: task.aiMode || task.service, kind: "task", note: `${actor?.name || user.email} asked Connors to stop. It will stop at the next safe checkpoint; a request already sent to an external service cannot be recalled.` };
    const next = { ...data, tasks: data.tasks.map((item: any) => item.id === task.id ? updatedTask : item), activity: [event, ...(data.activity || [])].slice(0, 100) };
    const revision = `ai-cancel-${crypto.randomUUID()}`;
    const result = await env.DB.prepare("UPDATE workspace_documents SET data = ?1, updated_at = ?2 WHERE id = ?3 AND updated_at = ?4")
      .bind(JSON.stringify(next), revision, "f2b-agency", row.updated_at).run();
    if (result.meta.changes === 1) return Response.json({ task: updatedTask, message: "Cancellation requested. Connors will stop safely after the current check." }, { headers: { "Cache-Control": "no-store" } });
  }
  return Response.json({ error: "The task changed while cancellation was being saved. Try again." }, { status: 409 });
}
