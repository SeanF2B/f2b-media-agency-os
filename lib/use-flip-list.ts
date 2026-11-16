"use client";
import { useLayoutEffect, useRef } from "react";

/**
 * Smoothly animates children of `container` (marked with `data-flip-id`) to their new positions
 * whenever `orderKey` changes — e.g. client cards sliding up as they match a search.
 */
export function useFlipList(container: React.RefObject<HTMLElement | null>, orderKey: string) {
  const last = useRef(new Map<string, number>());
  useLayoutEffect(() => {
    const root = container.current; if (!root) return;
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const items = [...root.querySelectorAll<HTMLElement>("[data-flip-id]")];
    const next = new Map<string, number>();
    for (const el of items) {
      const id = el.dataset.flipId || ""; const top = el.offsetTop; next.set(id, top);
      const before = last.current.get(id);
      if (reduce || before === undefined || before === top) continue;
      el.style.transition = "none";
      el.style.transform = `translateY(${before - top}px)`;
      requestAnimationFrame(() => { el.style.transition = "transform .28s cubic-bezier(.2,.8,.2,1)"; el.style.transform = ""; });
    }
    last.current = next;
  }, [container, orderKey]);
}

/** Scrolls `child` into view inside its own scrolling `list` only (never the page). */
export function keepInList(list: HTMLElement | null, child: HTMLElement | null) {
  if (!list || !child) return;
  const listBox = list.getBoundingClientRect(), box = child.getBoundingClientRect();
  if (box.top < listBox.top) list.scrollBy({ top: box.top - listBox.top - 8, behavior: "smooth" });
  else if (box.bottom > listBox.bottom) list.scrollBy({ top: box.bottom - listBox.bottom + 8, behavior: "smooth" });
}
