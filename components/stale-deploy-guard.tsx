"use client";

import { useEffect } from "react";

// After a new deploy, a tab opened earlier can't load the old page files any more ("Failed to fetch dynamically
// imported module") and the page goes blank. Load the new version once (at most once a minute) instead of leaving it broken.
// Lives outside the app itself so it still works when the app has crashed.
export function StaleDeployGuard() {
  useEffect(() => {
    const stale = (text: string) => /Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module|ChunkLoadError|Loading chunk \S+ failed/i.test(text);
    const recover = (text: string) => {
      if (!stale(text)) return;
      try { const last = Number(window.sessionStorage.getItem("f2b-stale-reload") || 0); if (Date.now() - last < 60_000) return; window.sessionStorage.setItem("f2b-stale-reload", String(Date.now())); } catch { /* storage unavailable */ }
      window.location.reload();
    };
    const onRejection = (event: PromiseRejectionEvent) => recover(String((event.reason as Error)?.message || event.reason || ""));
    const onError = (event: ErrorEvent) => recover(String(event.message || (event.error as Error)?.message || ""));
    const onPreload = () => recover("Failed to fetch dynamically imported module");
    window.addEventListener("unhandledrejection", onRejection);
    window.addEventListener("error", onError);
    window.addEventListener("vite:preloadError", onPreload);
    // React also logs the failed lazy load through console.error before the page blanks.
    const original = console.error;
    console.error = (...args: unknown[]) => { try { recover(args.map((a) => a instanceof Error ? a.message : String(a)).join(" ")); } catch { /* ignore */ } original.apply(console, args as []); };
    return () => { window.removeEventListener("unhandledrejection", onRejection); window.removeEventListener("error", onError); window.removeEventListener("vite:preloadError", onPreload); console.error = original; };
  }, []);
  return null;
}
