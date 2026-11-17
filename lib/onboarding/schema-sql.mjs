// Onboarding engine tables. Same SQL as drizzle/0051_onboarding_engine.sql; the server runs it idempotently once
// per isolate so the feature also works before the migration is applied. All additive: no existing table changes.
export const ONBOARDING_SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS onboarding_sessions (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  entry_route TEXT NOT NULL DEFAULT 'grow',
  status TEXT NOT NULL DEFAULT 'started',
  step TEXT NOT NULL DEFAULT '',
  answers TEXT NOT NULL DEFAULT '{}',
  domain TEXT NOT NULL DEFAULT '',
  acquisition TEXT NOT NULL DEFAULT '{}',
  client_id TEXT,
  contact_id TEXT,
  opportunity_id TEXT,
  audit_id TEXT,
  recommended TEXT NOT NULL DEFAULT '{}',
  approvals TEXT NOT NULL DEFAULT '[]',
  consent_contact INTEGER NOT NULL DEFAULT 0,
  consent_marketing INTEGER NOT NULL DEFAULT 0,
  consent_at TEXT,
  unlocked INTEGER NOT NULL DEFAULT 0,
  booking_status TEXT NOT NULL DEFAULT '',
  payment_status TEXT NOT NULL DEFAULT '',
  quote TEXT NOT NULL DEFAULT '{}',
  stripe_customer_id TEXT NOT NULL DEFAULT '',
  checkout_id TEXT NOT NULL DEFAULT '',
  subscription_id TEXT NOT NULL DEFAULT '',
  subscription_status TEXT NOT NULL DEFAULT '',
  visitor TEXT NOT NULL DEFAULT '',
  staff INTEGER NOT NULL DEFAULT 0,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS onboarding_sessions_owner_updated_idx ON onboarding_sessions(owner_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS onboarding_sessions_owner_contact_idx ON onboarding_sessions(owner_id, contact_id);
CREATE INDEX IF NOT EXISTS onboarding_sessions_checkout_idx ON onboarding_sessions(checkout_id);
CREATE INDEX IF NOT EXISTS onboarding_sessions_subscription_idx ON onboarding_sessions(subscription_id);

CREATE TABLE IF NOT EXISTS onboarding_business_profiles (
  owner_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  profile TEXT NOT NULL DEFAULT '{}',
  extracted_at TEXT,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, domain)
);

CREATE TABLE IF NOT EXISTS onboarding_audits (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  session_id TEXT NOT NULL DEFAULT '',
  domain TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'running',
  stages_done TEXT NOT NULL DEFAULT '[]',
  stage_running TEXT NOT NULL DEFAULT '',
  stage_started_at TEXT,
  data TEXT NOT NULL DEFAULT '{}',
  result TEXT NOT NULL DEFAULT '{}',
  error TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  completed_at TEXT
);
CREATE INDEX IF NOT EXISTS onboarding_audits_domain_idx ON onboarding_audits(owner_id, domain, created_at DESC);
CREATE INDEX IF NOT EXISTS onboarding_audits_status_idx ON onboarding_audits(status, updated_at);

CREATE TABLE IF NOT EXISTS onboarding_usage (
  bucket TEXT NOT NULL,
  usage_date TEXT NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (bucket, usage_date)
);

CREATE TABLE IF NOT EXISTS onboarding_files (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  session_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  purpose TEXT NOT NULL DEFAULT 'document',
  name TEXT NOT NULL,
  size INTEGER NOT NULL,
  r2_key TEXT NOT NULL,
  extracted_text TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS onboarding_files_session_idx ON onboarding_files(owner_id, session_id);

CREATE TABLE IF NOT EXISTS onboarding_settings (
  owner_id TEXT PRIMARY KEY NOT NULL,
  data TEXT NOT NULL DEFAULT '{}',
  stripe_mode TEXT NOT NULL DEFAULT 'test',
  stripe_test_key TEXT NOT NULL DEFAULT '',
  stripe_test_key_iv TEXT NOT NULL DEFAULT '',
  stripe_test_webhook TEXT NOT NULL DEFAULT '',
  stripe_test_webhook_iv TEXT NOT NULL DEFAULT '',
  stripe_live_key TEXT NOT NULL DEFAULT '',
  stripe_live_key_iv TEXT NOT NULL DEFAULT '',
  stripe_live_webhook TEXT NOT NULL DEFAULT '',
  stripe_live_webhook_iv TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stripe_events (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  type TEXT NOT NULL,
  livemode INTEGER NOT NULL DEFAULT 0,
  session_id TEXT NOT NULL DEFAULT '',
  processed_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS stripe_invoice_links (
  stripe_invoice_id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  os_invoice_id TEXT NOT NULL,
  session_id TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
`;
