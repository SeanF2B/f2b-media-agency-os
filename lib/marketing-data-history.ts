export type MarketingSnapshotService = "Google Ads" | "Meta Ads" | "Search Console" | "GA4" | "Google Business Profile";

export type MarketingSnapshot = {
  service: MarketingSnapshotService;
  snapshotDate: string;
  accountId: string;
  status: "connected" | "no_data";
  fetchedAt: string;
  payload: Record<string, unknown>;
};

type CacheInput = {
  db: D1Database;
  ownerId: string;
  clientId: string;
  service: MarketingSnapshotService;
  key: string;
  now?: Date;
  ttlMs?: number;
};

function dublinDate(date: Date) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Dublin",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

async function digestKey(value: string) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (part) => part.toString(16).padStart(2, "0")).join("");
}

export async function loadCachedMarketingData<T>(input: CacheInput, load: () => Promise<T>): Promise<{ data: T; cacheHit: boolean; fetchedAt: string }> {
  const now = input.now || new Date();
  const nowIso = now.toISOString();
  const cacheKey = await digestKey(input.key);
  try {
    const row = await input.db.prepare(
      "SELECT fetched_at, payload_json FROM marketing_data_cache WHERE owner_id = ?1 AND client_id = ?2 AND service = ?3 AND cache_key = ?4 AND expires_at > ?5 LIMIT 1",
    ).bind(input.ownerId, input.clientId, input.service, cacheKey, nowIso).first<{ fetched_at: string; payload_json: string }>();
    if (row) {
      try { return { data: JSON.parse(row.payload_json) as T, cacheHit: true, fetchedAt: row.fetched_at }; }
      catch { /* Replace an unreadable cache row with a live response. */ }
    }
  } catch { /* A cache read failure must not block live reporting. */ }

  const data = await load();
  const fetchedAt = now.toISOString();
  const expiresAt = new Date(now.getTime() + Math.max(1_000, input.ttlMs ?? 10 * 60_000)).toISOString();
  try {
    await input.db.prepare(
      "INSERT INTO marketing_data_cache (owner_id, client_id, service, cache_key, fetched_at, expires_at, payload_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7) ON CONFLICT(owner_id, client_id, service, cache_key) DO UPDATE SET fetched_at = excluded.fetched_at, expires_at = excluded.expires_at, payload_json = excluded.payload_json",
    ).bind(input.ownerId, input.clientId, input.service, cacheKey, fetchedAt, expiresAt, JSON.stringify(data)).run();
  } catch { /* D1 cache writes are best-effort; the verified live response still wins. */ }
  return { data, cacheHit: false, fetchedAt };
}

export async function saveDailyMarketingSnapshot(input: {
  db: D1Database;
  ownerId: string;
  clientId: string;
  service: MarketingSnapshotService;
  accountId: string;
  status: "connected" | "no_data";
  payload: Record<string, unknown>;
  fetchedAt?: Date;
}) {
  const fetchedAt = input.fetchedAt || new Date();
  const fetchedAtIso = fetchedAt.toISOString();
  const snapshotDate = dublinDate(fetchedAt);
  await input.db.prepare(
    "INSERT INTO marketing_metric_snapshots (owner_id, client_id, service, snapshot_date, account_id, status, fetched_at, payload_json) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8) ON CONFLICT(owner_id, client_id, service, snapshot_date) DO UPDATE SET account_id = excluded.account_id, status = excluded.status, fetched_at = excluded.fetched_at, payload_json = excluded.payload_json",
  ).bind(input.ownerId, input.clientId, input.service, snapshotDate, input.accountId, input.status, fetchedAtIso, JSON.stringify(input.payload)).run();
  return { service: input.service, snapshotDate, accountId: input.accountId, status: input.status, fetchedAt: fetchedAtIso, payload: input.payload } satisfies MarketingSnapshot;
}

export async function listDailyMarketingSnapshots(input: {
  db: D1Database;
  ownerId: string;
  clientId: string;
  service: MarketingSnapshotService;
  accountId: string;
  limit?: number;
}) {
  const limit = Math.max(1, Math.min(60, Math.trunc(input.limit || 30)));
  const rows = await input.db.prepare(
    "SELECT snapshot_date, account_id, status, fetched_at, payload_json FROM marketing_metric_snapshots WHERE owner_id = ?1 AND client_id = ?2 AND service = ?3 AND account_id = ?4 ORDER BY snapshot_date DESC LIMIT ?5",
  ).bind(input.ownerId, input.clientId, input.service, input.accountId, limit).all<{ snapshot_date: string; account_id: string; status: string; fetched_at: string; payload_json: string }>();
  return (rows.results || []).flatMap((row) => {
    if (row.status !== "connected" && row.status !== "no_data") return [];
    try {
      return [{ service: input.service, snapshotDate: row.snapshot_date, accountId: row.account_id, status: row.status, fetchedAt: row.fetched_at, payload: JSON.parse(row.payload_json) as Record<string, unknown> } satisfies MarketingSnapshot];
    } catch { return []; }
  }).reverse();
}

