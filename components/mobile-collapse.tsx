"use client";

import { useEffect } from "react";

// Big Dashboard sections fold open/closed by tapping their header, on every screen size.
// Phones: closed until tapped (data-mopen), so the work is on screen without scrolling through everything.
// Desktop: open by default; a folded section (data-dclosed) is remembered on this device.
// Pure attribute toggle — React state is untouched. Tasks filters also fold away on phones.
export const MOBILE_COLLAPSE_HEADS = [
  ".dh > section.panel > :first-child",
  ".dh > .dh-grid > .panel > :first-child",
  ".dh > .dh-ads-wrap > .panel > :first-child",
].join(", ");
const PANELS = ".dh > section.panel, .dh > .dh-grid > .panel, .dh > .dh-ads-wrap > .panel";
const STORE = "f2b-folded-sections";

const keyOf = (panel: HTMLElement) => panel.getAttribute("aria-label") || panel.querySelector("h2, h3")?.textContent?.trim() || "";
const readFolded = (): string[] => { try { const v = JSON.parse(localStorage.getItem(STORE) || "[]"); return Array.isArray(v) ? v : []; } catch { return []; } };
const writeFolded = (list: string[]) => { try { localStorage.setItem(STORE, JSON.stringify(list)); } catch { /* private mode */ } };

export function MobileCollapse() {
  useEffect(() => {
    const phone = window.matchMedia("(max-width: 860px)");
    // Desktop: re-apply remembered folds as sections render (they load lazily).
    let queued = false;
    const apply = () => {
      queued = false;
      const folded = new Set(readFolded());
      if (!folded.size) return;
      document.querySelectorAll<HTMLElement>(PANELS).forEach((panel) => {
        const key = keyOf(panel);
        if (key && folded.has(key) && !panel.hasAttribute("data-dfold-seen")) { panel.setAttribute("data-dclosed", ""); }
        panel.setAttribute("data-dfold-seen", "");
      });
    };
    const observer = new MutationObserver(() => { if (!queued) { queued = true; requestAnimationFrame(apply); } });
    observer.observe(document.body, { childList: true, subtree: true });
    apply();
    const onClick = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target) return;
      if (phone.matches) {
        // Tasks: tapping the folded filters bar opens it; it stays open until tapped on its label again.
        const toolbar = target.closest<HTMLElement>(".task-page .pipeline-toolbar, .pipeline-toolbar");
        if (toolbar && target === toolbar) { toolbar.toggleAttribute("data-mopen"); return; }
      }
      if (target.closest("button, a, select, input, label, textarea, [role='tab'], [role='button']")) return;
      const head = target.closest<HTMLElement>(MOBILE_COLLAPSE_HEADS);
      const panel = head?.parentElement;
      if (!panel) return;
      if (phone.matches) { panel.toggleAttribute("data-mopen"); return; }
      const closed = panel.toggleAttribute("data-dclosed");
      const key = keyOf(panel);
      if (key) { const list = readFolded().filter((k) => k !== key); writeFolded(closed ? [...list, key] : list); }
    };
    document.addEventListener("click", onClick);
    return () => { document.removeEventListener("click", onClick); observer.disconnect(); };
  }, []);
  return null;
}
