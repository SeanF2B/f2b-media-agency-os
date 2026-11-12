import { getChatGPTUser } from "../../../chatgpt-auth";
import { env } from "cloudflare:workers";
import { canResumeAiTaskRun, hasRunnablePendingApproval } from "@/lib/ai-task-lifecycle";
import { isAiAssignedTask } from "@/lib/ai-task-access";

export const dynamic = "force-dynamic";

type StartTask = {
  id: string;
  title: string;
  clientId?: string;
  assigneeId?: string;
  aiMode?: string;
  service?: string;
  aiRunState?: string;
  aiStartNowRequestedAt?: string;
  aiDismissedAt?: string;
  aiRunAttempt?: number;
  status?: string;
  aiApprovals?: Array<{ status: string; [key: string]: unknown }>;
  checklist?: Array<{ done: boolean; evidence?: string; [key: string]: unknown }>;
  [key: string]: unknown;
};

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in with ChatGPT to start AI tasks." }, { status: 401 });
  if (!env.DB) return Response.json({ error: "The private workspace database is not connected." }, { status: 503 });

  let taskId = "";
  try {
    const body = await request.json() as { taskId?: unknown };
    taskId = typeof body.taskId === "string" ? body.taskId.trim().slice(0, 120) : "";
  } catch { /* Report the same simple input error below. */ }
  if (!taskId) return Response.json({ error: "Choose an AI task to start." }, { status: 400 });

  for (let attempt = 0; attempt < 3; attempt += 1) {
    const row = await env.DB.prepare(`
      SELECT workspace.updated_at,
        (workspace.owner_id = ?1 OR lower(json_extract(workspace.data, '$.settings.adminEmail')) = lower(?2)
          OR EXISTS (SELECT 1 FROM json_each(workspace.data, '$.staff') member
            WHERE lower(json_extract(member.value, '$.email')) = lower(?2)
              AND json_extract(member.value, '$.isBot') IS NOT 1
              AND json_extract(member.value, '$.role') IN ('Owner', 'Admin'))) AS can_manage,
        CAST(task.key AS INTEGER) AS task_index,
        task.value AS task_json
      FROM workspace_documents workspace, json_each(workspace.data, '$.tasks') task
      WHERE workspace.id = 'f2b-agency' AND json_extract(task.value, '$.id') = ?3
      LIMIT 1
    `).bind(user.userId, user.email, taskId).first<{ updated_at: string; can_manage: number; task_index: number; task_json: string }>();

    if (!row) return Response.json({ error: "That task could not be found." }, { status: 404 });
    if (!row.can_manage) return Response.json({ error: "Only an owner or admin can start an AI task." }, { status: 403 });

    let task: StartTask;
    try { task = JSON.parse(row.task_json) as StartTask; }
    catch { return Response.json({ error: "This task could not be read. Refresh the board and try again." }, { status: 500 }); }
    if (!isAiAssignedTask(task) || task.aiDismissedAt || task.status === "Done") return Response.json({ error: "This task is not available to start." }, { status: 409 });
    if (task.aiStartNowRequestedAt) return Response.json({ task, alreadyStarted: true }, { headers: { "Cache-Control": "no-store" } });

    const scheduled = task.aiRunState === "scheduled";
    const retryable = canResumeAiTaskRun(task.aiRunState, task.aiApprovals || [], task.checklist || []);
    if (!scheduled && !retryable) return Response.json({ error: "This task cannot be started from its current state." }, { status: 409 });
    const pending = (task.aiApprovals || []).filter((approval) => approval.status === "pending");
    const blockedPendingOnly = pending.length > 0 && !hasRunnablePendingApproval(pending, task.checklist || []);
    if ((task.aiApprovals || []).some((approval) => approval.status === "applying") || pending.length > 0 && !blockedPendingOnly) {
      return Response.json({ error: "Resolve the ready Ads approvals before restarting this task." }, { status: 409 });
    }

    const index = Number(row.task_index);
    if (!Number.isInteger(index) || index < 0) return Response.json({ error: "This task could not be updated safely." }, { status: 409 });
    const path = `$.tasks[${index}]`;
    const now = new Date().toISOString();
    const activity = {
      id: crypto.randomUUID(),
      title: retryable ? "AI task retry started" : "AI task start requested",
      detail: `${task.title} · ${task.aiMode || task.service || "AI task"}`,
      icon: "▶️",
      at: now,
      actor: user.displayName || user.email,
      staffId: user.userId,
      clientId: task.clientId || "",
      taskId: task.id,
      service: task.aiMode || task.service || "AI task",
      kind: "task",
      note: "Moved to Doing. The task card and checklist are unchanged.",
    };
    const updated = await env.DB.prepare(`
      UPDATE workspace_documents
      SET data = json_set(
        json_remove(data,
          ?1 || '.pendingReason', ?1 || '.pendingReasonBy', ?1 || '.pendingReasonAt',
          ?1 || '.aiCancelRequestedAt', ?1 || '.aiCancelRequestedBy', ?1 || '.aiCancelledAt', ?1 || '.aiCancelledBy'),
        ?1 || '.status', 'In progress',
        ?1 || '.dueAt', ?2,
        ?1 || '.aiStartNowRequestedAt', ?2,
        ?1 || '.aiRunAttempt', ?3,
        ?1 || '.aiProgressText', 'Starting now',
        ?1 || '.aiProgressAt', ?2,
        '$.activity', json_insert(json(COALESCE(json_extract(data, '$.activity'), '[]')), '$[#]', json(?4))
      ), updated_at = ?5
      WHERE id = 'f2b-agency' AND updated_at = ?6
    `).bind(path, now, Math.max(0, Number(task.aiRunAttempt) || 0) + 1, JSON.stringify(activity), `ai-start-${crypto.randomUUID()}`, row.updated_at).run();

    if (updated.meta.changes === 1) {
      const startedTask = { ...task, status: "In progress", dueAt: now, aiStartNowRequestedAt: now, aiRunAttempt: Math.max(0, Number(task.aiRunAttempt) || 0) + 1, aiCancelRequestedAt: undefined, aiCancelRequestedBy: undefined, aiCancelledAt: undefined, aiCancelledBy: undefined, pendingReason: undefined, pendingReasonBy: undefined, pendingReasonAt: undefined, aiProgressText: "Starting now", aiProgressAt: now };
      return Response.json({ task: startedTask, activity }, { headers: { "Cache-Control": "no-store" } });
    }
  }

  return Response.json({ error: "The task changed while starting. Refresh the board and try once more." }, { status: 409 });
}
