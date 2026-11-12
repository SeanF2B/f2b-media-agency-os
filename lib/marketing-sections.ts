import { isMarketingImageKey, marketingImageKeyFromUrl } from "./marketing-assets.ts";
import { normalizeMarketingColumns, renderMarketingColumnsHtml } from "./marketing-columns.ts";
import { normalizeMarketingBlockStyle } from "./marketing-design.ts";
import { normalizeMarketingVideo } from "./marketing-video.ts";
import type { MarketingVisibility } from "./marketing-rules.ts";

export type MarketingSection = {
  type: string;
  heading: string;
  body: string;
  imageUrl: string;
  imageAlt: string;
  videoUrl: string;
  embeddedAssetId?: string;
  buttonLabel: string;
  buttonUrl: string;
  style: ReturnType<typeof normalizeMarketingBlockStyle>;
  columns?: ReturnType<typeof normalizeMarketingColumns>;
  layout?: "stack" | "two-column" | "three-column";
  children?: MarketingSection[];
  showWhen?: MarketingVisibility;
};

function normalizeSectionVisibility(value: unknown): MarketingVisibility | undefined {
  if (!value || typeof value !== "object") return undefined;
  const rule = value as Record<string, unknown>;
  const conditions = Array.isArray(rule.conditions) ? rule.conditions : typeof rule.fieldId === "string" ? [rule] : [];
  const normalized = conditions.slice(0, 8).flatMap((item) => {
    if (!item || typeof item !== "object") return [];
    const condition = item as Record<string, unknown>;
    const fieldId = String(condition.fieldId || "").slice(0, 64);
    if (!/^[A-Za-z0-9_-]{1,64}$/.test(fieldId)) return [];
    const operator = ["equals", "notEquals", "greaterThan", "lessThan", "contains", "isEmpty", "isNotEmpty"].includes(String(condition.operator)) ? String(condition.operator) : "equals";
    return [{ fieldId, operator, value: String(condition.value ?? condition.equals ?? "").slice(0, 160) }];
  });
  return normalized.length ? { mode: rule.mode === "or" ? "or" : "and", conditions: normalized } : undefined;
}

export function normalizeMarketingSections(input: unknown, depth = 0): MarketingSection[] {
  if (!Array.isArray(input)) return [];
  return input.filter((raw) => !(depth > 0 && raw && typeof raw === "object" && (raw as Record<string, unknown>).type === "container")).slice(0, 30).map((raw) => {
    const item = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    const safeUrl = (value: unknown) => {
      try {
        const url = new URL(String(value || ""));
        return url.protocol === "https:" ? url.toString().slice(0, 2000) : "";
      } catch {
        return "";
      }
    };
    const rawImageUrl = String(item.imageUrl || "");
    const uploadedImage = Boolean(marketingImageKeyFromUrl(rawImageUrl));
    const columns = normalizeMarketingColumns(item.columns);
    const allowedTypes = ["hero", "text", "image", "video", "embed", "button", "faq", "testimonial", "pricing", "columns", ...(depth === 0 ? ["container"] : [])];
    const type = allowedTypes.includes(String(item.type)) ? String(item.type) : "text";
    const children = type === "container" && depth === 0 ? normalizeMarketingSections(item.children, depth + 1).filter((child) => child.type !== "container").slice(0, 12) : [];
    return {
      type,
      heading: String(item.heading || "").slice(0, 160),
      body: String(item.body || "").slice(0, 4000),
      imageUrl: uploadedImage ? rawImageUrl : safeUrl(rawImageUrl),
      imageAlt: String(item.imageAlt || "").slice(0, 300),
      videoUrl: normalizeMarketingVideo(item.videoUrl)?.sourceUrl || "",
      ...(String(item.embeddedAssetId || "").match(/^[A-Za-z0-9_-]{8,80}$/) ? { embeddedAssetId: String(item.embeddedAssetId) } : {}),
      buttonLabel: String(item.buttonLabel || "Learn more").slice(0, 80),
      buttonUrl: safeUrl(item.buttonUrl),
      style: normalizeMarketingBlockStyle(item.style),
      ...(normalizeSectionVisibility(item.showWhen) ? { showWhen: normalizeSectionVisibility(item.showWhen) } : {}),
      ...(columns.length ? { columns } : {}),
      ...(type === "container" ? {
        layout: ["stack", "two-column", "three-column"].includes(String(item.layout)) ? item.layout as MarketingSection["layout"] : "stack",
        children,
      } : {}),
    };
  });
}

export function flattenMarketingSections(sections: MarketingSection[]): MarketingSection[] {
  return sections.flatMap((section) => [section, ...(section.children || [])]);
}

const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

