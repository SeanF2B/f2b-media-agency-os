import test from "node:test";
import assert from "node:assert/strict";
import { getDailySyncCandidates, processDailyMarketingSnapshots } from "../lib/marketing-daily-sync.ts";

test("daily sync only selects mapped accounts without today's snapshot or an active retry delay", () => {
  const now = new Date("2026-10-26T12:00:00Z");
  const clients = [
    { id: "c1", name: "Client One", googleAdsAccountId: "123-456-7890", metaAdsAccountId: "act_777", googleSearchConsoleAccountId: "sc-domain:one.ie" },
    { id: "c2", name: "Client Two", googleAnalyticsAccountId: "ga4-2" },
  ];
  const candidates = getDailySyncCandidates(clients, {
    ownerId: "owner", today: "2026-10-26", now,
    snapshots: [{ client_id: "c1", service: "Google Ads", account_id: "1234567890" }],
    states: [{ client_id: "c1", service: "Meta Ads", account_id: "777", next_attempt_at: "2026-10-26T18:00:00.000Z" }],
  });
  assert.deepEqual(candidates.map(({ clientId, service, accountId }) => `${clientId}:${service}:${accountId}`), [
    "c1:Search Console:sc-domain:one.ie",
    "c2:GA4:ga4-2",
  ]);
});

test("a crashed sync releases its syncing lease for retry while a live lease stays protected", () => {
  const now = new Date("2026-10-26T12:00:00Z");
  const client = [{ id: "c1", googleAnalyticsAccountId: "ga4-1" }];
  const base = { ownerId: "owner", today: "2026-10-26", now, snapshots: [] };
  const stale = getDailySyncCandidates(client, { ...base, states: [{
    client_id: "c1", service: "GA4", account_id: "ga4-1", status: "syncing",
    last_attempt_at: "2026-10-26T11:40:00Z", next_attempt_at: "2026-10-26T17:40:00Z",
  }] });
  assert.equal(stale.length, 1, "a worker crash must not leave the account locked for the six-hour error backoff");
  const live = getDailySyncCandidates(client, { ...base, states: [{
    client_id: "c1", service: "GA4", account_id: "ga4-1", status: "syncing",
    last_attempt_at: "2026-10-26T11:55:00Z", next_attempt_at: "2026-10-26T12:10:00Z",
  }] });
  assert.equal(live.length, 0, "a recently claimed sync must not be started twice");
});

test("Google Business Profile sync requires both an account and a location mapping", () => {
  const input = { ownerId: "owner", today: "2026-10-26", now: new Date("2026-10-26T12:00:00Z"), snapshots: [], states: [] };
  assert.deepEqual(getDailySyncCandidates([{ id: "c1", googleBusinessProfileAccountId: "account-1" }], input), []);
  assert.deepEqual(getDailySyncCandidates([{ id: "c1", googleBusinessProfileAccountId: "account-1", googleBusinessProfileLocationId: "location-9" }], input).map((row) => ({ service: row.service, accountId: row.accountId, locationId: row.locationId })), [
    { service: "Google Business Profile", accountId: "account-1", locationId: "location-9" },
  ]);
});

