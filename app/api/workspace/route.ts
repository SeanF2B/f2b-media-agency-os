import { getChatGPTUser } from "../../chatgpt-auth";
import { env } from "cloudflare:workers";
import { enforceOwnerOnlyOverview, fullTeamPermissions, getMemberPermissions, type TeamPermissions } from "@/lib/access-permissions";
import { canViewAiAssignedTask, isAiAssignedTask } from "@/lib/ai-task-access";
import { withoutChessActivity } from "@/lib/chess-engine";
import { applyPendingReason } from "@/lib/task-pending-reason";

export const dynamic = "force-dynamic";

type Staff = { id: string; name: string; email: string; role: string; isBot?: boolean; costRate?: number; avatar?: string; permissions?: Partial<TeamPermissions>; clientAccessIds?: string[]; vaultAccessEntryIds?: string[]; aiModeAccess?: string[] };
const botTeammates: Staff[] = [
  { id: "f2b-ai-agent", name: "Connors", email: "", role: "AI teammate", costRate: 0, avatar: "🤖", isBot: true },
  { id: "f2b-audit-agent", name: "Audit Agent", email: "", role: "Audit Agent", costRate: 0, avatar: "🔎", isBot: true },
  { id: "f2b-reporting-agent", name: "Reporting Agent", email: "", role: "Reporting Agent", costRate: 0, avatar: "📊", isBot: true },
];

async function getWorkspace() {
  if (!env.DB) return { error: "The private workspace database is not connected yet." };
  const result = await env.DB.prepare("SELECT data FROM workspace_documents WHERE id = ?1")
    .bind("f2b-agency")
    .first<{ data: string }>();
  return result?.data ? JSON.parse(result.data) : null;
}

function canView(data: any, user: { userId: string; email: string }) {
  if (!data) return true;
  return data.ownerId === user.userId || data.staff?.some((member: Staff) => !member.isBot && member.email?.toLowerCase() === user.email.toLowerCase());
}

function getProfile(data: any, user: { userId: string; email: string }): Staff | undefined {
  return data?.staff?.find((member: Staff) => !member.isBot && (member.id === user.userId || member.email?.toLowerCase() === user.email.toLowerCase()));
}

function canManage(data: any, user: { userId: string; email: string }) {
  return data?.ownerId === user.userId || data?.staff?.some((member: Staff) => !member.isBot && member.email?.toLowerCase() === user.email.toLowerCase() && ["Owner", "Admin"].includes(member.role));
}

