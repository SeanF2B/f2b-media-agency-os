// White-label branding (Settings > Branding): two colours and a logo, applied across the whole OS.
import { useSyncExternalStore } from "react";

export type Branding = { primary: string; secondary: string; logo: string; name: string };
export const DEFAULT_BRANDING: Branding = { primary: "#3b82f6", secondary: "#1e3a8a", logo: "", name: "" };

let state: Branding = DEFAULT_BRANDING;
const listeners = new Set<() => void>();
const hex = (value: unknown, fallback: string) => typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value.trim()) ? value.trim().toLowerCase() : fallback;

export function normalizeBranding(raw: Partial<Branding> | undefined | null): Branding {
  return { primary: hex(raw?.primary, DEFAULT_BRANDING.primary), secondary: hex(raw?.secondary, DEFAULT_BRANDING.secondary), logo: typeof raw?.logo === "string" && /^(data:image\/|https:\/\/|\/(?!\/))/.test(raw.logo) ? raw.logo : "", name: String(raw?.name || "").slice(0, 60) };
}
export function applyBranding(raw: Partial<Branding> | undefined | null) {
  const next = normalizeBranding(raw);
  if (next.primary === state.primary && next.secondary === state.secondary && next.logo === state.logo && next.name === state.name) return;
  state = next;
  if (typeof document !== "undefined") {
    const root = document.documentElement.style;
    root.setProperty("--brand-primary", next.primary); root.setProperty("--brand-secondary", next.secondary);
  }
  listeners.forEach((listener) => listener());
}
export const useBranding = () => useSyncExternalStore((cb) => { listeners.add(cb); return () => { listeners.delete(cb); }; }, () => state, () => DEFAULT_BRANDING);

/** Resize an uploaded logo to at most 256px and return a PNG data URL (kept small so it can live in the workspace settings). */
export async function logoFileToDataUrl(file: File): Promise<string> {
  if (!/^image\//.test(file.type)) throw new Error("Choose an image file (PNG, JPG, SVG or WebP).");
  if (file.size > 4 * 1024 * 1024) throw new Error("That image is over 4 MB. Choose a smaller logo.");
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => { const el = new Image(); el.onload = () => resolve(el); el.onerror = () => reject(new Error("That image could not be read.")); el.src = url; });
    const scale = Math.min(1, 256 / Math.max(img.naturalWidth || 256, img.naturalHeight || 256));
    const canvas = document.createElement("canvas"); canvas.width = Math.max(1, Math.round((img.naturalWidth || 256) * scale)); canvas.height = Math.max(1, Math.round((img.naturalHeight || 256) * scale));
    canvas.getContext("2d")?.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL("image/png");
  } finally { URL.revokeObjectURL(url); }
}

/** Pull a primary + secondary colour out of a logo (data URL or same-origin URL). Ignores transparent, white, black and grey pixels. */
const toHex = (r: number, g: number, b: number) => "#" + [r, g, b].map((v) => Math.max(0, Math.min(255, Math.round(v))).toString(16).padStart(2, "0")).join("");
const colourCache = new Map<string, { primary: string; secondary: string } | null>();
export async function extractLogoColours(src: string): Promise<{ primary: string; secondary: string } | null> {
  if (!src || typeof document === "undefined") return null;
  if (colourCache.has(src)) return colourCache.get(src)!;
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => { const el = new Image(); if (!src.startsWith("data:")) el.crossOrigin = "anonymous"; el.onload = () => resolve(el); el.onerror = () => reject(new Error("load")); el.src = src; });
    const size = 64, canvas = document.createElement("canvas"); canvas.width = size; canvas.height = size;
    const ctx = canvas.getContext("2d", { willReadFrequently: true }); if (!ctx) return null;
    const scale = Math.min(size / (img.naturalWidth || size), size / (img.naturalHeight || size));
    ctx.drawImage(img, 0, 0, Math.max(1, Math.round((img.naturalWidth || size) * scale)), Math.max(1, Math.round((img.naturalHeight || size) * scale)));
    const data = ctx.getImageData(0, 0, size, size).data;
    const bins = new Map<number, { n: number; c: number; r: number; g: number; b: number }>();
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3]; if (a < 200) continue;
      const r = data[i], g = data[i + 1], b = data[i + 2], max = Math.max(r, g, b), min = Math.min(r, g, b), sat = max === 0 ? 0 : (max - min) / max;
      if (max > 242 && min > 225) continue;          // white
      if (max < 40) continue;                         // black
      if (sat < 0.22) continue;                       // grey
      const key = ((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4), bin = bins.get(key) || { n: 0, c: 0, r: 0, g: 0, b: 0 };
      bin.c += 1; bin.n += 1 + sat; bin.r += r; bin.g += g; bin.b += b; bins.set(key, bin);
    }
    const ranked = [...bins.values()].sort((x, y) => y.n - x.n).map((v) => ({ n: v.n, r: v.r / v.c, g: v.g / v.c, b: v.b / v.c }));
    if (!ranked.length) { colourCache.set(src, null); return null; }
    const first = ranked[0], dist = (p: { r: number; g: number; b: number }, q: { r: number; g: number; b: number }) => Math.hypot(p.r - q.r, p.g - q.g, p.b - q.b);
    const other = ranked.find((c) => dist(c, first) > 90);
    const primary = toHex(first.r, first.g, first.b);
    const secondary = other ? toHex(other.r, other.g, other.b) : toHex(first.r * 0.55, first.g * 0.55, first.b * 0.55);
    const result = { primary, secondary }; colourCache.set(src, result); return result;
  } catch { colourCache.set(src, null); return null; }
}
