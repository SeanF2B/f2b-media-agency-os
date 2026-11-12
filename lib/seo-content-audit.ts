export type SeoContentPage = {
  title: string;
  status: string;
  link?: string;
  seoTitle?: string;
  metaDescription?: string;
  robots?: string;
  seoChecked?: boolean;
  seoCapabilities?: { title?: boolean; description?: boolean };
};

/** Only reports missing fields when the live HTML or an exposed WordPress SEO field was checked. */
export function inspectSeoContentPage(page: SeoContentPage) {
  const published = page.status === "publish";
  const titleKnown = Boolean(page.seoChecked || page.seoCapabilities?.title);
  const descriptionKnown = Boolean(page.seoChecked || page.seoCapabilities?.description);
  const issues = [
    ...(published && titleKnown && !page.seoTitle?.trim() ? ["SEO title is missing"] : []),
    ...(published && descriptionKnown && !page.metaDescription?.trim() ? ["Meta description is missing"] : []),
    ...(published && /(?:^|[,\s])noindex(?:$|[,\s])/i.test(page.robots || "") ? ["Published page is marked noindex"] : []),
  ];
  const unavailable = [
    ...(!titleKnown ? ["SEO title could not be checked"] : []),
    ...(!descriptionKnown ? ["Meta description could not be checked"] : []),
  ];
  return { issues, unavailable, status: issues.length ? "review" as const : unavailable.length ? "unknown" as const : "checked" as const };
}
