import test from "node:test";
import assert from "node:assert/strict";
import { compareBacklinkCounts, normalizeBacklinkTarget, parseDataForSeoBacklinkChanges, parseDataForSeoBacklinkItems, parseDataForSeoBacklinkSummary } from "../lib/dataforseo-backlinks.ts";

test("backlink targets normalize hostnames and preserve explicit page paths", () => {
  assert.equal(normalizeBacklinkTarget("https://www.example.ie/about/?utm_source=x"), "https://www.example.ie/about/");
  assert.equal(normalizeBacklinkTarget("www.example.ie"), "example.ie");
  assert.equal(normalizeBacklinkTarget("example.ie/roof-repairs"), "https://example.ie/roof-repairs");
});

test("backlink targets reject local hosts, IPs, invalid protocols, and whitespace", () => {
  for (const input of ["", "localhost", "admin.localhost", "example.local", "127.0.0.1", "ftp://example.com", "example.com path"]) {
    assert.equal(normalizeBacklinkTarget(input), null, input);
  }
});

test("DataForSEO summary parser keeps absent values unavailable and returns reported task cost", () => {
  const parsed = parseDataForSeoBacklinkSummary({
    status_code: 20000,
    tasks: [{ cost: 0.02003, result: [{ target: "example.ie", backlinks: 14, referring_domains: 7, referring_ips: 6, rank: 42, target_spam_score: 3, broken_backlinks: 1, crawled_pages: 9 }] }],
  });
  assert.deepEqual(parsed, {
    summary: { target: "example.ie", backlinks: 14, referringDomains: 7, referringIps: 6, rank: 42, spamScore: 3, brokenBacklinks: 1, crawledPages: 9 },
    cost: 0.02003,
  });
  const noMetrics = parseDataForSeoBacklinkSummary({ status_code: 20000, tasks: [{ result: [{ target: "example.ie", backlinks: null }] }] });
  assert.equal(noMetrics.summary.backlinks, null);
  assert.equal(noMetrics.summary.referringDomains, null);
  assert.equal(noMetrics.cost, null);
});

test("DataForSEO summary parser refuses failed or empty tasks", () => {
  assert.equal(parseDataForSeoBacklinkSummary({ status_code: 40000, tasks: [] }), null);
  assert.equal(parseDataForSeoBacklinkSummary({ status_code: 20000, tasks: [{ result: [] }] }), null);
});

test("backlink history reports count differences without claiming exact new or lost links", () => {
  const previous = { target: "example.ie", backlinks: 12, referringDomains: 5, referringIps: null, rank: null, spamScore: null, brokenBacklinks: 2, crawledPages: null };
  const current = { ...previous, backlinks: 18, referringDomains: 4, brokenBacklinks: null };
  assert.deepEqual(compareBacklinkCounts(current, previous, "2026-10-20T00:00:00.000Z"), {
    previousCheckedAt: "2026-10-20T00:00:00.000Z",
    backlinks: 6,
    referringDomains: -1,
    brokenBacklinks: null,
  });
});

test("DataForSEO backlink change parser totals time-series rows and preserves unavailable fields", () => {
  const parsed = parseDataForSeoBacklinkChanges({ status_code: 20000, tasks: [{ cost: 0.01, result: [{ items: [
    { new_backlinks: 3, lost_backlinks: 1, new_referring_domains: 2, lost_referring_domains: 0 },
    { new_backlinks: 4, lost_backlinks: 2, new_referring_domains: 1, lost_referring_domains: 1 },
  ] }] }] }, "2026-09-28", "2026-10-27");
  assert.deepEqual(parsed, { changes: { backlinksNew: 7, backlinksLost: 3, referringDomainsNew: 3, referringDomainsLost: 1, startDate: "2026-09-28", endDate: "2026-10-27" }, cost: 0.01 });
  assert.equal(parseDataForSeoBacklinkChanges({ status_code: 20000, tasks: [{ result: [{ items: [] }] }] }, "a", "b").changes.backlinksNew, 0);
  assert.equal(parseDataForSeoBacklinkChanges({ status_code: 20000, tasks: [{ result: [{ items: [{}] }] }] }, "a", "b").changes.backlinksNew, null);
});

test("DataForSEO backlink item parser returns safe structured details and reported cost", () => {
  const parsed = parseDataForSeoBacklinkItems({ status_code: 20000, tasks: [{ cost: 0.02, result: [{ items: [
    { domain_from: "partner.ie", url_from: "https://partner.ie/suppliers", url_to: "https://example.ie/roofing", anchor: "roofing", rank: 12, first_seen: "2026-10-01", is_new: true, dofollow: true },
    { url_from: "javascript:alert(1)", url_to: "https://example.ie", is_lost: true },
    { url_from: 7, url_to: "https://example.ie" },
  ] }] }] });
  assert.equal(parsed.items.length, 2);
  assert.equal(parsed.items[0].isNew, true);
  assert.equal(parsed.items[0].dofollow, true);
  assert.equal(parsed.items[1].domainFrom, "Unknown source");
  assert.equal(parsed.cost, 0.02);
  assert.equal(parseDataForSeoBacklinkItems({ status_code: 40000, tasks: [] }), null);
});
