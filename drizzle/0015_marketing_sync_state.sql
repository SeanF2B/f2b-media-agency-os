CREATE TABLE IF NOT EXISTS marketing_sync_state (
  owner_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  service TEXT NOT NULL,
  account_id TEXT NOT NULL,
  last_attempt_at TEXT NOT NULL,
  next_attempt_at TEXT NOT NULL,
  status TEXT NOT NULL,
  detail TEXT,
  PRIMARY KEY (owner_id, client_id, service, account_id)
);

CREATE INDEX IF NOT EXISTS marketing_sync_state_due
  ON marketing_sync_state (next_attempt_at);