export function renderMarketingFaqStructuredData(sections: MarketingSection[]): string {
  const questions = flattenMarketingSections(sections)
    .filter((section) => section.type === "faq" && section.heading.trim() && section.body.trim())
    .map((section) => ({
      "@type": "Question",
      name: section.heading,
      acceptedAnswer: { "@type": "Answer", text: section.body },
    }));
  if (!questions.length) return "";
  const json = JSON.stringify({ "@context": "https://schema.org", "@type": "FAQPage", mainEntity: questions })
    .replace(/[<>&\u2028\u2029]/g, (char) => ({ "<": "\\u003c", ">": "\\u003e", "&": "\\u0026", "\u2028": "\\u2028", "\u2029": "\\u2029" })[char]!);
  return `<script type="application/ld+json">${json}</script>`;
}
export function renderMarketingSectionsHtml(sections: MarketingSection[], slug: string, embeddedAssets: ReadonlyMap<string, { slug: string; kind: string }> = new Map()): string {
  let nextBlockIndex = 0;
  const safeHttps = (value: unknown) => {
    try { const url = new URL(String(value || "")); return url.protocol === "https:" ? url.toString() : ""; } catch { return ""; }
  };
  const renderBlock = (section: MarketingSection): string => {
    const blockClass = `marketing-published-block-${nextBlockIndex++}`;
    const sectionVisibility = section.showWhen?.conditions?.length
      ? ` data-section-show-rules="${escapeHtml(JSON.stringify(section.showWhen.conditions))}" data-section-show-mode="${section.showWhen.mode === "or" ? "or" : "and"}"`
      : "";
    const title = section.heading ? `<h2>${escapeHtml(section.heading)}</h2>` : "";
    const copy = section.body ? `<p>${escapeHtml(section.body)}</p>` : "";
    const href = safeHttps(section.buttonUrl);
    const link = href ? `<a class="cta" href="${escapeHtml(href)}">${escapeHtml(section.buttonLabel || "Learn more")}</a>` : "";
    if (section.type === "container") {
      const layout = section.layout === "two-column" ? "two" : section.layout === "three-column" ? "three" : "stack";
      return `<section class="block container-block ${blockClass}"${sectionVisibility}>${title}${copy}<div class="container-layout container-layout-${layout}">${(section.children || []).map(renderBlock).join("")}</div></section>`;
    }
    if (section.type === "columns") return `<section class="block columns-block ${blockClass}"${sectionVisibility}>${title}${copy}${renderMarketingColumnsHtml(section.columns)}</section>`;
    if (section.type === "image") {
      const privateKey = marketingImageKeyFromUrl(section.imageUrl);
      const src = isMarketingImageKey(privateKey) ? `/api/marketing-public?slug=${encodeURIComponent(slug)}&asset=${encodeURIComponent(privateKey)}` : safeHttps(section.imageUrl);
      return src ? `<figure class="block image-block ${blockClass}"${sectionVisibility}><img src="${escapeHtml(src)}" alt="${escapeHtml(section.imageAlt || "")}" loading="lazy">${title}${copy}</figure>` : `<section class="block ${blockClass}"${sectionVisibility}>${title}${copy}</section>`;
    }
    if (section.type === "embed") {
      const embedded = section.embeddedAssetId ? embeddedAssets.get(section.embeddedAssetId) : undefined;
      const allowed = embedded && ["form", "survey", "calculator"].includes(embedded.kind);
      const frame = allowed ? `<iframe class="marketing-embedded-project" src="/f/${encodeURIComponent(embedded.slug)}?embed=1" title="${escapeHtml(section.heading || embedded.kind)}" data-f2b-marketing-slug="${escapeHtml(embedded.slug)}" loading="lazy" height="900"></iframe>` : `<p class="marketing-embed-unavailable">This embedded form is currently unavailable.</p>`;
      return `<section class="block embedded-project ${blockClass}"${sectionVisibility}>${title}${copy}${frame}</section>`;
    }    if (section.type === "video") {
      const video = normalizeMarketingVideo(section.videoUrl);
      const player = video?.kind === "file"
        ? `<video controls playsinline preload="metadata" src="${escapeHtml(video.sourceUrl)}"></video>`
        : video?.embedUrl
          ? `<iframe src="${escapeHtml(video.embedUrl)}" title="${escapeHtml(section.heading || "Video")}" loading="lazy" referrerpolicy="strict-origin-when-cross-origin" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen></iframe>`
          : "";
      return `<section class="block video-block ${blockClass}"${sectionVisibility}>${title}${player}${copy}</section>`;
    }
    if (section.type === "hero") return `<section class="block hero-block ${blockClass}"${sectionVisibility}>${title}${copy}${link}</section>`;
    if (section.type === "button") return `<section class="block cta-block ${blockClass}"${sectionVisibility}>${title}${copy}${link}</section>`;
    if (section.type === "faq") return `<section class="block ${blockClass}"${sectionVisibility}><details><summary>${escapeHtml(section.heading || "Frequently asked question")}</summary>${copy}</details></section>`;
    if (section.type === "testimonial") return `<figure class="block quote-block ${blockClass}"${sectionVisibility}><blockquote>${escapeHtml(section.body || "")}</blockquote>${section.heading ? `<figcaption>${escapeHtml(section.heading)}</figcaption>` : ""}</figure>`;
    if (section.type === "pricing") return `<section class="block pricing-block ${blockClass}"${sectionVisibility}>${title}${copy}${link}</section>`;
    return `<section class="block ${blockClass}"${sectionVisibility}>${title}${copy}</section>`;
  };
  return sections.map(renderBlock).join("");
}
