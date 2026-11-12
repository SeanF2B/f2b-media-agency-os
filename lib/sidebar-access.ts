import type { TeamPermissions } from "./access-permissions";

export function canOpenPage(page: string, permissions: TeamPermissions, isAdmin: boolean, hasClientScope = false) {
  return page === "Overview" ? permissions.overview || isAdmin
    : page === "Activity" || page === "Activity & Time" ? permissions.overview || permissions.timesheets || permissions.clientActivity || permissions.allActivity
    : page === "Clients" ? permissions.clients || hasClientScope
    : page === "CRM" || page === "Conversations" ? isAdmin
    : page === "Tasks" ? permissions.tasks || permissions.aiTasks
    : page === "SEO" ? permissions.clients || hasClientScope || isAdmin
    : page === "Tracking & Analytics" ? permissions.reports || isAdmin
    : page === "Email Marketing" || page === "Cold Outreach" ? isAdmin
    : page === "Google Ads" || page === "Meta Ads" ? permissions.reports || isAdmin
    : page === "Time & Timesheets" ? permissions.timesheets
    : page === "AI Assistant" ? permissions.aiAssistant
    : page === "Sites" || page === "Automations" || page === "Integrations" || page === "Lead Factory" || page === "Settings" ? isAdmin
    : ["Reports", "Report Studio", "Proposal Studio"].includes(page) ? permissions.reports || isAdmin
    : page === "Team" ? permissions.team || isAdmin
    : page === "Client Vault" ? permissions.vault && isAdmin
    : page === "Chess" ? true
    : false;
}
