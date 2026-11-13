import { allowedStockHost, cleanFolder, cleanName, detectMediaType, driveFileIdFromLink, isStockProvider, MEDIA_MAX_BYTES, MEDIA_PAGE_SIZE, newFileKey, normalizeOpenverse, normalizePexels, normalizePixabay, normalizeUnsplash, publicMediaUrl, STOCK_PROVIDERS, type StockProvider, type StockResult } from "../../../lib/media-library/core";
import { driveAccessToken, driveConnection, driveOAuthReady, mediaAccess, ok, reply, stockKey, type MediaAccess } from "../../../lib/media-library/server";

export const dynamic = "force-dynamic";

type Row = { id: string; scope_id: string; name: string; folder: string; kind: string; mime: string; size: number; width: number | null; height: number | null; file_key: string; source: string; source_url: string; credit: string; alt: string; created_by: string; created_at: string };
const COLUMNS = "id, scope_id, name, folder, kind, mime, size, width, height, file_key, source, source_url, credit, alt, created_by, created_at";
const toItem = (row: Row) => ({ id: row.id, scopeId: row.scope_id, name: row.name, folder: row.folder, kind: row.kind, mime: row.mime, size: Number(row.size) || 0, width: row.width, height: row.height, url: publicMediaUrl(row.file_key), source: row.source, sourceUrl: row.source_url, credit: row.credit, alt: row.alt, createdBy: row.created_by, createdAt: row.created_at });

/** "agency" / "" = the agency's shared library. Returns null when the person can't use that library. */
function scopeOf(value: unknown, access: MediaAccess) {
  const text = String(value ?? "").trim();
  const scope = text === "agency" ? "" : text.slice(0, 100);
  return access.allowedScopes.has(scope) ? scope : null;
}

async function store(access: MediaAccess, bytes: Uint8Array, meta: { scope: string; name: string; folder?: string; source: string; sourceId?: string; sourceUrl?: string; credit?: string; alt?: string; width?: number; height?: number }) {
  if (bytes.byteLength < 1) throw new Error("That file is empty.");
  if (bytes.byteLength > MEDIA_MAX_BYTES) throw new Error("Files must be 50 MB or smaller.");
  const type = detectMediaType(bytes);
  if (!type) throw new Error("Only images (JPG, PNG, WebP, GIF, AVIF, HEIC), videos (MP4, MOV, WebM) and PDFs can be added.");
  const key = newFileKey(type.ext);
  await access.bucket.put(key, bytes, { httpMetadata: { contentType: type.mime, cacheControl: "public, max-age=31536000, immutable" } });
  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const name = cleanName(meta.name).replace(/\.[a-z0-9]{2,5}$/i, "") || "Untitled";
  const width = Number.isFinite(meta.width) && meta.width! > 0 ? Math.round(meta.width!) : null;
  const height = Number.isFinite(meta.height) && meta.height! > 0 ? Math.round(meta.height!) : null;
  try {
    await access.db.prepare(`INSERT INTO media_library_items (id, owner_id, scope_id, name, folder, kind, mime, size, width, height, file_key, source, source_id, source_url, credit, alt, created_by, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?18)`)
      .bind(id, access.ownerId, meta.scope, name, cleanFolder(meta.folder), type.kind, type.mime, bytes.byteLength, width, height, key, meta.source, String(meta.sourceId || "").slice(0, 200), String(meta.sourceUrl || "").slice(0, 600), String(meta.credit || "").slice(0, 300), String(meta.alt || "").slice(0, 300), access.userLabel.slice(0, 120), now).run();
  } catch (error) { await access.bucket.delete(key).catch(() => undefined); throw error; }
  return toItem({ id, scope_id: meta.scope, name, folder: cleanFolder(meta.folder), kind: type.kind, mime: type.mime, size: bytes.byteLength, width, height, file_key: key, source: meta.source, source_url: String(meta.sourceUrl || ""), credit: String(meta.credit || ""), alt: String(meta.alt || ""), created_by: access.userLabel, created_at: now });
}