test("manual retry bypasses the backoff and today's snapshot but never a live sync lease", async () => {
  const at = new Date("2026-10-26T12:00:00Z");
  const db = syncDb({ ownerId: "owner", clients: [{ id: "client", name: "Client", googleAnalyticsAccountId: "ga4-1" }] });
  const key = "owner|client|GA4|ga4-1";
  db.states.set(key, { owner_id: "owner", client_id: "client", service: "GA4", account_id: "ga4-1", last_attempt_at: "2026-10-26T06:00:00Z", next_attempt_at: "2026-10-26T12:00:00Z", status: "unavailable", detail: "previous failure" });
  db.snapshots.set("owner|client|GA4|2026-10-26", { owner_id: "owner", client_id: "client", service: "GA4", snapshot_date: "2026-10-26", account_id: "ga4-1", status: "connected", fetched_at: "2026-10-26T06:00:00Z", payload_json: "{}" });
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return new Response(JSON.stringify({ data: [{ sessions: 5, active_users: 4, engaged_sessions: 3, conversions: 1 }] }), { status: 200 }); };
  try {
    const result = await processDailyMarketingSnapshots({ DB: db, WINDSOR_API_KEY: "test-key" }, at, { clientId: "client", service: "GA4" });
    assert.deepEqual(result, { status: "ok", synced: 1, failed: 0, remaining: 0 });
    assert.equal(calls, 2, "manual GA4 retry refreshes its totals and channel reports despite backoff and an existing daily snapshot");
    assert.equal(db.states.get(key).status, "connected");

    db.states.set(key, { ...db.states.get(key), last_attempt_at: at.toISOString(), next_attempt_at: "2026-10-26T12:15:00Z", status: "syncing" });
    const blocked = await processDailyMarketingSnapshots({ DB: db, WINDSOR_API_KEY: "test-key" }, new Date(at.getTime() + 60_000), { clientId: "client", service: "GA4" });
    assert.deepEqual(blocked, { status: "ok", synced: 0, failed: 0, remaining: 0 });
    assert.equal(calls, 2, "manual retry does not start another report during a live sync lease");
  } finally { globalThis.fetch = originalFetch; }
});

test("overlapping sync ticks atomically claim a client account only once", async () => {
  const db = syncDb({ ownerId: "owner", clients: [{ id: "client", name: "Client", googleAnalyticsAccountId: "ga4-1" }] });
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => {
    calls += 1;
    await new Promise((resolve) => setTimeout(resolve, 20));
    return new Response(JSON.stringify({ data: [{ sessions: 5, active_users: 4, engaged_sessions: 3, conversions: 1 }] }), { status: 200 });
  };
  try {
    const env = { DB: db, WINDSOR_API_KEY: "test-key" };
    const at = new Date("2026-10-26T12:00:00Z");
    const results = await Promise.all([processDailyMarketingSnapshots(env, at), processDailyMarketingSnapshots(env, at)]);
    assert.equal(calls, 2, "the atomic lease prevents duplicate syncs; each GA4 sync fetches totals and channel reports");
    assert.equal(results.reduce((sum, result) => sum + result.synced, 0), 1);
  } finally { globalThis.fetch = originalFetch; }
});

function syncDb(workspace) {
  const snapshots = new Map();
  const states = new Map();
  const cache = new Map();
  return {
    snapshots,
    states,
    prepare(sql) {
      let values = [];
      const statement = {
        bind(...args) { values = args; return statement; },
        async first() {
          if (sql.includes("FROM workspace_documents")) return { data: JSON.stringify(workspace) };
          if (sql.startsWith("SELECT fetched_at, payload_json FROM marketing_data_cache")) {
            const key = values.slice(0, 4).join("|");
            const row = cache.get(key);
            return row && row.expires_at > values[4] ? row : null;
          }
          throw new Error(`unexpected first query: ${sql}`);
        },
        async all() {
          if (sql.startsWith("SELECT client_id, service, account_id FROM marketing_metric_snapshots")) {
            const [, date] = values;
            return { results: [...snapshots.values()].filter((row) => row.snapshot_date === date) };
          }
          if (sql.startsWith("SELECT client_id, service, account_id,") && sql.includes("FROM marketing_sync_state")) return { results: [...states.values()] };
          throw new Error(`unexpected list query: ${sql}`);
        },
        async run() {
          if (sql.startsWith("INSERT INTO marketing_data_cache")) {
            cache.set(values.slice(0, 4).join("|"), { fetched_at: values[4], expires_at: values[5], payload_json: values[6] });
            return { success: true };
          }
          if (sql.startsWith("INSERT INTO marketing_metric_snapshots")) {
            const row = { owner_id: values[0], client_id: values[1], service: values[2], snapshot_date: values[3], account_id: values[4], status: values[5], fetched_at: values[6], payload_json: values[7] };
            snapshots.set(`${row.owner_id}|${row.client_id}|${row.service}|${row.snapshot_date}`, row);
            return { success: true };
          }
          if (sql.startsWith("INSERT INTO marketing_sync_state")) {
            const key = `${values[0]}|${values[1]}|${values[2]}|${values[3]}`;
            const current = states.get(key);
            if (sql.includes("status = 'syncing'")) {
              if (current?.status === "syncing" && current.last_attempt_at > values[6]) return { meta: { changes: 0 } };
              states.set(key, { owner_id: values[0], client_id: values[1], service: values[2], account_id: values[3], last_attempt_at: values[4], next_attempt_at: values[5], status: "syncing", detail: null });
              return { meta: { changes: 1 } };
            }
            const row = { owner_id: values[0], client_id: values[1], service: values[2], account_id: values[3], last_attempt_at: values[4], next_attempt_at: values[5], status: values[6], detail: values[7] };
            states.set(key, row);
            return { meta: { changes: 1 } };
          }
          throw new Error(`unexpected write query: ${sql}`);
        },
      };
      return statement;
    },
  };
}

