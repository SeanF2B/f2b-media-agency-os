export const MARKETING_IMAGE_MAX_BYTES = 1_000_000;

export function detectMarketingImageType(bytes: Uint8Array) {
  if (bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a) return { mime: "image/png", ext: "png" };
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return { mime: "image/jpeg", ext: "jpg" };
  if (bytes.length >= 12 && new TextDecoder().decode(bytes.slice(0, 4)) === "RIFF" && new TextDecoder().decode(bytes.slice(8, 12)) === "WEBP") return { mime: "image/webp", ext: "webp" };
  return null;
}

export async function marketingImageOwnerPrefix(ownerId: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(ownerId));
  return `marketing-studio/${Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("")}/`;
}

export function isMarketingImageKey(key: string) {
  return /^marketing-studio\/[a-f0-9]{64}\/[a-f0-9-]{36}\.(png|jpg|webp)$/.test(key);
}

export function uploadedMarketingImageUrl(key: string) {
  return `/api/marketing-studio/assets?image=${encodeURIComponent(key)}`;
}

export function marketingImageKeyFromUrl(value: string) {
  const match = /^\/api\/marketing-studio\/assets\?image=(marketing-studio%2F[a-f0-9]{64}%2F[a-f0-9-]{36}\.(?:png|jpg|webp))$/.exec(value);
  return match ? decodeURIComponent(match[1]) : "";
}
