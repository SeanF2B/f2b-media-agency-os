export type TeamPermissions = {
  overview: boolean;
  clients: boolean;
  projects: boolean;
  tasks: boolean;
  allTasks: boolean;
  aiTasks: boolean;
  aiApprovals: boolean;
  aiCompletedTasks: boolean;
  timesheets: boolean;
  allTimesheets: boolean;
  team: boolean;
  vault: boolean;
  finance: boolean;
  aiAssistant: boolean;
  clientActivity: boolean;
  allActivity: boolean;
  reports: boolean;
};

export const fullTeamPermissions: TeamPermissions = {
  overview: true,
  clients: true,
  projects: true,
  tasks: true,
  allTasks: true,
  aiTasks: true,
  aiApprovals: true,
  aiCompletedTasks: true,
  timesheets: true,
  allTimesheets: true,
  team: true,
  vault: true,
  finance: true,
  aiAssistant: true,
  clientActivity: true,
  allActivity: true,
  reports: true,
};

export const roleTeamPermissions: Record<string, TeamPermissions> = {
  Owner: fullTeamPermissions,
  Admin: fullTeamPermissions,
  "Account Manager": { overview: false, clients: true, projects: true, tasks: true, allTasks: false, aiTasks: false, aiApprovals: false, aiCompletedTasks: false, timesheets: true, allTimesheets: false, team: false, vault: false, finance: true, aiAssistant: false, clientActivity: false, allActivity: false, reports: false },
  Specialist: { overview: false, clients: false, projects: false, tasks: true, allTasks: false, aiTasks: false, aiApprovals: false, aiCompletedTasks: false, timesheets: true, allTimesheets: false, team: false, vault: false, finance: false, aiAssistant: false, clientActivity: false, allActivity: false, reports: false },
  Staff: { overview: false, clients: false, projects: false, tasks: true, allTasks: false, aiTasks: false, aiApprovals: false, aiCompletedTasks: false, timesheets: true, allTimesheets: false, team: false, vault: false, finance: false, aiAssistant: false, clientActivity: false, allActivity: false, reports: false },
  Viewer: { overview: false, clients: true, projects: true, tasks: true, allTasks: false, aiTasks: false, aiApprovals: false, aiCompletedTasks: false, timesheets: true, allTimesheets: false, team: false, vault: false, finance: false, aiAssistant: false, clientActivity: false, allActivity: false, reports: false },
};

export function getTeamPermissions(role: string, configured?: Partial<TeamPermissions> | null): TeamPermissions {
  const defaults = roleTeamPermissions[role] ?? roleTeamPermissions.Staff;
  const merged = { ...defaults, ...(configured ?? {}) };
  if (role === "Owner") return { ...fullTeamPermissions, ...merged };
  if (role === "Admin") return { ...fullTeamPermissions, ...merged, overview: false };
  if (!merged.aiTasks) merged.aiCompletedTasks = false;
  if (!merged.aiTasks) merged.aiApprovals = false;
  return merged;
}

export function getMemberPermissions(member: { id?: string; role?: string; permissions?: Partial<TeamPermissions> | null } | null | undefined, ownerId?: string): TeamPermissions {
  if (member?.id && ownerId && member.id === ownerId) return fullTeamPermissions;
  return { ...getTeamPermissions(member?.role || "Viewer", member?.permissions), overview: false };
}

export function enforceOwnerOnlyOverview<T extends { id?: string; permissions?: Partial<TeamPermissions> | null }>(staff: T[], ownerId: string, trustedOwner?: T): T[] {
  const owner = trustedOwner ?? staff.find((member) => member.id === ownerId);
  const teammates = staff.filter((member) => member.id !== ownerId)
    .map((member) => ({ ...member, permissions: { ...(member.permissions ?? {}), overview: false } }));
  return owner ? [owner, ...teammates] : teammates;
}
