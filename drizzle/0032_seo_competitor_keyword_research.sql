CREATE TABLE IF NOT EXISTS seo_competitor_keyword_research_runs (
  run_id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  location_name TEXT NOT NULL,
  client_domain TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  competitors_json TEXT NOT NULL,
  provider_cost_usd REAL
);

CREATE INDEX IF NOT EXISTS seo_competitor_keyword_client_history_idx
  ON seo_competitor_keyword_research_runs(owner_id, client_id, created_at DESC);
