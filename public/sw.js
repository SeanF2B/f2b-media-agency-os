/*
 * Keep only the generic, sign-in-gated app shell and immutable static assets
 * available offline. Never cache workspace, client, or API responses.
 */
const SHELL_CACHE = "f2b-app-shell-v7";
const ASSET_CACHE = "f2b-static-assets-v7";
// Keep the offline copy tied to this service-worker release. A generic `/`
// cache key can otherwise restore an old client shell after a new deploy.
const APP_SHELL = new URL("/?app-shell-version=7", self.location.origin).href;

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names.filter((name) => name.startsWith("f2b-app-shell-") || name.startsWith("f2b-static-assets-")).filter((name) => name !== SHELL_CACHE && name !== ASSET_CACHE).map((name) => caches.delete(name)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const request = event.request;
  if (request.method !== "GET") return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) return;

  const isAppShell = request.mode === "navigate" && url.pathname === "/";
  const isStaticAsset = url.pathname.startsWith("/_next/static/") || /\.(?:css|js|woff2?|png|jpe?g|webp|svg|ico)$/i.test(url.pathname);
  if (!isAppShell && !isStaticAsset) return;

  event.respondWith((async () => {
    try {
      const response = await fetch(request, isAppShell ? { cache: "reload" } : undefined);
      if (!response.ok || response.type === "opaque") return response;
      if (isAppShell) {
        const contentType = response.headers.get("content-type") || "";
        if (contentType.includes("text/html") && new URL(response.url).origin === self.location.origin && new URL(response.url).pathname === "/") {
          try { const cache = await caches.open(SHELL_CACHE); await cache.put(APP_SHELL, response.clone()); } catch { /* A full cache must never block the online app. */ }
        }
      } else if (isStaticAsset) {
        try { const cache = await caches.open(ASSET_CACHE); await cache.put(request, response.clone()); } catch { /* Static caching is best-effort only. */ }
      }
      return response;
    } catch (error) {
      if (isAppShell) {
        const cachedShell = await caches.match(APP_SHELL);
        if (cachedShell) return cachedShell;
      } else if (isStaticAsset) {
        const cachedAsset = await caches.match(request);
        if (cachedAsset) return cachedAsset;
      }
      throw error;
    }
  })());
});
