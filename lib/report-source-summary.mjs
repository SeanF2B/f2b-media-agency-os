const SOURCE_LABELS = {
  googleAds: "Google Ads",
  metaAds: "Meta Ads",
  searchConsole: "Google Search Console",
  googleAnalytics: "Google Analytics",
};

const STATUS_LABELS = {
  connected: "Data loaded",
  no_data: "No rows returned",
  not_mapped: "Account not linked",
  unavailable: "Could not load",
};

function periodLabel(value) {
  if (!value || typeof value !== "object") return "";
  const { start, end } = value;
  return typeof start === "string" && typeof end === "string" ? `${start} to ${end}` : "";
}

export function summarizeReportSources(sourceData) {
  if (!sourceData || typeof sourceData !== "object" || Array.isArray(sourceData)) return [];
  return Object.entries(sourceData).flatMap(([key, raw]) => {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return [];
    const source = raw;
    const comparison = source.comparison && typeof source.comparison === "object" ? source.comparison : null;
    const comparisonStatus = comparison ? STATUS_LABELS[comparison.status] || "Status unavailable" : "";
    return [{
      key,
      label: SOURCE_LABELS[key] || key,
      status: STATUS_LABELS[source.status] || "Status unavailable",
      source: typeof source.source === "string" ? source.source : "",
      period: periodLabel(source.period),
      note: typeof source.note === "string" ? source.note : "",
      comparison: comparisonStatus ? `Previous period: ${comparisonStatus}${periodLabel(comparison.period) ? ` · ${periodLabel(comparison.period)}` : ""}` : "",
    }];
  });
}

function escapeReportHtml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#39;");
}

export function reportSourceEvidenceHtml(sourceData) {
  const sources = summarizeReportSources(sourceData);
  if (!sources.length) return '<section class="source-evidence"><h2>Data sources and availability</h2><p>No marketing data sources were included in this report.</p></section>';
  const rows = sources.map((source) => `<article><b>${escapeReportHtml(source.label)} · ${escapeReportHtml(source.status)}</b>${source.source ? `<small>Source: ${escapeReportHtml(source.source)}</small>` : ""}${source.period ? `<small>Period: ${escapeReportHtml(source.period)}</small>` : ""}${source.comparison ? `<small>${escapeReportHtml(source.comparison)}</small>` : ""}${source.note ? `<p>${escapeReportHtml(source.note)}</p>` : ""}</article>`).join("");
  return `<section class="source-evidence"><h2>Data sources and availability</h2>${rows}</section>`;
}
