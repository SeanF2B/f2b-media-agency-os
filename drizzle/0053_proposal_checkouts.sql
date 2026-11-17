-- Proposal Studio: client approval → Stripe Checkout links (also created lazily).
CREATE TABLE IF NOT EXISTS proposal_checkouts (
  session_id TEXT PRIMARY KEY NOT NULL,
  proposal_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  addons TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS proposal_checkouts_proposal_idx ON proposal_checkouts(proposal_id);
