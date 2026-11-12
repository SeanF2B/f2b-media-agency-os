CREATE TABLE IF NOT EXISTS google_calendar_connections (
  owner_id TEXT PRIMARY KEY,
  encrypted_refresh_token TEXT NOT NULL,
  token_iv TEXT NOT NULL,
  account_email TEXT NOT NULL DEFAULT '',
  connected_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS google_calendar_task_events (
  owner_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  google_event_id TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, task_id)
);
