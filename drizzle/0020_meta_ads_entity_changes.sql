CREATE TABLE IF NOT EXISTS meta_ads_entity_change_proposals (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  entity_type TEXT NOT NULL CHECK (entity_type IN ('ad_set', 'ad')),
  entity_id TEXT NOT NULL,
  entity_name TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  campaign_name TEXT NOT NULL DEFAULT '',
  old_status TEXT NOT NULL,
  new_status TEXT NOT NULL CHECK (new_status IN ('ACTIVE', 'PAUSED')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'applying', 'applied', 'rejected', 'failed')),
  actor TEXT NOT NULL,
  created_at TEXT NOT NULL,
  decided_at TEXT,
  result_detail TEXT NOT NULL DEFAULT '',
  verified INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS meta_ads_entity_change_owner_client_created
  ON meta_ads_entity_change_proposals(owner_id, client_id, created_at DESC);
