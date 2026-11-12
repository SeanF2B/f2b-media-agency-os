CREATE TABLE IF NOT EXISTS workspace_files (
  id TEXT PRIMARY KEY NOT NULL,
  client_id TEXT NOT NULL,
  name TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size INTEGER NOT NULL,
  uploaded_at TEXT NOT NULL,
  data BLOB NOT NULL
);

CREATE INDEX IF NOT EXISTS workspace_files_client_id_idx ON workspace_files (client_id);
