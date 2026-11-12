CREATE TABLE IF NOT EXISTS wordpress_connections (
  owner_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  site_url TEXT NOT NULL,
  username TEXT NOT NULL,
  encrypted_app_password TEXT NOT NULL,
  token_iv TEXT NOT NULL,
  connected_at TEXT NOT NULL,
  last_verified_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, client_id)
);
