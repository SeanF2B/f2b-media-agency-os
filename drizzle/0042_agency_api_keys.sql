CREATE TABLE IF NOT EXISTS agency_api_keys (
  owner_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider IN ('openrouter')),
  encrypted_key TEXT NOT NULL,
  key_iv TEXT NOT NULL,
  key_fingerprint TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (owner_id, provider)
);
