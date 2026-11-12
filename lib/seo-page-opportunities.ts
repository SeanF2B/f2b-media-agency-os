export type SeoPageOpportunity = {
  service: string;
  location: string;
  suggestedTitle: string;
  matchedPage?: string;
};

function normalize(value: string): string {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * Suggest service/location page coverage for human review. This deliberately
 * reports candidates rather than claiming a page is missing: callers may only
 * have loaded one page of a paginated CMS inventory.
 */
export function suggestSeoPageOpportunities(
  services: string[],
  locations: string[],
  pages: Array<{ title?: string; slug?: string; link?: string }>,
): SeoPageOpportunity[] {
  const pageText = pages.map((page) => ({
    label: page.title?.trim() || page.slug?.trim() || page.link?.trim() || "Untitled page",
    text: normalize([page.title, page.slug, page.link].filter(Boolean).join(" ")),
  }));
  const results: SeoPageOpportunity[] = [];
  for (const serviceValue of services) {
    const service = serviceValue.trim();
    if (!service) continue;
    for (const locationValue of locations) {
      const location = locationValue.trim();
      if (!location) continue;
      const target = normalize(`${service} ${location}`);
      if (!target) continue;
      const match = pageText.find((page) => page.text.includes(target));
      results.push({ service, location, suggestedTitle: `${service} in ${location}`, ...(match ? { matchedPage: match.label } : {}) });
    }
  }
  return results.slice(0, 100);
}
