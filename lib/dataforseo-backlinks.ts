export type DataForSeoBacklinkSummary = {
  target: string;
  backlinks: number | null;
  referringDomains: number | null;
  referringIps: number | null;
  rank: number | null;
  spamScore: number | null;
  brokenBacklinks: number | null;
  crawledPages: number | null;
};

export type BacklinkCountComparison = {
  previousCheckedAt: string;
  backlinks: number | null;
  referringDomains: number | null;
  brokenBacklinks: number | null;
};

export type DataForSeoBacklinkItem = {
  domainFrom: string;
  urlFrom: string;
  urlTo: string;
  anchor: string | null;
  rank: number | null;
  firstSeen: string | null;
  isNew: boolean;
  isLost: boolean;
  dofollow: boolean | null;
};

export type DataForSeoBacklinkChanges = {
  backlinksNew: number | null;
  backlinksLost: number | null;
  referringDomainsNew: number | null;
  referringDomainsLost: number | null;
  startDate: string;
  endDate: string;
};

export function compareBacklinkCounts(current: DataForSeoBacklinkSummary, previous: DataForSeoBacklinkSummary, previousCheckedAt: string): BacklinkCountComparison {
  const difference = (value: number | null, previousValue: number | null) => value == null || previousValue == null ? null : value - previousValue;
  return {
    previousCheckedAt,
    backlinks: difference(current.backlinks, previous.backlinks),
    referringDomains: difference(current.referringDomains, previous.referringDomains),
    brokenBacklinks: difference(current.brokenBacklinks, previous.brokenBacklinks),
  };
}

const metric = (value: unknown): number | null => {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return value;
};

function dataForSeoTasks(payload: unknown): { tasks: Array<Record<string, unknown>>; cost: number | null } | null {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as { status_code?: unknown; tasks?: Array<Record<string, unknown>>; cost?: unknown };
  if (root.status_code !== 20000 || !Array.isArray(root.tasks)) return null;
  const taskCosts = root.tasks.map((task) => metric(task.cost)).filter((cost): cost is number => cost !== null);
  return { tasks: root.tasks, cost: taskCosts.length ? taskCosts.reduce((sum, cost) => sum + cost, 0) : metric(root.cost) };
}

export function parseDataForSeoBacklinkItems(payload: unknown): { items: DataForSeoBacklinkItem[]; cost: number | null } | null {
  const parsed = dataForSeoTasks(payload);
  if (!parsed) return null;
  const task = parsed.tasks[0];
  const result = Array.isArray(task?.result) ? task.result[0] as Record<string, unknown> | undefined : undefined;
  if (!result || !Array.isArray(result.items)) return null;
  const items = result.items.flatMap((value): DataForSeoBacklinkItem[] => {
    if (!value || typeof value !== "object") return [];
    const item = value as Record<string, unknown>;
    if (typeof item.url_from !== "string" || typeof item.url_to !== "string") return [];
    let fallbackDomain = "Unknown source";
    try { fallbackDomain = new URL(item.url_from).hostname || fallbackDomain; } catch { /* Keep malformed provider URLs visible as text only. */ }
    return [{
      domainFrom: typeof item.domain_from === "string" ? item.domain_from : fallbackDomain,
      urlFrom: item.url_from,
      urlTo: item.url_to,
      anchor: typeof item.anchor === "string" ? item.anchor : null,
      rank: metric(item.rank),
      firstSeen: typeof item.first_seen === "string" ? item.first_seen : null,
      isNew: item.is_new === true,
      isLost: item.is_lost === true,
      dofollow: typeof item.dofollow === "boolean" ? item.dofollow : null,
    }];
  });
  return { items, cost: metric(task.cost) ?? parsed.cost };
}

export function parseDataForSeoBacklinkChanges(payload: unknown, startDate: string, endDate: string): { changes: DataForSeoBacklinkChanges; cost: number | null } | null {
  const parsed = dataForSeoTasks(payload);
  if (!parsed) return null;
  const task = parsed.tasks[0];
  const result = Array.isArray(task?.result) ? task.result[0] as Record<string, unknown> | undefined : undefined;
  if (!result || !Array.isArray(result.items)) return null;
  const totals = { backlinksNew: 0, backlinksLost: 0, referringDomainsNew: 0, referringDomainsLost: 0 };
  let hasNew = false;
  let hasLost = false;
  let hasDomainsNew = false;
  let hasDomainsLost = false;
  if (result.items.length === 0) { hasNew = true; hasLost = true; hasDomainsNew = true; hasDomainsLost = true; }
  for (const value of result.items) {
    if (!value || typeof value !== "object") continue;
    const item = value as Record<string, unknown>;
    const add = (field: keyof typeof totals, raw: unknown, mark: () => void) => {
      const numberValue = metric(raw);
      if (numberValue !== null) { totals[field] += numberValue; mark(); }
    };
    add("backlinksNew", item.new_backlinks, () => { hasNew = true; });
    add("backlinksLost", item.lost_backlinks, () => { hasLost = true; });
    add("referringDomainsNew", item.new_referring_domains, () => { hasDomainsNew = true; });
    add("referringDomainsLost", item.lost_referring_domains, () => { hasDomainsLost = true; });
  }
  return {
    changes: {
      backlinksNew: hasNew ? totals.backlinksNew : null,
      backlinksLost: hasLost ? totals.backlinksLost : null,
      referringDomainsNew: hasDomainsNew ? totals.referringDomainsNew : null,
      referringDomainsLost: hasDomainsLost ? totals.referringDomainsLost : null,
      startDate,
      endDate,
    },
    cost: metric(task.cost) ?? parsed.cost,
  };
}

export function normalizeBacklinkTarget(input: string): string | null {
  const raw = input.trim();
  if (!raw || raw.length > 253 || /[\s\u0000-\u001f]/.test(raw)) return null;
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!(url.protocol === "https:" || url.protocol === "http:")) return null;
    const host = url.hostname.toLowerCase().replace(/^www\./, "");
    if (!host || host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local") || /^\d{1,3}(?:\.\d{1,3}){3}$/.test(host) || host.includes(":")) return null;
    return raw.includes("/") && !/^[^/]+\/$/.test(raw) ? `${url.protocol}//${url.host}${url.pathname}` : host;
  } catch {
    return null;
  }
}

export function parseDataForSeoBacklinkSummary(payload: unknown): { summary: DataForSeoBacklinkSummary; cost: number | null } | null {
  const parsed = dataForSeoTasks(payload);
  if (!parsed) return null;
  const task = parsed.tasks[0];
  const result = Array.isArray(task?.result) ? task.result[0] as Record<string, unknown> | undefined : undefined;
  if (!result || typeof result.target !== "string") return null;
  return {
    summary: {
      target: result.target,
      backlinks: metric(result.backlinks),
      referringDomains: metric(result.referring_domains),
      referringIps: metric(result.referring_ips),
      rank: metric(result.rank),
      spamScore: metric(result.target_spam_score),
      brokenBacklinks: metric(result.broken_backlinks),
      crawledPages: metric(result.crawled_pages),
    },
    cost: metric(task.cost) ?? parsed.cost,
  };
}
