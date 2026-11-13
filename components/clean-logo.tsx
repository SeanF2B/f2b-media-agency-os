"use client";

import { useEffect, useState } from "react";

const cache = new Map<string, string>();

// Removes a flat background (usually white) baked into a logo: flood-fills from the image edges,
// making pixels close to the corner colour transparent. Falls back to the original on any failure.
async function stripBackground(src: string): Promise<string> {
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
  const corners = [at(0, 0), at(w - 1, 0), at(0, h - 1), at(w - 1, h - 1)].filter((i) => px[i + 3] > 200);
  if (corners.length < 3) return src; // already transparent
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
  return canvas.toDataURL("image/png");
}

export function useCleanLogo(src?: string | null): string {
  const [out, setOut] = useState(() => (src && cache.get(src)) || src || "");
  useEffect(() => {
    if (!src) { setOut(""); return; }
    const hit = cache.get(src); if (hit) { setOut(hit); return; }
    setOut(src);
    let live = true;
    stripBackground(src).catch(() => src).then((result) => { cache.set(src, result); if (live) setOut(result); });
    return () => { live = false; };
  }, [src]);
  return out;
}

export function CleanLogo({ src, alt, className }: { src: string; alt: string; className?: string }) {
  const clean = useCleanLogo(src);
  return clean ? <img className={className} src={clean} alt={alt} /> : null;
}
