export type SiteCampaignPlatform = "Google Ads" | "Meta Ads";
export type SiteCampaignEvidence = {
  status: "retrieved" | "no_data" | "unavailable";
  platform: SiteCampaignPlatform;
  campaignId: string;
  campaignName: string;
  keywords: string[];
  headlines: string[];
  descriptions: string[];
  destinationUrls: string[];
  audienceTargeting: string[];
  note: string;
};

function values(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(values);
  if (typeof value !== "string") return [];
  const trimmed = value.trim();
  if (!trimmed) return [];
  if (trimmed.startsWith("[")) {
    try { return values(JSON.parse(trimmed)); } catch {}
  }
  return trimmed.split(/\s*;\s*/).map((item) => item.trim()).filter(Boolean);
}

function unique(items: string[], limit: number, maxLength = 240) {
  return [...new Map(items.map((item) => [item.trim().toLocaleLowerCase(), item.trim().slice(0, maxLength)])).values()].filter(Boolean).slice(0, limit);
}

function targetingSummary(value: unknown) {
  const raw = Array.isArray(value) ? value[0] : value;
  try {
    const spec = (typeof raw === "string" ? JSON.parse(raw) : raw) as Record<string, any> | null;
    if (!spec || typeof spec !== "object") return [];
    const audience: string[] = [];
    if (Number.isFinite(Number(spec.age_min)) || Number.isFinite(Number(spec.age_max))) audience.push(`age ${Number(spec.age_min) || 18}–${Number(spec.age_max) || 65}`);
    if (Array.isArray(spec.genders) && spec.genders.length) audience.push(`genders: ${spec.genders.slice(0, 4).map((gender: unknown) => ({ 1: "men", 2: "women" } as Record<number, string>)[Number(gender)] || `code ${String(gender)}`).join(", ")}`);
    const geo = spec.geo_locations || {};
    for (const [key, label] of [["countries", "countries"], ["regions", "regions"], ["cities", "cities"]] as const) {
      const entries = Array.isArray(geo[key]) ? geo[key].slice(0, 8).map((entry: any) => typeof entry === "string" ? entry : String(entry?.name || entry?.key || entry?.country || "")).filter(Boolean) : [];
      if (entries.length) audience.push(`${label}: ${entries.join(", ")}`);
    }
    const interests = Array.isArray(spec.flexible_spec) ? spec.flexible_spec.flatMap((group: any) => Array.isArray(group.interests) ? group.interests.map((item: any) => item.name).filter(Boolean) : []).slice(0, 12) : [];
    if (interests.length) audience.push(`interests: ${interests.join(", ")}`);
    return audience;
  } catch { return []; }
}

export function summarizeSiteCampaignEvidence(input: {
  platform: SiteCampaignPlatform;
  campaignId: string;
  campaignName: string;
  keywordRows?: Array<Record<string, unknown>>;
  creativeRows?: Array<Record<string, unknown>>;
  targetingRows?: Array<Record<string, unknown>>;
  unavailableNote?: string;
}): SiteCampaignEvidence {
  const keywordRows = input.keywordRows || [];
  const creativeRows = input.creativeRows || [];
  const targetingRows = input.targetingRows || [];
  const google = input.platform === "Google Ads";
  const evidence: SiteCampaignEvidence = {
    status: "unavailable",
    platform: input.platform,
    campaignId: input.campaignId,
    campaignName: input.campaignName,
    keywords: unique(keywordRows.flatMap((row) => values(row.keyword_text)), 40, 100),
    headlines: unique(creativeRows.flatMap((row) => values(google ? row.ad_group_ad_ad_responsive_search_ad_headlines : row.title)), 30, 120),
    descriptions: unique(creativeRows.flatMap((row) => values(google ? row.ad_group_ad_ad_responsive_search_ad_descriptions : row.body)), 20, 280),
    destinationUrls: unique(creativeRows.flatMap((row) => values(google ? row.ad_group_ad_ad_final_urls : row.link_url ?? row.link ?? row.website_destination_url)).filter((url) => /^https:\/\//i.test(url)), 20, 500),
    audienceTargeting: unique(targetingRows.flatMap((row) => targetingSummary(row.adset_targeting)), 20, 160),
    note: input.unavailableNote || "",
  };
  if ([...evidence.keywords, ...evidence.headlines, ...evidence.descriptions, ...evidence.destinationUrls, ...evidence.audienceTargeting].length) {
    evidence.status = "retrieved";
    evidence.note = "Campaign details were read from the connected advertising account. Empty fields were not supplied by the source.";
  } else if (!input.unavailableNote) {
    evidence.status = "no_data";
    evidence.note = "The connected source returned no campaign keywords, ad text, URLs or targeting for this campaign and period.";
  }
  return evidence;
}

export function siteCampaignEvidenceText(evidence: SiteCampaignEvidence | null) {
  if (!evidence) return "No campaign was selected.";
  if (evidence.status !== "retrieved") return `${evidence.status === "no_data" ? "No campaign details returned" : "Campaign details unavailable"}: ${evidence.note}`;
  const lines = [
    `${evidence.platform} campaign: ${evidence.campaignName} (ID ${evidence.campaignId})`,
    evidence.keywords.length ? `Existing keywords: ${evidence.keywords.join("; ")}` : "Existing keywords: not supplied by the connected source.",
    evidence.headlines.length ? `Current ad headlines: ${evidence.headlines.join("; ")}` : "Current ad headlines: not supplied by the connected source.",
    evidence.descriptions.length ? `Current ad descriptions: ${evidence.descriptions.join("; ")}` : "Current ad descriptions: not supplied by the connected source.",
    evidence.destinationUrls.length ? `Current ad destination URLs: ${evidence.destinationUrls.join("; ")}` : "Current ad destination URLs: not supplied by the connected source.",
    evidence.audienceTargeting.length ? `Current audience targeting: ${evidence.audienceTargeting.join("; ")}` : "Current audience targeting: not supplied by the connected source.",
  ];
  return lines.join("\n");
}

export function campaignChecklistStepVerified(text: string, aiCompleted: boolean, evidenceStatus: SiteCampaignEvidence["status"] | null) {
  if (!/campaign|keyword|ad copy|targeting/i.test(text)) return aiCompleted;
  return aiCompleted && evidenceStatus === "retrieved";
}
