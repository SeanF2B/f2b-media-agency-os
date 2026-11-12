CREATE TABLE IF NOT EXISTS google_ads_connections (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL UNIQUE,
  encrypted_refresh_token TEXT NOT NULL,
  token_iv TEXT NOT NULL,
  account_email TEXT NOT NULL DEFAULT '',
  connected_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS google_ads_change_log (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  service TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  campaign_name TEXT NOT NULL,
  change_type TEXT NOT NULL,
  old_value TEXT NOT NULL,
  new_value TEXT NOT NULL,
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS google_ads_pending_changes (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  customer_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  campaign_name TEXT NOT NULL,
  campaign_budget_resource TEXT NOT NULL DEFAULT '',
  change_type TEXT NOT NULL,
  old_value TEXT NOT NULL,
  new_value TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS google_ads_change_log_owner_created_idx
  ON google_ads_change_log (owner_id, created_at);
