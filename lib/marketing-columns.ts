export type MarketingColumn = { heading: string; body: string; buttonLabel: string; buttonUrl: string };
const escapeHtml = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);

export function normalizeMarketingColumns(value: unknown): MarketingColumn[] {
  if (!Array.isArray(value)) return [];
  return value.slice(0, 4).map((raw) => {
    const column = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    let buttonUrl = "";
    try {
      const url = new URL(String(column.buttonUrl || ""));
      if (url.protocol === "https:") buttonUrl = url.toString().slice(0, 2000);
    } catch { /* invalid or relative links are discarded */ }
    return {
      heading: String(column.heading || "").slice(0, 160),
      body: String(column.body || "").slice(0, 2000),
      buttonLabel: String(column.buttonLabel || "").slice(0, 80),
      buttonUrl,
    };
  });
}

export function renderMarketingColumnsHtml(value: unknown): string {
  const columns = normalizeMarketingColumns(value);
  const count = Math.max(2, Math.min(4, columns.length));
  const items = columns.map((column) => {
    let href = "";
    try { const url = new URL(column.buttonUrl); if (url.protocol === "https:") href = url.toString(); } catch { /* invalid links are omitted */ }
    return `<article class="column-card">${column.heading ? `<h3>${escapeHtml(column.heading)}</h3>` : ""}${column.body ? `<p>${escapeHtml(column.body)}</p>` : ""}${href ? `<a class="cta" href="${escapeHtml(href)}">${escapeHtml(column.buttonLabel || "Learn more")}</a>` : ""}</article>`;
  }).join("");
  return `<div class="columns-grid columns-grid-${count}">${items}</div>`;
}
