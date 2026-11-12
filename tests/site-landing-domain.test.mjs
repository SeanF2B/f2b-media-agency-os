import test from "node:test";
import assert from "node:assert/strict";
import { checkLandingDomain } from "../lib/site-landing-domain.ts";

const dnsResponse = (answers = []) => new Response(JSON.stringify({ Answer: answers.map((data) => ({ data })) }), { status: 200, headers: { "Content-Type": "application/dns-json" } });

test("landing domain check separates missing DNS from HTTPS and skips HTTPS without records", async () => {
  const calls = [];
  const result = await checkLandingDomain("go.example.ie", async (input) => {
    calls.push(String(input));
    return dnsResponse();
  }, "2026-10-27T12:00:00.000Z");
  assert.equal(result.dnsStatus, "missing");
  assert.equal(result.httpsStatus, "unavailable");
  assert.equal(calls.length, 3);
});

test("landing domain check confirms DNS answers and reports an external redirect clearly", async () => {
  const result = await checkLandingDomain("GO.Example.ie", async (input, init) => {
    if (String(input).includes("cloudflare-dns.com")) {
      const type = new URL(String(input)).searchParams.get("type");
      return type === "CNAME" ? dnsResponse(["landing-host.example.net."]) : dnsResponse();
    }
    assert.equal(init?.method, "HEAD");
    return new Response(null, { status: 302, headers: { location: "https://example.ie/landing/" } });
  });
  assert.equal(result.hostname, "go.example.ie");
  assert.equal(result.dnsStatus, "found");
  assert.deepEqual(result.dnsAnswers, ["landing-host.example.net."]);
  assert.equal(result.httpsStatus, "redirects");
  assert.equal(result.redirectHost, "example.ie");
});

test("landing domain check rejects invalid or local hostnames before making requests", async () => {
  let calls = 0;
  await assert.rejects(() => checkLandingDomain("localhost", async () => { calls++; return dnsResponse(); }), /valid public hostname/);
  assert.equal(calls, 0);
});

test("partial DNS provider errors are not reported as a missing record", async () => {
  const result = await checkLandingDomain("go.example.ie", async (input) => {
    if (new URL(String(input)).searchParams.get("type") === "A") throw new Error("resolver unavailable");
    return dnsResponse();
  });
  assert.equal(result.dnsStatus, "unavailable");
});

test("DNS resolver failures are unavailable rather than missing", async () => {
  const result = await checkLandingDomain("go.example.ie", async (input) => {
    if (String(input).includes("cloudflare-dns.com")) return new Response(JSON.stringify({ Status: 2 }), { status: 200 });
    throw new Error("HTTPS should not be checked without DNS answers");
  });
  assert.equal(result.dnsStatus, "unavailable");
  assert.equal(result.httpsStatus, "unavailable");
});

test("an HTTP error is not reported as a ready landing page", async () => {
  const result = await checkLandingDomain("go.example.ie", async (input) => {
    if (String(input).includes("cloudflare-dns.com")) {
      const type = new URL(String(input)).searchParams.get("type");
      return type === "CNAME" ? dnsResponse(["landing-host.example.net."]) : dnsResponse();
    }
    return new Response(null, { status: 404 });
  });
  assert.equal(result.dnsStatus, "found");
  assert.equal(result.httpsStatus, "error");
  assert.equal(result.httpStatus, 404);
});

test("landing host that rejects HEAD gets a minimal GET fallback", async () => {
  const methods = [];
  const result = await checkLandingDomain("go.example.ie", async (input, init) => {
    if (String(input).includes("cloudflare-dns.com")) {
      const type = new URL(String(input)).searchParams.get("type");
      return type === "CNAME" ? dnsResponse(["landing-host.example.net."]) : dnsResponse();
    }
    methods.push(init?.method);
    return new Response(null, { status: init?.method === "HEAD" ? 405 : 200 });
  });
  assert.deepEqual(methods, ["HEAD", "GET"]);
  assert.equal(result.httpsStatus, "ready");
});
