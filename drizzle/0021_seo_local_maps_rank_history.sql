CREATE TABLE IF NOT EXISTS seo_local_maps_rank_runs (
  run_id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  location_name TEXT NOT NULL,
  business_name TEXT NOT NULL,
  domain TEXT NOT NULL DEFAULT '',
  results_json TEXT NOT NULL,
  provider_cost_usd REAL
);

CREATE INDEX IF NOT EXISTS seo_local_maps_rank_client_history_idx
  ON seo_local_maps_rank_runs(owner_id, client_id, created_at DESC);
