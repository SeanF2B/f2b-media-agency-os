export const MARKETING_SUBMISSION_RATE_LIMIT = 60;
export const MARKETING_SUBMISSION_RATE_WINDOW_MS = 60_000;

export async function consumeMarketingSubmissionRateLimit(db, ownerId, assetId, nowMs = Date.now()) {
  const windowStart = Math.floor(nowMs / MARKETING_SUBMISSION_RATE_WINDOW_MS) * MARKETING_SUBMISSION_RATE_WINDOW_MS;
  await db.prepare("DELETE FROM marketing_submission_rate_limits WHERE window_start < ?1").bind(windowStart).run();
  const result = await db.prepare(`
    INSERT INTO marketing_submission_rate_limits (owner_id, asset_id, window_start, request_count)
    VALUES (?1, ?2, ?3, 1)
    ON CONFLICT (owner_id, asset_id, window_start) DO UPDATE SET request_count = request_count + 1
    WHERE request_count < ?4
    RETURNING request_count
  `).bind(ownerId, assetId, windowStart, MARKETING_SUBMISSION_RATE_LIMIT).first();
  return Boolean(result);
}
