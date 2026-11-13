-- Saved client reports (manual + automatic monthly). The app also creates this on first use.
CREATE TABLE IF NOT EXISTS client_report_archive (id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL, client_id TEXT NOT NULL, type TEXT NOT NULL, period_start TEXT NOT NULL, period_end TEXT NOT NULL, kind TEXT NOT NULL, created_at TEXT NOT NULL, storage_key TEXT NOT NULL DEFAULT '', html TEXT, summary_json TEXT NOT NULL DEFAULT '{}');
CREATE UNIQUE INDEX IF NOT EXISTS client_report_archive_period_idx ON client_report_archive(owner_id, client_id, type, period_start, period_end, kind);
