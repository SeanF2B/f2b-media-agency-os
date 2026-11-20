-- Client contracts (Client workroom → Contracts, public signing at /f/contract/<token>). Also created lazily by lib/contracts/server.ts.
CREATE TABLE IF NOT EXISTS contracts (
  id TEXT PRIMARY KEY NOT NULL,
  owner_id TEXT NOT NULL,
  client_id TEXT NOT NULL,
  reference TEXT NOT NULL DEFAULT '',
  title TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  data TEXT NOT NULL DEFAULT '{}',
  monthly_total REAL NOT NULL DEFAULT 0,
  share_token TEXT,
  sent_at TEXT,
  viewed_at TEXT,
  signed_at TEXT,
  signature TEXT,
  signed_html_key TEXT NOT NULL DEFAULT '',
  signed_html TEXT,
  created_by TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS contracts_client_idx ON contracts(owner_id, client_id, updated_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS contracts_share_token_idx ON contracts(share_token);
CREATE TABLE IF NOT EXISTS contract_settings (
  owner_id TEXT PRIMARY KEY NOT NULL,
  defaults TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL
);
