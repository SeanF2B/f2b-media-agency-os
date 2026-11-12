import assert from "node:assert/strict";
import test from "node:test";
import { build } from "../node_modules/.pnpm/esbuild@0.28.2/node_modules/esbuild/lib/main.js";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ownerWorkspace = { ownerId: "owner-1", staff: [] };
const baseEnv = {
  F2B_CF_ACCOUNT_ID: "account-123",
  F2B_CF_ACCESS_APP_ID: "root-app",
  F2B_CF_ACCESS_POLICY_ID: "private-allow",
  CLOUDFLARE_ACCESS_API_TOKEN: "test-only-token",
  TASK_APP_URL: "https://crm.example.test/",
};

class TestD1 {
  constructor(workspace = ownerWorkspace) { this.workspace = workspace; }
  prepare() {
    const query = {
      bind() { return query; },
      first: async () => ({ data: JSON.stringify(this.workspace) }),
    };
    return query;
  }
}

async function loadRoute() {
  const temp = await mkdtemp(path.join(os.tmpdir(), "f2b-public-access-route-"));
  const outfile = path.join(temp, "public-access-route.mjs");
  const mocks = {
    "cloudflare:workers": "export const env = globalThis.__publicAccessRouteEnv;",
    "../../../chatgpt-auth": "export const getChatGPTUser = async () => globalThis.__publicAccessRouteUser;",
    "access-permissions": "export const getTeamPermissions = (role) => ({ team: role === 'Owner' || role === 'Admin' });",
  };
  await build({
    entryPoints: [path.resolve("app/api/integrations/public-marketing-access/route.ts")], outfile, bundle: true, platform: "node", format: "esm", target: "node24",
    plugins: [{ name: "public-access-route-mocks", setup(api) {
      api.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: "cloudflare:workers", namespace: "public-access-route-test" }));
      api.onResolve({ filter: /chatgpt-auth/ }, () => ({ path: "../../../chatgpt-auth", namespace: "public-access-route-test" }));
      api.onResolve({ filter: /access-permissions/ }, () => ({ path: "access-permissions", namespace: "public-access-route-test" }));
      api.onLoad({ filter: /.*/, namespace: "public-access-route-test" }, (args) => ({ contents: mocks[args.path], loader: "js" }));
    } }],
  });
  const route = await import(`${pathToFileURL(outfile).href}?test=${Date.now()}`);
  return { route, dispose: () => rm(temp, { recursive: true, force: true }) };
}

function request({ confirm = "APPROVE_PUBLIC_MARKETING_ROUTES", origin = "https://crm.example.test" } = {}) {
  return new Request("https://crm.example.test/api/integrations/public-marketing-access", {
    method: "POST", headers: { "content-type": "application/json", origin }, body: JSON.stringify({ confirm }),
  });
}

function json(body, status = 200) { return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } }); }

test("public-route setup rejects signed-out users and cross-origin requests before Cloudflare calls", async () => {
  globalThis.__publicAccessRouteEnv = { DB: new TestD1(), ...baseEnv };
  const isolated = await loadRoute();
  const oldFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => { called = true; throw new Error("should not call Cloudflare"); };
  try {
    globalThis.__publicAccessRouteUser = null;
    assert.equal((await isolated.route.POST(request())).status, 401);
    globalThis.__publicAccessRouteUser = { userId: "owner-1", email: "owner@example.test" };
    assert.equal((await isolated.route.POST(request({ origin: "https://other.example.test" }))).status, 403);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = oldFetch;
    await isolated.dispose();
  }
});

test("public-route setup requires the owner confirmation phrase and changes no Access app without it", async () => {
  globalThis.__publicAccessRouteEnv = { DB: new TestD1(), ...baseEnv };
  globalThis.__publicAccessRouteUser = { userId: "owner-1", email: "owner@example.test" };
  const isolated = await loadRoute();
  const oldFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => { called = true; throw new Error("should not call Cloudflare"); };
  try {
    const response = await isolated.route.POST(request({ confirm: "" }));
    assert.equal(response.status, 400);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = oldFetch;
    await isolated.dispose();
  }
});

test("non-owner staff cannot apply the public path Access changes", async () => {
  globalThis.__publicAccessRouteEnv = { DB: new TestD1({ ownerId: "owner-1", staff: [{ id: "staff-2", role: "Viewer", email: "staff@example.test" }] }), ...baseEnv };
  globalThis.__publicAccessRouteUser = { userId: "staff-2", email: "staff@example.test" };
  const isolated = await loadRoute();
  const oldFetch = globalThis.fetch;
  let called = false;
  globalThis.fetch = async () => { called = true; throw new Error("should not call Cloudflare"); };
  try {
    const response = await isolated.route.POST(request());
    assert.equal(response.status, 403);
    assert.equal(called, false);
  } finally {
    globalThis.fetch = oldFetch;
    await isolated.dispose();
  }
});

test("owner route setup applies only the approved path-specific rules through the Access helper", async () => {
  globalThis.__publicAccessRouteEnv = { DB: new TestD1(), ...baseEnv };
  globalThis.__publicAccessRouteUser = { userId: "owner-1", email: "owner@example.test" };
  const isolated = await loadRoute();
  const oldFetch = globalThis.fetch;
  const apps = [];
  const policies = new Map([["root-app", [{ id: "private-allow", decision: "allow", include: [{ email: { email: "owner@example.test" } }], exclude: [], require: [] }]]]);
  let id = 0;
  globalThis.fetch = async (input, init = {}) => {
    const url = new URL(input);
    const method = init.method || "GET";
    if (url.pathname.endsWith("/access/apps/root-app")) return json({ success: true, result: { id: "root-app", domain: "crm.example.test", type: "self_hosted" } });
    if (url.pathname.endsWith("/access/apps/root-app/policies")) return json({ success: true, result: policies.get("root-app") });
    if (url.pathname.endsWith("/access/apps") && method === "GET") return json({ success: true, result: apps.filter((app) => app.domain === url.searchParams.get("domain")) });
    const policyMatch = url.pathname.match(/\/access\/apps\/([^/]+)\/policies$/);
    if (policyMatch) return json({ success: true, result: policies.get(policyMatch[1]) || [] });
    if (url.pathname.endsWith("/access/apps") && method === "POST") {
      const body = JSON.parse(init.body);
      const appId = `path-${++id}`;
      apps.push({ id: appId, domain: body.domain, type: body.type });
      policies.set(appId, body.policies);
      return json({ success: true, result: { id: appId } }, 201);
    }
    return json({ success: false, errors: [{ message: "unexpected request" }] }, 404);
  };
  try {
    const response = await isolated.route.POST(request());
    const payload = await response.json();
    assert.equal(response.status, 200);
    assert.equal(payload.ok, true);
    assert.equal(apps.length, 5);
    assert.equal(apps.some((app) => app.domain === "crm.example.test"), false);
  } finally {
    globalThis.fetch = oldFetch;
    await isolated.dispose();
  }
});
