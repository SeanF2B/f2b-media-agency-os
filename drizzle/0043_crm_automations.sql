-- Native CRM Automations (workflow builder + event-driven runner).
-- scope_id = client id, or '' for agency-level automations.
-- Every query in the runner is index-backed; no table is scanned in full.

CREATE TABLE IF NOT EXISTS crm_automations (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  scope_id TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'off' CHECK (status IN ('off','on')),
  trigger_type TEXT NOT NULL DEFAULT '',
  definition TEXT NOT NULL,
  sends_email INTEGER NOT NULL DEFAULT 0,
  next_fire_at TEXT,
  last_run_at TEXT,
  total_runs INTEGER NOT NULL DEFAULT 0,
  enabled_by TEXT,
  enabled_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS crm_automations_scope_idx ON crm_automations(owner_id, scope_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS crm_automations_live_idx ON crm_automations(status, trigger_type, owner_id, scope_id);
CREATE INDEX IF NOT EXISTS crm_automations_due_idx ON crm_automations(next_fire_at) WHERE status = 'on' AND next_fire_at IS NOT NULL;

-- Event queue. dedupe_key makes every event idempotent (the same lead/tag/stage change is queued once).
CREATE TABLE IF NOT EXISTS crm_automation_events (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  scope_id TEXT NOT NULL DEFAULT '',
  event_type TEXT NOT NULL,
  contact_id TEXT,
  payload TEXT NOT NULL DEFAULT '{}',
  dedupe_key TEXT NOT NULL,
  source_automation_id TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done')),
  created_at TEXT NOT NULL,
  processed_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS crm_automation_events_dedupe_idx ON crm_automation_events(owner_id, dedupe_key);
CREATE INDEX IF NOT EXISTS crm_automation_events_pending_idx ON crm_automation_events(created_at) WHERE status = 'pending';

-- One row per contact per automation run. resume_at doubles as the scheduler and as a claim lease.
CREATE TABLE IF NOT EXISTS crm_automation_runs (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  automation_id TEXT NOT NULL,
  scope_id TEXT NOT NULL DEFAULT '',
  contact_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('running','waiting','completed','failed','cancelled')),
  dry_run INTEGER NOT NULL DEFAULT 0,
  current_node_id TEXT,
  resume_at TEXT,
  event_id TEXT,
  trigger_summary TEXT NOT NULL DEFAULT '',
  attempts INTEGER NOT NULL DEFAULT 0,
  error TEXT,
  started_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  finished_at TEXT
);
-- A contact can't be in the same automation twice at once.
CREATE UNIQUE INDEX IF NOT EXISTS crm_automation_runs_one_active_idx ON crm_automation_runs(automation_id, contact_id) WHERE status IN ('running','waiting') AND dry_run = 0;
-- The same event can never start the same automation twice.
CREATE UNIQUE INDEX IF NOT EXISTS crm_automation_runs_event_idx ON crm_automation_runs(automation_id, event_id) WHERE event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS crm_automation_runs_due_idx ON crm_automation_runs(resume_at) WHERE status IN ('running','waiting');
CREATE INDEX IF NOT EXISTS crm_automation_runs_history_idx ON crm_automation_runs(owner_id, automation_id, started_at DESC);
CREATE INDEX IF NOT EXISTS crm_automation_runs_scope_active_idx ON crm_automation_runs(owner_id, scope_id, status) WHERE status IN ('running','waiting');

-- Step log. UNIQUE(run_id, node_id) makes each step execute at most once per run.
CREATE TABLE IF NOT EXISTS crm_automation_steps (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  run_id TEXT NOT NULL,
  node_id TEXT NOT NULL,
  node_type TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL CHECK (status IN ('started','done','skipped','failed','waiting','simulated')),
  detail TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS crm_automation_steps_run_node_idx ON crm_automation_steps(run_id, node_id);

CREATE TABLE IF NOT EXISTS crm_contact_tags (
  owner_id TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  tag TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, contact_id, tag)
);
CREATE INDEX IF NOT EXISTS crm_contact_tags_tag_idx ON crm_contact_tags(owner_id, tag);

CREATE TABLE IF NOT EXISTS crm_automation_notifications (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  scope_id TEXT NOT NULL DEFAULT '',
  automation_id TEXT NOT NULL,
  run_id TEXT,
  contact_id TEXT,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  read_at TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS crm_automation_notifications_owner_idx ON crm_automation_notifications(owner_id, scope_id, created_at DESC);

-- Per-client kill switch (scope_id '' = agency).
CREATE TABLE IF NOT EXISTS crm_automation_scope_settings (
  owner_id TEXT NOT NULL,
  scope_id TEXT NOT NULL,
  paused INTEGER NOT NULL DEFAULT 0,
  paused_by TEXT,
  paused_at TEXT,
  PRIMARY KEY (owner_id, scope_id)
);

-- Change-detection cursors and the last-seen stage of each deal.
CREATE TABLE IF NOT EXISTS crm_automation_cursors (
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  value TEXT NOT NULL,
  PRIMARY KEY (owner_id, name)
);
CREATE TABLE IF NOT EXISTS crm_automation_stage_snapshot (
  owner_id TEXT NOT NULL,
  opportunity_id TEXT NOT NULL,
  stage_id TEXT NOT NULL,
  PRIMARY KEY (owner_id, opportunity_id)
);

-- Lookups the runner needs on existing CRM tables.
CREATE INDEX IF NOT EXISTS crm_contacts_owner_client_idx ON crm_contacts(owner_id, client_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS crm_opportunities_owner_contact_idx ON crm_opportunities(owner_id, contact_id, updated_at DESC);
