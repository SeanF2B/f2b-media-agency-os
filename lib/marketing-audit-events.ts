export type MarketingAuditResourceType = "project" | "submission" | "workspace";
export type MarketingAuditKind = "funnel" | "form" | "survey" | "calculator" | "automation" | "workspace";
export type MarketingAuditAction =
  | "project_created"
  | "project_saved"
  | "project_published"
  | "project_unpublished"
  | "version_restored"
  | "automation_activated"
  | "automation_paused"
  | "project_deleted"
  | "submission_deleted"
  | "retention_changed";

export type MarketingAuditEvent = {
  id: string;
  ownerId: string;
  actorId: string;
  clientId: string | null;
  resourceType: MarketingAuditResourceType;
  resourceId: string;
  resourceLabel?: string | null;
  projectKind: MarketingAuditKind;
  action: MarketingAuditAction;
  createdAt: string;
};

export function marketingAuditInsert(db: D1Database, event: MarketingAuditEvent) {
  return db.prepare(
    "INSERT INTO marketing_audit_events (id, owner_id, actor_id, client_id, resource_type, resource_id, resource_label, project_kind, action, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
  ).bind(event.id, event.ownerId, event.actorId, event.clientId, event.resourceType, event.resourceId, event.resourceLabel?.slice(0, 120) || null, event.projectKind, event.action, event.createdAt);
}

export async function listMarketingAuditEvents(db: D1Database, ownerId: string, kind: MarketingAuditKind, limit = 30) {
  const boundedLimit = Math.max(1, Math.min(100, Math.floor(limit)));
  const rows = await db.prepare(
    "SELECT e.id, e.actor_id AS actorId, e.client_id AS clientId, e.resource_type AS resourceType, e.resource_id AS resourceId, e.resource_label AS resourceLabel, e.project_kind AS projectKind, e.action, e.created_at AS createdAt, COALESCE(a.name, e.resource_label) AS projectName FROM marketing_audit_events e LEFT JOIN marketing_assets a ON a.owner_id = e.owner_id AND a.id = e.resource_id WHERE e.owner_id = ?1 AND e.project_kind IN (?2, 'workspace') ORDER BY e.created_at DESC, e.id DESC LIMIT ?3",
  ).bind(ownerId, kind, boundedLimit).all<Record<string, unknown>>();
  return rows.results || [];
}
