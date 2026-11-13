-- Unified, indexed log of every form submission (OS forms, client website forms) for
-- per-form / per-page / per-client tracking. The app also creates this table on first use.
CREATE TABLE IF NOT EXISTS form_submission_log (id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL, client_id TEXT NOT NULL DEFAULT '', source TEXT NOT NULL, form_key TEXT NOT NULL, form_name TEXT NOT NULL, page_url TEXT NOT NULL DEFAULT '', page_path TEXT NOT NULL DEFAULT '', name TEXT NOT NULL DEFAULT '', email TEXT NOT NULL DEFAULT '', phone TEXT NOT NULL DEFAULT '', message TEXT NOT NULL DEFAULT '', contact_id TEXT NOT NULL DEFAULT '', created_at TEXT NOT NULL);
CREATE INDEX IF NOT EXISTS form_submission_log_owner_created_idx ON form_submission_log(owner_id, created_at DESC);
CREATE INDEX IF NOT EXISTS form_submission_log_client_created_idx ON form_submission_log(owner_id, client_id, created_at DESC);
