CREATE TABLE IF NOT EXISTS seo_keyword_research_runs (
  run_id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  location_name TEXT NOT NULL,
  seed_keywords_json TEXT NOT NULL,
  provider_cost_usd REAL,
  results_json TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS seo_keyword_research_client_history_idx
  ON seo_keyword_research_runs(owner_id, client_id, created_at DESC);
