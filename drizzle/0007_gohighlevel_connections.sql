CREATE TABLE IF NOT EXISTS gohighlevel_connections (
  owner_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  location_id TEXT NOT NULL,
  location_name TEXT NOT NULL DEFAULT '',
  encrypted_token TEXT NOT NULL,
  token_iv TEXT NOT NULL,
  connected_at TEXT NOT NULL,
  last_verified_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, client_id)
);
