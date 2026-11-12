export type SearchConsoleRow = Record<string, unknown>;
const numeric = (value: unknown) => { const parsed = Number(value); return Number.isFinite(parsed) ? parsed : 0; };
const dayKey = (date: Date) => date.toISOString().slice(0, 10);

function localDateKey(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function customMarketingDateWindow(start: string, end: string) {
  const isDate = (value: string) => {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const parsed = new Date(`${value}T00:00:00.000Z`);
    return Number.isFinite(parsed.getTime()) && dayKey(parsed) === value;
  };
  if (!isDate(start) || !isDate(end) || start > end) return null;
  const currentStart = new Date(`${start}T00:00:00.000Z`);
  const currentEnd = new Date(`${end}T00:00:00.000Z`);
  const length = Math.round((currentEnd.getTime() - currentStart.getTime()) / 86_400_000) + 1;
  if (length > 366) return null;
  const previousEnd = new Date(currentStart); previousEnd.setUTCDate(previousEnd.getUTCDate() - 1);
  const previousStart = new Date(previousEnd); previousStart.setUTCDate(previousStart.getUTCDate() - length + 1);
  return { length, current: { start, end }, previous: { start: dayKey(previousStart), end: dayKey(previousEnd) } };
}

export type MarketingDateWindow = { length: number; current: { start: string; end: string }; previous: { start: string; end: string } };
type CustomMarketingRange = { start: string; end: string };
export function googleAnalyticsDateWindow(range: "last_7d" | "last_30d" | "last_90d", now?: Date): MarketingDateWindow;
export function googleAnalyticsDateWindow(range: "all_time", now?: Date): null;
export function googleAnalyticsDateWindow(range: "custom", now: Date, custom: CustomMarketingRange): MarketingDateWindow | null;
export function googleAnalyticsDateWindow(range: string, now?: Date): MarketingDateWindow | null;
export function googleAnalyticsDateWindow(range: string, now: Date | undefined, custom: CustomMarketingRange): MarketingDateWindow | null;
export function googleAnalyticsDateWindow(range: string, now = new Date(), custom?: CustomMarketingRange): MarketingDateWindow | null {
  if (range === "custom") return custom ? customMarketingDateWindow(custom.start, custom.end) : null;
  if (range === "all_time") return null;
  const length = range === "last_7d" ? 7 : range === "last_90d" ? 90 : 30;
  const currentEnd = new Date(`${localDateKey(now, "Europe/Dublin")}T00:00:00.000Z`);
  currentEnd.setUTCDate(currentEnd.getUTCDate() - 1);
  const currentStart = new Date(currentEnd); currentStart.setUTCDate(currentStart.getUTCDate() - length + 1);
  const previousEnd = new Date(currentStart); previousEnd.setUTCDate(previousEnd.getUTCDate() - 1);
  const previousStart = new Date(previousEnd); previousStart.setUTCDate(previousStart.getUTCDate() - length + 1);
  return { length, current: { start: dayKey(currentStart), end: dayKey(currentEnd) }, previous: { start: dayKey(previousStart), end: dayKey(previousEnd) } };
}

const numericOrNull = (value: unknown) => {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export function summarizeGoogleAnalyticsRows(rows: SearchConsoleRow[]) {
  const metrics = ["sessions", "active_users", "engaged_sessions", "conversions", "totalrevenue"] as const;
  const totals = Object.fromEntries(metrics.map((key) => {
    const values = rows.map((row) => numericOrNull(row[key])).filter((value): value is number => value != null);
    return [key, values.length ? values.reduce((sum, value) => sum + value, 0) : null];
  })) as Record<(typeof metrics)[number], number | null>;
  return {
    ...totals,
    engagement_rate: totals.sessions != null && totals.sessions > 0 && totals.engaged_sessions != null ? totals.engaged_sessions / totals.sessions : null,
    sourceRows: rows.length,
  };
}

export function summarizeOrganicSearchRows(rows: SearchConsoleRow[]) {
  const organicRows = rows.filter((row) => String(row.session_default_channel_group || "").trim().toLowerCase() === "organic search");
  const sum = (field: "sessions" | "conversions") => {
    const values = organicRows.map((row) => numericOrNull(row[field])).filter((value): value is number => value != null);
    return values.length ? values.reduce((total, value) => total + value, 0) : null;
  };
  return { sessions: sum("sessions"), conversions: sum("conversions"), sourceRows: organicRows.length };
}

function sumReported(rows: SearchConsoleRow[], field: string) {
  const values = rows.map((row) => numericOrNull(row[field])).filter((value): value is number => value != null);
  return values.length ? values.reduce((sum, value) => sum + value, 0) : null;
}

export function summarizeLandingPageAnalytics(pageRows: SearchConsoleRow[], landingRows: SearchConsoleRow[], eventRows: SearchConsoleRow[]) {
  const events = new Map<string, { eventName: string; eventCount: number | null; conversions: number | null }>();
  for (const row of eventRows) {
    const eventName = String(row.event_name || "(event name not supplied)");
    const previous = events.get(eventName);
    const eventCount = numericOrNull(row.event_count);
    const conversions = numericOrNull(row.conversions);
    events.set(eventName, {
      eventName,
      eventCount: previous?.eventCount == null ? eventCount : eventCount == null ? previous.eventCount : previous.eventCount + eventCount,
      conversions: previous?.conversions == null ? conversions : conversions == null ? previous.conversions : previous.conversions + conversions,
    });
  }
  return {
    pageViews: sumReported(pageRows, "screen_page_views"),
    landingSessions: sumReported(landingRows, "sessions"),
    activeUsers: sumReported(landingRows, "active_users"),
    engagedSessions: sumReported(landingRows, "engaged_sessions"),
    conversions: sumReported(eventRows, "conversions"),
    events: [...events.values()].sort((a, b) => (b.eventCount ?? -1) - (a.eventCount ?? -1)).slice(0, 10),
    pageViewRows: pageRows.length,
    landingRows: landingRows.length,
    eventRows: eventRows.length,
  };
}

export function summarizeLandingPageSignals(rows: SearchConsoleRow[]) {
  const formEvents = new Map<string, { eventName: string; eventCount: number | null; conversions: number | null }>();
  let phoneClicks = 0;
  let hasPhoneClickSignal = false;
  for (const row of rows) {
    const eventName = String(row.event_name || "").trim();
    const eventCount = numericOrNull(row.event_count);
    const conversions = numericOrNull(row.conversions);
    if (/^(form_submit|generate_lead)$/i.test(eventName)) {
      const previous = formEvents.get(eventName) || { eventName, eventCount: null, conversions: null };
      formEvents.set(eventName, {
        eventName,
        eventCount: eventCount == null ? previous.eventCount : (previous.eventCount ?? 0) + eventCount,
        conversions: conversions == null ? previous.conversions : (previous.conversions ?? 0) + conversions,
      });
    }
    const linkUrl = String(row.link_url || "").trim();
    if (/^tel:/i.test(linkUrl) || /^(phone_click|click_to_call|call_click)$/i.test(eventName)) {
      hasPhoneClickSignal = true;
      if (eventCount != null) phoneClicks += eventCount;
    }
  }
  return { formEvents: [...formEvents.values()], phoneClicks: hasPhoneClickSignal ? phoneClicks : rows.length ? 0 : null };
}

export function summarizeLandingPageAttribution(rows: SearchConsoleRow[]) {
  const grouped = new Map<string, { campaignName: string; sourceMedium: string; sessions: number | null; conversions: number | null }>();
  for (const row of rows) {
    const campaignName = String(row.session_google_ads_campaign_name || row.session_manual_campaign_name || "").trim() || "Campaign not supplied";
    const sourceMedium = String(row.session_source_medium || "").trim() || "Source / medium not supplied";
    const key = JSON.stringify([campaignName, sourceMedium]);
    const previous = grouped.get(key) || { campaignName, sourceMedium, sessions: null, conversions: null };
    const sessions = numericOrNull(row.sessions);
    const conversions = numericOrNull(row.conversions);
    grouped.set(key, {
      campaignName,
      sourceMedium,
      sessions: sessions == null ? previous.sessions : (previous.sessions ?? 0) + sessions,
      conversions: conversions == null ? previous.conversions : (previous.conversions ?? 0) + conversions,
    });
  }
  return [...grouped.values()].sort((a, b) => (b.sessions ?? -1) - (a.sessions ?? -1)).slice(0, 12);
}

export function normalizeAnalyticsPagePath(value: string) {
  const path = new URL(value, "https://f2b.invalid").pathname.replace(/\/{2,}/g, "/") || "/";
  return path.endsWith("/") ? path : `${path}/`;
}

export function searchConsoleDateWindow(range: "last_7d" | "last_30d" | "last_90d", now?: Date): MarketingDateWindow;
export function searchConsoleDateWindow(range: "custom", now: Date, custom: CustomMarketingRange): MarketingDateWindow | null;
export function searchConsoleDateWindow(range: string, now?: Date): MarketingDateWindow;
export function searchConsoleDateWindow(range: string, now: Date | undefined, custom: CustomMarketingRange): MarketingDateWindow | null;
export function searchConsoleDateWindow(range: string, now = new Date(), custom?: CustomMarketingRange): MarketingDateWindow | null {
  if (range === "custom") return custom ? customMarketingDateWindow(custom.start, custom.end) : null;
  const length = range === "last_7d" ? 7 : range === "last_90d" ? 90 : 30;
  const latest = new Date(now); latest.setUTCHours(0, 0, 0, 0); latest.setUTCDate(latest.getUTCDate() - 3);
  const currentEnd = new Date(latest); const currentStart = new Date(latest); currentStart.setUTCDate(currentStart.getUTCDate() - length + 1);
  const previousEnd = new Date(currentStart); previousEnd.setUTCDate(previousEnd.getUTCDate() - 1);
  const previousStart = new Date(previousEnd); previousStart.setUTCDate(previousStart.getUTCDate() - length + 1);
  return { length, current: { start: dayKey(currentStart), end: dayKey(currentEnd) }, previous: { start: dayKey(previousStart), end: dayKey(previousEnd) } };
}

export function summarizeSearchConsoleRows(rows: SearchConsoleRow[]) {
  const totals = { clicks: 0, impressions: 0, weightedPosition: 0 };
  const dates = new Map<string, { clicks: number; impressions: number; weightedPosition: number }>();
  const group = (field: "query" | "page") => {
    const map = new Map<string, { name: string; clicks: number; impressions: number; weightedPosition: number }>();
    for (const row of rows) {
      const name = String(row[field] || "(not provided)");
      const item = map.get(name) || { name, clicks: 0, impressions: 0, weightedPosition: 0 };
      item.clicks += numeric(row.clicks); item.impressions += numeric(row.impressions); item.weightedPosition += numeric(row.position) * numeric(row.impressions); map.set(name, item);
    }
    return [...map.values()].sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions).slice(0, 30).map((item) => ({ ...item, ctr: item.impressions ? item.clicks / item.impressions : null, averagePosition: item.impressions ? item.weightedPosition / item.impressions : null }));
  };
  for (const row of rows) {
    const clicks = numeric(row.clicks), impressions = numeric(row.impressions), position = numeric(row.position);
    totals.clicks += clicks; totals.impressions += impressions; totals.weightedPosition += position * impressions;
    const date = String(row.date || "");
    if (date) { const item = dates.get(date) || { clicks: 0, impressions: 0, weightedPosition: 0 }; item.clicks += clicks; item.impressions += impressions; item.weightedPosition += position * impressions; dates.set(date, item); }
  }
  return { totals: { clicks: totals.clicks, impressions: totals.impressions, ctr: totals.impressions ? totals.clicks / totals.impressions : null, averagePosition: totals.impressions ? totals.weightedPosition / totals.impressions : null }, daily: [...dates.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([date, item]) => ({ date, clicks: item.clicks, impressions: item.impressions, ctr: item.impressions ? item.clicks / item.impressions : null, averagePosition: item.impressions ? item.weightedPosition / item.impressions : null })), topQueries: group("query"), topPages: group("page"), sourceRows: rows.length, mayBeLimited: rows.length >= 1000 };
}

export type SearchConsoleQueryPosition = { name: string; clicks: number; impressions: number; averagePosition: number | null };

/** Compare query positions from two saved rolling-window snapshots. This is a
 * Search Console average-position change, not a fixed-location rank check. */
export function compareSearchConsoleQueryPositions(current: SearchConsoleQueryPosition[], previous: SearchConsoleQueryPosition[]) {
  const priorByQuery = new Map(previous.map((row) => [row.name, row]));
  return current.map((row) => {
    const prior = priorByQuery.get(row.name);
    const change = row.averagePosition == null || prior?.averagePosition == null ? null : prior.averagePosition - row.averagePosition;
    return { ...row, previousPosition: prior?.averagePosition ?? null, positionChange: change, changeKind: !prior ? "new" as const : change == null ? "unavailable" as const : change > 0 ? "improved" as const : change < 0 ? "declined" as const : "unchanged" as const };
  });
}
