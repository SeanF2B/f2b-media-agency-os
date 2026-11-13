/*
 * F2B Agency OS · auto-update.
 * Open tabs keep running the JavaScript they loaded, so after a deploy they can
 * show an old version for hours. Every 2 minutes (and when the tab regains focus)
 * this compares the app's build files with the live ones; when a new deploy is
 * live it shows a small "Updating…" note and reloads at a safe moment (tab just
 * came back into view, or nobody is typing).
 */
(function () {
  if (window.__f2bAutoUpdate) return;
  window.__f2bAutoUpdate = true;

  var CHECK_MS = 2 * 60 * 1000;
  var pending = false;
  var lastCheck = 0;

  function buildFiles(doc) {
    var set = {};
    var nodes = doc.querySelectorAll('script[src*="/_next/static/"], link[href*="/_next/static/"]');
    for (var i = 0; i < nodes.length; i++) {
      var url = nodes[i].getAttribute("src") || nodes[i].getAttribute("href") || "";
      set[url.split("?")[0]] = true;
    }
    return set;
  }

  var current = buildFiles(document);
  if (!Object.keys(current).length) return;

  function typing() {
    var el = document.activeElement;
    if (!el) return false;
    var tag = (el.tagName || "").toLowerCase();
    return tag === "input" || tag === "textarea" || tag === "select" || el.isContentEditable;
  }

  function modalOpen() {
    return !!document.querySelector('[role="dialog"], .modal, .modal-backdrop');
  }

  function showNote() {
    if (document.getElementById("f2b-update-note")) return;
    var note = document.createElement("button");
    note.id = "f2b-update-note";
    note.type = "button";
    note.textContent = "New version ready · click to update";
    note.style.cssText = "position:fixed;right:18px;bottom:18px;z-index:2147483000;background:#111;color:#fff;border:0;border-radius:10px;padding:10px 14px;font:600 13px/1.2 inherit;box-shadow:0 6px 20px rgba(0,0,0,.25);cursor:pointer";
    note.onclick = function () { location.reload(); };
    document.body.appendChild(note);
  }

  function tryReload(force) {
    if (!pending) return;
    if (force || (!typing() && !modalOpen())) location.reload();
  }

  function check() {
    if (pending || Date.now() - lastCheck < 30 * 1000) return;
    lastCheck = Date.now();
    fetch("/", { cache: "no-store", credentials: "same-origin", headers: { "x-f2b-update-check": "1" } })
      .then(function (res) {
        if (!res.ok || new URL(res.url).origin !== location.origin) return null;
        if ((res.headers.get("content-type") || "").indexOf("text/html") === -1) return null;
        return res.text();
      })
      .then(function (html) {
        if (!html) return;
        var live = buildFiles(new DOMParser().parseFromString(html, "text/html"));
        var keys = Object.keys(live);
        if (!keys.length) return;
        var changed = keys.some(function (k) { return !current[k]; });
        if (!changed) return;
        pending = true;
        showNote();
        if (document.visibilityState === "hidden") return; // reload when it comes back
        setTimeout(function () { tryReload(false); }, 1500);
      })
      .catch(function () { /* offline or signed out: try again later */ });
  }

  setInterval(function () {
    if (pending) tryReload(false);
    else check();
  }, CHECK_MS);
  document.addEventListener("visibilitychange", function () {
    if (document.visibilityState !== "visible") return;
    if (pending) tryReload(true);
    else check();
  });
  window.addEventListener("focus", check);
  setTimeout(check, 15 * 1000);
})();
