-- Proposal Studio (Operations → Reports → Proposals). Also created lazily by lib/proposals/server.ts.
CREATE TABLE IF NOT EXISTS proposals (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  client_id TEXT,
  contact_id TEXT,
  business_name TEXT NOT NULL DEFAULT '',
  website TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  brand TEXT NOT NULL DEFAULT '{}',
  inputs TEXT NOT NULL DEFAULT '{}',
  services TEXT NOT NULL DEFAULT '[]',
  deck TEXT NOT NULL DEFAULT '',
  uploads TEXT NOT NULL DEFAULT '[]',
  share_token TEXT,
  view_count INTEGER NOT NULL DEFAULT 0,
  viewed_at TEXT,
  approved_at TEXT,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS proposals_owner_updated_idx ON proposals(owner_id, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS proposals_share_token_idx ON proposals(share_token);
CREATE TABLE IF NOT EXISTS proposal_settings (
  owner_id TEXT PRIMARY KEY NOT NULL,
  catalogue TEXT NOT NULL DEFAULT '[]',
  updated_at TEXT NOT NULL
);
