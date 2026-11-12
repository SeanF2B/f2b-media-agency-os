CREATE TABLE IF NOT EXISTS marketing_data_cache (
  owner_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  service TEXT NOT NULL,
  cache_key TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (owner_id, client_id, service, cache_key)
);

CREATE INDEX IF NOT EXISTS marketing_data_cache_expiry
  ON marketing_data_cache (expires_at);

CREATE TABLE IF NOT EXISTS marketing_metric_snapshots (
  owner_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  service TEXT NOT NULL,
  snapshot_date TEXT NOT NULL,
  account_id TEXT NOT NULL,
  status TEXT NOT NULL,
  fetched_at TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  PRIMARY KEY (owner_id, client_id, service, snapshot_date)
);

CREATE INDEX IF NOT EXISTS marketing_metric_snapshots_history
  ON marketing_metric_snapshots (owner_id, client_id, service, snapshot_date DESC);
