export type DataForSeoKeywordIdea = {
  keyword: string;
  avgMonthlySearches: number | null;
  paidCompetition: string | null;
  difficulty: number | null;
  lowTopOfPageBid: number | null;
  highTopOfPageBid: number | null;
};

type TaskPayload = { status_code?: number; status_message?: string; cost?: number; result?: Array<{ items?: Array<Record<string, unknown>> }> };

function tasks(payload: unknown): TaskPayload[] {
  const data = payload as { tasks?: unknown } | null;
  return Array.isArray(data?.tasks) ? data.tasks as TaskPayload[] : [];
}

export function parseDataForSeoIdeas(payload: unknown) {
  const task = tasks(payload)[0];
  const result = task?.result?.[0];
  const ideas: DataForSeoKeywordIdea[] = (result?.items || []).flatMap((item) => {
    const info = item.keyword_info as Record<string, unknown> | undefined;
    const keyword = typeof item.keyword === "string" ? item.keyword.trim() : "";
    if (!keyword || !info) return [];
    const numberOrNull = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : null;
    return [{ keyword, avgMonthlySearches: numberOrNull(info.search_volume), paidCompetition: typeof info.competition_level === "string" ? info.competition_level : null, difficulty: null, lowTopOfPageBid: numberOrNull(info.low_top_of_page_bid), highTopOfPageBid: numberOrNull(info.high_top_of_page_bid) }];
  });
  return { statusCode: Number(task?.status_code || 0), message: String(task?.status_message || ""), cost: typeof task?.cost === "number" ? task.cost : null, ideas };
}

export function parseDataForSeoDifficulty(payload: unknown) {
  const task = tasks(payload)[0];
  const result = task?.result?.[0];
  const difficulty = new Map<string, number>();
  for (const item of result?.items || []) {
    if (typeof item.keyword === "string" && typeof item.keyword_difficulty === "number" && Number.isFinite(item.keyword_difficulty)) difficulty.set(item.keyword.trim().toLocaleLowerCase(), item.keyword_difficulty);
  }
  return { statusCode: Number(task?.status_code || 0), message: String(task?.status_message || ""), cost: typeof task?.cost === "number" ? task.cost : null, difficulty };
}

export function mergeDataForSeoDifficulty(ideas: DataForSeoKeywordIdea[], difficulty: Map<string, number>) {
  return ideas.map((idea) => ({ ...idea, difficulty: difficulty.get(idea.keyword.toLocaleLowerCase()) ?? null }));
}
