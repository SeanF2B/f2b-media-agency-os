import assert from "node:assert/strict";
import test from "node:test";
import { ensurePublicMarketingAccessRoutes, PUBLIC_MARKETING_ACCESS_PATHS } from "../lib/cloudflare-public-marketing-access.js";

const config = {
  accountId: "account-123",
  appId: "root-app",
  allowPolicyId: "private-allow",
  token: "unit-test-token",
  hostname: "crm.example.test",
};

function fakeCloudflare({ rootApp = { id: "root-app", domain: config.hostname, type: "self_hosted" }, rootPolicies, pathApps = [] } = {}) {
  const apps = [...pathApps];
  const policies = new Map([
    ["root-app", rootPolicies || [{ id: "private-allow", decision: "allow", include: [{ email: { email: "owner@example.test" } }], exclude: [], require: [] }]],
    ...pathApps.map((app) => [app.id, app.policies || []]),
  ]);
  const calls = [];
  let id = 0;
  const fetcher = async (input, init = {}) => {
    const url = new URL(input);
    const method = init.method || "GET";
    calls.push({ url, method, body: init.body ? JSON.parse(init.body) : undefined });
    if (url.pathname.endsWith("/access/apps/root-app") && method === "GET") return jsonResponse({ success: true, result: rootApp });
    if (url.pathname.endsWith("/access/apps/root-app/policies") && method === "GET") return jsonResponse({ success: true, result: policies.get("root-app") || [] });
    if (url.pathname.endsWith("/access/apps") && method === "GET") {
      const domain = url.searchParams.get("domain");
      return jsonResponse({ success: true, result: apps.filter((app) => app.domain === domain) });
    }
    const policyMatch = url.pathname.match(/\/access\/apps\/([^/]+)\/policies$/);
    if (policyMatch && method === "GET") return jsonResponse({ success: true, result: policies.get(policyMatch[1]) || [] });
    if (url.pathname.endsWith("/access/apps") && method === "POST") {
      const body = JSON.parse(init.body);
      const newId = `path-app-${++id}`;
      apps.push({ id: newId, domain: body.domain, type: body.type });
      policies.set(newId, body.policies || []);
      return jsonResponse({ success: true, result: { id: newId, domain: body.domain, type: body.type } }, 201);
    }
    return jsonResponse({ success: false, errors: [{ message: `Unexpected ${method} ${url.pathname}` }] }, 404);
  };
  return { fetcher, calls, apps, policies };
}

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

test("creates only the five approved path-specific public rules and leaves the CRM root app untouched", async () => {
  const cloudflare = fakeCloudflare();
  const result = await ensurePublicMarketingAccessRoutes({ ...config, fetcher: cloudflare.fetcher });
  assert.equal(result.ok, true);
  assert.deepEqual(result.createdPaths, PUBLIC_MARKETING_ACCESS_PATHS.map(({ path }) => path));
  assert.equal(cloudflare.apps.length, 5);
  assert.equal(cloudflare.calls.filter((call) => call.method === "PUT").length, 0);
  const creates = cloudflare.calls.filter((call) => call.method === "POST");
  assert.equal(creates.length, 5);
  for (const call of creates) {
    assert.equal(call.body.type, "self_hosted");
    assert.equal(call.body.policies.length, 1);
    assert.equal(call.body.policies[0].decision, "bypass");
    assert.deepEqual(call.body.policies[0].include, [{ everyone: {} }]);
    assert.deepEqual(call.body.policies[0].exclude, []);
    assert.deepEqual(call.body.policies[0].require, []);
  }
});

test("an exact path rule is idempotent only when it is already an Everyone-only public bypass", async () => {
  const pathApps = PUBLIC_MARKETING_ACCESS_PATHS.map(({ path }, index) => ({
    id: `existing-${index}`,
    domain: `${config.hostname}${path}`,
    type: "self_hosted",
    policies: [{ decision: "bypass", include: [{ everyone: {} }], exclude: [], require: [] }],
  }));
  const cloudflare = fakeCloudflare({ pathApps });
  const result = await ensurePublicMarketingAccessRoutes({ ...config, fetcher: cloudflare.fetcher });
  assert.equal(result.ok, true);
  assert.deepEqual(result.createdPaths, []);
  assert.ok(result.results.every((item) => item.status === "already_configured"));
  assert.equal(cloudflare.calls.some((call) => call.method === "POST" || call.method === "PUT"), false);
});

test("a conflicting path application stops before creating any new public rules", async () => {
  const pathApps = [{
    id: "conflict",
    domain: `${config.hostname}/robots.txt`,
    type: "self_hosted",
    policies: [{ decision: "allow", include: [{ email: { email: "owner@example.test" } }], exclude: [], require: [] }],
  }];
  const cloudflare = fakeCloudflare({ pathApps });
  const result = await ensurePublicMarketingAccessRoutes({ ...config, fetcher: cloudflare.fetcher });
  assert.equal(result.ok, false);
  assert.match(result.error, /not the approved Everyone-only public rule/);
  assert.equal(cloudflare.calls.some((call) => call.method === "POST"), false);
});

test("a root CRM app that is not the expected private hostname is never modified", async () => {
  const cloudflare = fakeCloudflare({ rootApp: { id: "root-app", domain: "other.example.test", type: "self_hosted" } });
  const result = await ensurePublicMarketingAccessRoutes({ ...config, fetcher: cloudflare.fetcher });
  assert.equal(result.ok, false);
  assert.match(result.error, /does not match the expected protected CRM hostname/);
  assert.equal(cloudflare.calls.some((call) => call.method === "POST" || call.method === "PUT"), false);
});

test("an Everyone rule on the root allow policy blocks setup before any writes", async () => {
  const cloudflare = fakeCloudflare({ rootPolicies: [{ id: "private-allow", decision: "allow", include: [{ everyone: {} }], exclude: [], require: [] }] });
  const result = await ensurePublicMarketingAccessRoutes({ ...config, fetcher: cloudflare.fetcher });
  assert.equal(result.ok, false);
  assert.match(result.error, /could not be confirmed as private/);
  assert.equal(cloudflare.calls.some((call) => call.method === "POST" || call.method === "PUT"), false);
});

test("missing Cloudflare credentials returns setup guidance without an API request", async () => {
  let called = false;
  const result = await ensurePublicMarketingAccessRoutes({ ...config, token: "", fetcher: async () => { called = true; } });
  assert.equal(result.ok, false);
  assert.equal(result.configured, false);
  assert.equal(called, false);
});
