export type InternalLinkAuditPage = {
  url: string;
  status: number | null;
  title: string;
  description: string;
  internalLinks: string[];
};

export type InternalLinkOpportunity = {
  sourceUrl: string;
  sourceTitle: string;
  targetUrl: string;
  targetTitle: string;
  sharedTopics: string[];
};

const ignoredWords = new Set("about after again also and are but can for from have into its more page pages that the their this through with your www com ie html".split(" "));

function pageKey(value: string) {
  try {
    const url = new URL(value);
    url.search = "";
    url.hash = "";
    url.pathname = url.pathname.replace(/\/+$/, "") || "/";
    return `${url.origin.toLowerCase()}${url.pathname.toLowerCase()}`;
  } catch { return value.trim().toLowerCase(); }
}

function pagePath(value: string) {
  try { return new URL(value).pathname; } catch { return value; }
}

function terms(value: string) {
  return value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "").toLocaleLowerCase()
    .split(/[^a-z0-9]+/).filter((word) => word.length > 2 && !ignoredWords.has(word))
    .map((word) => word.endsWith("ies") && word.length > 5 ? `${word.slice(0, -3)}y` : word.endsWith("s") && word.length > 4 ? word.slice(0, -1) : word);
}

/**
 * Finds review candidates only from successfully crawled pages. This is a
 * lightweight title/description topic match, never a claim that an edit is
 * required or that the full website was crawled.
 */
export function suggestInternalLinkOpportunities(pages: InternalLinkAuditPage[]): InternalLinkOpportunity[] {
  const checkedPages = pages.filter((page) => page.status !== null && page.status < 400 && page.url);
  const ranked: Array<InternalLinkOpportunity & { score: number }> = [];
  for (const source of checkedPages) {
    const sourceKey = pageKey(source.url);
    const sourceWords = new Set(terms(`${source.title} ${source.description} ${pagePath(source.url)}`));
    if (sourceWords.size < 2) continue;
    const linked = new Set(source.internalLinks.map(pageKey));
    for (const target of checkedPages) {
      const targetKey = pageKey(target.url);
      if (sourceKey === targetKey || linked.has(targetKey)) continue;
      const targetWords = new Set(terms(`${target.title} ${pagePath(target.url)}`));
      const sharedTopics = [...targetWords].filter((word) => sourceWords.has(word)).sort();
      if (sharedTopics.length < 2) continue;
      ranked.push({ sourceUrl: source.url, sourceTitle: source.title || source.url, targetUrl: target.url, targetTitle: target.title || target.url, sharedTopics, score: sharedTopics.length });
    }
  }
  return ranked.sort((a, b) => b.score - a.score || a.sourceUrl.localeCompare(b.sourceUrl) || a.targetUrl.localeCompare(b.targetUrl)
  ).slice(0, 30).map(({ score: _score, ...opportunity }) => opportunity);
}
