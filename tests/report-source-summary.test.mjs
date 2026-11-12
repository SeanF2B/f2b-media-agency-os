import test from "node:test";
import assert from "node:assert/strict";
import { reportSourceEvidenceHtml, summarizeReportSources } from "../lib/report-source-summary.mjs";

test("report source details are translated into plain labels and include periods and caveats", () => {
  const [ads] = summarizeReportSources({
    googleAds: {
      status: "connected",
      source: "Google Ads API · read-only",
      period: { start: "2026-10-01", end: "2026-10-30" },
      note: "Recent conversions may be revised.",
      comparison: { status: "no_data", period: { start: "2026-09-01", end: "2026-09-30" } },
      accountId: "1234567890",
    },
  });
  assert.deepEqual(ads, {
    key: "googleAds",
    label: "Google Ads",
    status: "Data loaded",
    source: "Google Ads API · read-only",
    period: "2026-10-01 to 2026-10-30",
    note: "Recent conversions may be revised.",
    comparison: "Previous period: No rows returned · 2026-09-01 to 2026-09-30",
  });
  assert.equal(Object.hasOwn(ads, "accountId"), false);
});

test("report source summaries distinguish missing mappings from unavailable data", () => {
  const rows = summarizeReportSources({
    metaAds: { status: "not_mapped", note: "No account ID is linked." },
    searchConsole: { status: "unavailable", note: "Authorization expired." },
  });
  assert.deepEqual(rows.map(({ label, status }) => [label, status]), [
    ["Meta Ads", "Account not linked"],
    ["Google Search Console", "Could not load"],
  ]);
});

test("report source summary safely handles empty and malformed data", () => {
  assert.deepEqual(summarizeReportSources(null), []);
  assert.deepEqual(summarizeReportSources({ googleAds: null, metaAds: "error" }), []);
});

test("printable report evidence includes source availability, periods and caveats", () => {
  const html = reportSourceEvidenceHtml({
    googleAds: { status: "connected", source: "Google Ads API", period: { start: "2026-10-01", end: "2026-10-30" }, note: "Campaign-only totals." },
    metaAds: { status: "unavailable", note: "Login expired." },
  });
  assert.match(html, /Google Ads · Data loaded/);
  assert.match(html, /Period: 2026-10-01 to 2026-10-30/);
  assert.match(html, /Campaign-only totals\./);
  assert.match(html, /Meta Ads · Could not load/);
  assert.match(html, /Login expired\./);
});

test("printable report evidence escapes source values and explains when no sources were included", () => {
  const html = reportSourceEvidenceHtml({ searchConsole: { status: "unavailable", source: "<script>alert(1)</script>", note: "<img src=x onerror=alert(1)>" } });
  assert.doesNotMatch(html, /<script>|<img/);
  assert.match(html, /&lt;script&gt;/);
  assert.match(html, /&lt;img/);
  assert.match(reportSourceEvidenceHtml(null), /No marketing data sources were included/);
});