test("scheduled sync saves four connected source snapshots once per Dublin day", async () => {
  const db = syncDb({ ownerId: "owner", clients: [{
    id: "client", name: "Client",
    googleAdsAccountId: "123-456-7890", metaAdsAccountId: "act_777",
    googleSearchConsoleAccountId: "sc-domain:client.ie", googleAnalyticsAccountId: "ga4-99",
  }] });
  const originalFetch = globalThis.fetch;
  const requestedSources = [];
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    requestedSources.push(url.pathname);
    const rows = url.pathname.endsWith("google_ads") ? [{ date: "2026-10-25", campaign: "Search", campaign_id: "1", spend: 12, impressions: 100, clicks: 4, conversions: 1, conversion_value: 20 }]
      : url.pathname.endsWith("facebook") ? [{ date: "2026-10-25", campaign: "Meta", campaign_id: "2", spend: 8, impressions: 80, clicks: 3, actions_lead: 1 }]
        : url.pathname.endsWith("searchconsole") ? [{ date: "2026-10-22", query: "roofer", page: "https://client.ie/", clicks: 3, impressions: 20, position: 4 }]
          : url.searchParams.get("fields")?.includes("session_default_channel_group") ? [{ session_default_channel_group: "Organic Search", sessions: 4, conversions: 1 }]
            : [{ account_name: "Client Analytics", sessions: 5, active_users: 4, engaged_sessions: 3, conversions: 1, totalrevenue: 0 }];
    return new Response(JSON.stringify({ data: rows }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const env = { DB: db, WINDSOR_API_KEY: "test-key" };
    const at = new Date("2026-10-26T12:00:00Z");
    const result = await processDailyMarketingSnapshots(env, at);
    assert.deepEqual(result, { status: "ok", synced: 4, failed: 0, remaining: 0 });
    assert.equal(db.snapshots.size, 4);
    assert.equal(requestedSources.length, 5);
    const ga4Snapshot = [...db.snapshots.values()].find((snapshot) => snapshot.service === "GA4");
    assert.deepEqual(JSON.parse(ga4Snapshot.payload_json).organicTotals, { sessions: 4, conversions: 1, sourceRows: 1 });
    const secondRun = await processDailyMarketingSnapshots(env, new Date("2026-10-26T12:05:00Z"));
    assert.deepEqual(secondRun, { status: "ok", synced: 0, failed: 0, remaining: 0 });
    assert.equal(requestedSources.length, 5, "a second tick must not request today's sources again");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("scheduled Google Business Profile sync saves only the mapped location metrics", async () => {
  const db = syncDb({ ownerId: "owner", clients: [{ id: "client", name: "Client", googleBusinessProfileAccountId: "account-1", googleBusinessProfileLocationId: "location-9" }] });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    assert.ok(url.pathname.endsWith("google_my_business"));
    return new Response(JSON.stringify({ data: [
      { location_id: "location-9", impressions: 80, call_clicks: 4, direction_requests: 3, website_clicks: 6 },
      { location_id: "other-location", impressions: 900, call_clicks: 20, direction_requests: 30, website_clicks: 60 },
    ] }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const result = await processDailyMarketingSnapshots({ DB: db, WINDSOR_API_KEY: "test-key" }, new Date("2026-10-26T12:00:00Z"));
    assert.deepEqual(result, { status: "ok", synced: 1, failed: 0, remaining: 0 });
    const snapshot = [...db.snapshots.values()][0];
    assert.equal(snapshot.service, "Google Business Profile");
    assert.deepEqual(JSON.parse(snapshot.payload_json), { current: { rows: 1, locationName: "", impressions: 80, calls: 4, directions: 3, websiteClicks: 6 }, locationId: "location-9" });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("scheduled Meta Ads snapshots use the direct connection when the owner has one", async () => {
  const db = syncDb({ ownerId: "owner", clients: [{ id: "client", name: "Client", metaAdsAccountId: "act_777" }] });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Windsor must not be called when direct Meta is connected."); };
  try {
    const result = await processDailyMarketingSnapshots({
      DB: db,
      WINDSOR_API_KEY: "test-key",
      isMetaAdsDirect: async () => true,
      readDirectMetaAds: async (ownerId, accountId) => {
        assert.equal(ownerId, "owner");
        assert.equal(accountId, "777");
        return [{ date: "2026-10-25", campaign: "Meta", campaign_id: "2", spend: "8", impressions: "80", clicks: "3", actions_lead: 1 }];
      },
    }, new Date("2026-10-26T12:00:00Z"));
    assert.deepEqual(result, { status: "ok", synced: 1, failed: 0, remaining: 0 });
    const snapshot = [...db.snapshots.values()][0];
    const payload = JSON.parse(snapshot.payload_json);
    assert.equal(payload.source, "Meta Marketing API · read-only");
    assert.deepEqual(payload.current.totals, { spend: 8, impressions: 80, clicks: 3, leads: 1, ctr: 3 / 80, costPerLead: 8 });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("scheduled Google Ads snapshots use the direct API when available, even without Windsor", async () => {
  const db = syncDb({ ownerId: "owner", clients: [{ id: "client", name: "Client", googleAdsAccountId: "123-456-7890" }] });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Windsor must not be called when direct Google Ads is connected."); };
  try {
    const result = await processDailyMarketingSnapshots({
      DB: db,
      isGoogleAdsDirect: async (ownerId) => ownerId === "owner",
      readDirectGoogleAds: async (ownerId, accountId, window) => {
        assert.equal(ownerId, "owner");
        assert.equal(accountId, "1234567890");
        assert.deepEqual(window, { start: "2026-09-26", end: "2026-10-25" });
        return [{ date: "2026-10-25", campaign: "Search", campaign_id: "123", campaign_status: "ENABLED", spend: 12, impressions: 100, clicks: 4, conversions: 1, conversion_value: 20 }];
      },
    }, new Date("2026-10-26T12:00:00Z"));
    assert.deepEqual(result, { status: "ok", synced: 1, failed: 0, remaining: 0 });
    const snapshot = [...db.snapshots.values()][0];
    const payload = JSON.parse(snapshot.payload_json);
    assert.equal(snapshot.service, "Google Ads");
    assert.equal(payload.source, "Google Ads API · read-only");
    assert.equal(payload.current.totals.spend, 12);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("scheduled Google Ads snapshots fall back to Windsor when the direct report fails", async () => {
  const db = syncDb({ ownerId: "owner", clients: [{ id: "client", name: "Client", googleAdsAccountId: "1234567890" }] });
  const originalFetch = globalThis.fetch;
  let directCalls = 0;
  let windsorCalls = 0;
  globalThis.fetch = async (input) => {
    const url = new URL(String(input));
    assert.ok(url.pathname.endsWith("google_ads"));
    windsorCalls += 1;
    return new Response(JSON.stringify({ data: [{ date: "2026-10-25", campaign: "Fallback", campaign_id: "987", spend: 9, impressions: 40, clicks: 2, conversions: 1, conversion_value: 0 }] }), { status: 200, headers: { "content-type": "application/json" } });
  };
  try {
    const result = await processDailyMarketingSnapshots({
      DB: db,
      WINDSOR_API_KEY: "test-key",
      isGoogleAdsDirect: async () => true,
      readDirectGoogleAds: async () => { directCalls += 1; throw new Error("Google Ads API temporarily unavailable"); },
    }, new Date("2026-10-26T12:00:00Z"));
    assert.deepEqual(result, { status: "ok", synced: 1, failed: 0, remaining: 0 });
    assert.equal(directCalls, 1);
    assert.equal(windsorCalls, 1);
    const payload = JSON.parse([...db.snapshots.values()][0].payload_json);
    assert.equal(payload.source, "Windsor.ai Google Ads connector · read-only");
    assert.equal(payload.current.totals.spend, 9);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("scheduled Search Console snapshots use direct read-only data when available, even without Windsor", async () => {
  const db = syncDb({ ownerId: "owner", clients: [{ id: "client", name: "Client", googleSearchConsoleAccountId: "sc-domain:client.ie" }] });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Windsor must not be called when direct Search Console is connected."); };
  try {
    const result = await processDailyMarketingSnapshots({
      DB: db,
      isSearchConsoleDirect: async (ownerId) => ownerId === "owner",
      readDirectSearchConsole: async (ownerId, accountId, window) => {
        assert.equal(ownerId, "owner");
        assert.equal(accountId, "sc-domain:client.ie");
          assert.deepEqual(window, { start: "2026-09-24", end: "2026-10-23" });
        return [{ date: "2026-10-22", query: "roofer", page: "https://client.ie/", clicks: 3, impressions: 20, ctr: 0.15, position: 4 }];
      },
    }, new Date("2026-10-26T12:00:00Z"));
    assert.deepEqual(result, { status: "ok", synced: 1, failed: 0, remaining: 0 });
    const snapshot = [...db.snapshots.values()][0];
    const payload = JSON.parse(snapshot.payload_json);
    assert.equal(snapshot.service, "Search Console");
    assert.equal(payload.source, "Google Search Console API · read-only");
    assert.equal(payload.current.totals.clicks, 3);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("scheduled GA4 snapshots use direct reports and save Organic Search totals", async () => {
  const db = syncDb({ ownerId: "owner", clients: [{ id: "client", name: "Client", googleAnalyticsAccountId: "ga4-99" }] });
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error("Windsor must not be called when direct GA4 is connected."); };
  try {
    const result = await processDailyMarketingSnapshots({
      DB: db,
      isGoogleAnalyticsDirect: async (ownerId) => ownerId === "owner",
      readDirectGoogleAnalytics: async (ownerId, accountId, window) => {
        assert.equal(ownerId, "owner");
        assert.equal(accountId, "ga4-99");
        assert.deepEqual(window, { start: "2026-09-26", end: "2026-10-25" });
        return {
          totals: [{ sessions: "30", active_users: "22", engaged_sessions: "20", conversions: "3", totalrevenue: "0" }],
          channels: [{ session_default_channel_group: "Organic Search", sessions: "12", conversions: "2" }, { session_default_channel_group: "Paid Search", sessions: "18", conversions: "1" }],
        };
      },
    }, new Date("2026-10-26T12:00:00Z"));
    assert.deepEqual(result, { status: "ok", synced: 1, failed: 0, remaining: 0 });
    const payload = JSON.parse([...db.snapshots.values()][0].payload_json);
    assert.equal(payload.source, "Google Analytics Data API · read-only");
    assert.deepEqual(payload.organicTotals, { sessions: 12, conversions: 2, sourceRows: 1 });
    assert.equal(payload.totals.sessions, 30);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("failed provider sync is not recorded as zero data and is delayed before retry", async () => {
  const db = syncDb({ ownerId: "owner", clients: [{ id: "client", name: "Client", googleAdsAccountId: "1234567890" }] });
  const originalFetch = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls += 1; return new Response("provider unavailable", { status: 503 }); };
  try {
    const env = { DB: db, WINDSOR_API_KEY: "test-key" };
    const first = await processDailyMarketingSnapshots(env, new Date("2026-10-26T12:00:00Z"));
    assert.deepEqual(first, { status: "ok", synced: 0, failed: 1, remaining: 0 });
    assert.equal(db.snapshots.size, 0, "a failed request must not be stored as no_data");
    assert.equal([...db.states.values()][0].status, "unavailable");
    const second = await processDailyMarketingSnapshots(env, new Date("2026-10-26T13:00:00Z"));
    assert.deepEqual(second, { status: "ok", synced: 0, failed: 0, remaining: 0 });
    assert.equal(calls, 1, "the retry backoff prevents repeated calls every five minutes");
  } finally {
    globalThis.fetch = originalFetch;
  }
});
