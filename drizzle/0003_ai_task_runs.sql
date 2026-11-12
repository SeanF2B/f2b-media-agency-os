CREATE TABLE IF NOT EXISTS ai_task_runs (
  task_id TEXT NOT NULL,
  run_key TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  note TEXT,
  PRIMARY KEY (task_id, run_key)
);
