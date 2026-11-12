CREATE TABLE IF NOT EXISTS marketing_reusable_blocks (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('funnel')),
  name TEXT NOT NULL,
  data TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS marketing_reusable_blocks_owner_kind_updated_idx
  ON marketing_reusable_blocks(owner_id, kind, updated_at DESC);
