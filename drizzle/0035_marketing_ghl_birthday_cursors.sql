CREATE TABLE IF NOT EXISTS marketing_ghl_birthday_cursors (
  owner_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  last_contact_id TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, client_id)
);
