export function pageSpeedApiErrorMessage(status: number, responseBody: string) {
  if (status === 403) return "Google PageSpeed access was denied. Add a valid GOOGLE_PAGESPEED_API_KEY production secret and enable the PageSpeed Insights API for that key.";
  if (status === 429) {
    const zeroDailyQuota = /"quota_limit_value"\s*:\s*"?0"?/i.test(responseBody)
      || /defaultPerDayPerProject/i.test(responseBody) && /Queries per day/i.test(responseBody);
    return zeroDailyQuota
      ? "Google PageSpeed has no daily API quota enabled for this Worker project. Add a GOOGLE_PAGESPEED_API_KEY production secret with the PageSpeed Insights API enabled, then retry."
      : "Google PageSpeed rate limit reached. Wait before retrying or add a quota-enabled GOOGLE_PAGESPEED_API_KEY.";
  }
  return `Google PageSpeed could not test this page (HTTP ${status}).`;
}
