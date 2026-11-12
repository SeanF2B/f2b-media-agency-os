CREATE INDEX IF NOT EXISTS marketing_executions_owner_asset_created_idx ON marketing_executions(owner_id, automation_id, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS marketing_executions_trigger_once_idx ON marketing_executions(owner_id, automation_id, trigger_key);
