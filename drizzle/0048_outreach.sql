-- Outreach (native cold-email engine) — lives under Leads → Outreach.
-- Additive only. It deliberately does NOT duplicate the CRM:
--   * prospects are crm_contacts rows (company = crm_contacts.company)
--   * email threads/messages are conv_threads / conv_messages rows with channel = 'email'
--     (our_number = sending mailbox, contact = prospect email), so they show in Conversations
--   * positive replies create/update crm_opportunities using
--     source_submission_id = 'outreach:<contact_id>' (already uniquely indexed) to prevent duplicates
-- Every table is owner-scoped and indexed for the queries the cron runs, to keep D1 reads low.

-- Encrypted connections: Microsoft Graph app, Google service account, Telegram bot, optional verifier.
CREATE TABLE IF NOT EXISTS outreach_connections (
  owner_id TEXT NOT NULL,
  provider TEXT NOT NULL,                       -- microsoft | google | telegram | verifier
  encrypted_secret TEXT NOT NULL,
  secret_iv TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  config_json TEXT NOT NULL DEFAULT '{}',       -- non-secret settings (tenant id, chat id…)
  status TEXT NOT NULL DEFAULT 'unverified',    -- unverified | ok | error
  last_error TEXT NOT NULL DEFAULT '',
  verified_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, provider)
);

