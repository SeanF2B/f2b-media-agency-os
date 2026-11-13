// Media Library — pure helpers shared by the API routes and tests (no Cloudflare imports here).
// scope_id = client id, or '' for the agency's own shared library. Every list query is index-backed.

export const MEDIA_MAX_BYTES = 50_000_000;
export const MEDIA_PAGE_SIZE = 60;

export const MEDIA_SCHEMA_SQL = [
  `CREATE TABLE IF NOT EXISTS media_library_items (
    id TEXT PRIMARY KEY NOT NULL,
    owner_id TEXT NOT NULL,
    scope_id TEXT NOT NULL DEFAULT '',
    name TEXT NOT NULL,
    folder TEXT NOT NULL DEFAULT '',
    kind TEXT NOT NULL CHECK (kind IN ('image','video','document')),
    mime TEXT NOT NULL,
    size INTEGER NOT NULL DEFAULT 0,
    width INTEGER,
    height INTEGER,
    file_key TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'upload',
    source_id TEXT NOT NULL DEFAULT '',
    source_url TEXT NOT NULL DEFAULT '',
    credit TEXT NOT NULL DEFAULT '',
    alt TEXT NOT NULL DEFAULT '',
    created_by TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS media_library_scope_idx ON media_library_items(owner_id, scope_id, created_at DESC)",
  "CREATE INDEX IF NOT EXISTS media_library_owner_idx ON media_library_items(owner_id, created_at DESC)",
  `CREATE TABLE IF NOT EXISTS google_drive_connections (
    owner_id TEXT PRIMARY KEY NOT NULL,
    encrypted_refresh_token TEXT NOT NULL,
    token_iv TEXT NOT NULL,
    account_email TEXT NOT NULL DEFAULT '',
    connected_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
];

export type MediaKind = "image" | "video" | "document";
export type DetectedType = { mime: string; ext: string; kind: MediaKind };

const ascii = (bytes: Uint8Array, start: number, end: number) => String.fromCharCode(...bytes.slice(start, end));

/** Identify a file by its contents (never by its name or the browser's claim). SVG/HTML are refused on purpose. */
export function detectMediaType(bytes: Uint8Array): DetectedType | null {
  if (bytes.length >= 8 && bytes[0] === 0x89 && ascii(bytes, 1, 4) === "PNG") return { mime: "image/png", ext: "png", kind: "image" };
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime: "image/jpeg", ext: "jpg", kind: "image" };
  if (bytes.length >= 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 12) === "WEBP") return { mime: "image/webp", ext: "webp", kind: "image" };
  if (bytes.length >= 6 && (ascii(bytes, 0, 6) === "GIF87a" || ascii(bytes, 0, 6) === "GIF89a")) return { mime: "image/gif", ext: "gif", kind: "image" };
  if (bytes.length >= 12 && ascii(bytes, 4, 8) === "ftyp") {
    const brand = ascii(bytes, 8, 12);
    if (/^(avif|avis)$/.test(brand)) return { mime: "image/avif", ext: "avif", kind: "image" };
    if (/^(heic|heix|mif1|msf1)$/.test(brand)) return { mime: "image/heic", ext: "heic", kind: "image" };
    if (brand === "qt  ") return { mime: "video/quicktime", ext: "mov", kind: "video" };
    return { mime: "video/mp4", ext: "mp4", kind: "video" };
  }
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return { mime: "video/webm", ext: "webm", kind: "video" };
  if (bytes.length >= 5 && ascii(bytes, 0, 5) === "%PDF-") return { mime: "application/pdf", ext: "pdf", kind: "document" };
  return null;
}

const FILE_KEY = /^media-library\/[a-f0-9-]{36}\.(png|jpg|webp|gif|avif|heic|mov|mp4|webm|pdf)$/;
export const newFileKey = (ext: string) => `media-library/${crypto.randomUUID()}.${ext}`;
export const isMediaFileKey = (key: string) => FILE_KEY.test(key);
/** Public, unguessable link (like Drive's "anyone with the link"). Served without a database read. */
export const publicMediaUrl = (key: string) => `/api/marketing-public/media?f=${encodeURIComponent(key.slice("media-library/".length))}`;
export const fileKeyFromPublicParam = (value: string) => { const key = `media-library/${value}`; return isMediaFileKey(key) ? key : ""; };

export function cleanName(value: unknown, fallback = "Untitled") {
  const text = String(value ?? "").replace(/[\u0000-\u001f<>]/g, "").replace(/\s+/g, " ").trim().slice(0, 140);
  return text || fallback;
}
export const cleanFolder = (value: unknown) => String(value ?? "").replace(/[\u0000-\u001f<>/\\]/g, "").replace(/\s+/g, " ").trim().slice(0, 60);

/** Pull a Google Drive file id out of any of the share-link shapes people paste. */
export function driveFileIdFromLink(value: string) {
  const text = String(value || "").trim();
  if (/^[A-Za-z0-9_-]{20,}$/.test(text)) return text;
  let url: URL;
  try { url = new URL(text); } catch { return ""; }
  if (!/(^|\.)google\.com$/.test(url.hostname) && url.hostname !== "drive.usercontent.google.com") return "";
  const path = /\/(?:file\/d|document\/d|presentation\/d|spreadsheets\/d)\/([A-Za-z0-9_-]{20,})/.exec(url.pathname);
  if (path) return path[1];
  const id = url.searchParams.get("id") || "";
  return /^[A-Za-z0-9_-]{20,}$/.test(id) ? id : "";
}

