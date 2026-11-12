export function normalizeMarketingPage({ limit, offset }, { defaultLimit = 100, maxLimit = 200, maxOffset = 1_000_000 } = {}) {
  const requestedLimit = Number(limit);
  const requestedOffset = Number(offset);
  return {
    limit: limit === null || limit === undefined || limit === "" ? defaultLimit : Number.isInteger(requestedLimit) ? Math.max(1, Math.min(maxLimit, requestedLimit)) : defaultLimit,
    offset: Number.isSafeInteger(requestedOffset) ? Math.max(0, Math.min(maxOffset, requestedOffset)) : 0,
  };
}

export function buildMarketingPageResult(rows, { limit, offset }) {
  const hasMore = rows.length > limit;
  return {
    items: hasMore ? rows.slice(0, limit) : rows,
    hasMore,
    nextOffset: hasMore ? offset + limit : null,
  };
}
