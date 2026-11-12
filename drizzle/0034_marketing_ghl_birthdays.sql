CREATE TABLE IF NOT EXISTS marketing_ghl_contact_birthdays (
  owner_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  birthday_month_day TEXT NOT NULL CHECK (birthday_month_day GLOB '[0-1][0-9]-[0-3][0-9]'),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, client_id, contact_id)
);

CREATE INDEX IF NOT EXISTS idx_marketing_ghl_birthdays_day
  ON marketing_ghl_contact_birthdays (client_id, birthday_month_day);
