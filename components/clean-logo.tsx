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
  const corners = [at(0, 0), at(w - 1, 0), at(0, h - 1), at(w - 1, h - 1)].filter((i) => px[i + 3] > 200);
  if (corners.length < 3) return cropped(); // already transparent
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
  if (cleared > w * h * 0.97) return src; // would erase the whole logo
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
