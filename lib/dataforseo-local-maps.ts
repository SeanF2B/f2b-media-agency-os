export type LocalMapsRank = { keyword: string; location: string; businessName: string; domain: string; rank: number | null; placeId: string | null; rating: number | null; reviewCount: number | null; matchedBy: "domain" | "name" | null; competitors: Array<{ name: string; rank: number; domain: string | null; rating: number | null; reviewCount: number | null }> };

type MapsTask = { status_code?: number; status_message?: string; cost?: number; result?: Array<{ items?: Array<Record<string, unknown>> }> };
function firstTask(payload: unknown): MapsTask | undefined {
  const tasks = (payload as { tasks?: unknown } | null)?.tasks;
  return Array.isArray(tasks) ? tasks[0] as MapsTask : undefined;
}
function cleanDomain(value: string) {
  try { return new URL(value.includes("://") ? value : `https://${value}`).hostname.toLowerCase().replace(/^www\./, ""); }
  catch { return value.toLowerCase().replace(/^www\./, "").replace(/\/.*$/, ""); }
}
function cleanName(value: string) { return value.toLocaleLowerCase().normalize("NFKD").replace(/[\u0300-\u036f]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim(); }
function rating(item: Record<string, unknown>) {
  const raw = item.rating as { value?: unknown; votes_count?: unknown } | undefined;
  const value = typeof raw?.value === "number" ? raw.value : null;
  const votes = typeof raw?.votes_count === "number" ? raw.votes_count : null;
  return { value, votes };
}

export function parseGoogleMapsLocalRank(payload: unknown, input: { keyword: string; location: string; businessName: string; domain: string }): { statusCode: number; message: string; cost: number | null; result: LocalMapsRank | null } {
  const task = firstTask(payload), result = task?.result?.[0];
  const items = (result?.items || []).filter((item) => item.type === "maps_search");
  const wantedDomain = cleanDomain(input.domain);
  const wantedName = cleanName(input.businessName);
  let matchedBy: LocalMapsRank["matchedBy"] = null;
  let match: Record<string, unknown> | undefined;
  if (wantedDomain) {
    match = items.find((item) => {
      const itemDomain = cleanDomain(String(item.domain || item.url || ""));
      return itemDomain && (itemDomain === wantedDomain || itemDomain.endsWith(`.${wantedDomain}`));
    });
    if (match) matchedBy = "domain";
  }
  if (!match && wantedName.length >= 3) {
    match = items.find((item) => cleanName(String(item.title || item.original_title || "")) === wantedName || cleanName(String(item.title || item.original_title || "")).includes(wantedName));
    if (match) matchedBy = "name";
  }
  const competitors = items.filter((item) => item !== match).slice(0, 5).flatMap((item) => {
    const rank = Number(item.rank_absolute);
    if (!Number.isInteger(rank) || rank < 1) return [];
    const scores = rating(item);
    return [{ name: String(item.title || item.original_title || "Local listing"), rank, domain: item.domain ? cleanDomain(String(item.domain)) : null, rating: scores.value, reviewCount: scores.votes }];
  });
  const rank = match && Number.isInteger(Number(match.rank_absolute)) && Number(match.rank_absolute) > 0 ? Number(match.rank_absolute) : null;
  const scores = match ? rating(match) : { value: null, votes: null };
  return {
    statusCode: Number(task?.status_code || 0),
    message: String(task?.status_message || ""),
    cost: typeof task?.cost === "number" && Number.isFinite(task.cost) ? task.cost : null,
    result: task?.status_code === 20000 ? { keyword: input.keyword, location: input.location, businessName: input.businessName, domain: wantedDomain, rank, placeId: match?.place_id ? String(match.place_id) : null, rating: scores.value, reviewCount: scores.votes, matchedBy, competitors } : null,
  };
}
