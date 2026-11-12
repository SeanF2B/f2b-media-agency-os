import test from "node:test";
import assert from "node:assert/strict";
import { checkSiteConversionTags, inspectTrackingHtml } from "../lib/site-conversion-tracking.ts";

test("tracking inspection finds Ads, Analytics, Tag Manager and Meta tags without claiming events fired", () => {
  const result = inspectTrackingHtml(`<script src="https://www.googletagmanager.com/gtag/js?id=AW-123456789"></script><script>gtag('config','G-ABC123XYZ9'); fbq('init','123456789012345');</script><script src="https://www.googletagmanager.com/gtm.js?id=GTM-AB12CD"></script>`, "https://example.ie/landing/", "2026-10-27T12:00:00.000Z");
  assert.deepEqual(result.checks.map((item) => item.status), ["found", "found", "found", "found"]);
  assert.deepEqual(result.checks.map((item) => item.ids[0]), ["AW-123456789", "G-ABC123XYZ9", "GTM-AB12CD", "123456789012345"]);
  assert.match(result.note, /does not prove a conversion event fired/);
});

test("Tag Manager presence is reported as an indirect check for hidden platform tags", () => {
  const result = inspectTrackingHtml(`<script src="https://www.googletagmanager.com/gtm.js?id=GTM-AB12CD"></script>`, "https://example.ie/landing/");
  assert.equal(result.checks[0].status, "tag_manager");
  assert.equal(result.checks[3].status, "tag_manager");
  assert.equal(result.checks[2].status, "found");
});

test("tracking check only requests the client's approved HTTPS hosts", async () => {
  let calls = 0;
  await assert.rejects(() => checkSiteConversionTags("https://not-example.ie/page", ["example.ie"], async () => { calls++; return new Response(); }), /client’s own website/);
  assert.equal(calls, 0);
});

test("tracking check follows only approved same-client redirects and reads public HTML", async () => {
  const calls = [];
  const result = await checkSiteConversionTags("https://www.example.ie/old", ["example.ie", "www.example.ie", "go.example.ie"], async (url) => {
    calls.push(String(url));
    if (calls.length === 1) return new Response(null, { status: 301, headers: { location: "https://go.example.ie/new" } });
    return new Response(`<script>fbq('init','123456789012345')</script>`, { status: 200, headers: { "Content-Type": "text/html" } });
  }, "2026-10-27T12:00:00.000Z");
  assert.equal(result.pageUrl, "https://go.example.ie/new");
  assert.equal(result.checks[3].status, "found");
  assert.equal(calls.length, 2);
});

test("tracking check refuses redirects to unrelated hosts", async () => {
  await assert.rejects(() => checkSiteConversionTags("https://example.ie/old", ["example.ie", "go.example.ie"], async () => new Response(null, { status: 302, headers: { location: "https://attacker.invalid/" } })), /outside this client/);
});
