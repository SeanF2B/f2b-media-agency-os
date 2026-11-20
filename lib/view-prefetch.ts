// Warm the code and data for heavy tabs before they're opened (idle time + nav hover),
// so switching to Scheduling / Conversations / Tasks shows content straight away.
// Kept free of view imports so it doesn't pull those chunks into the main bundle.
import { prefetchView } from "@/lib/view-cache";

const addDays = (d: Date, n: number) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
const mondayOf = (d: Date) => { const x = new Date(d.getFullYear(), d.getMonth(), d.getDate()); const wd = (x.getDay() + 6) % 7; return addDays(x, -wd); };

export const schedulingCacheKey = (scope: string, week: Date) => `sch:${scope || "agency"}:${week.toISOString().slice(0, 10)}`;
export const schedulingUrl = (scope: string, week: Date) => `/api/scheduling?clientId=${encodeURIComponent(scope || "agency")}&from=${addDays(week, -35).toISOString()}&to=${addDays(week, 70).toISOString()}`;
export const currentWeek = () => mondayOf(new Date());

export const conversationsCacheKey = (scope: string) => `conv:threads:${scope || "agency"}`;
export const conversationsUrl = (scope: string) => `/api/conversations?view=threads&clientId=${encodeURIComponent(scope || "agency")}`;

const chunks: Record<string, () => Promise<unknown>> = {
  Scheduling: () => import("@/components/scheduling-view"),
  Operations: () => import("@/components/operations-view"),
  Tasks: () => import("@/components/operations-view"),
};
const loadedChunks = new Set<string>();
function warmChunk(page: string) {
  const load = chunks[page];
  if (!load || loadedChunks.has(page)) return;
  loadedChunks.add(page);
  load().catch(() => loadedChunks.delete(page));
}

/** Called on nav hover / focus / pointerdown. Cheap and deduped. */
export function prefetchPage(page: string, scope: string, opts: { conversations?: boolean } = {}) {
  warmChunk(page);
  if (page === "Scheduling") { const w = currentWeek(); void prefetchView(schedulingCacheKey(scope, w), schedulingUrl(scope, w)); }
  if (page === "Conversations" || (page === "CRM" && opts.conversations)) void prefetchView(conversationsCacheKey(scope), conversationsUrl(scope));
}

/** Download the heavy tab code once the app is idle (no data requests, so no extra database reads). */
export function warmChunksWhenIdle() {
  const run = () => { warmChunk("Operations"); warmChunk("Scheduling"); };
  const w = window as Window & { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number };
  if (w.requestIdleCallback) w.requestIdleCallback(run, { timeout: 4000 });
  else window.setTimeout(run, 2500);
}
