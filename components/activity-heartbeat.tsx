"use client";
import { useEffect } from "react";

// Reports active time to Settings → Audit log: a minute counts as active when the mouse, keyboard, scroll or
// touch was used in it and the tab is visible. Sent once a minute; nothing is sent while idle or hidden.
export function ActivityHeartbeat({ page }: { page: string }) {
  useEffect(() => {
    let activeSince = 0, lastInput = 0;
    const mark = () => { const now = Date.now(); if (!activeSince) activeSince = now; lastInput = now; };
    const events = ["mousemove", "mousedown", "keydown", "scroll", "touchstart", "wheel"] as const;
    events.forEach((e) => window.addEventListener(e, mark, { passive: true }));
    const timer = window.setInterval(() => {
      const now = Date.now();
      if (document.visibilityState !== "visible" || !lastInput || now - lastInput > 60_000) { activeSince = 0; return; }
      const seconds = Math.min(60, Math.round((now - Math.max(activeSince, now - 60_000)) / 1000));
      activeSince = now;
      const body = JSON.stringify({ seconds, page: (window as { __f2bPage?: string }).__f2bPage || "" });
      try { if (!navigator.sendBeacon?.("/api/activity-log", new Blob([body], { type: "application/json" }))) void fetch("/api/activity-log", { method: "POST", headers: { "Content-Type": "application/json" }, body, keepalive: true }); } catch { /* offline */ }
    }, 60_000);
    return () => { window.clearInterval(timer); events.forEach((e) => window.removeEventListener(e, mark)); };
  }, []);
  useEffect(() => { (window as { __f2bPage?: string }).__f2bPage = page; }, [page]);
  return null;
}
