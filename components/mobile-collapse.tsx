"use client";

import { useEffect } from "react";

// Phones: big sections (Dashboard, Books) open on tap and Tasks filters fold away, so the work is on screen
// without scrolling through everything. Pure attribute toggle (data-mopen) — React state is untouched.
export const MOBILE_COLLAPSE_HEADS = [
  ".dh > section.panel > :first-child",
  ".dh > .dh-grid > .panel > :first-child",
  ".dh > .dh-ads-wrap > .panel > :first-child",
  ".overview-projection-panel > :first-child",
].join(", ");

export function MobileCollapse() {
  useEffect(() => {
    const phone = window.matchMedia("(max-width: 860px)");
    const onClick = (event: MouseEvent) => {
      if (!phone.matches) return;
      const target = event.target as HTMLElement | null;
      if (!target) return;
      // Tasks: tapping the folded filters bar opens it; it stays open until tapped on its label again.
      const toolbar = target.closest<HTMLElement>(".task-page .pipeline-toolbar, .pipeline-toolbar");
      if (toolbar && target === toolbar) { toolbar.toggleAttribute("data-mopen"); return; }
      if (target.closest("button, a, select, input, label, textarea, [role='tab'], [role='button']")) return;
      const head = target.closest<HTMLElement>(MOBILE_COLLAPSE_HEADS);
      if (!head?.parentElement) return;
      head.parentElement.toggleAttribute("data-mopen");
    };
    document.addEventListener("click", onClick);
    return () => document.removeEventListener("click", onClick);
  }, []);
  return null;
}
