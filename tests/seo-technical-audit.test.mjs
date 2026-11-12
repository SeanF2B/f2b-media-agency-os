import assert from "node:assert/strict";
import test from "node:test";
import { buildSeoTechnicalFindings, extractSeoCrawlPage, inspectSitemapXml } from "../lib/seo-technical-audit.ts";

test("sitemap indexes expose only same-site child maps and page URLs", () => {
  const index = inspectSitemapXml(
    '<sitemapindex><sitemap><loc>https://www.example.com/pages.xml</loc></sitemap><sitemap><loc>https://evil.example/steal.xml</loc></sitemap></sitemapindex>',
    "https://example.com/sitemap_index.xml", "https://example.com",
  );
  assert.equal(index.isIndex, true);
  assert.deepEqual(index.childSitemaps, ["https://www.example.com/pages.xml"]);
  assert.equal(index.offsiteUrlsFound, 1);

  const pages = inspectSitemapXml(
    '<urlset><url><loc>https://example.com/roof/</loc></url><url><loc><![CDATA[https://example.com/contact/?x=1&amp;y=2]]></loc></url><url><loc>https://evil.example/page/</loc></url></urlset>',
    "https://example.com/pages.xml", "https://example.com",
  );
  assert.equal(pages.isIndex, false);
  assert.deepEqual(pages.urls, ["https://example.com/roof/", "https://example.com/contact/?x=1&y=2"]);
  assert.equal(pages.offsiteUrlsFound, 1);
});

test("sitemap XML never treats credentials, HTTP, or local hosts as same-site entries", () => {
  const result = inspectSitemapXml(
    '<urlset><url><loc>http://example.com/insecure</loc></url><url><loc>https://user:pass@example.com/private</loc></url><url><loc>https://127.0.0.1/admin</loc></url></urlset>',
    "https://example.com/sitemap.xml", "https://example.com",
  );
  assert.deepEqual(result.urls, []);
  assert.equal(result.offsiteUrlsFound, 1);
});

test("SEO crawl extracts metadata, canonical tags, JSON-LD validity and same-site links only", () => {
  const html = "<title>Roof Repairs &amp; Maintenance</title>" +
    "<meta name=\"description\" content=\"Roof repair specialists\">" +
    "<meta name=\"robots\" content=\"index,follow\">" +
    "<link rel=\"canonical\" href=\"/roof-repairs/\">" +
    "<script type=\"application/ld+json\">{\"@type\":\"LocalBusiness\"}</script>" +
    "<script type=\"application/ld+json\">{broken</script>" +
    "<a href=\"/contact/\">Contact</a><a href=\"https://evil.example/\">External</a>";
  const page = extractSeoCrawlPage(html, "https://example.com/roof-repairs/", 200, "https://example.com/roof-repairs/", "https://example.com");
  assert.equal(page.title, "Roof Repairs & Maintenance");
  assert.equal(page.description, "Roof repair specialists");
  assert.deepEqual(page.canonicalUrls, ["https://example.com/roof-repairs/"]);
  assert.equal(page.structuredDataCount, 2);
  assert.equal(page.invalidStructuredData, 1);
  assert.deepEqual(page.internalLinks, ["https://example.com/contact/"]);
});

test("technical findings report missing metadata, noindex, bad canonicals and invalid JSON-LD", () => {
  const html = "<title>Same title</title><meta name=\"description\" content=\"Same description\">" +
    "<meta name=\"robots\" content=\"noindex,nofollow\">" +
    "<link rel=\"canonical\" href=\"https://other.example/page\"><link rel=\"canonical\" href=\"/duplicate/\">" +
    "<script type=\"application/ld+json\">{broken</script>";
  const page = extractSeoCrawlPage(html, "https://example.com/page/", 200, "https://example.com/page/", "https://example.com");
  const findings = buildSeoTechnicalFindings([page], [{ url: "https://example.com/missing/", status: 404, sourcePages: [page.url] }], { checked: true, urlsFound: 12, status: 200 });
  assert.ok(findings.some((item) => item.title === "Multiple canonical URLs"));
  assert.ok(findings.some((item) => item.title === "Page blocks search indexing"));
  assert.ok(findings.some((item) => item.title === "Structured data contains invalid JSON"));
  assert.ok(findings.some((item) => item.title === "Internal link returns HTTP 404"));
});

test("unverified and error pages do not create guessed metadata findings", () => {
  const findings = buildSeoTechnicalFindings([
    { url: "https://example.com/down/", status: null, error: "Page timed out.", title: "", description: "", canonicalUrls: [], robots: "", structuredDataCount: 0, invalidStructuredData: 0, internalLinks: [] },
    { url: "https://example.com/404/", status: 404, title: "", description: "", canonicalUrls: [], robots: "", structuredDataCount: 0, invalidStructuredData: 0, internalLinks: [] },
  ], [], { checked: false, urlsFound: 0, status: null });
  assert.equal(findings.filter((item) => item.key.startsWith("title-missing")).length, 0);
  assert.equal(findings.filter((item) => item.key.startsWith("description-missing")).length, 0);
  assert.ok(findings.some((item) => item.title === "Page could not be verified"));
  assert.ok(findings.some((item) => item.title === "Page returns HTTP 404"));
});

test("sitemap findings call out off-site entries without fetching or overclaiming", () => {
  const findings = buildSeoTechnicalFindings([], [], { checked: true, urlsFound: 4, status: 200, sitemapsRead: 2, offsiteUrlsFound: 1 });
  assert.deepEqual(findings.filter((finding) => finding.key === "sitemap-offsite-urls").map((finding) => [finding.severity, finding.title]), [["info", "Sitemap includes URLs outside this website"]]);
});
