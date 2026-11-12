CREATE TABLE IF NOT EXISTS google_search_console_connections (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL UNIQUE,
  encrypted_refresh_token TEXT NOT NULL,
  token_iv TEXT NOT NULL,
  account_email TEXT NOT NULL DEFAULT '',
  connected_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
