CREATE TABLE IF NOT EXISTS wordpress_mcp_oauth_apps (
  owner_id TEXT PRIMARY KEY NOT NULL,
  client_id TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS wordpress_mcp_oauth_states (
  state TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  code_verifier TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS wordpress_mcp_connections (
  owner_id TEXT PRIMARY KEY NOT NULL,
  encrypted_access_token TEXT NOT NULL,
  access_token_iv TEXT NOT NULL,
  encrypted_refresh_token TEXT,
  refresh_token_iv TEXT,
  token_expires_at TEXT,
  wp_username TEXT,
  connected_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
