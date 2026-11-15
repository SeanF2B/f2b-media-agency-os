// Operating World tables. CREATE TABLE IF NOT EXISTS only — never alters or drops CRM data.
// scope_id = client (sub-account) id, or '' for the agency account. Every query is index-backed.
export const OPERATING_WORLD_SCHEMA = [
  // One row per account: when the game was switched on (rewards only count work after this), mode and profile.
  "CREATE TABLE IF NOT EXISTS ow_state (owner_id TEXT NOT NULL, scope_id TEXT NOT NULL DEFAULT '', started_at TEXT NOT NULL, mode TEXT NOT NULL DEFAULT 'copilot' CHECK (mode IN ('manual','copilot','autopilot')), autopilot_paused INTEGER NOT NULL DEFAULT 1, profile TEXT NOT NULL DEFAULT '{}', updated_at TEXT NOT NULL, PRIMARY KEY (owner_id, scope_id))",
  // Virtual reward ledger. The primary key makes every reward idempotent: a record can only ever pay out once.
  // Coins/XP land as collectable coins over the employee; they count once the owner taps to collect (collected_at).
  "CREATE TABLE IF NOT EXISTS ow_ledger (owner_id TEXT NOT NULL, scope_id TEXT NOT NULL DEFAULT '', reward_key TEXT NOT NULL, kind TEXT NOT NULL, coins INTEGER NOT NULL, xp INTEGER NOT NULL, label TEXT NOT NULL DEFAULT '', earned_at TEXT NOT NULL, created_at TEXT NOT NULL, collected_at TEXT NOT NULL DEFAULT '', PRIMARY KEY (owner_id, scope_id, reward_key))",
  "CREATE INDEX IF NOT EXISTS ow_ledger_recent_idx ON ow_ledger(owner_id, scope_id, created_at DESC)",
  "CREATE INDEX IF NOT EXISTS ow_ledger_pending_idx ON ow_ledger(owner_id, scope_id, collected_at)",
  // Upgrade purchases (coins only), item_id = '<track>:<tier>'. One row per tier per account.
  "CREATE TABLE IF NOT EXISTS ow_purchases (owner_id TEXT NOT NULL, scope_id TEXT NOT NULL DEFAULT '', item_id TEXT NOT NULL, coins INTEGER NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY (owner_id, scope_id, item_id))",
  // What the owner and the AI did in the game, why, and which records it touched.
  "CREATE TABLE IF NOT EXISTS ow_action_log (id TEXT PRIMARY KEY NOT NULL, owner_id TEXT NOT NULL, scope_id TEXT NOT NULL DEFAULT '', actor TEXT NOT NULL, action TEXT NOT NULL, reason TEXT NOT NULL DEFAULT '', records TEXT NOT NULL DEFAULT '[]', status TEXT NOT NULL DEFAULT 'done', created_at TEXT NOT NULL)",
  "CREATE INDEX IF NOT EXISTS ow_action_log_recent_idx ON ow_action_log(owner_id, scope_id, created_at DESC)",
];
