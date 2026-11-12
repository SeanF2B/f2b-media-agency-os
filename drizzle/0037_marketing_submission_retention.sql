CREATE TABLE IF NOT EXISTS marketing_submission_retention (
  owner_id TEXT PRIMARY KEY NOT NULL,
  retention_days INTEGER CHECK (retention_days IS NULL OR retention_days IN (30, 90, 180, 365)),
  cursor_created_at TEXT NOT NULL DEFAULT '',
  cursor_submission_id TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);
