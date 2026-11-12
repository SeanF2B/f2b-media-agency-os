CREATE TABLE IF NOT EXISTS marketing_submission_rate_limits (
  owner_id TEXT NOT NULL,
  asset_id TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0 CHECK (request_count >= 0 AND request_count <= 60),
  PRIMARY KEY (owner_id, asset_id, window_start)
);

CREATE INDEX IF NOT EXISTS marketing_submission_rate_limits_window_idx
  ON marketing_submission_rate_limits (window_start);
