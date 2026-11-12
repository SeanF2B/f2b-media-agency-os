import { getChatGPTUser } from "../../../chatgpt-auth";
import { env } from "cloudflare:workers";
import { fullTeamPermissions, getTeamPermissions } from "@/lib/access-permissions";

export const dynamic = "force-dynamic";
const modes = ["Google Ads", "SEO", "Audit", "Research", "Setup", "Sites"];
const repeats = ["None", "Daily", "Weekly", "Fortnightly", "Monthly"];
const aiAssigneeId = "f2b-ai-agent";

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in to schedule an AI task." }, { status: 401 });
  if (!env.DB) return Response.json({ error: "The private workspace database is not connected." }, { status: 503 });
  try {
    const body = await request.json() as { clientId?: string; service?: string; title?: string; due?: string; dueAt?: string; repeat?: string; assigneeId?: string; notes?: string; campaignId?: string; campaignName?: string; campaignContext?: string; aiReferenceFileId?: string; aiReferenceFileName?: string };
    const clientId = String(body.clientId || "").slice(0, 120);
    const service = String(body.service || "").slice(0, 80);
    const title = String(body.title || "").trim().slice(0, 180);
    const due = String(body.due || "").slice(0, 10);
    const dueAt = String(body.dueAt || "").slice(0, 40);
    const repeat = repeats.includes(String(body.repeat)) ? String(body.repeat) : "None";
    const notes = String(body.notes || "").trim().slice(0, 4000);
    const campaignId = (service === "Google Ads" || service === "Audit") ? String(body.campaignId || "").replace(/\D/g, "").slice(0, 20) : "";
    const campaignName = campaignId ? String(body.campaignName || "").trim().slice(0, 160) : "";
    if (!clientId || !modes.includes(service) || !title || !due || !dueAt || !Number.isFinite(Date.parse(dueAt))) {
      return Response.json({ error: "Choose a client and AI mode, then enter a task name and valid run date/time." }, { status: 400 });
    }
    const row = await env.DB.prepare("SELECT data, updated_at FROM workspace_documents WHERE id = ?1").bind("f2b-agency").first<{ data: string; updated_at: string }>();
    if (!row) return Response.json({ error: "The agency workspace is not available." }, { status: 503 });
    const data = JSON.parse(row.data);
    const aiAssigneeIdForTask = String(body.assigneeId || aiAssigneeId).slice(0, 120);
    const aiAssignee = data.staff?.find((member: any) => member.id === aiAssigneeIdForTask && member.isBot);
    const aiAgentName = aiAssignee?.name || "AI teammate";
    if (!aiAssignee || (data.hiddenAiAgentIds || []).includes(aiAssigneeIdForTask)) return Response.json({ error: "Choose an active AI agent from Team before scheduling this run." }, { status: 409 });
    const profile = data.staff?.find((member: any) => !member.isBot && (member.id === user.userId || member.email?.toLowerCase() === user.email.toLowerCase()));
    const admin = data.ownerId === user.userId || ["Owner", "Admin"].includes(profile?.role || "");
    const permissions = data.ownerId === user.userId ? fullTeamPermissions : getTeamPermissions(profile?.role || "Viewer", profile?.permissions);
    const scopedClient = Array.isArray(profile?.clientAccessIds);
    const hasClient = (data.clients || []).some((client: any) => client.id === clientId);
    const clientAllowed = admin || (hasClient && (scopedClient ? profile.clientAccessIds.includes(clientId) : permissions.clients || permissions.tasks && (data.tasks || []).some((task: any) => task.clientId === clientId && task.assigneeId === profile?.id)));
    const modeAllowed = admin || (permissions.aiAssistant && (Array.isArray(profile?.aiModeAccess) ? profile.aiModeAccess.includes(service) : true));
    if (!clientAllowed || !modeAllowed) return Response.json({ error: "Your profile cannot schedule AI work for this client or mode." }, { status: 403 });
    if (!admin && aiAssigneeIdForTask !== aiAssigneeId) return Response.json({ error: "Only an owner or admin can assign this task to a different AI agent." }, { status: 403 });
    const client = data.clients.find((item: any) => item.id === clientId);
    if (service === "Sites" && !client?.wordpressSiteUrl) return Response.json({ error: "Add this client’s WordPress website URL before scheduling a Sites task." }, { status: 400 });
    const aiReferenceFileId = service === "Sites" ? String(body.aiReferenceFileId || "").slice(0, 120) : "";
    const aiReferenceFileName = service === "Sites" ? String(body.aiReferenceFileName || "").slice(0, 180) : "";
    if (aiReferenceFileId) {
      const reference = await env.DB.prepare("SELECT content_type, size FROM workspace_files WHERE id = ?1 AND client_id = ?2").bind(aiReferenceFileId, clientId).first<{ content_type: string; size: number }>();
      if (!reference || !["image/jpeg", "image/png", "image/webp"].includes(reference.content_type) || reference.size > 1024 * 1024) return Response.json({ error: "The attached image is missing or invalid. Upload it again and reschedule." }, { status: 400 });
    }
    const now = new Date().toISOString();
    const dueParts = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/Dublin", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(dueAt));
    const repeatTime = `${dueParts.find((part) => part.type === "hour")?.value || "09"}:${dueParts.find((part) => part.type === "minute")?.value || "00"}`;
    const task = { id: crypto.randomUUID(), clientId, projectId: "", title, assigneeId: admin ? aiAssigneeIdForTask : aiAssigneeId, status: "To do", priority: "Normal", service, estimate: 0, due, dueAt, repeatTime, createdById: profile?.id || user.userId, notes, repeat: service === "Sites" ? "None" : repeat, aiMode: service, aiRunState: "scheduled", aiInstructions: notes, ...(aiReferenceFileId ? { aiReferenceFileId, aiReferenceFileName: aiReferenceFileName || "Design reference" } : {}), ...(campaignId ? { campaignId, campaignName, campaignContext: String(body.campaignContext || "").trim().slice(0, 1200) } : {}) };
    const usesAdsAccount = service === "Google Ads" || service === "Audit";
    const accountLabel = usesAdsAccount ? `Google Ads account ${client.googleAdsAccountId || "not mapped"}` : client.website ? `Website ${client.website}` : `${service} workspace`;
    const activity = { id: crypto.randomUUID(), title: "AI task scheduled", detail: `${title} · ${client.name} · ${service}${campaignName ? ` · ${campaignName}` : ""}${usesAdsAccount && client.googleAdsAccountId ? ` · account ${client.googleAdsAccountId}` : ""}`, icon: "🤖", at: now, actor: profile?.name || user.displayName || "Workspace user", actorAvatar: profile?.avatar, staffId: profile?.id || user.userId, clientId, taskId: task.id, service, note: `Assigned to ${aiAgentName}. Routed to the ${service} assistant chat. Run scheduled for ${new Date(dueAt).toLocaleString("en-IE", { timeZone: "Europe/Dublin" })} Europe/Dublin. Account: ${accountLabel}.${campaignName ? ` Campaign: ${campaignName} (${campaignId}).` : ""} Exact task card instructions: ${notes || title}`, kind: "task" };
    const next = { ...data, tasks: [task, ...(data.tasks || [])], activity: [activity, ...(data.activity || [])].slice(0, 100) };
    const result = await env.DB.prepare("UPDATE workspace_documents SET data = ?1, updated_at = ?2 WHERE id = ?3 AND updated_at = ?4")
      .bind(JSON.stringify(next), `assistant-task-${crypto.randomUUID()}`, "f2b-agency", row.updated_at).run();
    if (result.meta.changes !== 1) return Response.json({ error: "The workspace changed at the same time. Refresh and schedule the task again." }, { status: 409 });
    return Response.json({ ok: true, task, clientName: client.name });
  } catch {
    return Response.json({ error: "Could not schedule this AI task." }, { status: 500 });
  }
}
