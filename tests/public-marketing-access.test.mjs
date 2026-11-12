import test from "node:test";
import assert from "node:assert/strict";
import { checkPublicMarketingAccess } from "../lib/public-marketing-access.ts";

const missingPage = () => new Response(JSON.stringify({ error: "This published page could not be found." }), { status: 404, headers: { "Content-Type": "application/json" } });
const accessLogin = () => new Response(null, { status: 302, headers: { location: "https://team.cloudflareaccess.com/cdn-cgi/access/login" } });

test("both public marketing routes are verified without writing a page view", async () => {
  const requested = [];
  const result = await checkPublicMarketingAccess("https://agency.example.workers.dev/api/integrations/status", async (url) => {
    requested.push(new URL(String(url)).pathname);
    return missingPage();
  }, "2026-10-27T12:00:00.000Z", "test-id");
  assert.deepEqual(requested.sort(), ["/api/marketing-public", "/f/f2b-public-access-check-test-id"]);
  assert.equal(result.status, "ready");
  assert.equal(result.pageRoute, "reachable");
  assert.equal(result.apiRoute, "reachable");
});

test("Access login on both routes is reported as setup needed", async () => {
  const result = await checkPublicMarketingAccess("https://agency.example.workers.dev", async () => accessLogin(), "2026-10-27T12:00:00.000Z", "blocked");
  assert.equal(result.status, "needs_setup");
  assert.equal(result.pageRoute, "blocked");
  assert.equal(result.apiRoute, "blocked");
  assert.match(result.detail, /Cloudflare Access login is blocking/);
});

test("one public path and one blocked path are reported separately", async () => {
  const result = await checkPublicMarketingAccess("https://agency.example.workers.dev", async (url) => {
    return new URL(String(url)).pathname.startsWith("/f/") ? missingPage() : accessLogin();
  }, "2026-10-27T12:00:00.000Z", "partial");
  assert.equal(result.status, "partial");
  assert.equal(result.pageRoute, "reachable");
  assert.equal(result.apiRoute, "blocked");
});

test("unrelated responses and network failures are not treated as ready", async () => {
  const status = await checkPublicMarketingAccess("https://agency.example.workers.dev", async () => new Response("not found", { status: 404 }), "2026-10-27T12:00:00.000Z", "unexpected");
  assert.equal(status.status, "needs_setup");
  const failed = await checkPublicMarketingAccess("https://agency.example.workers.dev", async () => { throw new Error("network error"); }, "2026-10-27T12:00:00.000Z", "offline");
  assert.equal(failed.status, "needs_setup");
});

test("rejects non-HTTPS app origins before probing", async () => {
  await assert.rejects(() => checkPublicMarketingAccess("http://agency.example.workers.dev", async () => missingPage()), /must use HTTPS/);
});
