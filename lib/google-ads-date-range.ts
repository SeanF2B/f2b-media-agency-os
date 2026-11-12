export type GoogleAdsDateSelection = {
  range: "today" | "last_3d" | "last_7d" | "last_30d" | "last_90d" | "all_time" | "custom";
  from?: string;
  to?: string;
};

export type GoogleAdsDateResolution = { selection: GoogleAdsDateSelection | null; sourceMessage: string; carriedForward: boolean };

function dublinToday(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Dublin", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  return `${parts.find((part) => part.type === "year")?.value}-${parts.find((part) => part.type === "month")?.value}-${parts.find((part) => part.type === "day")?.value}`;
}

function dateWindow(start: string, end: string): GoogleAdsDateSelection | null {
  const startDate = new Date(`${start}T00:00:00Z`), endDate = new Date(`${end}T00:00:00Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(start) || !/^\d{4}-\d{2}-\d{2}$/.test(end) || !Number.isFinite(startDate.getTime()) || !Number.isFinite(endDate.getTime()) || startDate.toISOString().slice(0, 10) !== start || endDate.toISOString().slice(0, 10) !== end || start > end) return null;
  return { range: "custom", from: start, to: end };
}

const monthNumbers: Record<string, string> = {
  january: "01", february: "02", march: "03", april: "04", may: "05", june: "06",
  july: "07", august: "08", september: "09", october: "10", november: "11", december: "12",
  jan: "01", feb: "02", mar: "03", apr: "04", jun: "06", jul: "07", aug: "08", sep: "09", sept: "09", oct: "10", nov: "11", dec: "12",
};

function monthDate(day: string, month: string, year: string) {
  const monthNumber = monthNumbers[month.toLowerCase()];
  return monthNumber ? `${year}-${monthNumber}-${String(Number(day)).padStart(2, "0")}` : "";
}

/** Understand date requests in chat so the Ads report controls can follow the question. */
export function googleAdsDateSelectionFromMessage(message: string, now = new Date()): GoogleAdsDateSelection | null {
  const text = message.toLowerCase().replace(/\b(\d{1,2})(st|nd|rd|th)\b/g, "$1");
  if (/\b(all time|all-time|entire history|all history)\b/.test(text)) return { range: "all_time" };
  if (/\btoday\b/.test(text)) return { range: "today" };

  const currentParts = dublinToday(now).split("-").map(Number);
  const currentYear = currentParts[0], currentMonth = currentParts[1];
  const resolveMonthYear = (month: string, year?: string) => {
    const monthNumber = Number(monthNumbers[month.toLowerCase()]);
    if (year) return Number(year);
    return monthNumber > currentMonth ? currentYear - 1 : currentYear;
  };
  const monthNumberFor = (month: string) => monthNumbers[month.toLowerCase()];

  if (/\b(?:this|current) month\b/.test(text)) {
    return dateWindow(`${currentYear}-${String(currentMonth).padStart(2, "0")}-01`, dublinToday(now));
  }
  if (/\b(?:last|previous|prior) month\b/.test(text)) {
    const previousMonthEnd = new Date(Date.UTC(currentYear, currentMonth - 1, 0));
    const year = previousMonthEnd.getUTCFullYear(), month = String(previousMonthEnd.getUTCMonth() + 1).padStart(2, "0");
    return dateWindow(`${year}-${month}-01`, `${year}-${month}-${String(previousMonthEnd.getUTCDate()).padStart(2, "0")}`);
  }

  const isoRange = text.match(/\b(?:from|between)\s+(\d{4}-\d{2}-\d{2})\s+(?:to|and|through|until|–|—|-)\s+(\d{4}-\d{2}-\d{2})\b/);
  if (isoRange) return dateWindow(isoRange[1], isoRange[2]);

  const dayMonthRange = text.match(/\b(?:from\s+)?(\d{1,2})\s*(?:to|through|until|–|—|-)\s*(\d{1,2})\s+([a-z]+)(?:\s+(\d{4}))?\b/);
  if (dayMonthRange) { const year = String(resolveMonthYear(dayMonthRange[3], dayMonthRange[4])); return dateWindow(monthDate(dayMonthRange[1], dayMonthRange[3], year), monthDate(dayMonthRange[2], dayMonthRange[3], year)); }
  const monthDayRange = text.match(/\b([a-z]+)\s+(\d{1,2})\s*(?:to|through|until|–|—|-)\s*(\d{1,2})(?:,)?(?:\s+(\d{4}))?\b/);
  if (monthDayRange) { const year = String(resolveMonthYear(monthDayRange[1], monthDayRange[4])); return dateWindow(monthDate(monthDayRange[2], monthDayRange[1], year), monthDate(monthDayRange[3], monthDayRange[1], year)); }

  const fromToMonth = text.match(/\bfrom\s+(\d{1,2})\s+([a-z]+)\s+(\d{4})\s+to\s+(\d{1,2})\s+([a-z]+)\s+(\d{4})\b/);
  if (fromToMonth) return dateWindow(monthDate(fromToMonth[1], fromToMonth[2], fromToMonth[3]), monthDate(fromToMonth[4], fromToMonth[5], fromToMonth[6]));

  const month = text.match(/\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)(?:\s+(\d{4}))?\b/);
  if (month) {
    const year = resolveMonthYear(month[1], month[2]);
    const monthNumber = monthNumberFor(month[1]);
    const start = `${year}-${monthNumber}-01`;
    const endDay = new Date(Date.UTC(year, Number(monthNumber), 0)).getUTCDate();
    return dateWindow(start, `${year}-${monthNumber}-${String(endDay).padStart(2, "0")}`);
  }

  const duration = text.match(/\b(?:last|past|previous)\s+(\d{1,4})\s+(days?|weeks?)\b/);
  const lastWeek = /\b(?:last|past|previous)\s+week\b/.test(text);
  if (duration || lastWeek) {
    const count = duration ? Number(duration[1]) * (/weeks?/.test(duration[2]) ? 7 : 1) : 7;
    if (!Number.isFinite(count) || count < 1) return null;
    const end = new Date(`${dublinToday(now)}T00:00:00Z`);
    end.setUTCDate(end.getUTCDate() - 1);
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - count + 1);
    return dateWindow(start.toISOString().slice(0, 10), end.toISOString().slice(0, 10));
  }
  return null;
}

/** Keep a requested Ads period for short retry prompts in the same conversation. */
export function resolveGoogleAdsDateSelection(message: string, previousUserMessages: string[], now = new Date()): GoogleAdsDateResolution {
  const current = googleAdsDateSelectionFromMessage(message, now);
  if (current) return { selection: current, sourceMessage: message, carriedForward: false };
  const isRetry = /^(?:(?:okay|ok|yes|please)\s+)?(?:(?:can you|could you)\s+)?(?:now\s+)?(?:try\w*|retry|check|review|look)(?:\s+(?:it|that|again|now|please|the period))?[.!?\s]*$/i.test(message.trim());
  if (isRetry) {
    for (const priorMessage of previousUserMessages) {
      const selection = googleAdsDateSelectionFromMessage(priorMessage, now);
      if (selection) return { selection, sourceMessage: priorMessage, carriedForward: true };
    }
  }
  return { selection: null, sourceMessage: message, carriedForward: false };
}

