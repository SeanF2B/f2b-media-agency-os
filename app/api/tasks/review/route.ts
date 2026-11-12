import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../../chatgpt-auth";
import { getTeamPermissions, type TeamPermissions } from "@/lib/access-permissions";
import { isAiAssignedTask } from "@/lib/ai-task-access";

export const dynamic = "force-dynamic";

type Staff = { id: string; name: string; email: string; role: string; isBot?: boolean; permissions?: Partial<TeamPermissions> };
type ReviewTask = { id: string; title: string; clientId?: string; service?: string; assigneeId?: string; status: string; completedAt?: string; reviewStatus?: string; reviewSubmittedAt?: string; reviewSubmittedBy?: string; reviewSubmissionNote?: string; reviewApproverId?: string; reviewNote?: string; reviewDecidedAt?: string; reviewDecidedBy?: string; reviewHistory?: Array<{ id: string; action: string; at: string; by: string; note?: string }> };

function isManager(data: { ownerId?: string; staff?: Staff[] }, user: { userId: string; email: string }) {
  return data.ownerId === user.userId || data.staff?.some((member) => !member.isBot && member.email?.toLowerCase() === user.email.toLowerCase() && ["Owner", "Admin"].includes(member.role));
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in before sending a task for review." }, { status: 401 });
  if (!env.DB) return Response.json({ error: "The workspace database is unavailable." }, { status: 503 });

  let body: { action?: string; taskId?: string; taskIds?: string[]; note?: string; approverId?: string };
  try { body = await request.json() as typeof body; } catch { return Response.json({ error: "The review request was not valid." }, { status: 400 }); }
  const action = body.action;
  const taskId = typeof body.taskId === "string" ? body.taskId.trim().slice(0, 128) : "";
  const taskIds = Array.isArray(body.taskIds) ? [...new Set(body.taskIds.filter((id): id is string => typeof id === "string").map((id) => id.trim().slice(0, 128)).filter(Boolean))] : [];
  const note = typeof body.note === "string" ? body.note.trim().slice(0, 2000) : "";
  const approverId = typeof body.approverId === "string" ? body.approverId.trim().slice(0, 128) : "";
  if (action === "approve_all") {
    if (!taskIds.length) return Response.json({ error: "Choose at least one pending task." }, { status: 400 });
  } else if (!taskId || !["submit", "approve", "request_changes"].includes(action || "")) return Response.json({ error: "Choose a task and a review action." }, { status: 400 });
  if (action === "request_changes" && note.length < 3) return Response.json({ error: "Add a short note explaining what needs to change." }, { status: 400 });

  for (let attempt = 0; attempt < 4; attempt += 1) {
    const row = await env.DB.prepare("SELECT data, updated_at FROM workspace_documents WHERE id = ?1").bind("f2b-agency").first<{ data: string; updated_at: string }>();
    if (!row?.data) return Response.json({ error: "The workspace could not be loaded." }, { status: 404 });
    let data: any;
    try { data = JSON.parse(row.data); } catch { return Response.json({ error: "The workspace data could not be read." }, { status: 500 }); }

    const profile = (data.staff || []).find((member: Staff) => !member.isBot && (member.id === user.userId || member.email?.toLowerCase() === user.email.toLowerCase())) as Staff | undefined;
    const manager = isManager(data, user);
    const permissions = data.ownerId === user.userId ? undefined : getTeamPermissions(profile?.role || "Viewer", profile?.permissions);
    if (action === "approve_all") {
      if (!manager) return Response.json({ error: "Only an owner or admin can approve all selected staff tasks." }, { status: 403 });
      const selected = new Set(taskIds);
      const at = new Date().toISOString();
      const actor = profile?.name || user.displayName || user.email;
      const approved: ReviewTask[] = [];
      const events: Array<Record<string, unknown>> = [];
      const nextTasks = (data.tasks || []).map((candidate: ReviewTask) => {
        if (!selected.has(candidate.id) || candidate.reviewStatus !== "submitted" || isAiAssignedTask(candidate)) return candidate;
        const nextTask: ReviewTask = { ...candidate, status: "Done", completedAt: at, reviewStatus: "approved", reviewDecidedAt: at, reviewDecidedBy: actor };
        nextTask.reviewHistory = [...(candidate.reviewHistory || []), { id: crypto.randomUUID(), action: "approved", at, by: actor }].slice(-100);
        approved.push(nextTask);
        events.push({ id: crypto.randomUUID(), title: "Staff task approved", detail: `${candidate.title} · ${data.clients?.find((client: any) => client.id === candidate.clientId)?.name || "Internal"}`, icon: "✅", at, actor, staffId: profile?.id || user.userId, clientId: candidate.clientId, taskId: candidate.id, service: candidate.service, kind: "task" });
        return nextTask;
      });
      if (!approved.length) return Response.json({ error: "Those tasks are no longer waiting for approval. Refresh the queue and try again." }, { status: 409 });
      const next = { ...data, tasks: nextTasks, activity: [...events, ...(data.activity || [])].slice(0, 100) };
      const saved = await env.DB.prepare("UPDATE workspace_documents SET data = ?1, updated_at = ?2 WHERE id = ?3 AND updated_at = ?4")
        .bind(JSON.stringify(next), `staff-review-bulk-${crypto.randomUUID()}`, "f2b-agency", row.updated_at).run();
      if (saved.meta.changes === 1) return Response.json({ tasks: approved, events, approvedCount: approved.length }, { headers: { "Cache-Control": "no-store" } });
      continue;
    }
    const task = (data.tasks || []).find((item: ReviewTask) => item.id === taskId) as ReviewTask | undefined;
    if (!task || isAiAssignedTask(task)) return Response.json({ error: "That staff task could not be found." }, { status: 404 });

    let nextTask: ReviewTask;
    let title: string;
    let icon: string;
    let detail: string;
    let historyAction: string;
    if (action === "submit") {
      if (!profile || (data.ownerId !== user.userId && !permissions?.tasks) || task.assigneeId !== profile.id) return Response.json({ error: "Only the teammate assigned to this task can submit it for review." }, { status: 403 });
      if (task.status === "Done" || task.reviewStatus === "submitted") return Response.json({ error: "This task is already complete or waiting for review." }, { status: 409 });
      const approver = (data.staff || []).find((member: Staff) => member.id === approverId && !member.isBot && getTeamPermissions(member.role, member.permissions).tasks);
      if (!approver) return Response.json({ error: "Choose a teammate with task access to review this task." }, { status: 400 });
      nextTask = { ...task, status: "Blocked", reviewStatus: "submitted", reviewSubmittedAt: new Date().toISOString(), reviewSubmittedBy: profile.name, reviewApproverId: approver.id, ...(note ? { reviewSubmissionNote: note } : {}) };
      title = "Task submitted for approval"; icon = "📨"; historyAction = "submitted";
      detail = `${task.title} · ${data.clients?.find((client: any) => client.id === task.clientId)?.name || "Internal"} · sent to ${approver.name}`;
    } else {
      if (task.reviewStatus !== "submitted") return Response.json({ error: "This task is no longer waiting for review." }, { status: 409 });
      const isSelectedApprover = Boolean(manager || task.reviewApproverId && profile && task.reviewApproverId === profile.id && (data.ownerId === user.userId || permissions?.tasks));
      if (task.reviewApproverId ? !isSelectedApprover : !manager) return Response.json({ error: task.reviewApproverId ? "This task was sent to a different approver." : "Only an owner or admin can decide an older, unassigned review." }, { status: 403 });
      const at = new Date().toISOString();
      if (action === "approve") {
        nextTask = { ...task, status: "Done", completedAt: at, reviewStatus: "approved", reviewDecidedAt: at, reviewDecidedBy: profile?.name || user.displayName || "Workspace owner" };
        title = "Staff task approved"; icon = "✅"; historyAction = "approved";
      } else {
        nextTask = { ...task, status: "In progress", reviewStatus: "changes_requested", reviewNote: note, reviewDecidedAt: at, reviewDecidedBy: profile?.name || user.displayName || "Workspace owner" };
        title = "Changes requested on staff task"; icon = "↩️"; historyAction = "changes_requested";
      }
      detail = `${task.title} · ${data.clients?.find((client: any) => client.id === task.clientId)?.name || "Internal"}`;
    }

    const at = new Date().toISOString();
    const actor = profile?.name || user.displayName || user.email;
    const entry = { id: crypto.randomUUID(), action: historyAction, at, by: actor, ...(note ? { note } : {}) };
    nextTask.reviewHistory = [...(task.reviewHistory || []), entry].slice(-100);
    const event = { id: crypto.randomUUID(), title, detail, icon, at, actor, staffId: profile?.id || user.userId, clientId: task.clientId, taskId: task.id, service: task.service, kind: "task", ...(note ? { note } : {}) };
    const next = { ...data, tasks: data.tasks.map((item: ReviewTask) => item.id === task.id ? nextTask : item), activity: [event, ...(data.activity || [])].slice(0, 100) };
    const saved = await env.DB.prepare("UPDATE workspace_documents SET data = ?1, updated_at = ?2 WHERE id = ?3 AND updated_at = ?4")
      .bind(JSON.stringify(next), `staff-review-${crypto.randomUUID()}`, "f2b-agency", row.updated_at).run();
    if (saved.meta.changes === 1) return Response.json({ task: nextTask, event }, { headers: { "Cache-Control": "no-store" } });
  }
  return Response.json({ error: "The task changed while review was being saved. Refresh and try again." }, { status: 409 });
}
