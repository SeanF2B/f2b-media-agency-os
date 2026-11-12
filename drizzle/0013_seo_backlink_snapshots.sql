CREATE TABLE IF NOT EXISTS seo_backlink_snapshots (
  snapshot_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  target TEXT NOT NULL,
  created_at TEXT NOT NULL,
  provider_cost_usd REAL,
  result_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS seo_backlink_snapshots_owner_client_target_created
  ON seo_backlink_snapshots(owner_id, client_id, target, created_at DESC);
