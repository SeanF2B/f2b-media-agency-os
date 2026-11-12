type RawPage = Record<string, unknown>;

function text(value: unknown, limit: number) {
  const candidate = value && typeof value === "object"
    ? (value as { raw?: unknown; rendered?: unknown }).raw ?? (value as { rendered?: unknown }).rendered
    : value;
  if (typeof candidate !== "string") return "";
  return candidate.replace(/<[^>]*>/g, " ").replace(/&nbsp;|&#160;/gi, " ").replace(/&amp;/gi, "&").replace(/&quot;/gi, '"').replace(/&#39;|&apos;/gi, "'").replace(/\s+/g, " ").trim().slice(0, limit);
}

function firstText(values: unknown[], limit: number) {
  for (const value of values) {
    const candidate = text(value, limit);
    if (candidate) return candidate;
  }
  return "";
}

export type WordPressSeoInventoryPage = {
  id: number;
  title: string;
  slug: string;
  status: string;
  url: string;
  modifiedAt: string;
  seoTitle: string;
  metaDescription: string;
  canonicalUrl: string;
  robots: string;
  checkedFields: { seoTitle: boolean; metaDescription: boolean; canonical: boolean; indexing: boolean };
};

export function mapWordPressSeoInventory(value: unknown): WordPressSeoInventoryPage[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 50).flatMap((raw): WordPressSeoInventoryPage[] => {
    if (!raw || typeof raw !== "object") return [];
    const page = raw as RawPage;
    const meta = page.meta && typeof page.meta === "object" ? page.meta as RawPage : {};
    const yoast = page.yoast_head_json && typeof page.yoast_head_json === "object" ? page.yoast_head_json as RawPage : {};
    const id = Number(page.id);
    if (!Number.isSafeInteger(id) || id < 1) return [];
    const title = firstText([page.title], 240) || String(page.slug || "Untitled page").slice(0, 160);
    const slug = typeof page.slug === "string" ? page.slug.slice(0, 200) : "";
    const status = typeof page.status === "string" ? page.status.slice(0, 30) : "unknown";
    const seoTitle = firstText([yoast.title, meta._yoast_wpseo_title, meta.rank_math_title, meta.seopress_titles_title], 300);
    const metaDescription = firstText([yoast.description, meta._yoast_wpseo_metadesc, meta.rank_math_description, meta.seopress_titles_desc], 500);
    const canonicalUrl = firstText([yoast.canonical, meta._yoast_wpseo_canonical, meta.rank_math_canonical_url, meta.seopress_robots_canonical], 500);
    const rawRobots = yoast.robots;
    const robots = Array.isArray(rawRobots)
      ? rawRobots.filter((item): item is string => typeof item === "string").join(", ").slice(0, 120)
      : firstText([rawRobots, meta.rank_math_robots, meta["_yoast_wpseo_meta-robots-noindex"], meta._yoast_wpseo_meta_robots_noindex, meta.seopress_robots_index], 120);
    const hasMeta = (...keys: string[]) => keys.some((key) => Object.prototype.hasOwnProperty.call(meta, key));
    return [{
      id,
      title,
      slug,
      status,
      url: typeof page.link === "string" ? page.link.slice(0, 1000) : "",
      modifiedAt: typeof page.modified === "string" ? page.modified.slice(0, 40) : "",
      seoTitle,
      metaDescription,
      canonicalUrl,
      robots,
      checkedFields: {
        seoTitle: Boolean(yoast.title) || hasMeta("_yoast_wpseo_title", "rank_math_title", "seopress_titles_title"),
        metaDescription: Boolean(yoast.description) || hasMeta("_yoast_wpseo_metadesc", "rank_math_description", "seopress_titles_desc"),
        canonical: Boolean(yoast.canonical) || hasMeta("_yoast_wpseo_canonical", "rank_math_canonical_url", "seopress_robots_canonical"),
        indexing: Boolean(rawRobots) || hasMeta("rank_math_robots", "_yoast_wpseo_meta-robots-noindex", "_yoast_wpseo_meta_robots_noindex", "seopress_robots_index"),
      },
    }];
  });
}
