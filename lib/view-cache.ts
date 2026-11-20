// Tiny "show last data instantly, refresh in the background" cache for tab views.
// Switching tabs unmounts views; without this every visit starts from an empty loading state.
// Memory only (cleared on reload / sign-out), so inbox and calendar data never sit in browser storage.
// Only read-only GET payloads go here; never anything that must be fresh before acting on it.

const mem = new Map<string, { at: number; data: unknown }>();
const inflight = new Map<string, Promise<unknown>>();

export function readViewCache<T>(key: string): T | undefined {
  return mem.get(key)?.data as T | undefined;
}

export function writeViewCache(key: string, data: unknown) {
  mem.set(key, { at: Date.now(), data });
}

export function viewCacheAge(key: string): number {
  const hit = mem.get(key);
  return hit ? Date.now() - hit.at : Infinity;
}

/** Warm a GET into the cache (deduped; skipped if fresher than maxAgeMs). Used when hovering a nav item. */
export function prefetchView(key: string, url: string, maxAgeMs = 20_000): Promise<unknown> {
  if (viewCacheAge(key) < maxAgeMs) return Promise.resolve(mem.get(key)?.data);
  const existing = inflight.get(key);
  if (existing) return existing;
  const p = fetch(url, { cache: "no-store", credentials: "same-origin" })
    .then(async (r) => { if (!r.ok) return undefined; const j = await r.json(); writeViewCache(key, j); return j; })
    .catch(() => undefined)
    .finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

/** Join an in-flight prefetch instead of firing a duplicate request. */
export function pendingView<T>(key: string): Promise<T | undefined> | undefined {
  return inflight.get(key) as Promise<T | undefined> | undefined;
}
