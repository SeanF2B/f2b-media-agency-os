// White-label branding (Settings > Branding): two colours and a logo, applied across the whole OS.
import { useSyncExternalStore } from "react";

export type Branding = { primary: string; secondary: string; logo: string; name: string };
export const DEFAULT_BRANDING: Branding = { primary: "#3b82f6", secondary: "#1e3a8a", logo: "", name: "" };

let state: Branding = DEFAULT_BRANDING;
const listeners = new Set<() => void>();
const hex = (value: unknown, fallback: string) => typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value.trim()) ? value.trim().toLowerCase() : fallback;

export function normalizeBranding(raw: Partial<Branding> | undefined | null): Branding {
  return { primary: hex(raw?.primary, DEFAULT_BRANDING.primary), secondary: hex(raw?.secondary, DEFAULT_BRANDING.secondary), logo: typeof raw?.logo === "string" && raw.logo.startsWith("data:image/") ? raw.logo : "", name: String(raw?.name || "").slice(0, 60) };
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
