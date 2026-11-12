import assert from "node:assert/strict";
import test from "node:test";
import { build } from "../node_modules/.pnpm/esbuild@0.28.2/node_modules/esbuild/lib/main.js";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const workspace = { ownerId: "owner-1", staff: [], clients: [{ id: "client-1" }] };

class TestD1 {
  constructor({ existing = null } = {}) {
    this.existing = existing;
    this.calls = [];
    this.batches = [];
  }
  prepare(sql) {
    let values = [];
    const query = {
      sql,
      get values() { return values; },
      bind(...nextValues) { values = nextValues; return query; },
      first: async () => {
        this.calls.push({ method: "first", sql, values });
        if (sql.includes("workspace_documents")) return { data: JSON.stringify(workspace) };
        if (sql.includes("FROM marketing_assets") && sql.includes("AND kind = ?3")) {
          return this.existing && this.existing.ownerId === values[0] && this.existing.id === values[1] && this.existing.kind === values[2]
            ? { version: this.existing.version, data: this.existing.data, publishedData: this.existing.publishedData }
            : null;
        }
        return null;
      },
      all: async () => { this.calls.push({ method: "all", sql, values }); return { results: [] }; },
      run: async () => { this.calls.push({ method: "run", sql, values }); return { meta: { changes: 1 } }; },
    };
    return query;
  }
  async batch(queries) {
    this.batches.push(queries.map((query) => ({ sql: query.sql, values: query.values })));
    return queries.map(() => ({ meta: { changes: 1 } }));
  }
}

async function loadRoute() {
  const temp = await mkdtemp(path.join(os.tmpdir(), "f2b-marketing-api-route-"));
  const outfile = path.join(temp, "studio-route.mjs");
  const mocks = {
    "cloudflare:workers": "export const env = globalThis.__marketingStudioApiEnv;",
    "../../chatgpt-auth": "export const getChatGPTUser = async () => globalThis.__marketingStudioApiUser;",
  };
  await build({
    entryPoints: [path.resolve("app/api/marketing-studio/route.ts")], outfile, bundle: true, platform: "node", format: "esm", target: "node24",
    plugins: [{ name: "marketing-studio-api-route-mocks", setup(api) {
      api.onResolve({ filter: /^cloudflare:workers$/ }, () => ({ path: "cloudflare:workers", namespace: "marketing-studio-api-test" }));
      api.onResolve({ filter: /chatgpt-auth/ }, () => ({ path: "../../chatgpt-auth", namespace: "marketing-studio-api-test" }));
      api.onLoad({ filter: /.*/, namespace: "marketing-studio-api-test" }, (args) => ({ contents: mocks[args.path], loader: "js" }));
    } }],
  });
  const route = await import(`${pathToFileURL(outfile).href}?test=${Date.now()}`);
  return { route, dispose: () => rm(temp, { recursive: true, force: true }) };
}

function saveRequest({ id, clientId = "client-1", name = "Website enquiry", status = "draft" } = {}) {
  return new Request("https://crm.example.test/api/marketing-studio", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...(id ? { id } : {}), kind: "form", clientId, name, status, data: { heading: name, fields: [{ id: "email", label: "Email", type: "email", required: true }] } }),
  });
}

test("private Marketing Studio API rejects signed-out and non-owner users before project writes", async () => {
  const db = new TestD1();
  globalThis.__marketingStudioApiEnv = { DB: db };
  const isolated = await loadRoute();
  try {
    globalThis.__marketingStudioApiUser = null;
    const signedOut = await isolated.route.POST(saveRequest());
    assert.equal(signedOut.status, 401);

    globalThis.__marketingStudioApiUser = { userId: "outsider-1", email: "outsider@example.test" };
    const outsider = await isolated.route.POST(saveRequest());
    assert.equal(outsider.status, 403);
    assert.equal(db.batches.length, 0);
    assert.equal(db.calls.some((call) => call.sql.includes("INSERT INTO marketing_assets")), false);
  } finally {
    delete globalThis.__marketingStudioApiEnv;
    delete globalThis.__marketingStudioApiUser;
    await isolated.dispose();
  }
});

test("owner-created drafts are stored under the workspace owner and never published implicitly", async () => {
  const db = new TestD1();
  globalThis.__marketingStudioApiEnv = { DB: db };
  globalThis.__marketingStudioApiUser = { userId: "owner-1", email: "owner@example.test" };
  const isolated = await loadRoute();
  try {
    const response = await isolated.route.POST(saveRequest());
    const body = await response.json();
    assert.equal(response.status, 201);
    assert.equal(body.asset.status, "draft");
    assert.equal(body.asset.hasPublishedVersion, false);
    const insert = db.batches.flat().find((query) => query.sql.includes("INSERT INTO marketing_assets"));
    assert.ok(insert);
    assert.equal(insert.values[1], "owner-1");
    assert.equal(insert.values[7], "draft");
    assert.equal(insert.values[9], null);
    assert.equal(db.batches.flat().some((query) => query.sql.includes("INSERT INTO marketing_asset_versions")), true);
  } finally {
    delete globalThis.__marketingStudioApiEnv;
    delete globalThis.__marketingStudioApiUser;
    await isolated.dispose();
  }
});

test("owner publishing a valid form stores a distinct versioned published snapshot", async () => {
  const db = new TestD1();
  globalThis.__marketingStudioApiEnv = { DB: db };
  globalThis.__marketingStudioApiUser = { userId: "owner-1", email: "owner@example.test" };
  const isolated = await loadRoute();
  try {
    const response = await isolated.route.POST(saveRequest({ status: "published" }));
    const body = await response.json();
    assert.equal(response.status, 201);
    assert.equal(body.asset.status, "published");
    assert.equal(body.asset.hasPublishedVersion, true);
    const insert = db.batches.flat().find((query) => query.sql.includes("INSERT INTO marketing_assets"));
    assert.ok(insert);
    const published = JSON.parse(insert.values[9]);
    assert.equal(published._marketingPublicationVersion, 1);
    assert.equal(published.fields[0].id, "email");
    assert.equal(insert.values[7], "published");
  } finally {
    delete globalThis.__marketingStudioApiEnv;
    delete globalThis.__marketingStudioApiUser;
    await isolated.dispose();
  }
});

test("a different workspace cannot update a project by guessing its ID", async () => {
  const db = new TestD1({ existing: { ownerId: "another-owner", id: "project-123", kind: "form", version: 1, data: "{}", publishedData: null } });
  globalThis.__marketingStudioApiEnv = { DB: db };
  globalThis.__marketingStudioApiUser = { userId: "owner-1", email: "owner@example.test" };
  const isolated = await loadRoute();
  try {
    const response = await isolated.route.POST(saveRequest({ id: "project-123" }));
    const body = await response.json();
    assert.equal(response.status, 404);
    assert.match(body.error, /not found for this workspace/);
    const ownershipRead = db.calls.find((call) => call.sql.includes("FROM marketing_assets") && call.sql.includes("AND kind = ?3"));
    assert.deepEqual(ownershipRead.values, ["owner-1", "project-123", "form"]);
    assert.equal(db.batches.length, 0);
  } finally {
    delete globalThis.__marketingStudioApiEnv;
    delete globalThis.__marketingStudioApiUser;
    await isolated.dispose();
  }
});
