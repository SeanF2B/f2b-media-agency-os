import test from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createMarketingDomainVerificationToken, isMarketingDomainVerified, marketingCustomDomainPageUrl, marketingDomainDnsRecordContainsToken, marketingDomainVerificationRecord, normalizeMarketingHostname } from "../lib/marketing-custom-domain.js";

test("custom hostnames normalize safely and accept a hostname or HTTPS URL", () => {
  assert.equal(normalizeMarketingHostname("  HTTPS://Go.Example.IE/ "), "go.example.ie");
  assert.equal(normalizeMarketingHostname("localhost"), "");
  assert.equal(normalizeMarketingHostname("127.0.0.1"), "");
  assert.equal(normalizeMarketingHostname("example.ie/path"), "");
  assert.equal(normalizeMarketingHostname("https://user@example.ie"), "");
  assert.equal(normalizeMarketingHostname("http://example.ie:8443"), "");
  assert.equal(normalizeMarketingHostname("example.invalid-label-.ie"), "");
});

test("ownership verification produces a DNS TXT record and checks the exact token", () => {
  const token = createMarketingDomainVerificationToken(() => "A1234567-89ab-cdef-0123-456789abcdef");
  assert.match(token, /^f2b-[a-z0-9-]{16,80}$/);
  assert.deepEqual(marketingDomainVerificationRecord("go.example.ie", token), { type: "TXT", name: "_f2b-verify.go.example.ie", value: token });
  assert.equal(marketingDomainDnsRecordContainsToken({ Answer: [{ type: 16, data: `"${token}"` }] }, token), true);
  assert.equal(marketingDomainDnsRecordContainsToken({ Answer: [{ type: 16, data: "other-token" }] }, token), false);
  assert.equal(marketingDomainDnsRecordContainsToken({ Answer: [{ type: 1, data: token }] }, token), false);
});

test("only a DNS-verified domain is eligible for routing", () => {
  assert.equal(isMarketingDomainVerified({ status: "verified", verifiedAt: "2026-10-27T10:00:00Z" }), true);
  assert.equal(isMarketingDomainVerified({ status: "pending", verifiedAt: "" }), false);
  assert.equal(isMarketingDomainVerified({ status: "verified", verifiedAt: "" }), false);
  assert.equal(isMarketingDomainVerified(null), false);
});

test("custom domain routing maps only the root path to a safe published slug", () => {
  const page = marketingCustomDomainPageUrl("https://go.example.ie/?utm_source=ads", "approved-page-1");
  assert.equal(page.hostname, "go.example.ie");
  assert.equal(page.pathname, "/f/approved-page-1");
  assert.equal(page.searchParams.get("utm_source"), "ads");
  assert.equal(marketingCustomDomainPageUrl("https://go.example.ie/api/workspace", "approved-page-1"), null);
  assert.equal(marketingCustomDomainPageUrl("https://go.example.ie/", "../private"), null);
});

test("all checked-in D1 migrations replay with the custom-domain schema", async () => {
  const root = fileURLToPath(new URL("../", import.meta.url));
  const directory = path.join(root, "drizzle");
  const files = (await readdir(directory)).filter((name) => /^\d{4}_.+\.sql$/.test(name)).sort();
  const db = new DatabaseSync(":memory:");
  try {
    for (const file of files) db.exec(await readFile(path.join(directory, file), "utf8"));
    const table = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'marketing_custom_domains'").get();
    assert.equal(table?.name, "marketing_custom_domains");
    assert.equal(files.length, 41);
  } finally { db.close(); }
});
