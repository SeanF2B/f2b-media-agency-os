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
  // Sub-account staff (people who belong to one client sub-account). None of these are agency admins.
  "Sub-account Manager": { overview: false, clients: true, projects: true, tasks: true, allTasks: true, aiTasks: true, aiApprovals: true, aiCompletedTasks: true, timesheets: true, allTimesheets: true, team: true, vault: false, finance: false, aiAssistant: true, clientActivity: true, allActivity: false, reports: true },
  "Sub-account User": { overview: false, clients: true, projects: true, tasks: true, allTasks: false, aiTasks: false, aiApprovals: false, aiCompletedTasks: false, timesheets: true, allTimesheets: false, team: false, vault: false, finance: false, aiAssistant: true, clientActivity: true, allActivity: false, reports: false },
  "Sub-account Viewer": { overview: false, clients: true, projects: true, tasks: true, allTasks: false, aiTasks: false, aiApprovals: false, aiCompletedTasks: false, timesheets: false, allTimesheets: false, team: false, vault: false, finance: false, aiAssistant: false, clientActivity: true, allActivity: false, reports: false },
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

export const AGENCY_ROLES = ["Admin", "Account Manager", "Specialist", "Staff", "Viewer"] as const;
export const SUB_ACCOUNT_ROLES = ["Sub-account Manager", "Sub-account User", "Sub-account Viewer"] as const;
export const ROLE_DESCRIPTIONS: Record<string, string> = {
  Admin: "Full access to the agency and every sub-account, including settings, billing and team.",
  "Account Manager": "Clients, projects, tasks, timesheets and client finance. No agency settings.",
  Specialist: "Their own assigned tasks and timesheets.",
  Staff: "Their own assigned tasks and timesheets.",
  Viewer: "Read-only view of clients, projects and tasks.",
  "Sub-account Manager": "Runs one sub-account: all its tasks, AI tasks and approvals, timesheets, team list and reports.",
  "Sub-account User": "Works inside one sub-account: tasks, timesheets, activity and the AI Assistant.",
  "Sub-account Viewer": "Read-only view of one sub-account's clients, projects, tasks and activity.",
};
/** Pages a teammate can be allowed to see (the sidebar). Admin-only pages are always admin-only. */
export const VIEWABLE_PAGES = ["Tasks", "Clients", "Activity", "AI Assistant", "Team", "Report Studio", "Proposal Studio", "SEO", "Google Ads", "Meta Ads", "Media Library", "Tracking & Analytics", "Chess"] as const;
export function isSubAccountRole(role?: string) { return Boolean(role && (SUB_ACCOUNT_ROLES as readonly string[]).includes(role)); }
