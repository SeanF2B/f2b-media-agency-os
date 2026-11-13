import assert from "node:assert/strict";
import test from "node:test";
import { allowedStockHost, cleanFolder, cleanName, detectMediaType, driveFileIdFromLink, fileKeyFromPublicParam, isMediaFileKey, newFileKey, normalizeOpenverse, normalizePexels, normalizeUnsplash, publicMediaUrl } from "../lib/media-library/core.ts";
import { canOpenPage } from "../lib/sidebar-access.ts";
import { getMemberPermissions } from "../lib/access-permissions.ts";

const bytes = (...parts) => new Uint8Array(parts.flatMap((part) => typeof part === "string" ? [...part].map((c) => c.charCodeAt(0)) : part));

test("files are identified by their contents, and HTML/SVG are refused", () => {
  assert.equal(detectMediaType(bytes([0x89], "PNG", [0x0d, 0x0a, 0x1a, 0x0a]))?.mime, "image/png");
  assert.equal(detectMediaType(bytes([0xff, 0xd8, 0xff, 0xe0]))?.kind, "image");
  assert.equal(detectMediaType(bytes("RIFF", [0, 0, 0, 0], "WEBP"))?.ext, "webp");
  assert.equal(detectMediaType(bytes("GIF89a"))?.mime, "image/gif");
  assert.equal(detectMediaType(bytes([0, 0, 0, 0x18], "ftypqt  "))?.mime, "video/quicktime");
  assert.equal(detectMediaType(bytes([0, 0, 0, 0x18], "ftypisom"))?.mime, "video/mp4");
  assert.equal(detectMediaType(bytes([0, 0, 0, 0x18], "ftypheic"))?.mime, "image/heic");
  assert.equal(detectMediaType(bytes("%PDF-1.7"))?.kind, "document");
  assert.equal(detectMediaType(bytes("<svg xmlns='http://www.w3.org/2000/svg'>")), null);
  assert.equal(detectMediaType(bytes("<!doctype html><script>")), null);
});

test("public links map only to Media Library storage keys", () => {
  const key = newFileKey("jpg");
  assert.ok(isMediaFileKey(key));
  const param = new URL(`https://x.test${publicMediaUrl(key)}`).searchParams.get("f");
  assert.equal(fileKeyFromPublicParam(param), key);
  assert.equal(fileKeyFromPublicParam("../marketing-studio/secret.png"), "");
  assert.equal(fileKeyFromPublicParam("abc.html"), "");
});

test("Google Drive share links of every shape give the file id", () => {
  const id = "1AbCdEfGhIjKlMnOpQrStUvWxYz012345";
  assert.equal(driveFileIdFromLink(`https://drive.google.com/file/d/${id}/view?usp=sharing`), id);
  assert.equal(driveFileIdFromLink(`https://drive.google.com/open?id=${id}`), id);
  assert.equal(driveFileIdFromLink(`https://drive.google.com/uc?export=download&id=${id}`), id);
  assert.equal(driveFileIdFromLink(id), id);
  assert.equal(driveFileIdFromLink(`https://evil.example/file/d/${id}/view`), "");
});

test("stock imports only download from the provider's own image hosts", () => {
  assert.equal(allowedStockHost("unsplash", "https://images.unsplash.com/photo-1?ixid=a&w=2400"), true);
  assert.equal(allowedStockHost("unsplash", "https://169.254.169.254/latest"), false);
  assert.equal(allowedStockHost("pexels", "http://images.pexels.com/a.jpg"), false);
  assert.equal(allowedStockHost("pixabay", "https://cdn.pixabay.com/photo/a.jpg"), true);
});

test("stock results keep the photographer credit", () => {
  const unsplash = normalizeUnsplash({ id: "abc", width: 10, height: 5, alt_description: "roof", urls: { raw: "https://images.unsplash.com/p?ixid=1", regular: "https://images.unsplash.com/r", small: "https://images.unsplash.com/s" }, user: { name: "Ann", links: { html: "https://unsplash.com/@ann" } }, links: { html: "https://unsplash.com/photos/abc", download_location: "https://api.unsplash.com/photos/abc/download" } });
  assert.match(unsplash.credit, /Ann on Unsplash/);
  assert.ok(unsplash.full.startsWith("https://images.unsplash.com/p?ixid=1&w=2400"));
  assert.equal(normalizePexels({ id: 7, photographer: "Bo", src: { large2x: "https://images.pexels.com/x", medium: "m", large: "l" } }).credit, "Photo by Bo on Pexels");
  assert.match(normalizeOpenverse({ id: "o1", url: "https://live.staticflickr.com/x.jpg", title: "Bay", creator: "Cy", license: "by", license_version: "2.0" }).credit, /CC BY 2.0/);
  assert.equal(normalizeUnsplash({}), null);
});

test("names and folders are tidied", () => {
  assert.equal(cleanName("  <b>Roof  photo</b>  "), "bRoof photo/b");
  assert.equal(cleanName(""), "Untitled");
  assert.equal(cleanFolder("Jobs/2026\\Galway"), "Jobs2026Galway");
});

test("Media Library opens for client workers and admins, not for unrelated staff", () => {
  const staff = getMemberPermissions({ id: "s", role: "Staff", permissions: { clients: false } }, "owner");
  assert.equal(canOpenPage("Media Library", staff, true), true);
  assert.equal(canOpenPage("Media Library", staff, false, true), true);
  assert.equal(canOpenPage("Media Library", staff, false, false), false);
});
