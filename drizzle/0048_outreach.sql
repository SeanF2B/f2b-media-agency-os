-- Outreach module (Phase 1 foundation). Additive only: no existing table is touched.
-- Every table is scoped by owner_id and every hot query path has an index, to keep
-- D1 rows-read low (the account already reads 3–7M rows/day).

-- Provider connections (Instantly, Inframail, Telegram, verifier…). Keys are AES-GCM
-- encrypted with AGENCY_CREDENTIALS_ENCRYPTION_KEY, like agency_api_keys.
CREATE TABLE IF NOT EXISTS outreach_connections (
  owner_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  encrypted_key TEXT NOT NULL,
  key_iv TEXT NOT NULL,
  key_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'unverified',   -- unverified | ok | error
  last_error TEXT NOT NULL DEFAULT '',
  verified_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, provider)
);

-- Sending domains managed by the platform. Primary business domains are flagged
-- protected and are never modified by automation.
CREATE TABLE IF NOT EXISTS outreach_domains (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  client_id TEXT,
  zone_id TEXT,
  registrar TEXT NOT NULL DEFAULT '',
  protected INTEGER NOT NULL DEFAULT 0,
  dmarc_stage TEXT NOT NULL DEFAULT 'none',     -- none | quarantine | reject
  expires_at TEXT,
  auto_renew INTEGER NOT NULL DEFAULT 1,
  annual_cost_cents INTEGER,
  currency TEXT NOT NULL DEFAULT 'USD',
  last_check_json TEXT NOT NULL DEFAULT '{}',
  last_checked_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS outreach_domains_owner_domain_idx ON outreach_domains(owner_id, domain);

-- Sending mailboxes. provider_ref is the id/email at the sending provider (Instantly).
CREATE TABLE IF NOT EXISTS outreach_mailboxes (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  email TEXT NOT NULL,
  domain TEXT NOT NULL,
  provider TEXT NOT NULL,                       -- instantly
  first_name TEXT NOT NULL DEFAULT '',
  last_name TEXT NOT NULL DEFAULT '',
  client_id TEXT,
  group_label TEXT NOT NULL DEFAULT '',
  tags_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'unknown',       -- active | paused | error | unknown
  warmup_status TEXT NOT NULL DEFAULT 'unknown',
  daily_limit INTEGER,
  monthly_cost_cents INTEGER,
  renews_at TEXT,
  health_json TEXT NOT NULL DEFAULT '{}',
  synced_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS outreach_mailboxes_owner_email_idx ON outreach_mailboxes(owner_id, email);
CREATE INDEX IF NOT EXISTS outreach_mailboxes_owner_domain_idx ON outreach_mailboxes(owner_id, domain);

-- Every DNS change the platform makes, with the previous value for rollback.
CREATE TABLE IF NOT EXISTS outreach_dns_changes (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  zone_id TEXT NOT NULL,
  record_id TEXT,
  action TEXT NOT NULL,                         -- create | update | delete | rollback
  record_type TEXT NOT NULL,
  record_name TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  reason TEXT NOT NULL DEFAULT '',
  actor TEXT NOT NULL DEFAULT '',
  rolled_back_by TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS outreach_dns_changes_domain_idx ON outreach_dns_changes(owner_id, domain, created_at);

-- Provisioning wizard runs. idempotency_key prevents a double purchase on retry.
CREATE TABLE IF NOT EXISTS outreach_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  kind TEXT NOT NULL,                           -- provision | dns-repair | sync
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',       -- pending | running | waiting | done | failed | cancelled
  input_json TEXT NOT NULL DEFAULT '{}',
  approved_by TEXT,
  approved_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS outreach_jobs_idem_idx ON outreach_jobs(owner_id, idempotency_key);
CREATE INDEX IF NOT EXISTS outreach_jobs_status_idx ON outreach_jobs(status, updated_at);

CREATE TABLE IF NOT EXISTS outreach_job_steps (
  job_id TEXT NOT NULL,
  step_key TEXT NOT NULL,                       -- e.g. purchase:acme-mail.com, dkim:acme-mail.com
  position INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',       -- pending | running | done | failed | skipped
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  message TEXT NOT NULL DEFAULT '',
  result_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (job_id, step_key)
);
CREATE INDEX IF NOT EXISTS outreach_job_steps_due_idx ON outreach_job_steps(status, next_attempt_at);

-- Global suppression list (unsubscribes, hard bounces, complaints, manual).
CREATE TABLE IF NOT EXISTS outreach_suppressions (
  owner_id TEXT NOT NULL,
  value TEXT NOT NULL,                          -- lower-cased email or @domain
  reason TEXT NOT NULL,                         -- unsubscribe | bounce | complaint | manual | do-not-contact
  source TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, value)
);

-- Reply classifications and review queue. message_ref is the provider email id.
CREATE TABLE IF NOT EXISTS outreach_replies (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  provider TEXT NOT NULL,
  message_ref TEXT NOT NULL,
  thread_ref TEXT NOT NULL,
  campaign_ref TEXT,
  mailbox TEXT NOT NULL,
  lead_email TEXT NOT NULL,
  received_at TEXT NOT NULL,
  label TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0,
  needs_review INTEGER NOT NULL DEFAULT 0,
  label_source TEXT NOT NULL DEFAULT 'ai',      -- ai | rule | human
  status TEXT NOT NULL DEFAULT 'open',          -- open | replied | archived
  assigned_to TEXT,
  notified_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS outreach_replies_msg_idx ON outreach_replies(owner_id, provider, message_ref);
CREATE INDEX IF NOT EXISTS outreach_replies_inbox_idx ON outreach_replies(owner_id, label, status, received_at);
CREATE INDEX IF NOT EXISTS outreach_replies_review_idx ON outreach_replies(owner_id, needs_review, received_at);

-- Audit trail for chargeable or destructive actions and approvals.
CREATE TABLE IF NOT EXISTS outreach_audit (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  actor TEXT NOT NULL,
  action TEXT NOT NULL,
  target TEXT NOT NULL DEFAULT '',
  detail_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS outreach_audit_owner_idx ON outreach_audit(owner_id, created_at);
