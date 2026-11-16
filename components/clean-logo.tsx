"use client";

import { useEffect, useState } from "react";

const cache = new Map<string, string>();

// Removes a flat background (usually white) baked into a logo: flood-fills from the image edges,
// making pixels close to the corner colour transparent. Falls back to the original on any failure.
let inkOut: Ink = "mid";
export type Ink = "dark" | "light" | "mid";
const inkCache = new Map<string, Ink>();
async function stripBackground(src: string): Promise<string> {
  inkOut = "mid";
  const img = new Image();
  img.crossOrigin = "anonymous";
  img.decoding = "async";
  await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = () => reject(new Error("load")); img.src = src; });
  const scale = Math.min(1, 640 / Math.max(img.naturalWidth || 1, img.naturalHeight || 1));
  const w = Math.max(1, Math.round(img.naturalWidth * scale)), h = Math.max(1, Math.round(img.naturalHeight * scale));
  const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) return src;
  ctx.drawImage(img, 0, 0, w, h);
  const data = ctx.getImageData(0, 0, w, h); const px = data.data;
  const at = (x: number, y: number) => (y * w + x) * 4;
  // Trims empty transparent margins so small wordmarks fill the space they're given.
  // Average brightness of the visible logo pixels, so the top bar can give dark logos a light tile in dark mode (and vice versa).
  const measureInk = () => { let sum = 0, n = 0; for (let i = 0; i < px.length; i += 16) { if (px[i + 3] > 128) { sum += 0.2126 * px[i] + 0.7152 * px[i + 1] + 0.0722 * px[i + 2]; n++; } } inkOut = n ? (sum / n < 110 ? "dark" : sum / n > 170 ? "light" : "mid") : "mid"; };
  const cropped = () => {
    measureInk();
    let x0 = w, y0 = h, x1 = -1, y1 = -1;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) if (px[at(x, y) + 3] > 16) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
    if (x1 < 0) return canvas.toDataURL("image/png");
    const pad = Math.round(Math.max(x1 - x0, y1 - y0) * 0.04);
    x0 = Math.max(0, x0 - pad); y0 = Math.max(0, y0 - pad); x1 = Math.min(w - 1, x1 + pad); y1 = Math.min(h - 1, y1 + pad);
    if ((x1 - x0 + 1) * (y1 - y0 + 1) > w * h * 0.92) return canvas.toDataURL("image/png");
    const out = document.createElement("canvas"); out.width = x1 - x0 + 1; out.height = y1 - y0 + 1;
    out.getContext("2d")!.drawImage(canvas, x0, y0, out.width, out.height, 0, 0, out.width, out.height);
    return out.toDataURL("image/png");
  };
  let corners = [at(0, 0), at(w - 1, 0), at(0, h - 1), at(w - 1, h - 1)].filter((i) => px[i + 3] > 200);
  if (corners.length < 3) {
    // Transparent corners can still hide a white rounded "card" behind the logo: sample just inside the edges.
    const ix = Math.max(1, Math.round(w * 0.06)), iy = Math.max(1, Math.round(h * 0.08));
    const inner = [at(ix, iy), at(w - 1 - ix, iy), at(ix, h - 1 - iy), at(w - 1 - ix, h - 1 - iy), at(ix, h >> 1), at(w - 1 - ix, h >> 1)].filter((i) => px[i + 3] > 200 && px[i] > 225 && px[i + 1] > 225 && px[i + 2] > 225);
    if (inner.length < 4) return cropped(); // genuinely transparent background
    corners = inner;
  }
  const [br, bg, bb] = [0, 1, 2].map((c) => Math.round(corners.reduce((sum, i) => sum + px[i + c], 0) / corners.length));
  const dist = (i: number) => Math.max(Math.abs(px[i] - br), Math.abs(px[i + 1] - bg), Math.abs(px[i + 2] - bb));
  if (corners.filter((i) => dist(i) < 28).length < 3) return src; // corners disagree: no flat background
  const seen = new Uint8Array(w * h); const stack: number[] = [];
  for (let x = 0; x < w; x++) { stack.push(x, (h - 1) * w + x); }
  for (let y = 0; y < h; y++) { stack.push(y * w, y * w + w - 1); }
  let cleared = 0;
  while (stack.length) {
    const p = stack.pop()!; if (seen[p]) continue; seen[p] = 1;
    const i = p * 4; if (px[i + 3] === 0) { cleared++; } else { const d = dist(i); if (d > 48) continue; px[i + 3] = d < 22 ? 0 : Math.round(px[i + 3] * ((d - 22) / 26)); cleared++; }
    const x = p % w, y = (p / w) | 0;
    if (x > 0) stack.push(p - 1); if (x < w - 1) stack.push(p + 1); if (y > 0) stack.push(p - w); if (y < h - 1) stack.push(p + w);
  }
  if (cleared > w * h * 0.997) return src; // would erase the whole logo (small marks on big squares are fine)
  ctx.putImageData(data, 0, 0);
  return cropped();
}

export function useCleanLogo(src?: string | null): string {
  const [out, setOut] = useState(() => (src && cache.get(src)) || src || "");
  useEffect(() => {
    if (!src) { setOut(""); return; }
    const hit = cache.get(src); if (hit) { setOut(hit); return; }
    setOut(src);
    let live = true;
    stripBackground(src).catch(() => src).then((result) => { cache.set(src, result); inkCache.set(src, inkOut); if (live) setOut(result); });
    return () => { live = false; };
  }, [src]);
  return out;
}

