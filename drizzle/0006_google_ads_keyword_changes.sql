ALTER TABLE google_ads_pending_changes
  ADD COLUMN payload_json TEXT NOT NULL DEFAULT '{}';
