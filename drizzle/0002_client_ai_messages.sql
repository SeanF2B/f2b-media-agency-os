CREATE TABLE IF NOT EXISTS client_ai_messages (
  id TEXT PRIMARY KEY NOT NULL,
  client_id TEXT NOT NULL,
  service TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS client_ai_messages_thread_idx
  ON client_ai_messages (client_id, service, created_at);