export function CleanLogo({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const clean = useCleanLogo(src);
  return clean ? <img className={className} src={clean} alt={alt} data-ink={inkCache.get(src) || "mid"} /> : null;
}

// ---------- Dark mode: logos without white tiles ----------
// Dark-mode copy of a logo: background removed (as above), then near-black / grey ink turned light so it reads on a
// dark bar. Coloured parts (brand colours) are left as they are. Cached per source.
const darkCache = new Map<string, Promise<string>>();
async function loadImage(src: string) {
  const img = new Image(); img.crossOrigin = "anonymous"; img.decoding = "async";
  await new Promise<void>((resolve, reject) => { img.onload = () => resolve(); img.onerror = () => reject(new Error("load")); img.src = src; });
  return img;
}
export function darkReadyLogo(src: string): Promise<string> {
  const hit = darkCache.get(src); if (hit) return hit;
  const job = (async () => {
    const stripped = cache.get(src) || await stripBackground(src).catch(() => src);
    cache.set(src, stripped);
    const img = await loadImage(stripped);
    const w = img.naturalWidth || 1, h = img.naturalHeight || 1;
    const canvas = document.createElement("canvas"); canvas.width = w; canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true }); if (!ctx) return stripped;
    ctx.drawImage(img, 0, 0);
    const data = ctx.getImageData(0, 0, w, h); const px = data.data;
    let opaque = 0, changed = 0;
    for (let i = 0; i < px.length; i += 4) {
      if (px[i + 3] < 24) continue; opaque++;
      const r = px[i], g = px[i + 1], b = px[i + 2];
      const max = Math.max(r, g, b), min = Math.min(r, g, b);
      const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      if (max - min < 60 && lum < 150) { const v = Math.round(255 - lum * 0.85); px[i] = px[i + 1] = px[i + 2] = v; changed++; }
    }
    if (!opaque || changed / opaque < 0.04) return stripped; // nothing dark to lift
    ctx.putImageData(data, 0, 0);
    return canvas.toDataURL("image/png");
  })().catch(() => src);
  darkCache.set(src, job);
  return job;
}

// Colour of whatever is actually painted behind an element (first ancestor with a solid-enough background).
function parseRgba(text: string): [number, number, number, number] | null {
  const m = text.match(/rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:[,\s/]+([\d.]+%?))?\s*\)/);
  if (!m) return null;
  const a = m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
  return [+m[1], +m[2], +m[3], a];
}
function sitsOnDarkSurface(img: HTMLElement) {
  let el: HTMLElement | null = img.parentElement;
  while (el && el !== document.documentElement) {
    const cs = getComputedStyle(el);
    const solid = parseRgba(cs.backgroundColor);
    const grad = cs.backgroundImage && cs.backgroundImage !== "none" ? parseRgba(cs.backgroundImage) : null;
    const c = solid && solid[3] >= 0.35 ? solid : grad && grad[3] >= 0.35 ? grad : null;
    if (c) return (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) < 140;
    el = el.parentElement;
  }
  return true; // nothing painted: the dark-mode page shows through
}

const LOGO_SELECTOR = "img[class*='logo'], [class*='logo'] img, [class*='Logo'] img";
const SKIP = ".brand-icon-image, [data-keep-logo], .bot-icon img, .ai-icon img";
/** Mounted once by the app: while dark mode is on, every logo image is swapped for its dark-ready copy (no white boxes). */
export function DarkLogoFixer({ dark }: { dark: boolean }) {
  useEffect(() => {
    const restore = () => document.querySelectorAll<HTMLImageElement>("img[data-light-src]").forEach((img) => { const orig = img.dataset.lightSrc || ""; delete img.dataset.lightSrc; delete img.dataset.darkLogo; if (orig) img.src = orig; });
    if (!dark) { restore(); return; }
    const fix = (img: HTMLImageElement) => {
      if (img.matches(SKIP) || img.closest("[data-keep-logo]")) return;
      const current = img.getAttribute("src") || "";
      if (!current || img.dataset.darkLogo === current) return; // already our copy
      if (/\.svg(\?|$)/i.test(current)) return;
      if (!sitsOnDarkSurface(img)) return; // logo on a light bar/card: keep its real colours
      img.dataset.lightSrc = current;
      void darkReadyLogo(current).then((out) => { if (img.getAttribute("src") === current && out !== current) { img.dataset.darkLogo = out; img.src = out; } });
    };
    const scan = (root: ParentNode) => { if (root instanceof HTMLImageElement) { if (root.matches(LOGO_SELECTOR)) fix(root); return; } root.querySelectorAll?.<HTMLImageElement>(LOGO_SELECTOR).forEach(fix); };
    scan(document);
    const mo = new MutationObserver((list) => { for (const m of list) { if (m.type === "attributes" && m.target instanceof HTMLImageElement) { if (m.target.matches(LOGO_SELECTOR)) fix(m.target); } else m.addedNodes.forEach((n) => { if (n instanceof Element) scan(n); }); } });
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ["src"] });
    return () => { mo.disconnect(); restore(); };
  }, [dark]);
  return null;
}