export async function GET() {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in with ChatGPT to open this private workspace." }, { status: 401 });
  try {
    const data = await getWorkspace();
    if (data?.error) return Response.json(data, { status: 503 });
    if (!canView(data, user)) return Response.json({ error: "Your account is not on the F2B team yet. Ask an administrator to add your email and invite you to the private Site." }, { status: 403 });
    if (data) {
      const activity = withoutChessActivity(data.activity || []).map((item: any) => {
        // Activity rows repeat the full base64 staff photo even though the
        // profile image is already present in `staff`. Avoid retaining or
        // sending that same image with every event; ActivityEntry resolves it
        // by staffId.
        if (typeof item.actorAvatar === "string" && item.actorAvatar.startsWith("data:image/")) {
          const { actorAvatar: _duplicateAvatar, ...compactItem } = item;
          return compactItem;
        }
        return item;
      });
      // This parsed snapshot is request-local, so replace its activity array
      // before serializing the response and release the duplicate image data.
      data.activity = activity;
      const normalized = {
        ...data,
        staff: [...(data.staff || [])],
        activity,
      };
      for (const bot of botTeammates) if (!normalized.staff.some((member: Staff) => member.id === bot.id)) normalized.staff.push(bot);
      const manager = canManage(data, user);
      const profile = getProfile(data, user);
      const permissions = data.ownerId === user.userId ? fullTeamPermissions : getMemberPermissions(profile);
      const aiModes = ["Google Ads", "SEO", "Audit", "Research", "Setup", "Sites"];
      let visible = normalized;
      if (!manager) {
        const restrictedClients = Array.isArray(profile?.clientAccessIds);
        const allowedClientIds = new Set(restrictedClients ? profile!.clientAccessIds! : normalized.clients.map((client: any) => client.id));
        const isAllowedClient = (clientId: string | undefined) => !clientId || allowedClientIds.has(clientId);
        const allowedAiModes = Array.isArray(profile?.aiModeAccess) ? profile!.aiModeAccess! : ["Google Ads", "SEO", "Audit", "Research", "Setup", "Sites"];
        const visibleTasks = normalized.tasks.filter((task: any) => isAiAssignedTask(task)
          ? canViewAiAssignedTask(task, permissions, allowedAiModes)
          : permissions.tasks && (permissions.allTasks || task.assigneeId === profile?.id || task.reviewApproverId === profile?.id))
          .filter((task: any) => isAllowedClient(task.clientId));
        const assignedClientIds = new Set(visibleTasks.map((task: any) => task.clientId).filter(Boolean));
        const assignedProjectIds = new Set(visibleTasks.map((task: any) => task.projectId).filter(Boolean));
        const visibleClientIds = permissions.clients
          ? new Set(normalized.clients.filter((client: any) => isAllowedClient(client.id)).map((client: any) => client.id))
          : assignedClientIds;
        const safeClients = restrictedClients || permissions.clients
          ? normalized.clients.filter((client: any) => isAllowedClient(client.id))
          : normalized.clients.filter((client: any) => assignedClientIds.has(client.id) && isAllowedClient(client.id)).map((client: any) => ({ id: client.id, name: client.name, company: "", contact: "", email: "", status: client.status, color: client.color, logo: client.logo, services: [], codexUrl: "", serviceChats: {} }));
        const visibleProjects = normalized.projects.filter((project: any) => isAllowedClient(project.clientId) && (permissions.projects ? visibleClientIds.has(project.clientId) : assignedProjectIds.has(project.id)));
        const visibleTaskIds = new Set(visibleTasks.map((task: any) => task.id));
        const hiddenAiTaskIds = new Set(normalized.tasks.filter((task: any) => isAiAssignedTask(task) && !visibleTaskIds.has(task.id)).map((task: any) => task.id));
        const visibleActivity = permissions.allActivity
          ? (normalized.activity || []).filter((item: any) => !hiddenAiTaskIds.has(item.taskId))
          : (permissions.overview || permissions.clientActivity || permissions.timesheets)
            ? (normalized.activity || []).filter((item: any) => !hiddenAiTaskIds.has(item.taskId) && (item.staffId === profile?.id || ((permissions.overview || permissions.clientActivity) && item.clientId && visibleClientIds.has(item.clientId)) || (item.taskId && visibleTaskIds.has(item.taskId))))
            : [];
        const authorizedVaultEntries = permissions.vault
          ? (normalized.vaultEntries || []).filter((entry: any) => visibleClientIds.has(entry.clientId) && Array.isArray(profile?.vaultAccessEntryIds) && profile!.vaultAccessEntryIds!.includes(entry.id))
          : [];
        visible = {
          ...normalized,
          settings: { ...normalized.settings, adminEmail: "" },
          staff: permissions.team ? normalized.staff : normalized.staff.filter((member: Staff) => member.id === profile?.id),
          clients: safeClients,
          projects: visibleProjects,
          tasks: visibleTasks,
          entries: permissions.timesheets ? (permissions.allTimesheets ? normalized.entries : normalized.entries.filter((entry: any) => entry.staffId === profile?.id)).filter((entry: any) => isAllowedClient(entry.clientId)) : [],
          activeTimer: permissions.timesheets && (permissions.allTimesheets || normalized.activeTimer?.staffId === profile?.id) && isAllowedClient(normalized.tasks.find((task: any) => task.id === normalized.activeTimer?.taskId)?.clientId) ? normalized.activeTimer : null,
          financeRecords: permissions.finance ? normalized.financeRecords.filter((record: any) => isAllowedClient(record.clientId)) : [],
          activity: visibleActivity,
          reportTemplates: permissions.reports ? normalized.reportTemplates || [] : [],
          auditRuns: (normalized.auditRuns || []).filter((run: any) => visibleClientIds.has(run.clientId)),
          sitePageMetadata: [],
          siteLandingDomainChecks: [],
          leadProfiles: [],
          leadLists: [],
          studioSettings: permissions.reports ? normalized.studioSettings || {} : {},
          notes: normalized.notes.filter((note: any) => (note.clientId ? visibleClientIds.has(note.clientId) : Boolean(note.taskId && visibleTaskIds.has(note.taskId))) && (!note.taskId || visibleTaskIds.has(note.taskId))),
          files: permissions.clients ? normalized.files.filter((file: any) => visibleClientIds.has(file.clientId)) : [],
          vault: permissions.vault ? normalized.vault : undefined,
          vaultEntries: authorizedVaultEntries,
        };
      }
      const aiModeAccess = manager ? aiModes : !permissions.aiAssistant ? [] : Array.isArray(profile?.aiModeAccess) ? profile!.aiModeAccess!.filter((mode) => aiModes.includes(mode)) : aiModes;
      return Response.json({ data: visible, user: { id: user.userId, email: user.email, name: user.displayName }, canManage: manager, permissions, aiModes: aiModeAccess });
    }
    const initial = {
      ownerId: user.userId,
      settings: { adminEmail: "sean@f2bmedia.com", currency: "EUR", weekStarts: "Monday" },
      staff: [{ id: user.userId, name: user.displayName, email: "sean@f2bmedia.com", role: "Owner", costRate: 0, avatar: "SF" }, ...botTeammates],
      clients: [], projects: [], tasks: [], entries: [], notes: [], files: [], activity: [], vault: null, vaultEntries: [], reportTemplates: [], leadProfiles: [], leadLists: [], studioSettings: {}, activeTimer: null,
    };
    await env.DB!.prepare("INSERT OR IGNORE INTO workspace_documents (id, owner_id, data, updated_at) VALUES (?1, ?2, ?3, CURRENT_TIMESTAMP)")
      .bind("f2b-agency", user.userId, JSON.stringify(initial)).run();
      return Response.json({ data: initial, user: { id: user.userId, email: user.email, name: user.displayName }, canManage: true, permissions: fullTeamPermissions, aiModes: ["Google Ads", "SEO", "Audit", "Research", "Setup", "Sites"] });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not load the workspace." }, { status: 500 });
  }
}

