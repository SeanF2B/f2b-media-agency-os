CREATE TABLE IF NOT EXISTS marketing_assets (
  id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  client_id TEXT,
  kind TEXT NOT NULL CHECK (kind IN ('funnel','form','survey','calculator','automation')),
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','active','paused')),
  version INTEGER NOT NULL DEFAULT 1,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, id),
  UNIQUE (owner_id, slug)
);
CREATE INDEX IF NOT EXISTS marketing_assets_owner_kind_updated_idx ON marketing_assets(owner_id, kind, updated_at DESC);
CREATE TABLE IF NOT EXISTS marketing_asset_versions (
  owner_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  version INTEGER NOT NULL,
  data TEXT NOT NULL,
  saved_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, asset_id, version),
  FOREIGN KEY (owner_id, asset_id) REFERENCES marketing_assets(owner_id, id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS marketing_submissions (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, asset_id) REFERENCES marketing_assets(owner_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS marketing_submissions_asset_created_idx ON marketing_submissions(owner_id, asset_id, created_at DESC);
CREATE TABLE IF NOT EXISTS marketing_executions (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  automation_id TEXT NOT NULL,
  trigger_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued','running','succeeded','failed','cancelled')),
  input TEXT NOT NULL,
  result TEXT NOT NULL DEFAULT '{}',
  run_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, automation_id) REFERENCES marketing_assets(owner_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS marketing_executions_due_idx ON marketing_executions(status, run_at);
CREATE TABLE IF NOT EXISTS marketing_ai_usage (
  owner_id TEXT NOT NULL,
  usage_date TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (owner_id, usage_date)
);
