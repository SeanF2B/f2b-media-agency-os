import { formatMarketingLocalDateTime, isValidMarketingTimeZone, parseMarketingLocalDateTime } from "./marketing-time-zone.js";

function validMonthDay(month, day, year = 2000) {
  const date = new Date(Date.UTC(year, month - 1, day));
  return date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
}

export function parseMarketingBirthday(value) {
  if (typeof value !== "string") return null;
  const text = value.trim();
  let month;
  let day;
  let sourceYear;
  let match = /^(\d{4})[-/. _](\d{1,2})[-/. _](\d{1,2})(?:$|T|\s)/.exec(text);
  if (match) [, sourceYear, month, day] = match;
  else {
    match = /^(\d{1,2})[-/. _](\d{1,2})[-/. _](\d{4})(?:$|T|\s)/.exec(text);
    if (!match) return null;
    [, month, day, sourceYear] = match;
  }
  month = Number(month);
  day = Number(day);
  return validMonthDay(month, day, Number(sourceYear)) ? `${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` : null;
}

function localCandidate(year, monthDay, localTime, timeZone, leapDayPolicy) {
  let [month, day] = monthDay.split("-").map(Number);
  if (month === 2 && day === 29 && !validMonthDay(month, day, year)) {
    if (leapDayPolicy === "mar1") { month = 3; day = 1; }
    else day = 28;
  }
  const [hour, minute] = localTime.split(":").map(Number);
  const start = new Date(Date.UTC(year, month - 1, day, hour, minute));
  // If local time falls in the spring-forward gap, use the first valid minute after it.
  for (let offset = 0; offset <= 180; offset++) {
    const candidateLocal = new Date(start.getTime() + offset * 60_000);
    const local = `${candidateLocal.getUTCFullYear()}-${String(candidateLocal.getUTCMonth() + 1).padStart(2, "0")}-${String(candidateLocal.getUTCDate()).padStart(2, "0")}T${String(candidateLocal.getUTCHours()).padStart(2, "0")}:${String(candidateLocal.getUTCMinutes()).padStart(2, "0")}`;
    const runAt = parseMarketingLocalDateTime(local, timeZone);
    if (runAt) return runAt;
  }
  return null;
}

export function nextMarketingBirthday(monthDay, now = new Date(), timeZone = "Europe/Dublin", localTime = "09:00", leapDayPolicy = "feb28") {
  if (typeof monthDay !== "string" || !/^\d{2}-\d{2}$/.test(monthDay)) return null;
  const [month, day] = monthDay.split("-").map(Number);
  if (!validMonthDay(month, day)) return null;
  if (!(now instanceof Date) || !Number.isFinite(now.getTime()) || !isValidMarketingTimeZone(timeZone) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(localTime)) return null;
  const currentLocal = formatMarketingLocalDateTime(now, timeZone);
  const localYear = Number(currentLocal.slice(0, 4));
  for (let year = localYear; year <= localYear + 2; year++) {
    const runAt = localCandidate(year, monthDay, localTime, timeZone, leapDayPolicy);
    if (runAt && Date.parse(runAt) >= now.getTime()) return { runAt, year };
  }
  return null;
}

export function marketingDateFieldRunAt(value, fieldType, timeZone = "Europe/Dublin", localTime = "09:00") {
  if (typeof value !== "string" || !isValidMarketingTimeZone(timeZone) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(localTime)) return null;
  if (fieldType === "DATE_TIME") {
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) return null;
    const time = Date.parse(value);
    return Number.isFinite(time) ? new Date(time).toISOString() : null;
  }
  if (fieldType !== "DATE") return null;
  const date = value.match(/^(\d{4})-(\d{2})-(\d{2})(?:T00:00(?::00(?:\.\d{1,3})?)?Z)?$/);
  if (!date || !validMonthDay(Number(date[2]), Number(date[3]), Number(date[1]))) return null;
  return parseMarketingLocalDateTime(`${date[1]}-${date[2]}-${date[3]}T${localTime}`, timeZone);
}