export async function PUT(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in with ChatGPT to save changes." }, { status: 401 });
  try {
    const current = await getWorkspace();
    if (current?.error) return Response.json(current, { status: 503 });
    if (!current || !canManage(current, user)) return Response.json({ error: "Only an administrator can change agency records." }, { status: 403 });
    const next = await request.json() as { ownerId?: string; clients?: unknown[]; tasks?: unknown[]; staff?: unknown[] };
    if (!next || next.ownerId !== current.ownerId || !Array.isArray(next.clients) || !Array.isArray(next.tasks) || !Array.isArray(next.staff)) {
      return Response.json({ error: "The workspace update was not valid." }, { status: 400 });
    }
    const existingTasks = new Map<string, any>((current.tasks || []).map((task: any) => [String(task.id), task]));
    const actor = current.staff?.find((member: Staff) => !member.isBot && (member.id === user.userId || member.email?.toLowerCase() === user.email.toLowerCase()));
    const pendingAt = new Date().toISOString();
    const pendingReasonResults = next.tasks.map((task) => applyPendingReason(task as any, existingTasks.get((task as any)?.id), actor?.name || user.displayName || user.email, pendingAt));
    const missingPendingReason = pendingReasonResults.find((result) => result.error);
    if (missingPendingReason) return Response.json({ error: missingPendingReason.error }, { status: 400 });
    const tasks = pendingReasonResults.map((result) => result.task);
    // Chess is updated by its own API, while this endpoint saves the full
    // workspace snapshot. Preserve the latest chessGames value atomically so
    // a stale workspace snapshot cannot make an active match disappear.
    const savedWorkspace = {
      ...next,
      tasks,
      staff: enforceOwnerOnlyOverview(
        next.staff as Array<{ id?: string; permissions?: Partial<TeamPermissions> | null }>,
        current.ownerId,
        current.staff?.find((member: Staff) => member.id === current.ownerId),
      ),
      marketingSetupWorkflows: current.marketingSetupWorkflows || [],
    };
    await env.DB!.prepare("UPDATE workspace_documents SET data = json_set(?1, '$.chessGames', json(COALESCE(json_extract(data, '$.chessGames'), '[]'))), updated_at = ?2 WHERE id = ?3")
      .bind(JSON.stringify(savedWorkspace), `workspace-${crypto.randomUUID()}`, "f2b-agency").run();
    return Response.json({ ok: true, updatedAt: new Date().toISOString() });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not save changes." }, { status: 500 });
  }
}

