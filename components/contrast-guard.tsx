"use client";

import { useEffect } from "react";

/**
 * Site-wide readability guard for dark mode.
 *
 * Dark mode forces white text everywhere (body.f2b-dark rule in f2b-brand-accessible.css). That is right on
 * dark surfaces, but white pop-ups, inputs, chips and highlighted rows then show white-on-white. This guard
 * finds every element whose effective background (nearest ancestor with a mostly-opaque background colour)
 * is light and gives it dark text with an inline !important colour, which beats the stylesheet rule. When the
 * background turns dark again (e.g. a row is deselected) the inline colour is removed.
 */
const DARK_TEXT = "#1c2330";
const MARK = "f2bOnLight";

function parseColor(value: string): [number, number, number, number] | null {
  const srgb = value.match(/color\(srgb\s+([^)]+)\)/); // color-mix() results compute to color(srgb r g b / a) with 0–1 channels
  if (srgb) {
    const p = srgb[1].split(/[\s/]+/).filter(Boolean).map(Number);
    if (p.length < 3 || p.some((n) => Number.isNaN(n))) return null;
    return [p[0] * 255, p[1] * 255, p[2] * 255, p.length > 3 ? p[3] : 1];
  }
  const match = value.match(/rgba?\(([^)]+)\)/);
  if (!match) return null;
  const parts = match[1].split(/[\s,/]+/).filter(Boolean).map(Number);
  if (parts.length < 3 || parts.some((n) => Number.isNaN(n))) return null;
  return [parts[0], parts[1], parts[2], parts.length > 3 ? parts[3] : 1];
}

function luminance([r, g, b]: [number, number, number, number]) {
  const lin = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function ContrastGuard() {
  useEffect(() => {
    let timer: number | undefined;
    let running = false;

    const scan = () => {
      running = true;
      const dark = document.body.classList.contains("f2b-dark");
      // Light mode with nothing to undo: skip the full-page walk (it reads styles for every element).
      if (!dark && !document.querySelector("[data-f2b-on-light]")) { observer.takeRecords(); running = false; return; }
      const cache = new Map<Element, boolean>(); // element -> is its effective background light?
      const isLight = (el: Element | null): boolean => {
        if (!el || el === document.documentElement) return false;
        const known = cache.get(el);
        if (known !== undefined) return known;
        let result: boolean;
        const color = parseColor(getComputedStyle(el).backgroundColor);
        if (color && color[3] >= 0.5) result = luminance(color) > 0.45;
        else result = isLight(el.parentElement);
        cache.set(el, result);
        return result;
      };
      const all = document.body.querySelectorAll<HTMLElement | SVGElement>("*");
      for (const el of all) {
        const tag = el.tagName;
        if (tag === "SCRIPT" || tag === "STYLE" || tag === "IMG" || tag === "IFRAME" || tag === "CANVAS") continue;
        if (el.closest(".marketing-live-page")) continue;
        // Chess boards and pieces set their own colours; recolouring them per square makes pieces flicker as they move.
        if (el.closest(".chess-board, .chess-final-board, .chess-thumbnail, .chess-piece-svg, .chess-pause")) continue;
        const marked = el.dataset[MARK] === "1";
        const light = dark && isLight(el);
        if (light && !marked) {
          el.style.setProperty("color", DARK_TEXT, "important");
          el.dataset[MARK] = "1";
          el.classList.add("f2b-on-light");
        } else if (!light && marked) {
          el.style.removeProperty("color");
          delete el.dataset[MARK];
          el.classList.remove("f2b-on-light");
        }
      }
      // Ignore the mutations we just caused.
      observer.takeRecords();
      running = false;
    };

    const queue = () => { if (running) return; window.clearTimeout(timer); timer = window.setTimeout(scan, 120); };
    const observer = new MutationObserver(queue);
    observer.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ["class", "style", "open", "aria-expanded", "aria-selected"] });
    scan();
    return () => { observer.disconnect(); window.clearTimeout(timer); };
  }, []);
  return null;
}
