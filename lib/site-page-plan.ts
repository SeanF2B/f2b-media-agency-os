export type SitePagePurpose = "SEO" | "Paid Ads" | "Both";
export type SitePagePlan = {
  purpose: SitePagePurpose;
  campaignPlatform?: "Google Ads" | "Meta Ads";
  campaignId?: string;
  campaignName?: string;
  service?: string;
  targetLocation?: string;
  conversionGoal?: string;
  templateStyle?: "local-service" | "emergency" | "high-value";
  sourcePageId?: number;
};
export type SitePageMetadata = SitePagePlan & { clientId: string; pageId: number; updatedAt: string };
export type SiteLandingDomainCheck = {
  clientId: string;
  hostname: string;
  checkedAt: string;
  dnsStatus: "found" | "missing" | "unavailable";
  dnsAnswers: string[];
  httpsStatus: "ready" | "redirects" | "error" | "unavailable";
  httpStatus?: number;
  redirectHost?: string;
};

export function landingHostnameForWebsite(siteUrl?: string) {
  if (!siteUrl) return null;
  try {
    const url = new URL(siteUrl);
    const websiteHost = url.hostname.toLowerCase().replace(/^www\./, "");
    if (websiteHost === "wordpress.com" || websiteHost.endsWith(".wordpress.com") || websiteHost === "wp.com" || websiteHost.endsWith(".wp.com")) return null;
    if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(websiteHost)) return null;
    return `go.${websiteHost}`;
  } catch { return null; }
}

export function normalizeSitePagePlan(value: unknown): SitePagePlan | null {
  if (!value || typeof value !== "object") return null;
  const input = value as Record<string, unknown>;
  const purpose = input.purpose;
  if (purpose !== "SEO" && purpose !== "Paid Ads" && purpose !== "Both") return null;
  const campaignPlatform = input.campaignPlatform === "Google Ads" || input.campaignPlatform === "Meta Ads" ? input.campaignPlatform : undefined;
  const templateStyle = input.templateStyle === "emergency" || input.templateStyle === "high-value" || input.templateStyle === "local-service" ? input.templateStyle : undefined;
  const sourcePageId = Number.isSafeInteger(input.sourcePageId) && Number(input.sourcePageId) > 0 ? Number(input.sourcePageId) : undefined;
  const clean = (item: unknown, max: number) => typeof item === "string" ? item.trim().slice(0, max) : "";
  return {
    purpose,
    ...(campaignPlatform ? { campaignPlatform } : {}),
    ...(clean(input.campaignId, 160) ? { campaignId: clean(input.campaignId, 160) } : {}),
    ...(clean(input.campaignName, 200) ? { campaignName: clean(input.campaignName, 200) } : {}),
    ...(clean(input.service, 160) ? { service: clean(input.service, 160) } : {}),
    ...(clean(input.targetLocation, 160) ? { targetLocation: clean(input.targetLocation, 160) } : {}),
    ...(clean(input.conversionGoal, 120) ? { conversionGoal: clean(input.conversionGoal, 120) } : {}),
    ...(templateStyle ? { templateStyle } : {}),
    ...(sourcePageId ? { sourcePageId } : {}),
  };
}

export function buildSitePageMetadata(plan: SitePagePlan, clientId: string, pageId: number, updatedAt: string): SitePageMetadata | null {
  if (!clientId || !Number.isSafeInteger(pageId) || pageId < 1 || !Number.isFinite(Date.parse(updatedAt))) return null;
  return { ...plan, clientId, pageId, updatedAt };
}
