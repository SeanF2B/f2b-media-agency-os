CREATE TABLE IF NOT EXISTS marketing_folders (
  id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('funnel','form','survey','calculator','automation')),
  name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, id),
  UNIQUE (owner_id, kind, name)
);

ALTER TABLE marketing_assets ADD COLUMN folder_id TEXT;
CREATE INDEX IF NOT EXISTS marketing_assets_owner_kind_folder_updated_idx ON marketing_assets(owner_id, kind, folder_id, updated_at DESC);
