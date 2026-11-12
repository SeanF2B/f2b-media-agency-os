CREATE TABLE IF NOT EXISTS gohighlevel_agency_connections (
  owner_id TEXT PRIMARY KEY,
  company_id TEXT NOT NULL,
  encrypted_refresh_token TEXT NOT NULL,
  token_iv TEXT NOT NULL,
  encrypted_access_token TEXT NOT NULL DEFAULT '',
  access_token_iv TEXT NOT NULL DEFAULT '',
  access_expires_at TEXT NOT NULL DEFAULT '',
  scopes TEXT NOT NULL DEFAULT '',
  connected_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS gohighlevel_location_links (
  owner_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  location_id TEXT NOT NULL,
  location_name TEXT NOT NULL DEFAULT '',
  linked_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, client_id),
  UNIQUE (owner_id, location_id)
);

CREATE TABLE IF NOT EXISTS gohighlevel_oauth_states (
  state TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  expires_at TEXT NOT NULL
);
