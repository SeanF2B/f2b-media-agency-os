export type DataForSeoUsageBucket = {
  requestCount: number;
  knownCostUsd: number | null;
  unknownCostCount: number;
};

export type DataForSeoUsageSummary = {
  periodStart: string;
  requestCount: number;
  knownCostUsd: number | null;
  unknownCostCount: number;
  byService: {
    keywordResearch: DataForSeoUsageBucket;
    competitorResearch: DataForSeoUsageBucket;
    localMaps: DataForSeoUsageBucket;
    backlinks: DataForSeoUsageBucket;
  };
};

function cleanBucket(bucket: DataForSeoUsageBucket): DataForSeoUsageBucket {
  const requestCount = Number.isFinite(bucket.requestCount) ? Math.max(0, Math.trunc(bucket.requestCount)) : 0;
  const unknownCostCount = Number.isFinite(bucket.unknownCostCount) ? Math.max(0, Math.trunc(bucket.unknownCostCount)) : 0;
  const knownCostUsd = typeof bucket.knownCostUsd === "number" && Number.isFinite(bucket.knownCostUsd)
    ? Math.max(0, bucket.knownCostUsd)
    : null;
  return { requestCount, knownCostUsd, unknownCostCount };
}

export function summarizeDataForSeoUsage(input: {
  periodStart: string;
  keywordResearch: DataForSeoUsageBucket;
  competitorResearch?: DataForSeoUsageBucket;
  localMaps: DataForSeoUsageBucket;
  backlinks: DataForSeoUsageBucket;
}): DataForSeoUsageSummary {
  const byService = {
    keywordResearch: cleanBucket(input.keywordResearch),
    competitorResearch: cleanBucket(input.competitorResearch || { requestCount: 0, knownCostUsd: null, unknownCostCount: 0 }),
    localMaps: cleanBucket(input.localMaps),
    backlinks: cleanBucket(input.backlinks),
  };
  const buckets = Object.values(byService);
  const requestCount = buckets.reduce((sum, bucket) => sum + bucket.requestCount, 0);
  const knownCostBuckets = buckets.filter((bucket) => bucket.knownCostUsd !== null);
  const knownCostUsd = !requestCount
    ? 0
    : knownCostBuckets.length
    ? knownCostBuckets.reduce((sum, bucket) => sum + (bucket.knownCostUsd || 0), 0)
    : null;
  return {
    periodStart: input.periodStart,
    requestCount,
    knownCostUsd,
    unknownCostCount: buckets.reduce((sum, bucket) => sum + bucket.unknownCostCount, 0),
    byService,
  };
}
