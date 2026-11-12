const dateTimePattern = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;

export const MARKETING_TIME_ZONES = [
  ["Europe/Dublin", "Dublin"], ["Europe/London", "London"], ["UTC", "UTC"],
  ["America/New_York", "New York"], ["America/Chicago", "Chicago"], ["America/Los_Angeles", "Los Angeles"],
  ["Asia/Dubai", "Dubai"], ["Asia/Kolkata", "Kolkata"], ["Australia/Sydney", "Sydney"],
];

export function isValidMarketingTimeZone(timeZone) {
  if (typeof timeZone !== "string" || !timeZone.trim()) return false;
  try { new Intl.DateTimeFormat("en", { timeZone }).format(0); return true; } catch { return false; }
}

function partsInZone(date, timeZone) {
  try {
    return Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
      timeZone, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
    }).formatToParts(date).filter((part) => part.type !== "literal").map((part) => [part.type, Number(part.value)]));
  } catch { return null; }
}

export function formatMarketingLocalDateTime(instant, timeZone = "Europe/Dublin") {
  const date = new Date(instant);
  if (!Number.isFinite(date.getTime()) || !isValidMarketingTimeZone(timeZone)) return "";
  const parts = partsInZone(date, timeZone);
  return parts ? `${parts.year}-${String(parts.month).padStart(2, "0")}-${String(parts.day).padStart(2, "0")}T${String(parts.hour).padStart(2, "0")}:${String(parts.minute).padStart(2, "0")}` : "";
}

export function parseMarketingLocalDateTime(value, timeZone = "Europe/Dublin") {
  const match = typeof value === "string" && dateTimePattern.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match.map(Number);
  const desired = Date.UTC(year, month - 1, day, hour, minute);
  const normalized = new Date(desired);
  if (normalized.getUTCFullYear() !== year || normalized.getUTCMonth() !== month - 1 || normalized.getUTCDate() !== day || normalized.getUTCHours() !== hour || normalized.getUTCMinutes() !== minute) return null;

  const candidates = new Set();
  for (const hours of [-36, -24, -12, 0, 12, 24, 36]) {
    const instant = desired + hours * 60 * 60_000;
    const parts = partsInZone(new Date(instant), timeZone);
    if (!parts) return null;
    const represented = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute);
    const candidate = desired - (represented - instant);
    if (formatMarketingLocalDateTime(new Date(candidate), timeZone) === value) candidates.add(candidate);
  }
  // During the autumn clock change, choose the earlier of the two valid instants.
  const candidate = [...candidates].sort((left, right) => left - right)[0];
  return candidate === undefined ? null : new Date(candidate).toISOString();
}
