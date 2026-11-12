CREATE TABLE IF NOT EXISTS marketing_audit_events (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  actor_id TEXT NOT NULL,
  client_id TEXT,
  resource_type TEXT NOT NULL CHECK (resource_type IN ('project','submission','workspace')),
  resource_id TEXT NOT NULL,
  project_kind TEXT NOT NULL CHECK (project_kind IN ('funnel','form','survey','calculator','automation','workspace')),
  action TEXT NOT NULL CHECK (action IN ('project_created','project_saved','project_published','project_unpublished','version_restored','automation_activated','automation_paused','project_deleted','submission_deleted','retention_changed')),
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS marketing_audit_events_owner_time_idx ON marketing_audit_events(owner_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS marketing_audit_events_owner_resource_idx ON marketing_audit_events(owner_id, resource_type, resource_id, created_at DESC);
