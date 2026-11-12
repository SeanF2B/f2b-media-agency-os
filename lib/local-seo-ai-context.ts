import { summarizeBusinessProfileReviews, summarizeBusinessProfileRows, type BusinessProfileRow } from "./local-seo.ts";

export function buildBusinessProfileAiContext(input: {
  accountId: string;
  locationId: string;
  currentRows: BusinessProfileRow[];
  previousRows: BusinessProfileRow[];
  reviewRows: BusinessProfileRow[];
  reviewStatus?: "connected" | "unavailable";
  dateRange: { start: string; end: string };
}) {
  const current = summarizeBusinessProfileRows(input.currentRows, input.locationId);
  const previous = summarizeBusinessProfileRows(input.previousRows, input.locationId);
  // Only include reviews that explicitly identify this location. Account-level
  // rows without a location ID could contain another client's review data.
  const scopedReviewRows = input.reviewRows.filter((row) => String(row.location_id || "") === input.locationId);
  const reviews = summarizeBusinessProfileReviews(scopedReviewRows, input.locationId);
  const reviewEvidence = reviews.recent.slice(0, 5).map((review) => ({
    rating: review.rating || null,
    createdAt: review.createdAt || null,
    comment: review.comment.replace(/\s+/g, " ").trim().slice(0, 400),
    ownerReply: review.reply.replace(/\s+/g, " ").trim().slice(0, 400) || null,
  }));

  return {
    status: current.rows || reviews.total !== null ? "connected" : "no_data",
    source: "Windsor.ai Google Business Profile",
    accountId: input.accountId,
    locationId: input.locationId,
    locationName: current.locationName || "Mapped Google Business Profile location",
    dateRange: input.dateRange,
    current: {
      impressions: current.impressions,
      calls: current.calls,
      directionRequests: current.directions,
      websiteClicks: current.websiteClicks,
      sourceRows: current.rows,
    },
    previousPeriod: {
      impressions: previous.impressions,
      calls: previous.calls,
      directionRequests: previous.directions,
      websiteClicks: previous.websiteClicks,
      sourceRows: previous.rows,
    },
    reviews: {
      status: input.reviewStatus || "connected",
      total: reviews.total,
      averageRating: reviews.averageRating,
      recent: reviewEvidence,
    },
    dataNote: "Business Profile interactions are platform-reported, not confirmed phone leads or booked jobs. Review comments and owner replies are public external content and may be incomplete.",
  };
}
