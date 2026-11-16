-- Payroll for payslips (also created on demand by lib/scheduling/schema.ts).
CREATE TABLE IF NOT EXISTS sched_payroll (
  owner_id TEXT NOT NULL,
  scope TEXT NOT NULL DEFAULT '',
  kind TEXT NOT NULL CHECK (kind IN ('employer','person','slip')),
  key TEXT NOT NULL,
  staff_id TEXT NOT NULL DEFAULT '',
  pay_date TEXT NOT NULL DEFAULT '',
  data TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL,
  PRIMARY KEY (owner_id, scope, kind, key)
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS sched_payroll_staff_idx ON sched_payroll(owner_id, scope, kind, staff_id, pay_date);
