CREATE TABLE IF NOT EXISTS seo_backlink_outreach (
  outreach_id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  source_url TEXT NOT NULL,
  source_domain TEXT NOT NULL,
  target_url TEXT NOT NULL,
  anchor TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'To review',
  note TEXT NOT NULL DEFAULT '',
  follow_up_date TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE(owner_id, client_id, source_url, target_url)
);

CREATE INDEX IF NOT EXISTS seo_backlink_outreach_client_updated
  ON seo_backlink_outreach(owner_id, client_id, updated_at DESC);
