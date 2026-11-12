CREATE TABLE IF NOT EXISTS meta_ads_connections (
  owner_id TEXT PRIMARY KEY NOT NULL,
  encrypted_access_token TEXT NOT NULL,
  token_iv TEXT NOT NULL,
  account_email TEXT NOT NULL DEFAULT '',
  expires_at TEXT NOT NULL,
  connected_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
