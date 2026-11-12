CREATE TABLE IF NOT EXISTS marketing_custom_domains (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  client_id TEXT,
  asset_id TEXT NOT NULL,
  hostname TEXT NOT NULL UNIQUE,
  verification_token TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','verified')),
  verified_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (owner_id, asset_id) REFERENCES marketing_assets(owner_id, id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS marketing_custom_domains_owner_idx ON marketing_custom_domains(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS marketing_custom_domains_hostname_status_idx ON marketing_custom_domains(hostname, status);
