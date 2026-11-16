// Shared definitions for the AI-guided Setup tabs (Google Ads and SEO). Used by the UI and the API.

export type SetupKind = "ads" | "seo";
export type SetupColumn = { key: string; label: string; type?: "text" | "long" | "lines" | "select" | "url" | "metric"; options?: string[]; width?: string; limit?: number; lineLimit?: number; maxLines?: number };
export type SetupStepDef = { id: string; title: string; intro: string; columns: SetupColumn[]; live: string };
export type SetupRow = Record<string, string> & { id: string; source: string };
export type SetupStepState = { rows: SetupRow[]; status: "empty" | "draft" | "reviewed"; generatedAt?: string; savedAt?: string; note?: string };
export type SetupBrief = { website: string; services: string; locations: string; landingPages: string; audience: string; notes: string };
export type SetupDraft = { brief: SetupBrief; steps: Record<string, SetupStepState>; updatedAt?: string };

export const AI_SOURCE = "AI suggestion";

export const ADS_STEPS: SetupStepDef[] = [
  { id: "structure", title: "Campaigns & ad groups", intro: "Group the account by service and search intent so each ad group has one clear theme and landing page.", live: "Existing campaigns and ad groups",
    columns: [{ key: "campaign", label: "Campaign" }, { key: "adGroup", label: "Ad group" }, { key: "service", label: "Service" }, { key: "intent", label: "Search intent", type: "select", options: ["Emergency / urgent", "Commercial (quote, price)", "Local (near me, town)", "Informational", "Brand"] }, { key: "landingPage", label: "Landing page", type: "url" }] },
  { id: "keywords", title: "Keywords", intro: "Keywords for each ad group with a suggested match type.", live: "Keywords already in the account",
    columns: [{ key: "keyword", label: "Keyword" }, { key: "matchType", label: "Match type", type: "select", options: ["Exact", "Phrase", "Broad"] }, { key: "adGroup", label: "Ad group" }, { key: "volume", label: "Monthly searches", type: "metric" }] },
  { id: "negatives", title: "Negative keywords", intro: "Searches to block, with the match type and why. Built from real search terms when the account is connected.", live: "Search terms from the last 90 days",
    columns: [{ key: "keyword", label: "Negative keyword" }, { key: "matchType", label: "Match type", type: "select", options: ["Exact", "Phrase", "Broad"] }, { key: "level", label: "Level", type: "select", options: ["Campaign", "Ad group", "Account list"] }, { key: "reason", label: "Reason", type: "long" }] },
  { id: "ads", title: "Ads", intro: "Responsive search ads per ad group, checked against Google Ads limits (headlines 30, descriptions 90, paths 15 characters).", live: "Live responsive search ads",
    columns: [{ key: "adGroup", label: "Ad group" }, { key: "headlines", label: "Headlines (one per line, up to 15)", type: "lines", lineLimit: 30, maxLines: 15 }, { key: "descriptions", label: "Descriptions (one per line, up to 4)", type: "lines", lineLimit: 90, maxLines: 4 }, { key: "finalUrl", label: "Final URL", type: "url" }, { key: "path1", label: "Path 1", limit: 15 }, { key: "path2", label: "Path 2", limit: 15 }] },
  { id: "assets", title: "Assets", intro: "Sitelinks with destination URLs, callouts, structured snippets, images and call assets.", live: "Assets linked in the account",
    columns: [{ key: "type", label: "Type", type: "select", options: ["Sitelink", "Callout", "Structured snippet", "Call", "Image"] }, { key: "text", label: "Text / header", limit: 25 }, { key: "line1", label: "Line 1 / values", type: "long" }, { key: "line2", label: "Line 2", limit: 35 }, { key: "url", label: "Destination URL / phone / image", type: "url" }] },
  { id: "conversions", title: "Conversion tracking", intro: "Forms, phone taps and completed calls: what's configured, what needs testing and what's verified.", live: "Conversion actions in Google Ads and form leads in the OS",
    columns: [{ key: "action", label: "Conversion" }, { key: "method", label: "How it's tracked", type: "long" }, { key: "status", label: "Status", type: "select", options: ["Missing", "Configured", "Needs testing", "Verified"] }, { key: "nextStep", label: "Next step", type: "long" }] },
];

