CREATE TABLE IF NOT EXISTS seo_audit_runs (
  run_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  result_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS seo_audit_runs_owner_client_created
  ON seo_audit_runs(owner_id, client_id, created_at DESC);
