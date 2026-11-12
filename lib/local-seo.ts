export type BusinessProfileRow = Record<string, unknown>;

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const valueAsNumber = Number(value);
  return Number.isFinite(valueAsNumber) ? valueAsNumber : null;
}

export function summarizeBusinessProfileRows(rows: BusinessProfileRow[], locationId: string) {
  const selected = rows.filter((row) => String(row.location_id || "") === locationId);
  const sum = (key: string) => {
    const values = selected.map((row) => numberOrNull(row[key])).filter((value): value is number => value !== null);
    return values.length ? values.reduce((total, value) => total + value, 0) : null;
  };
  return {
    rows: selected.length,
    locationName: String(selected.find((row) => row.location_title)?.location_title || ""),
    impressions: sum("impressions"),
    calls: sum("call_clicks"),
    directions: sum("direction_requests"),
    websiteClicks: sum("website_clicks"),
  };
}

export function summarizeBusinessProfileReviews(rows: BusinessProfileRow[], locationId: string) {
  const selected = rows.filter((row) => !row.location_id || String(row.location_id) === locationId);
  const first = selected[0];
  return {
    total: numberOrNull(first?.review_total_count),
    averageRating: numberOrNull(first?.review_average_rating_total),
    recent: selected.filter((row) => row.review_comment || row.review_reviewer || row.review_star_rating).slice(0, 20).map((row) => ({
      reviewer: String(row.review_reviewer || "Google user"),
      rating: String(row.review_star_rating || ""),
      comment: String(row.review_comment || ""),
      createdAt: String(row.review_create_time || ""),
      reply: String(row.review_reply_comment || ""),
    })),
  };
}
