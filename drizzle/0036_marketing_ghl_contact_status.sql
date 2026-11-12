CREATE TABLE IF NOT EXISTS marketing_ghl_contact_status_state (
  owner_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  field_id TEXT NOT NULL,
  status_value TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, client_id, contact_id, field_id)
);

CREATE INDEX IF NOT EXISTS idx_marketing_ghl_contact_status_owner_updated
  ON marketing_ghl_contact_status_state (owner_id, updated_at);