export const SEO_STEPS: SetupStepDef[] = [
  { id: "keywords", title: "Keyword research", intro: "Keywords by service, location and search intent, with the page that should rank for each priority topic.", live: "Saved keyword research",
    columns: [{ key: "topic", label: "Topic / service" }, { key: "keyword", label: "Keyword" }, { key: "location", label: "Location" }, { key: "intent", label: "Intent", type: "select", options: ["Commercial", "Local", "Informational", "Emergency", "Navigational"] }, { key: "targetPage", label: "Target page", type: "url" }, { key: "volume", label: "Monthly searches", type: "metric" }] },
  { id: "competitors", title: "Competitor research", intro: "Who competes in search, the keyword gaps and the pages worth investigating.", live: "Competitor research run in the Competitors tab",
    columns: [{ key: "competitor", label: "Competitor" }, { key: "gap", label: "Keyword gap / opportunity" }, { key: "page", label: "Page worth investigating", type: "url" }, { key: "note", label: "Why it matters", type: "long" }, { key: "volume", label: "Monthly searches", type: "metric" }] },
  { id: "content", title: "Content plan", intro: "Service pages, blogs and advice articles with titles, target keywords, briefs and internal links.", live: "Saved keywords to target",
    columns: [{ key: "type", label: "Type", type: "select", options: ["Service page", "Location page", "Blog post", "Advice article", "FAQ"] }, { key: "title", label: "Title" }, { key: "targetKeyword", label: "Target keyword" }, { key: "brief", label: "Brief", type: "long" }, { key: "internalLinks", label: "Internal links", type: "long" }] },
  { id: "backlinks", title: "Backlinks", intro: "Existing links, link opportunities and follow-ups to review and track.", live: "Backlink checks and tracked follow-ups",
    columns: [{ key: "type", label: "Type", type: "select", options: ["Opportunity", "Existing link", "Lost link", "Citation"] }, { key: "target", label: "Site / page", type: "url" }, { key: "approach", label: "How to get or keep it", type: "long" }, { key: "followUp", label: "Follow-up", type: "long" }, { key: "status", label: "Status", type: "select", options: ["Idea", "To contact", "Contacted", "Won", "Not relevant"] }] },
];

export const stepsFor = (kind: SetupKind) => kind === "ads" ? ADS_STEPS : SEO_STEPS;
export const emptyBrief = (): SetupBrief => ({ website: "", services: "", locations: "", landingPages: "", audience: "", notes: "" });

/** Google Ads limit problems for one row (empty list = OK). */
export function adsRowProblems(stepId: string, row: SetupRow): string[] {
  const def = ADS_STEPS.find((s) => s.id === stepId); if (!def) return [];
  const problems: string[] = [];
  for (const col of def.columns) {
    const value = String(row[col.key] || "");
    if (col.limit && value.length > col.limit) problems.push(`${col.label}: ${value.length}/${col.limit} characters`);
    if (col.type === "lines") {
      const lines = value.split("\n").map((l) => l.trim()).filter(Boolean);
      if (col.maxLines && lines.length > col.maxLines) problems.push(`${col.label.split(" (")[0]}: ${lines.length}/${col.maxLines}`);
      lines.forEach((line, i) => { if (col.lineLimit && line.length > col.lineLimit) problems.push(`${col.label.split(" (")[0]} ${i + 1}: ${line.length}/${col.lineLimit} characters`); });
      if (col.key === "headlines" && lines.length && lines.length < 3) problems.push("Headlines: at least 3 needed");
      if (col.key === "descriptions" && lines.length && lines.length < 2) problems.push("Descriptions: at least 2 needed");
    }
  }
  if (stepId === "assets") {
    const type = row.type;
    if (type === "Sitelink" && !/^https?:\/\//i.test(row.url || "")) problems.push("Sitelink needs a destination URL");
    if (type === "Callout" && String(row.text || "").length > 25) problems.push("Callout: max 25 characters");
    if (type === "Structured snippet") { const values = String(row.line1 || "").split(/[,\n]/).map((v) => v.trim()).filter(Boolean); if (values.length < 3) problems.push("Structured snippet: at least 3 values"); values.forEach((v) => { if (v.length > 25) problems.push(`Snippet value “${v.slice(0, 12)}…”: max 25`); }); }
  }
  return problems;
}

export const newRowId = () => `r${Math.random().toString(36).slice(2, 10)}`;
