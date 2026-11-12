export const MARKETING_SUBMISSION_FILE_MAX_BYTES = 5 * 1024 * 1024;
export const MARKETING_SUBMISSION_TOTAL_MAX_BYTES = 5 * 1024 * 1024 + 64 * 1024;

export type MarketingSubmissionFileType = { ext: "pdf" | "png" | "jpg" | "webp"; mime: "application/pdf" | "image/png" | "image/jpeg" | "image/webp" };

export function detectMarketingSubmissionFileType(bytes: Uint8Array): MarketingSubmissionFileType | null {
  const starts = (signature: number[]) => signature.every((value, index) => bytes[index] === value);
  if (starts([0x25, 0x50, 0x44, 0x46, 0x2d])) return { ext: "pdf", mime: "application/pdf" };
  if (starts([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])) return { ext: "png", mime: "image/png" };
  if (starts([0xff, 0xd8, 0xff])) return { ext: "jpg", mime: "image/jpeg" };
  if (bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP") return { ext: "webp", mime: "image/webp" };
  return null;
}

export function sanitizeMarketingSubmissionFilename(value: unknown) {
  const name = String(value || "upload").replace(/\u0000/g, "").replace(/[\\/\u0001-\u001f\u007f]/g, "_").trim().slice(0, 120);
  return name || "upload";
}

export function marketingSubmissionFilePrefix(ownerId: string, submissionId: string) {
  return `marketing-submissions/${encodeURIComponent(ownerId)}/${submissionId}/`;
}

export function marketingSubmissionFileKeys(ownerId: string, submissionId: string, rawData: unknown) {
  let data: { files?: Array<{ id?: string; mime?: string }> };
  try {
    const parsed = typeof rawData === "string" ? JSON.parse(rawData) : rawData;
    data = parsed && typeof parsed === "object" ? parsed as typeof data : {};
  } catch { return []; }
  const extensions: Record<string, string> = { "application/pdf": "pdf", "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
  return (Array.isArray(data.files) ? data.files : [])
    .filter((file) => /^[\w-]{1,120}$/.test(String(file.id || "")) && extensions[String(file.mime || "")])
    .map((file) => `${marketingSubmissionFilePrefix(ownerId, submissionId)}${file.id}.${extensions[String(file.mime)]}`);
}