// ---------- stock photo providers ----------
export type StockProvider = "unsplash" | "pexels" | "pixabay" | "openverse";
export const STOCK_PROVIDERS: Array<{ id: StockProvider; label: string; needsKey: boolean; keyLabel: string; signup: string }> = [
  { id: "unsplash", label: "Unsplash", needsKey: true, keyLabel: "Unsplash", signup: "https://unsplash.com/oauth/applications" },
  { id: "pexels", label: "Pexels", needsKey: true, keyLabel: "Pexels", signup: "https://www.pexels.com/api/new/" },
  { id: "pixabay", label: "Pixabay", needsKey: true, keyLabel: "Pixabay", signup: "https://pixabay.com/api/docs/" },
  { id: "openverse", label: "Openverse", needsKey: false, keyLabel: "", signup: "https://openverse.org" },
];
export const isStockProvider = (value: unknown): value is StockProvider => STOCK_PROVIDERS.some((item) => item.id === value);

export type StockResult = { provider: StockProvider; id: string; thumb: string; preview: string; full: string; width: number; height: number; alt: string; credit: string; creditUrl: string; pageUrl: string; downloadPing?: string };

const str = (value: unknown) => (typeof value === "string" ? value : "");
const num = (value: unknown) => (typeof value === "number" && Number.isFinite(value) ? value : 0);
type Obj = Record<string, unknown>;
const obj = (value: unknown): Obj => (value && typeof value === "object" ? value as Obj : {});

export function normalizeUnsplash(photo: unknown): StockResult | null {
  const p = obj(photo); const urls = obj(p.urls); const user = obj(p.user); const links = obj(p.links);
  if (!str(p.id) || !str(urls.regular)) return null;
  return { provider: "unsplash", id: str(p.id), thumb: str(urls.small) || str(urls.thumb), preview: str(urls.regular), full: `${str(urls.raw) || str(urls.full)}${str(urls.raw) ? "&w=2400&q=85&fm=jpg" : ""}`, width: num(p.width), height: num(p.height), alt: str(p.alt_description) || str(p.description), credit: `Photo by ${str(user.name) || "Unsplash contributor"} on Unsplash`, creditUrl: `${str(obj(user.links).html) || "https://unsplash.com"}?utm_source=f2b_media&utm_medium=referral`, pageUrl: str(links.html), downloadPing: str(links.download_location) };
}
export function normalizePexels(photo: unknown): StockResult | null {
  const p = obj(photo); const src = obj(p.src);
  if (!p.id || !str(src.large2x)) return null;
  return { provider: "pexels", id: String(p.id), thumb: str(src.medium), preview: str(src.large), full: str(src.large2x) || str(src.original), width: num(p.width), height: num(p.height), alt: str(p.alt), credit: `Photo by ${str(p.photographer) || "Pexels contributor"} on Pexels`, creditUrl: str(p.photographer_url) || "https://www.pexels.com", pageUrl: str(p.url) };
}
export function normalizePixabay(hit: unknown): StockResult | null {
  const h = obj(hit);
  if (!h.id || !str(h.webformatURL)) return null;
  return { provider: "pixabay", id: String(h.id), thumb: str(h.previewURL) || str(h.webformatURL), preview: str(h.webformatURL), full: str(h.largeImageURL) || str(h.webformatURL), width: num(h.imageWidth), height: num(h.imageHeight), alt: str(h.tags), credit: `Image by ${str(h.user) || "Pixabay contributor"} from Pixabay`, creditUrl: str(h.pageURL) || "https://pixabay.com", pageUrl: str(h.pageURL) };
}
export function normalizeOpenverse(item: unknown): StockResult | null {
  const i = obj(item);
  if (!str(i.id) || !str(i.url)) return null;
  const license = [str(i.license).toUpperCase(), str(i.license_version)].filter(Boolean).join(" ");
  return { provider: "openverse", id: str(i.id), thumb: str(i.thumbnail) || str(i.url), preview: str(i.thumbnail) || str(i.url), full: str(i.url), width: num(i.width), height: num(i.height), alt: str(i.title), credit: `“${str(i.title) || "Untitled"}” by ${str(i.creator) || "unknown"}${license ? ` · CC ${license.replace(/^CC\s*/i, "")}` : ""}`, creditUrl: str(i.foreign_landing_url) || str(i.creator_url), pageUrl: str(i.foreign_landing_url) };
}

/** Only fetch imported images from the provider CDNs we asked (stops the import endpoint being used as a URL fetcher). */
export function allowedStockHost(provider: StockProvider, url: string) {
  let host = "";
  try { const parsed = new URL(url); if (parsed.protocol !== "https:") return false; host = parsed.hostname; } catch { return false; }
  if (provider === "unsplash") return host === "images.unsplash.com";
  if (provider === "pexels") return host === "images.pexels.com";
  if (provider === "pixabay") return host === "pixabay.com" || host === "cdn.pixabay.com";
  return true; // Openverse URLs come from its own API response for the requested id, never from the browser.
}
