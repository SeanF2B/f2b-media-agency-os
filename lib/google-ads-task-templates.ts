export type GoogleAdsTaskTemplate = {
  id: string;
  title: string;
  repeat: "Daily" | "Weekly" | "Fortnightly" | "Monthly" | "None";
  scheduleLabel: string;
  weekday?: number;
  monthWeek?: 1 | 2;
  onDemand?: boolean;
  checklist: string[];
};

/**
 * Keep Google Ads automation intentionally small: one evidence-led weekly
 * account review per client. Exact account edits go through owner approval.
 */
export const GOOGLE_ADS_TASK_TEMPLATES: GoogleAdsTaskTemplate[] = [
  {
    id: "weekly-account-review-v2",
    title: "Weekly Google Ads Review",
    repeat: "Weekly",
    scheduleLabel: "Every Monday",
    weekday: 1,
    checklist: [
      "Check campaign delivery, spend, budgets and recent account changes",
      "Compare recent performance with the previous period, including conversions and cost per lead when available",
      "Review search terms, keywords and negatives for specific, evidenced opportunities",
      "Review ad headlines, copy and sitelinks or other available assets",
      "Check conversion setup and the campaign's linked landing page for visible issues",
      "Save a full, readable report; send only the strongest evidence-backed suggestions to Recommendations",
      "Send exact Google Ads edits to To approve; do not change the account before owner approval",
    ],
  },
];

/** Old overlapping schedules are retired, not deleted from task history. */
export const RETIRED_GOOGLE_ADS_TASK_TEMPLATE_IDS = new Set([
  "account-health",
  "search-terms",
  "weekly-performance",
  "budget-bidding",
  "keyword-performance",
  "keyword-planner",
  "ad-copy",
  "ad-assets",
  "conversion-tracking",
  "landing-page-cro",
  "quality-score",
  "campaign-settings",
  "monthly-report",
]);

export type GoogleAdsTaskSettings = Record<string, boolean>;
export function defaultGoogleAdsTaskSettings(): GoogleAdsTaskSettings {
  return Object.fromEntries(GOOGLE_ADS_TASK_TEMPLATES.map((template) => [template.id, !template.onDemand]));
}
export function googleAdsTemplateEnabled(settings: GoogleAdsTaskSettings | undefined, template: GoogleAdsTaskTemplate): boolean {
  return settings?.[template.id] ?? !template.onDemand;
}
function dateKey(date: Date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function firstWeekdayOfMonth(year: number, month: number, weekday: number, week: number) { const first = new Date(year, month, 1); const offset = (weekday - first.getDay() + 7) % 7; return new Date(year, month, 1 + offset + (week - 1) * 7); }
export function nextGoogleAdsTemplateDate(template: GoogleAdsTaskTemplate, from = new Date(), afterDate?: string): string {
  if (template.repeat === "None") return dateKey(new Date(from.getFullYear(), from.getMonth(), from.getDate() + 1));
  const start = afterDate ? new Date(`${afterDate}T12:00:00`) : new Date(from);
  start.setHours(0, 0, 0, 0);
  if (template.repeat === "Daily") { if (!afterDate) start.setDate(start.getDate() + 1); return dateKey(start); }
  if (template.repeat === "Weekly") { let days = (template.weekday! - start.getDay() + 7) % 7; if (days === 0) days += 7; start.setDate(start.getDate() + days); return dateKey(start); }
  let year = start.getFullYear(); let month = start.getMonth();
  if (template.monthWeek && template.weekday !== undefined && start >= firstWeekdayOfMonth(year, month, template.weekday, template.monthWeek)) { month += 1; if (month > 11) { month = 0; year += 1; } }
  return dateKey(firstWeekdayOfMonth(year, month, template.weekday!, template.monthWeek || 1));
}
