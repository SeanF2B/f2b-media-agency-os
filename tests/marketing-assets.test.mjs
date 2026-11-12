import test from "node:test";
import assert from "node:assert/strict";
import { detectMarketingImageType, isMarketingImageKey, marketingImageKeyFromUrl, marketingImageOwnerPrefix, MARKETING_IMAGE_MAX_BYTES, uploadedMarketingImageUrl } from "../lib/marketing-assets.ts";

test("uploaded marketing images accept supported file signatures rather than client MIME claims", () => {
  assert.deepEqual(detectMarketingImageType(new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), { mime: "image/png", ext: "png" });
  assert.deepEqual(detectMarketingImageType(new Uint8Array([0xff, 0xd8, 0xff])), { mime: "image/jpeg", ext: "jpg" });
  const webp = new Uint8Array(12); webp.set(new TextEncoder().encode("RIFF"), 0); webp.set(new TextEncoder().encode("WEBP"), 8);
  assert.deepEqual(detectMarketingImageType(webp), { mime: "image/webp", ext: "webp" });
  assert.equal(detectMarketingImageType(new TextEncoder().encode("<svg onload=alert(1)>")), null);
  assert.equal(MARKETING_IMAGE_MAX_BYTES, 1_000_000);
});

test("uploaded marketing image keys are random, owner-namespaced and encoded in the editor URL", async () => {
  const first = await marketingImageOwnerPrefix("owner-one");
  const second = await marketingImageOwnerPrefix("owner-two");
  assert.notEqual(first, second);
  const key = `${first}123e4567-e89b-12d3-a456-426614174000.png`;
  assert.equal(isMarketingImageKey(key), true);
  const url = uploadedMarketingImageUrl(key);
  assert.equal(marketingImageKeyFromUrl(url), key);
  assert.equal(marketingImageKeyFromUrl(`/api/marketing-studio/assets?image=${encodeURIComponent(`${second}123e4567-e89b-12d3-a456-426614174000.png`)}`), `${second}123e4567-e89b-12d3-a456-426614174000.png`);
  assert.equal(isMarketingImageKey("marketing-studio/../public.svg"), false);
  assert.equal(marketingImageKeyFromUrl("https://example.com/api/marketing-studio/assets?image=bad"), "");
});
