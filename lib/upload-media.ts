// Upload a file to the Media Library (R2) for an account and get its public link back.
// Used for service pictures on booking pages and for photo / file attachments in Conversations.
export type UploadedMedia = { url: string; name: string; mime: string; kind: string; size: number };
export async function uploadToMedia(file: File, scope: string, folder: string): Promise<UploadedMedia> {
  if (file.size > 50 * 1024 * 1024) throw new Error("Files must be 50 MB or smaller.");
  const q = new URLSearchParams({ scope: scope || "agency", name: file.name.replace(/\.[^.]+$/, "").slice(0, 80) || "Upload", folder });
  const res = await fetch(`/api/media-library?${q}`, { method: "PUT", headers: { "content-type": file.type || "application/octet-stream" }, body: file });
  const json = await res.json().catch(() => ({})) as { item?: { url: string; name: string; mime: string; kind: string; size: number }; error?: string };
  if (!res.ok || !json.item) throw new Error(json.error || "The upload failed.");
  return { url: json.item.url, name: json.item.name, mime: json.item.mime, kind: json.item.kind, size: json.item.size };
}
