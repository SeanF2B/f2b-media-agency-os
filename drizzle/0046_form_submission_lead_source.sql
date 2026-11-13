-- Lead source on each form submission for SEO vs Google Ads attribution (applied to production 13 Nov 2026).
ALTER TABLE form_submission_log ADD COLUMN channel TEXT NOT NULL DEFAULT '';
ALTER TABLE form_submission_log ADD COLUMN utm_source TEXT NOT NULL DEFAULT '';
ALTER TABLE form_submission_log ADD COLUMN utm_medium TEXT NOT NULL DEFAULT '';
ALTER TABLE form_submission_log ADD COLUMN utm_campaign TEXT NOT NULL DEFAULT '';
ALTER TABLE form_submission_log ADD COLUMN click_id TEXT NOT NULL DEFAULT '';
ALTER TABLE form_submission_log ADD COLUMN referrer TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS form_submission_log_contact_idx ON form_submission_log(owner_id, contact_id);
