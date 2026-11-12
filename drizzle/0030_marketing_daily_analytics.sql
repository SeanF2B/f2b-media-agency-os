CREATE TABLE IF NOT EXISTS marketing_daily_analytics (
  owner_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  metric_date TEXT NOT NULL,
  page_loads INTEGER NOT NULL DEFAULT 0,
  submissions INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (owner_id, asset_id, metric_date),
  FOREIGN KEY (owner_id, asset_id) REFERENCES marketing_assets(owner_id, id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS marketing_daily_analytics_asset_date_idx
  ON marketing_daily_analytics(owner_id, asset_id, metric_date DESC);
