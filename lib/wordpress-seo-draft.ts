const SEO_DESCRIPTION_META_KEYS = ["_yoast_wpseo_metadesc", "rank_math_description", "seopress_titles_desc"] as const;

export type SeoDescriptionWritePlan =
  | { status: "not_requested"; description: "" }
  | { status: "not_exposed"; description: string }
  | { status: "ready"; description: string; metaKey: typeof SEO_DESCRIPTION_META_KEYS[number] };

export function planWordPressSeoDescriptionWrite(meta: unknown, description: string): SeoDescriptionWritePlan {
  const normalized = description.trim().replace(/\s+/g, " ").slice(0, 159);
  if (!normalized) return { status: "not_requested", description: "" };
  const fields = meta && typeof meta === "object" ? meta as Record<string, unknown> : {};
  const metaKey = SEO_DESCRIPTION_META_KEYS.find((key) => Object.prototype.hasOwnProperty.call(fields, key));
  return metaKey ? { status: "ready", description: normalized, metaKey } : { status: "not_exposed", description: normalized };
}

export function verifyWordPressSeoDescription(meta: unknown, metaKey: string, expected: string) {
  const fields = meta && typeof meta === "object" ? meta as Record<string, unknown> : {};
  const actual = fields[metaKey];
  return typeof actual === "string" && actual.trim().replace(/\s+/g, " ") === expected;
}
