export type CompetitorKeyword = {
  keyword: string;
  monthlySearches: number | null;
  difficulty: number | null;
  competitorPosition: number | null;
  competitorUrl: string | null;
};

export type CompetitorKeywordResult = {
  competitorDomain: string;
  status: "connected" | "unavailable";
  message?: string;
  costUsd: number | null;
  totalCount: number | null;
  keywords: CompetitorKeyword[];
};

type ProviderTask = { status_code?: number; status_message?: string; cost?: number; result?: Array<{ total_count?: number; items?: Array<Record<string, unknown>> }> };

export function normalizePublicDomain(value: string): string | null {
  const input = value.trim();
  if (!input || input.length > 2048) return null;
  try {
    const url = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(input) ? input : `https://${input}`);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.port) return null;
    const hostname = url.hostname.toLowerCase().replace(/^www\./, "").replace(/\.$/, "");
    if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(hostname)) return null;
    return hostname;
  } catch { return null; }
}

export function competitorDomainIntersectionRequest(clientDomain: string, competitorDomain: string, location: string) {
  return {
    target1: competitorDomain,
    target2: clientDomain,
    location_name: location,
    language_name: "English",
    intersections: false,
    item_types: ["organic"],
    limit: 100,
    order_by: ["keyword_data.keyword_info.search_volume,desc"],
  };
}

export function parseCompetitorKeywordIntersection(payload: unknown, competitorDomain: string): CompetitorKeywordResult {
  const tasks = (payload as { tasks?: unknown } | null)?.tasks;
  const task = Array.isArray(tasks) ? tasks[0] as ProviderTask | undefined : undefined;
  const result = task?.result?.[0];
  const keywords = (result?.items || []).flatMap((raw) => {
    const data = raw.keyword_data as Record<string, unknown> | undefined;
    const info = data?.keyword_info as Record<string, unknown> | undefined;
    const properties = data?.keyword_properties as Record<string, unknown> | undefined;
    const first = raw.first_domain_serp_element as Record<string, unknown> | undefined;
    const organic = first?.organic as Record<string, unknown> | undefined;
    const keyword = typeof data?.keyword === "string" ? data.keyword.trim() : "";
    if (!keyword) return [];
    const n = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;
    return [{
      keyword,
      monthlySearches: n(info?.search_volume),
      difficulty: n(properties?.keyword_difficulty),
      competitorPosition: n(organic?.rank_group),
      competitorUrl: typeof organic?.url === "string" ? organic.url : null,
    }];
  });
  return {
    competitorDomain,
    status: Number(task?.status_code || 0) === 20000 ? "connected" : "unavailable",
    ...(Number(task?.status_code || 0) !== 20000 ? { message: String(task?.status_message || "DataForSEO did not return keyword-gap results.") } : {}),
    costUsd: typeof task?.cost === "number" && Number.isFinite(task.cost) ? task.cost : null,
    totalCount: typeof result?.total_count === "number" ? result.total_count : null,
    keywords,
  };
}
