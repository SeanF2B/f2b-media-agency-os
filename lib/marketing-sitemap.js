const xml = (value) => String(value).replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[character]);

function safePageData(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value;
}

export function buildMarketingSitemap(entries, origin) {
  let base;
  try { base = new URL(origin); } catch { return "<?xml version=\"1.0\" encoding=\"UTF-8\"?><urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\"></urlset>"; }
  if (base.protocol !== "https:" && base.hostname !== "localhost" && base.hostname !== "127.0.0.1") return "<?xml version=\"1.0\" encoding=\"UTF-8\"?><urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\"></urlset>";
  const locations = new Set();
  for (const entry of Array.isArray(entries) ? entries.slice(0, 5000) : []) {
    const slug = typeof entry?.slug === "string" ? entry.slug : "";
    if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,119}$/.test(slug)) continue;
    let data = safePageData(entry.data);
    if (!data && typeof entry.data === "string") { try { data = safePageData(JSON.parse(entry.data)); } catch { data = null; } }
    if (!data || data.noIndex === true) continue;
    let location = new URL(`/f/${encodeURIComponent(slug)}`, base).toString();
    if (typeof data.canonicalUrl === "string") {
      try {
        const canonical = new URL(data.canonicalUrl);
        if (canonical.protocol === "https:" && canonical.origin === base.origin && !canonical.username && !canonical.password && !canonical.search && !canonical.hash) location = canonical.toString();
      } catch { /* Use the verified page URL when a canonical value is invalid. */ }
    }
    locations.add(location);
  }
  const entriesXml = [...locations].sort().map((location) => `<url><loc>${xml(location)}</loc></url>`).join("");
  return `<?xml version="1.0" encoding="UTF-8"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${entriesXml}</urlset>`;
}

export function buildMarketingRobots(origin) {
  let base;
  try { base = new URL(origin); } catch { base = new URL("https://f2b-media-agency-os.f2b-media.workers.dev"); }
  return `User-agent: *\nDisallow: /\nAllow: /f/\nDisallow: /api/\nSitemap: ${base.origin}/sitemap.xml\n`;
}