export async function DELETE(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return Response.json({ error: "Sign in to remove a client." }, { status: 401 });
  try {
    const current = await getWorkspace();
    if (current?.error) return Response.json(current, { status: 503 });
    if (!current || !canManage(current, user)) return Response.json({ error: "Only an administrator can remove a client." }, { status: 403 });
    const body = await request.json() as { clientId?: string };
    const clientId = String(body.clientId || "").slice(0, 120);
    const client = (current.clients || []).find((item: any) => item.id === clientId);
    if (!client) return Response.json({ error: "That client could not be found." }, { status: 404 });
    const taskIds = new Set((current.tasks || []).filter((item: any) => item.clientId === clientId).map((item: any) => item.id));
    const removedVaultEntryIds = new Set((current.vaultEntries || []).filter((item: any) => item.clientId === clientId).map((item: any) => item.id));
    const now = new Date().toISOString();
    const actor = current.staff?.find((member: Staff) => member.id === user.userId || member.email?.toLowerCase() === user.email.toLowerCase());
    const next = {
      ...current,
      clients: current.clients.filter((item: any) => item.id !== clientId),
      marketingSetupWorkflows: (current.marketingSetupWorkflows || []).filter((workflow: any) => workflow.clientId !== clientId),
      projects: (current.projects || []).filter((item: any) => item.clientId !== clientId),
      tasks: (current.tasks || []).filter((item: any) => item.clientId !== clientId),
      entries: (current.entries || []).filter((item: any) => item.clientId !== clientId && !taskIds.has(item.taskId)),
      financeRecords: (current.financeRecords || []).filter((item: any) => item.clientId !== clientId),
      notes: (current.notes || []).filter((item: any) => item.clientId !== clientId),
      files: (current.files || []).filter((item: any) => item.clientId !== clientId),
      vaultEntries: (current.vaultEntries || []).filter((item: any) => item.clientId !== clientId),
      staff: (current.staff || []).map((member: any) => ({ ...member, ...(Array.isArray(member.clientAccessIds) ? { clientAccessIds: member.clientAccessIds.filter((id: string) => id !== clientId) } : {}), ...(Array.isArray(member.vaultAccessEntryIds) ? { vaultAccessEntryIds: member.vaultAccessEntryIds.filter((id: string) => !removedVaultEntryIds.has(id)) } : {}) })),
      activeTimer: current.activeTimer && taskIds.has(current.activeTimer.taskId) ? null : current.activeTimer,
      activity: [
        { id: crypto.randomUUID(), title: "Client removed", detail: client.name, icon: "👥", at: now, actor: actor?.name || user.displayName || "Workspace admin", actorAvatar: actor?.avatar, staffId: actor?.id, kind: "client" },
        ...(current.activity || []).filter((item: any) => item.clientId !== clientId),
      ].slice(0, 100),
    };
    const row = await env.DB!.prepare("SELECT updated_at FROM workspace_documents WHERE id = ?1").bind("f2b-agency").first<{ updated_at: string }>();
    if (!row) return Response.json({ error: "The workspace could not be found." }, { status: 503 });
    const saved = await env.DB!.prepare("UPDATE workspace_documents SET data = ?1, updated_at = ?2 WHERE id = ?3 AND updated_at = ?4")
      .bind(JSON.stringify(next), `client-removed-${crypto.randomUUID()}`, "f2b-agency", row.updated_at).run();
    if (saved.meta.changes !== 1) return Response.json({ error: "The workspace changed at the same time. Refresh and try removing the client again." }, { status: 409 });
    await env.DB!.batch([
      env.DB!.prepare("DELETE FROM workspace_files WHERE client_id = ?1").bind(clientId),
      env.DB!.prepare("DELETE FROM client_ai_messages WHERE client_id = ?1").bind(clientId),
    ]);
    return Response.json({ ok: true });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Could not remove this client." }, { status: 500 });
  }
}
