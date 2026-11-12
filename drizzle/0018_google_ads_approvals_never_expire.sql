UPDATE google_ads_pending_changes
SET expires_at = '9999-12-31T23:59:59.999Z'
WHERE status IN ('pending', 'applying');
