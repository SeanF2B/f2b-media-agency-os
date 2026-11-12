type ReviewAd = {
  campaignId?: string;
  campaignName?: string;
  adGroupId?: string;
  adGroupName?: string;
  adId?: string;
  status?: string;
  finalUrls?: string[];
  headlines?: Array<{ text?: string }>;
};

type ReviewService = {
  name?: string;
  campaignName?: string;
  landingPageUrl?: string;
  landingPagePlatform?: string;
};

export type GoogleAdsLandingPageTarget = {
  url: string;
  campaignId: string;
  campaignName: string;
  adGroupId?: string;
  adGroupName?: string;
  adIds: string[];
  headlines: string[];
  platform: string;
};

export function buildGoogleAdsLandingPageTargets(
  services: ReviewService[],
  ads: ReviewAd[],
  selectedCampaignId = "",
  selectedCampaignName = "",
  limit = 8,
) {
  const targets = new Map<string, GoogleAdsLandingPageTarget>();
  const campaignName = selectedCampaignName.trim().toLocaleLowerCase();
  const matchesAdCampaign = (id = "") => !selectedCampaignId || id === selectedCampaignId;
  const matchesSavedPageCampaign = (name = "") => !campaignName || name.trim().toLocaleLowerCase() === campaignName;

  for (const service of services) {
    if (service.name !== "Google Ads" || !service.landingPageUrl || !matchesSavedPageCampaign(service.campaignName || "")) continue;
    const url = service.landingPageUrl.trim();
    if (!url) continue;
    const existing = targets.get(url);
    targets.set(url, {
      url,
      campaignId: selectedCampaignId,
      campaignName: service.campaignName || selectedCampaignName || "Google Ads campaign",
      adIds: existing?.adIds || [],
      headlines: existing?.headlines || [],
      platform: service.landingPagePlatform || "Other",
    });
  }

  for (const ad of ads) {
    if (String(ad.status || "").toUpperCase() !== "ENABLED" || !matchesAdCampaign(ad.campaignId || "")) continue;
    for (const value of ad.finalUrls || []) {
      const url = String(value || "").trim();
      if (!url) continue;
      const existing = targets.get(url);
      const headlines = [...new Set([...(existing?.headlines || []), ...(ad.headlines || []).map((item) => String(item.text || "").trim()).filter(Boolean)])];
      targets.set(url, {
        url,
        campaignId: ad.campaignId || existing?.campaignId || selectedCampaignId,
        campaignName: ad.campaignName || existing?.campaignName || selectedCampaignName || "Google Ads campaign",
        adGroupId: ad.adGroupId || existing?.adGroupId,
        adGroupName: ad.adGroupName || existing?.adGroupName,
        adIds: [...new Set([...(existing?.adIds || []), ...(ad.adId ? [ad.adId] : [])])],
        headlines,
        platform: existing?.platform || "Google Ads final URL",
      });
    }
  }

  const all = [...targets.values()];
  return { targets: all.slice(0, Math.max(0, limit)), omittedUrls: all.slice(Math.max(0, limit)).map((item) => item.url) };
}

export function assessGoogleAdsReviewPrerequisite(input: {
  adsStatus: string;
  activeAds: ReviewAd[];
  pageTargets: GoogleAdsLandingPageTarget[];
  omittedUrls?: string[];
  landingPages: Array<{ url?: string; status?: string }>;
}) {
  const missingHeadlines = input.activeAds.filter((ad) => !(ad.headlines || []).some((item) => String(item.text || "").trim()));
  const missingDestinationAds = input.activeAds.filter((ad) => !(ad.finalUrls || []).some((url) => String(url || "").trim()));
  const readableUrls = new Set(input.landingPages.filter((page) => page.status === "connected").map((page) => String(page.url || "").trim()));
  const missingPages = input.pageTargets.filter((target) => !readableUrls.has(target.url)).map((target) => target.url);
  const reasons: string[] = [];
  if (input.adsStatus !== "connected") reasons.push("The live Google Ads connection did not return ad assets.");
  if (!input.activeAds.length) reasons.push("No enabled Responsive Search Ads were returned for this campaign.");
  if (missingHeadlines.length) reasons.push(missingHeadlines.length + " enabled ad" + (missingHeadlines.length === 1 ? " has" : "s have") + " no readable headline assets.");
  if (missingDestinationAds.length) reasons.push(missingDestinationAds.length + " enabled ad" + (missingDestinationAds.length === 1 ? " has" : "s have") + " no destination URL to inspect.");
  if (!input.pageTargets.length) reasons.push("No destination landing page URL was found on the enabled ads or the campaign's saved service details.");
  if (missingPages.length) reasons.push(missingPages.length + " destination page" + (missingPages.length === 1 ? " could not" : "s could not") + " be read as public page content.");
  if (input.omittedUrls?.length) reasons.push(input.omittedUrls.length + " additional destination page" + (input.omittedUrls.length === 1 ? " was" : "s were") + " beyond the review limit and were not inspected.");
  return {
    required: true as const,
    status: reasons.length ? "incomplete" as const : "ready" as const,
    activeAdsReviewed: input.activeAds.length - missingHeadlines.length,
    activeAdsTotal: input.activeAds.length,
    landingPagesRead: input.landingPages.filter((page) => page.status === "connected").length,
    landingPagesTotal: input.pageTargets.length + (input.omittedUrls?.length || 0),
    missingPages,
    omittedUrls: input.omittedUrls || [],
    reasons,
    message: reasons.join(" "),
  };
}
