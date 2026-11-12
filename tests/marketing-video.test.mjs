import test from "node:test";
import assert from "node:assert/strict";
import { normalizeMarketingVideo } from "../lib/marketing-video.ts";
import { normalizeMarketingSections, renderMarketingSectionsHtml } from "../lib/marketing-sections.ts";

test("marketing video links are converted only to allowlisted YouTube and Vimeo embeds", () => {
  assert.deepEqual(normalizeMarketingVideo("https://youtu.be/abcdefghijk?t=40"), {
    kind: "youtube",
    sourceUrl: "https://youtu.be/abcdefghijk",
    embedUrl: "https://www.youtube-nocookie.com/embed/abcdefghijk",
  });
  assert.deepEqual(normalizeMarketingVideo("https://player.vimeo.com/video/123456?h=AbC123"), {
    kind: "vimeo",
    sourceUrl: "https://vimeo.com/123456?h=AbC123",
    embedUrl: "https://player.vimeo.com/video/123456?h=AbC123",
  });
  assert.equal(normalizeMarketingVideo("https://youtube.com.evil.test/watch?v=abcdefghijk"), null);
  assert.equal(normalizeMarketingVideo("https://youtube.com/watch?v=short"), null);
  assert.equal(normalizeMarketingVideo("https://vimeo.com/123?h=%3Cscript%3E"), null);
});

test("marketing video files require HTTPS and a supported media extension", () => {
  assert.deepEqual(normalizeMarketingVideo("https://cdn.example/video.mp4?token=abc#frame"), {
    kind: "file",
    sourceUrl: "https://cdn.example/video.mp4?token=abc",
  });
  assert.equal(normalizeMarketingVideo("http://cdn.example/video.mp4"), null);
  assert.equal(normalizeMarketingVideo("https://cdn.example/video.html"), null);
  assert.equal(normalizeMarketingVideo("https://user@cdn.example/video.mp4"), null);
});

test("published video blocks emit safe native players and escaped iframe titles", () => {
  const sections = normalizeMarketingSections([
    { type: "video", heading: "<script>not markup</script>", videoUrl: "https://www.youtube.com/watch?v=abcdefghijk" },
    { type: "video", heading: "Customer story", videoUrl: "https://cdn.example/customer.webm" },
    { type: "video", videoUrl: "javascript:alert(1)" },
  ]);
  assert.equal(sections[2].videoUrl, "");
  const html = renderMarketingSectionsHtml(sections, "video-test");
  assert.match(html, /youtube-nocookie\.com\/embed\/abcdefghijk/);
  assert.match(html, /title="&lt;script&gt;not markup&lt;\/script&gt;"/);
  assert.match(html, /<video controls playsinline preload="metadata" src="https:\/\/cdn\.example\/customer\.webm"><\/video>/);
  assert.doesNotMatch(html, /javascript:/i);
});
