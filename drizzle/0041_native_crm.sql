CREATE TABLE IF NOT EXISTS crm_contacts (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  client_id TEXT,
  first_name TEXT NOT NULL DEFAULT '',
  last_name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL DEFAULT '',
  phone TEXT NOT NULL DEFAULT '',
  company TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT 'manual',
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS crm_contacts_owner_updated_idx ON crm_contacts(owner_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS crm_contacts_owner_email_idx ON crm_contacts(owner_id, email);

CREATE TABLE IF NOT EXISTS crm_pipelines (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS crm_pipelines_owner_idx ON crm_pipelines(owner_id, archived, updated_at DESC);

CREATE TABLE IF NOT EXISTS crm_pipeline_stages (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  pipeline_id TEXT NOT NULL,
  name TEXT NOT NULL,
  position INTEGER NOT NULL,
  category TEXT NOT NULL DEFAULT 'open' CHECK (category IN ('open','won','lost')),
  created_at TEXT NOT NULL,
  FOREIGN KEY (pipeline_id) REFERENCES crm_pipelines(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS crm_pipeline_stages_order_idx ON crm_pipeline_stages(owner_id, pipeline_id, position);

CREATE TABLE IF NOT EXISTS crm_opportunities (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  pipeline_id TEXT NOT NULL,
  stage_id TEXT NOT NULL,
  contact_id TEXT,
  client_id TEXT,
  title TEXT NOT NULL,
  value REAL NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'EUR',
  assigned_to TEXT,
  expected_close_date TEXT,
  source TEXT NOT NULL DEFAULT 'manual',
  source_submission_id TEXT,
  notes TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (pipeline_id) REFERENCES crm_pipelines(id),
  FOREIGN KEY (stage_id) REFERENCES crm_pipeline_stages(id),
  FOREIGN KEY (contact_id) REFERENCES crm_contacts(id)
);
CREATE INDEX IF NOT EXISTS crm_opportunities_owner_updated_idx ON crm_opportunities(owner_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS crm_opportunities_pipeline_stage_idx ON crm_opportunities(owner_id, pipeline_id, stage_id, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS crm_opportunities_source_submission_idx ON crm_opportunities(owner_id, source_submission_id) WHERE source_submission_id IS NOT NULL;

CREATE TABLE IF NOT EXISTS crm_activities (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  opportunity_id TEXT,
  contact_id TEXT,
  activity_type TEXT NOT NULL DEFAULT 'note',
  body TEXT NOT NULL,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  FOREIGN KEY (opportunity_id) REFERENCES crm_opportunities(id) ON DELETE CASCADE,
  FOREIGN KEY (contact_id) REFERENCES crm_contacts(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS crm_activities_owner_created_idx ON crm_activities(owner_id, created_at DESC);
