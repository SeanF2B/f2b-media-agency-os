import test from "node:test";
import assert from "node:assert/strict";
import { listDailyMarketingSnapshots, loadCachedMarketingData, saveDailyMarketingSnapshot } from "../lib/marketing-data-history.ts";

function memoryDb() {
  const cache = new Map();
  const snapshots = new Map();
  return {
    cache,
    snapshots,
    prepare(sql) {
      let values = [];
      const statement = {
        bind(...args) { values = args; return statement; },
        async first() {
          if (!sql.startsWith("SELECT fetched_at, payload_json FROM marketing_data_cache")) throw new Error("unexpected first query");
          const row = cache.get(values.slice(0, 4).join("|"));
          return row && row.expires_at > values[4] ? row : null;
        },
        async run() {
          if (sql.startsWith("INSERT INTO marketing_data_cache")) {
            cache.set(values.slice(0, 4).join("|"), { fetched_at: values[4], expires_at: values[5], payload_json: values[6] });
            return { success: true };
          }
          if (sql.startsWith("INSERT INTO marketing_metric_snapshots")) {
            snapshots.set(values.slice(0, 4).join("|"), { account_id: values[4], status: values[5], fetched_at: values[6], payload_json: values[7] });
            return { success: true };
          }
          throw new Error("unexpected write query");
        },
        async all() {
          if (!sql.startsWith("SELECT snapshot_date, account_id, status, fetched_at, payload_json FROM marketing_metric_snapshots")) throw new Error("unexpected history query");
          const [ownerId, clientId, service, accountId, limit] = values;
          const results = [...snapshots.entries()]
            .filter(([key, row]) => key.startsWith(`${ownerId}|${clientId}|${service}|`) && row.account_id === accountId)
            .map(([key, row]) => ({ snapshot_date: key.split("|")[3], ...row }))
            .sort((a, b) => b.snapshot_date.localeCompare(a.snapshot_date)).slice(0, limit);
          return { results };
        },
      };
      return statement;
    },
  };
}

test("marketing response cache avoids a repeated provider load until expiry", async () => {
  const db = memoryDb();
  const input = { db, ownerId: "owner", clientId: "client", service: "Google Ads", key: "account:123:30d", now: new Date("2026-10-26T12:00:00Z") };
  let calls = 0;
  const first = await loadCachedMarketingData(input, async () => ({ clicks: ++calls }));
  const hit = await loadCachedMarketingData(input, async () => ({ clicks: ++calls }));
  assert.deepEqual(first.data, { clicks: 1 });
  assert.equal(first.cacheHit, false);
  assert.deepEqual(hit.data, { clicks: 1 });
  assert.equal(hit.cacheHit, true);
  assert.equal(calls, 1);
});

test("cache expiry reloads provider data and database failures do not block it", async () => {
  const db = memoryDb();
  const firstInput = { db, ownerId: "owner", clientId: "client", service: "GA4", key: "overview", now: new Date("2026-10-26T12:00:00Z"), ttlMs: 1_000 };
  await loadCachedMarketingData(firstInput, async () => "old");
  const expired = await loadCachedMarketingData({ ...firstInput, now: new Date("2026-10-26T12:00:02Z") }, async () => "fresh");
  assert.equal(expired.data, "fresh");
  const brokenDb = { prepare() { throw new Error("D1 unavailable"); } };
  const fallback = await loadCachedMarketingData({ ...firstInput, db: brokenDb }, async () => "live");
  assert.equal(fallback.data, "live");
});

test("daily snapshots upsert by Dublin date and history filters the mapped account", async () => {
  const db = memoryDb();
  const base = { db, ownerId: "owner", clientId: "client", service: "Search Console", accountId: "sc-domain:example.ie" };
  await saveDailyMarketingSnapshot({ ...base, status: "connected", payload: { clicks: 10 }, fetchedAt: new Date("2026-10-26T00:15:00Z") });
  await saveDailyMarketingSnapshot({ ...base, status: "connected", payload: { clicks: 14 }, fetchedAt: new Date("2026-10-26T20:00:00Z") });
  await saveDailyMarketingSnapshot({ ...base, accountId: "other-property", status: "connected", payload: { clicks: 99 }, fetchedAt: new Date("2026-10-27T08:00:00Z") });
  const history = await listDailyMarketingSnapshots({ ...base, limit: 30 });
  assert.equal(history.length, 1);
  assert.equal(history[0].snapshotDate, "2026-10-26");
  assert.deepEqual(history[0].payload, { clicks: 14 });
});