async function fetchBytes(url: string, init: RequestInit = {}) {
  const response = await fetch(url, { ...init, redirect: "follow", signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`The file could not be downloaded (HTTP ${response.status}).`);
  if (Number(response.headers.get("content-length") || 0) > MEDIA_MAX_BYTES) throw new Error("Files must be 50 MB or smaller.");
  const bytes = new Uint8Array(await response.arrayBuffer());
  return { bytes, contentType: response.headers.get("content-type") || "" };
}

// ---------- stock ----------
async function stockSearch(access: MediaAccess, provider: StockProvider, query: string, page: number): Promise<{ results: StockResult[]; total: number; needsKey?: boolean }> {
  const key = await stockKey(access.db, access.ownerId, provider);
  if (provider !== "openverse" && !key) return { results: [], total: 0, needsKey: true };
  const q = encodeURIComponent(query);
  if (provider === "unsplash") {
    const response = await fetch(`https://api.unsplash.com/search/photos?query=${q}&per_page=24&page=${page}&content_filter=high`, { headers: { Authorization: `Client-ID ${key}`, "Accept-Version": "v1" }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(response.status === 401 ? "Unsplash rejected the saved key. Check it under Settings → API keys." : `Unsplash search failed (HTTP ${response.status}).`);
    const data = await response.json() as { total?: number; results?: unknown[] };
    return { results: (data.results || []).map(normalizeUnsplash).filter(Boolean) as StockResult[], total: Number(data.total) || 0 };
  }
  if (provider === "pexels") {
    const response = await fetch(`https://api.pexels.com/v1/search?query=${q}&per_page=24&page=${page}`, { headers: { Authorization: key }, signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(response.status === 401 ? "Pexels rejected the saved key. Check it under Settings → API keys." : `Pexels search failed (HTTP ${response.status}).`);
    const data = await response.json() as { total_results?: number; photos?: unknown[] };
    return { results: (data.photos || []).map(normalizePexels).filter(Boolean) as StockResult[], total: Number(data.total_results) || 0 };
  }
  if (provider === "pixabay") {
    const response = await fetch(`https://pixabay.com/api/?key=${encodeURIComponent(key)}&q=${q}&image_type=photo&safesearch=true&per_page=24&page=${page}`, { signal: AbortSignal.timeout(15000) });
    if (!response.ok) throw new Error(response.status === 400 ? "Pixabay rejected the saved key. Check it under Settings → API keys." : `Pixabay search failed (HTTP ${response.status}).`);
    const data = await response.json() as { totalHits?: number; hits?: unknown[] };
    return { results: (data.hits || []).map(normalizePixabay).filter(Boolean) as StockResult[], total: Number(data.totalHits) || 0 };
  }
  const response = await fetch(`https://api.openverse.org/v1/images/?q=${q}&page_size=24&page=${page}&mature=false`, { headers: { "User-Agent": "F2B-Media-Agency-OS/1.0" }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(`Openverse search failed (HTTP ${response.status}). Try again in a minute.`);
  const data = await response.json() as { result_count?: number; results?: unknown[] };
  return { results: (data.results || []).map(normalizeOpenverse).filter(Boolean) as StockResult[], total: Number(data.result_count) || 0 };
}

/** Look the photo up again by id on the server, so the browser can never choose what URL we download. */
async function stockLookup(access: MediaAccess, provider: StockProvider, id: string) {
  const key = await stockKey(access.db, access.ownerId, provider);
  const safeId = encodeURIComponent(id);
  let result: StockResult | null = null;
  if (provider === "unsplash") {
    if (!key) throw new Error("Add an Unsplash key first.");
    const response = await fetch(`https://api.unsplash.com/photos/${safeId}`, { headers: { Authorization: `Client-ID ${key}`, "Accept-Version": "v1" }, signal: AbortSignal.timeout(15000) });
    if (response.ok) result = normalizeUnsplash(await response.json());
    // Unsplash's API terms require this "download" ping whenever a photo is used.
    if (result?.downloadPing) await fetch(result.downloadPing, { headers: { Authorization: `Client-ID ${key}` }, signal: AbortSignal.timeout(10000) }).catch(() => undefined);
  } else if (provider === "pexels") {
    if (!key) throw new Error("Add a Pexels key first.");
    const response = await fetch(`https://api.pexels.com/v1/photos/${safeId}`, { headers: { Authorization: key }, signal: AbortSignal.timeout(15000) });
    if (response.ok) result = normalizePexels(await response.json());
  } else if (provider === "pixabay") {
    if (!key) throw new Error("Add a Pixabay key first.");
    const response = await fetch(`https://pixabay.com/api/?key=${encodeURIComponent(key)}&id=${safeId}`, { signal: AbortSignal.timeout(15000) });
    if (response.ok) result = normalizePixabay(((await response.json()) as { hits?: unknown[] }).hits?.[0]);
  } else {
    const response = await fetch(`https://api.openverse.org/v1/images/${safeId}/`, { headers: { "User-Agent": "F2B-Media-Agency-OS/1.0" }, signal: AbortSignal.timeout(15000) });
    if (response.ok) result = normalizeOpenverse(await response.json());
  }
  if (!result || !allowedStockHost(provider, result.full)) throw new Error("That photo could not be found any more.");
  return result;
}

// ---------- Google Drive ----------
const DRIVE_MEDIA_QUERY = "(mimeType contains 'image/' or mimeType contains 'video/' or mimeType = 'application/pdf' or mimeType = 'application/vnd.google-apps.folder')";
async function driveList(access: MediaAccess, folder: string, query: string, pageToken: string) {
  const token = await driveAccessToken(access.db, access.ownerId);
  if (!token) return { connected: false, files: [] as unknown[], nextPageToken: "" };
  const clauses = [DRIVE_MEDIA_QUERY, "trashed = false"];
  if (query) clauses.push(`name contains '${query.replace(/['\\]/g, "")}'`);
  else clauses.push(`'${/^[A-Za-z0-9_-]{1,100}$/.test(folder) ? folder : "root"}' in parents`);
  const params = new URLSearchParams({ q: clauses.join(" and "), fields: "nextPageToken, files(id, name, mimeType, size, thumbnailLink, iconLink, imageMediaMetadata(width, height))", pageSize: "60", orderBy: "folder, modifiedTime desc", supportsAllDrives: "true", includeItemsFromAllDrives: "true", corpora: "allDrives" });
  if (pageToken) params.set("pageToken", pageToken.slice(0, 500));
  const response = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error(response.status === 403 ? "Google Drive refused access. Reconnect Google Drive and allow file access." : `Google Drive could not be listed (HTTP ${response.status}).`);
  const data = await response.json() as { nextPageToken?: string; files?: Array<Record<string, unknown>> };
  return { connected: true, files: data.files || [], nextPageToken: data.nextPageToken || "" };
}

async function driveImport(access: MediaAccess, idOrLink: string) {
  const fileId = driveFileIdFromLink(idOrLink);
  if (!fileId) throw new Error("Paste a Google Drive file link (Share → Copy link).");
  const token = await driveAccessToken(access.db, access.ownerId).catch(() => null);
  if (token) {
    const metaResponse = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=name,mimeType,size,imageMediaMetadata(width,height)&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(15000) });
    if (metaResponse.ok) {
      const meta = await metaResponse.json() as { name?: string; mimeType?: string; size?: string; imageMediaMetadata?: { width?: number; height?: number } };
      if (Number(meta.size || 0) > MEDIA_MAX_BYTES) throw new Error("That Drive file is over 50 MB.");
      const { bytes } = await fetchBytes(`https://www.googleapis.com/drive/v3/files/${fileId}?alt=media&supportsAllDrives=true`, { headers: { Authorization: `Bearer ${token}` } });
      return { bytes, name: meta.name || "Drive file", width: meta.imageMediaMetadata?.width, height: meta.imageMediaMetadata?.height, fileId };
    }
  }
  // Not connected (or not visible to the connected account): works for files shared as "Anyone with the link".
  const { bytes, contentType } = await fetchBytes(`https://drive.usercontent.google.com/download?id=${fileId}&export=download&confirm=t`);
  if (contentType.includes("text/html")) throw new Error(token ? "That file isn't visible to the connected Google account. Share it with that account or set it to “Anyone with the link”." : "That file is private. Set sharing to “Anyone with the link”, or connect Google Drive.");
  return { bytes, name: "Drive file", fileId };
}

export async function GET(request: Request) {
  const result = await mediaAccess(); if (result.response) return result.response;
  const { access } = result;
  const url = new URL(request.url);
  try {
    if (url.searchParams.has("status")) {
      const providers = await Promise.all(STOCK_PROVIDERS.map(async (item) => ({ id: item.id, label: item.label, ready: !item.needsKey || Boolean(await stockKey(access.db, access.ownerId, item.id)), signup: item.signup })));
      const drive = await driveConnection(access.db, access.ownerId).catch(() => null);
      return ok({ providers, drive: { available: driveOAuthReady(), connected: Boolean(drive), email: drive?.account_email || "" }, clients: access.clients, canUseAgency: access.canUseAgency, isAdmin: access.isAdmin });
    }
    const stock = url.searchParams.get("stock");
    if (stock !== null) {
      if (!isStockProvider(stock)) return reply("Choose a photo library.");
      const query = (url.searchParams.get("q") || "").trim().slice(0, 100);
      if (!query) return ok({ results: [], total: 0 });
      return ok(await stockSearch(access, stock, query, Math.min(Math.max(Number(url.searchParams.get("page")) || 1, 1), 50)));
    }
    if (url.searchParams.has("drive")) {
      return ok(await driveList(access, (url.searchParams.get("folder") || "root").trim(), (url.searchParams.get("q") || "").trim().slice(0, 100), url.searchParams.get("pageToken") || ""));
    }
    // Library listing — one index-backed page at a time.
    const scopeParam = url.searchParams.get("scope") || "agency";
    const cursor = (url.searchParams.get("cursor") || "").slice(0, 40);
    const kind = url.searchParams.get("kind") || "";
    const filters: string[] = ["owner_id = ?1"]; const binds: unknown[] = [access.ownerId];
    if (scopeParam === "all") {
      if (!access.isAdmin) { const scopes = [...access.allowedScopes]; filters.push(`scope_id IN (${scopes.map((_, index) => `?${binds.length + index + 1}`).join(",") || "NULL"})`); binds.push(...scopes); }
    } else {
      const scope = scopeOf(scopeParam, access);
      if (scope === null) return reply("You don't have access to that client's media.", 403);
      filters.push(`scope_id = ?${binds.length + 1}`); binds.push(scope);
    }
    if (cursor) { filters.push(`created_at < ?${binds.length + 1}`); binds.push(cursor); }
    if (["image", "video", "document"].includes(kind)) { filters.push(`kind = ?${binds.length + 1}`); binds.push(kind); }
    const rows = await access.db.prepare(`SELECT ${COLUMNS} FROM media_library_items WHERE ${filters.join(" AND ")} ORDER BY created_at DESC LIMIT ${MEDIA_PAGE_SIZE + 1}`).bind(...binds).all<Row>();
    const list = rows.results || [];
    const items = list.slice(0, MEDIA_PAGE_SIZE).map(toItem);
    return ok({ items, nextCursor: list.length > MEDIA_PAGE_SIZE ? items[items.length - 1]?.createdAt || "" : "" });
  } catch (error) {
    return reply(error instanceof Error ? error.message : "The Media Library could not be loaded.", 502);
  }
}

/** Direct upload: the file is the request body, details are in the query string. */
export async function PUT(request: Request) {
  const result = await mediaAccess(); if (result.response) return result.response;
  const { access } = result;
  const url = new URL(request.url);
  const scope = scopeOf(url.searchParams.get("scope"), access);
  if (scope === null) return reply("You don't have access to that client's media.", 403);
  if (Number(request.headers.get("content-length") || 0) > MEDIA_MAX_BYTES) return reply("Files must be 50 MB or smaller.", 413);
  try {
    const bytes = new Uint8Array(await request.arrayBuffer());
    const item = await store(access, bytes, { scope, name: url.searchParams.get("name") || "Upload", folder: url.searchParams.get("folder") || "", source: "upload", width: Number(url.searchParams.get("w")) || undefined, height: Number(url.searchParams.get("h")) || undefined });
    return ok({ item });
  } catch (error) { return reply(error instanceof Error ? error.message : "The upload failed.", 400); }
}

export async function POST(request: Request) {
  const result = await mediaAccess(); if (result.response) return result.response;
  const { access } = result;
  let body: Record<string, unknown>;
  try { body = await request.json() as Record<string, unknown>; } catch { return reply("Send a valid request."); }
  const action = String(body.action || "");
  try {
    if (action === "importStock") {
      const scope = scopeOf(body.scope, access); if (scope === null) return reply("You don't have access to that client's media.", 403);
      if (!isStockProvider(body.provider)) return reply("Choose a photo library.");
      const photo = await stockLookup(access, body.provider, String(body.id || "").slice(0, 100));
      const { bytes } = await fetchBytes(photo.full);
      const item = await store(access, bytes, { scope, name: photo.alt ? cleanName(photo.alt).slice(0, 80) : `${body.provider} ${photo.id}`, folder: String(body.folder || ""), source: body.provider, sourceId: photo.id, sourceUrl: photo.pageUrl, credit: photo.credit, alt: photo.alt, width: photo.width, height: photo.height });
      return ok({ item });
    }
    if (action === "importDrive") {
      const scope = scopeOf(body.scope, access); if (scope === null) return reply("You don't have access to that client's media.", 403);
      const file = await driveImport(access, String(body.link || body.fileId || ""));
      const item = await store(access, file.bytes, { scope, name: String(body.name || file.name), folder: String(body.folder || ""), source: "google-drive", sourceId: file.fileId, sourceUrl: `https://drive.google.com/file/d/${file.fileId}/view`, width: file.width, height: file.height });
      return ok({ item });
    }
    if (action === "importUrl") {
      const scope = scopeOf(body.scope, access); if (scope === null) return reply("You don't have access to that client's media.", 403);
      let target: URL;
      try { target = new URL(String(body.url || "")); } catch { return reply("Paste a full https:// link to an image, video or PDF."); }
      if (target.protocol !== "https:") return reply("Only https:// links can be imported.");
      if (driveFileIdFromLink(target.toString()) && /google\.com$/.test(target.hostname)) {
        const file = await driveImport(access, target.toString());
        return ok({ item: await store(access, file.bytes, { scope, name: file.name, folder: String(body.folder || ""), source: "google-drive", sourceId: file.fileId, sourceUrl: target.toString(), width: file.width, height: file.height }) });
      }
      const { bytes } = await fetchBytes(target.toString());
      const name = decodeURIComponent(target.pathname.split("/").filter(Boolean).pop() || target.hostname);
      return ok({ item: await store(access, bytes, { scope, name, folder: String(body.folder || ""), source: "link", sourceUrl: target.toString() }) });
    }
    if (action === "update") {
      const id = String(body.id || "");
      const row = await access.db.prepare("SELECT scope_id FROM media_library_items WHERE id = ?1 AND owner_id = ?2").bind(id, access.ownerId).first<{ scope_id: string }>();
      if (!row || !access.allowedScopes.has(row.scope_id)) return reply("That file could not be found.", 404);
      let nextScope = row.scope_id;
      if (body.scope !== undefined) { const scope = scopeOf(body.scope, access); if (scope === null) return reply("You don't have access to that client's media.", 403); nextScope = scope; }
      await access.db.prepare("UPDATE media_library_items SET name = COALESCE(?3, name), folder = COALESCE(?4, folder), alt = COALESCE(?5, alt), scope_id = ?6, updated_at = ?7 WHERE id = ?1 AND owner_id = ?2")
        .bind(id, access.ownerId, body.name === undefined ? null : cleanName(body.name), body.folder === undefined ? null : cleanFolder(body.folder), body.alt === undefined ? null : String(body.alt).slice(0, 300), nextScope, new Date().toISOString()).run();
      const updated = await access.db.prepare(`SELECT ${COLUMNS} FROM media_library_items WHERE id = ?1 AND owner_id = ?2`).bind(id, access.ownerId).first<Row>();
      return ok({ item: updated ? toItem(updated) : null });
    }
    if (action === "delete") {
      const ids = (Array.isArray(body.ids) ? body.ids : [body.id]).map(String).filter((id) => /^[a-f0-9-]{36}$/.test(id)).slice(0, 100);
      if (!ids.length) return reply("Choose files to delete.");
      const rows = await access.db.prepare(`SELECT id, scope_id, file_key FROM media_library_items WHERE owner_id = ?1 AND id IN (${ids.map((_, index) => `?${index + 2}`).join(",")})`).bind(access.ownerId, ...ids).all<{ id: string; scope_id: string; file_key: string }>();
      const allowed = (rows.results || []).filter((row) => access.allowedScopes.has(row.scope_id));
      if (!allowed.length) return reply("Those files could not be found.", 404);
      await access.db.batch(allowed.map((row) => access.db.prepare("DELETE FROM media_library_items WHERE id = ?1 AND owner_id = ?2").bind(row.id, access.ownerId)));
      await access.bucket.delete(allowed.map((row) => row.file_key)).catch(() => undefined);
      return ok({ deleted: allowed.map((row) => row.id) });
    }
    return reply("Unknown Media Library action.");
  } catch (error) {
    return reply(error instanceof Error ? error.message : "That didn't work — please try again.", 400);
  }
}
