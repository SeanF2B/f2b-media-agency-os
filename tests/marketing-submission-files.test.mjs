import test from "node:test";
import assert from "node:assert/strict";
import { detectMarketingSubmissionFileType, marketingSubmissionFileKeys, marketingSubmissionFilePrefix, sanitizeMarketingSubmissionFilename } from "../lib/marketing-submission-files.ts";

test("submission uploads accept only recognized PDF and image signatures", () => {
  assert.deepEqual(detectMarketingSubmissionFileType(Uint8Array.from([0x25, 0x50, 0x44, 0x46, 0x2d, 0x31])), { ext: "pdf", mime: "application/pdf" });
  assert.deepEqual(detectMarketingSubmissionFileType(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])), { ext: "png", mime: "image/png" });
  assert.deepEqual(detectMarketingSubmissionFileType(Uint8Array.from([0xff, 0xd8, 0xff, 0x00])), { ext: "jpg", mime: "image/jpeg" });
  assert.deepEqual(detectMarketingSubmissionFileType(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50])), { ext: "webp", mime: "image/webp" });
  assert.equal(detectMarketingSubmissionFileType(Uint8Array.from([0x4d, 0x5a])), null);
});

test("submission file names and object keys are safe and owner scoped", () => {
  assert.equal(sanitizeMarketingSubmissionFilename("../lead\\private.pdf"), ".._lead_private.pdf");
  assert.equal(sanitizeMarketingSubmissionFilename("\u0000"), "upload");
  assert.equal(marketingSubmissionFilePrefix("owner/example", "submission-1"), "marketing-submissions/owner%2Fexample/submission-1/");
});

test("deletion only produces keys for valid attachment ids and supported MIME types", () => {
  const data = JSON.stringify({ files: [
    { id: "file-1", mime: "application/pdf" },
    { id: "file-2", mime: "image/jpeg" },
    { id: "../other-owner/file", mime: "image/png" },
    { id: "file-3", mime: "text/html" },
  ] });
  assert.deepEqual(marketingSubmissionFileKeys("owner/a", "submission-1", data), [
    "marketing-submissions/owner%2Fa/submission-1/file-1.pdf",
    "marketing-submissions/owner%2Fa/submission-1/file-2.jpg",
  ]);
  assert.deepEqual(marketingSubmissionFileKeys("owner", "submission-1", "not JSON"), []);
});