-- Sending domains. protected = primary business domain: automation never changes it.
CREATE TABLE IF NOT EXISTS outreach_domains (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  client_id TEXT,
  zone_id TEXT,
  mail_host TEXT NOT NULL DEFAULT '',           -- microsoft | google | smtp
  protected INTEGER NOT NULL DEFAULT 0,
  dmarc_stage TEXT NOT NULL DEFAULT 'none',
  registered_at TEXT,
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

-- Sending mailboxes. Credentials only for SMTP mailboxes; Graph/Gmail use the app connection.
CREATE TABLE IF NOT EXISTS outreach_mailboxes (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  email TEXT NOT NULL,
  domain TEXT NOT NULL,
  host TEXT NOT NULL,                           -- microsoft | google | smtp
  host_user_id TEXT NOT NULL DEFAULT '',        -- Graph/Google user id
  display_name TEXT NOT NULL DEFAULT '',
  signature_html TEXT NOT NULL DEFAULT '',
  client_id TEXT,
  group_label TEXT NOT NULL DEFAULT '',
  tags_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'setup',         -- setup | ramping | active | paused | error
  paused_reason TEXT NOT NULL DEFAULT '',
  ramp_started_at TEXT,
  target_daily INTEGER NOT NULL DEFAULT 30,
  min_gap_seconds INTEGER NOT NULL DEFAULT 240,
  smtp_json_enc TEXT,                           -- encrypted {host,port,user,pass} for SMTP mailboxes
  smtp_iv TEXT,
  inbox_cursor TEXT NOT NULL DEFAULT '',        -- Graph delta link / Gmail historyId
  last_sent_at TEXT,
  last_polled_at TEXT,
  health_json TEXT NOT NULL DEFAULT '{}',
  monthly_cost_cents INTEGER,
  renews_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS outreach_mailboxes_owner_email_idx ON outreach_mailboxes(owner_id, email);
CREATE INDEX IF NOT EXISTS outreach_mailboxes_owner_status_idx ON outreach_mailboxes(owner_id, status);

-- Per-mailbox daily counters (limits, ramp and health). One row per mailbox per UTC day.
CREATE TABLE IF NOT EXISTS outreach_mailbox_days (
  mailbox_id TEXT NOT NULL,
  day TEXT NOT NULL,
  sent INTEGER NOT NULL DEFAULT 0,
  bounced INTEGER NOT NULL DEFAULT 0,
  complaints INTEGER NOT NULL DEFAULT 0,
  errors INTEGER NOT NULL DEFAULT 0,
  replies INTEGER NOT NULL DEFAULT 0,
  positive INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (mailbox_id, day)
);

-- Campaigns and their sequence steps (A/B variants live inside a step).
CREATE TABLE IF NOT EXISTS outreach_campaigns (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  client_id TEXT,
  name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'draft',         -- draft | active | paused | completed
  niche TEXT NOT NULL DEFAULT '',
  offer TEXT NOT NULL DEFAULT '',
  mailbox_ids_json TEXT NOT NULL DEFAULT '[]',
  schedule_json TEXT NOT NULL DEFAULT '{}',     -- {days:[1..5], start:"09:00", end:"17:00", tz:"recipient"|IANA}
  daily_cap INTEGER NOT NULL DEFAULT 0,         -- 0 = only mailbox limits apply
  pipeline_id TEXT,                             -- where positive replies land (default: first open pipeline)
  stage_id TEXT,
  lawful_basis TEXT NOT NULL DEFAULT '',        -- required before launch
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  launched_at TEXT
);
CREATE INDEX IF NOT EXISTS outreach_campaigns_owner_idx ON outreach_campaigns(owner_id, status, updated_at);

CREATE TABLE IF NOT EXISTS outreach_steps (
  id TEXT PRIMARY KEY NOT NULL,
  campaign_id TEXT NOT NULL,
  position INTEGER NOT NULL,
  delay_days INTEGER NOT NULL DEFAULT 0,        -- after the previous step
  variants_json TEXT NOT NULL DEFAULT '[]',     -- [{id, subject, body, weight}]; follow-ups may leave subject empty to thread
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS outreach_steps_order_idx ON outreach_steps(campaign_id, position);

-- A CRM contact enrolled in a campaign. Only one active enrollment per contact across all
-- campaigns (partial unique index) — this is what prevents duplicate outreach.
CREATE TABLE IF NOT EXISTS outreach_enrollments (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  contact_id TEXT NOT NULL,                     -- crm_contacts.id
  email TEXT NOT NULL,                          -- lower-cased copy for suppression checks
  status TEXT NOT NULL DEFAULT 'active',        -- active | paused | replied | unsubscribed | bounced | completed | stopped
  next_step INTEGER NOT NULL DEFAULT 0,
  next_send_at TEXT,
  mailbox_id TEXT,                              -- sticky: follow-ups come from the same mailbox
  thread_id TEXT,                               -- conv_threads.id once the first email is sent
  first_message_id TEXT NOT NULL DEFAULT '',    -- RFC Message-ID, used for In-Reply-To
  variant_json TEXT NOT NULL DEFAULT '{}',
  vars_json TEXT NOT NULL DEFAULT '{}',         -- personalisation variables, incl. AI opening line
  stop_reason TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS outreach_enrollments_campaign_contact_idx ON outreach_enrollments(campaign_id, contact_id);
CREATE UNIQUE INDEX IF NOT EXISTS outreach_enrollments_one_active_idx ON outreach_enrollments(owner_id, contact_id) WHERE status IN ('active', 'paused');
CREATE INDEX IF NOT EXISTS outreach_enrollments_due_idx ON outreach_enrollments(status, next_send_at);
CREATE INDEX IF NOT EXISTS outreach_enrollments_email_idx ON outreach_enrollments(owner_id, email);

-- Outbox / send log. idempotency_key = enrollment:step stops a step being sent twice.
CREATE TABLE IF NOT EXISTS outreach_sends (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  enrollment_id TEXT NOT NULL,
  campaign_id TEXT NOT NULL,
  step INTEGER NOT NULL,
  variant_id TEXT NOT NULL DEFAULT '',
  mailbox_id TEXT NOT NULL,
  message_id TEXT NOT NULL,                     -- RFC Message-ID we generated
  status TEXT NOT NULL DEFAULT 'claimed',       -- claimed | sent | failed | bounced
  error TEXT NOT NULL DEFAULT '',
  conv_message_id TEXT,
  created_at TEXT NOT NULL,
  sent_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS outreach_sends_idem_idx ON outreach_sends(owner_id, idempotency_key);
CREATE INDEX IF NOT EXISTS outreach_sends_campaign_idx ON outreach_sends(campaign_id, sent_at);
CREATE INDEX IF NOT EXISTS outreach_sends_message_idx ON outreach_sends(message_id);

-- Reply classification overlay on conv_messages (no copy of the email itself).
CREATE TABLE IF NOT EXISTS outreach_replies (
  conv_message_id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  thread_id TEXT NOT NULL,
  contact_id TEXT,
  campaign_id TEXT,
  mailbox_id TEXT,
  host_message_id TEXT NOT NULL,                -- Graph/Gmail id, dedupes polling
  label TEXT NOT NULL,
  confidence REAL NOT NULL DEFAULT 0,
  needs_review INTEGER NOT NULL DEFAULT 0,
  label_source TEXT NOT NULL DEFAULT 'ai',
  suggested_reply TEXT NOT NULL DEFAULT '',
  reply_status TEXT NOT NULL DEFAULT 'open',    -- open | drafted | sent | archived
  opportunity_id TEXT,
  notified_at TEXT,
  received_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS outreach_replies_host_idx ON outreach_replies(owner_id, mailbox_id, host_message_id);
CREATE INDEX IF NOT EXISTS outreach_replies_inbox_idx ON outreach_replies(owner_id, label, reply_status, received_at);
CREATE INDEX IF NOT EXISTS outreach_replies_review_idx ON outreach_replies(owner_id, needs_review, received_at);

-- Global suppression list.
CREATE TABLE IF NOT EXISTS outreach_suppressions (
  owner_id TEXT NOT NULL,
  value TEXT NOT NULL,                          -- lower-cased email or @domain
  reason TEXT NOT NULL,                         -- unsubscribe | bounce | complaint | manual | customer
  source TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, value)
);

-- AI Playbook entries (agency info, offers, ICPs, tone, approved examples, corrections…).
CREATE TABLE IF NOT EXISTS outreach_playbook (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  kind TEXT NOT NULL,                           -- agency | offer | pricing | icp | niche | tone | rule | example | case-study | objection | process | avoid | correction
  title TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL,
  evidence TEXT NOT NULL DEFAULT 'hypothesis',  -- proven | hypothesis
  client_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS outreach_playbook_owner_idx ON outreach_playbook(owner_id, kind);

-- DNS change history with previous values for rollback.
CREATE TABLE IF NOT EXISTS outreach_dns_changes (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  domain TEXT NOT NULL,
  zone_id TEXT NOT NULL,
  record_id TEXT,
  action TEXT NOT NULL,
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

-- Provisioning wizard runs (idempotent, resumable).
CREATE TABLE IF NOT EXISTS outreach_jobs (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
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
  step_key TEXT NOT NULL,
  position INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_attempt_at TEXT,
  message TEXT NOT NULL DEFAULT '',
  result_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (job_id, step_key)
);
CREATE INDEX IF NOT EXISTS outreach_job_steps_due_idx ON outreach_job_steps(status, next_attempt_at);

-- Audit trail for chargeable, destructive and approval actions.
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
