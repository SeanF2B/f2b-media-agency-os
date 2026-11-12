import { marketingSubmissionFileKeys } from "./marketing-submission-files.ts";

export type MarketingSubmissionDeleteResult =
  | { status: "deleted"; submissionId: string; assetId: string }
  | { status: "not_found" }
  | { status: "storage_unavailable" }
  | { status: "attachment_delete_failed" };

type MarketingSubmissionAuditContext = { assetId: string; clientId: string | null; projectKind: string; resourceLabel: string | null };

export async function deleteMarketingSubmission(
  db: D1Database,
  bucket: R2Bucket | undefined,
  ownerId: string,
  submissionId: string,
  auditStatement?: (submission: MarketingSubmissionAuditContext) => D1PreparedStatement,
): Promise<MarketingSubmissionDeleteResult> {
  const submission = auditStatement
    ? await db.prepare("SELECT s.id, s.asset_id AS assetId, s.data, s.created_at AS createdAt, a.client_id AS clientId, a.kind AS projectKind, a.name AS resourceLabel FROM marketing_submissions s LEFT JOIN marketing_assets a ON a.owner_id = s.owner_id AND a.id = s.asset_id WHERE s.owner_id = ?1 AND s.id = ?2").bind(ownerId, submissionId).first<{ id: string; assetId: string; data: string; createdAt: string; clientId: string | null; projectKind: string | null; resourceLabel: string | null }>()
    : await db.prepare("SELECT id, asset_id AS assetId, data, created_at AS createdAt FROM marketing_submissions WHERE owner_id = ?1 AND id = ?2").bind(ownerId, submissionId).first<{ id: string; assetId: string; data: string; createdAt: string; clientId?: null; projectKind?: null }>();
  if (!submission) return { status: "not_found" };

  const attachmentKeys = marketingSubmissionFileKeys(ownerId, submission.id, submission.data);
  if (attachmentKeys.length && !bucket) return { status: "storage_unavailable" };
  try {
    if (bucket && attachmentKeys.length) await Promise.all(attachmentKeys.map((key) => bucket.delete(key)));
  } catch (error) {
    console.error("Could not remove a submission attachment", error);
    return { status: "attachment_delete_failed" };
  }

  const statements = [
    db.prepare("DELETE FROM marketing_executions WHERE owner_id = ?1 AND json_extract(input, '$.submissionId') = ?2").bind(ownerId, submission.id),
    db.prepare("UPDATE marketing_daily_analytics SET submissions = MAX(0, submissions - 1) WHERE owner_id = ?1 AND asset_id = ?2 AND metric_date = date(?3)").bind(ownerId, submission.assetId, submission.createdAt),
    db.prepare("DELETE FROM marketing_submissions WHERE owner_id = ?1 AND id = ?2").bind(ownerId, submission.id),
    ...(auditStatement && submission.projectKind ? [auditStatement({ assetId: submission.assetId, clientId: submission.clientId, projectKind: submission.projectKind, resourceLabel: submission.resourceLabel })] : []),
  ];
  await db.batch(statements);
  return { status: "deleted", submissionId: submission.id, assetId: submission.assetId };
}
