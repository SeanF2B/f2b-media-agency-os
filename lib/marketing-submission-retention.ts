import { deleteMarketingSubmission } from "./marketing-submission-delete.ts";

export const MARKETING_SUBMISSION_RETENTION_DAYS = [30, 90, 180, 365] as const;
export type MarketingSubmissionRetentionDays = (typeof MARKETING_SUBMISSION_RETENTION_DAYS)[number] | null;

export function normalizeMarketingSubmissionRetentionDays(value: unknown): MarketingSubmissionRetentionDays | undefined {
  if (value === null || value === "never") return null;
  const days = Number(value);
  return MARKETING_SUBMISSION_RETENTION_DAYS.includes(days as (typeof MARKETING_SUBMISSION_RETENTION_DAYS)[number]) ? days as MarketingSubmissionRetentionDays : undefined;
}

export async function getMarketingSubmissionRetention(db: D1Database, ownerId: string): Promise<MarketingSubmissionRetentionDays> {
  const row = await db.prepare("SELECT retention_days AS retentionDays FROM marketing_submission_retention WHERE owner_id = ?1").bind(ownerId).first<{ retentionDays: number | null }>();
  return normalizeMarketingSubmissionRetentionDays(row?.retentionDays ?? null) ?? null;
}

export async function saveMarketingSubmissionRetention(db: D1Database, ownerId: string, days: MarketingSubmissionRetentionDays, now = new Date()) {
  await db.prepare("INSERT INTO marketing_submission_retention (owner_id, retention_days, updated_at) VALUES (?1, ?2, ?3) ON CONFLICT(owner_id) DO UPDATE SET retention_days = excluded.retention_days, cursor_created_at = '', cursor_submission_id = '', updated_at = excluded.updated_at")
    .bind(ownerId, days, now.toISOString()).run();
}

export async function processExpiredMarketingSubmissions(db: D1Database, bucket: R2Bucket | undefined, now = new Date(), limit = 50) {
  if (!Number.isInteger(limit) || limit < 1 || limit > 500) throw new Error("Retention cleanup batch must be between 1 and 500.");
  const policies = await db.prepare("SELECT owner_id AS ownerId, retention_days AS retentionDays, cursor_created_at AS cursorCreatedAt, cursor_submission_id AS cursorSubmissionId FROM marketing_submission_retention WHERE retention_days IS NOT NULL ORDER BY owner_id ASC").all<{ ownerId: string; retentionDays: number; cursorCreatedAt: string; cursorSubmissionId: string }>();
  let deleted = 0;
  let failed = 0;
  let scanned = 0;
  const outcomes: Array<{ ownerId: string; status: string }> = [];
  for (const policy of policies.results || []) {
    const days = normalizeMarketingSubmissionRetentionDays(policy.retentionDays);
    if (!days) continue;
    const cutoff = new Date(now.getTime() - days * 86_400_000).toISOString();
    const batchSize = Math.min(100, limit - scanned);
    const rows = await db.prepare("SELECT id, created_at AS createdAt FROM marketing_submissions WHERE owner_id = ?1 AND created_at < ?2 AND (?3 = '' OR created_at > ?3 OR (created_at = ?3 AND id > ?4)) ORDER BY created_at ASC, id ASC LIMIT ?5")
      .bind(policy.ownerId, cutoff, policy.cursorCreatedAt || "", policy.cursorSubmissionId || "", batchSize).all<{ id: string; createdAt: string }>();
    for (const row of rows.results || []) {
      scanned++;
      const result = await deleteMarketingSubmission(db, bucket, policy.ownerId, row.id);
      if (result.status === "deleted") deleted++;
      else if (result.status !== "not_found") {
        failed++;
        outcomes.push({ ownerId: policy.ownerId, status: result.status });
      }
    }
    const last = rows.results?.at(-1);
    if (rows.results?.length === batchSize && last) {
      await db.prepare("UPDATE marketing_submission_retention SET cursor_created_at = ?1, cursor_submission_id = ?2 WHERE owner_id = ?3").bind(last.createdAt, last.id, policy.ownerId).run();
    } else {
      await db.prepare("UPDATE marketing_submission_retention SET cursor_created_at = '', cursor_submission_id = '' WHERE owner_id = ?1").bind(policy.ownerId).run();
    }
    if (scanned >= limit) return { deleted, failed, outcomes };
  }
  return { deleted, failed, outcomes };
}
