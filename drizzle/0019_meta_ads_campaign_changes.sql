CREATE TABLE IF NOT EXISTS meta_ads_change_proposals (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  campaign_name TEXT NOT NULL,
  field TEXT NOT NULL CHECK (field IN ('status', 'daily_budget')),
  currency TEXT NOT NULL DEFAULT '',
  old_value TEXT NOT NULL,
  new_value TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'applying', 'applied', 'rejected', 'failed')),
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL,
  decided_at TEXT,
  result_detail TEXT NOT NULL DEFAULT '',
  verified INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS meta_ads_change_proposals_owner_client_created
  ON meta_ads_change_proposals(owner_id, client_id, created_at DESC);
