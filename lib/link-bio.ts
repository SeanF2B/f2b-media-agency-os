// Link in bio: one branded links page per client, published at /f/bio/<slug>.
// Pure helpers (schema, validation, defaults, public HTML) so they can be unit-tested without D1.

export const LINK_BIO_SQL = [
  `CREATE TABLE IF NOT EXISTS link_bio_pages (
    id TEXT PRIMARY KEY,
    owner_id TEXT NOT NULL,
    client_id TEXT NOT NULL,
    slug TEXT NOT NULL,
    data TEXT NOT NULL,
    published INTEGER NOT NULL DEFAULT 0,
    views INTEGER NOT NULL DEFAULT 0,
    clicks TEXT NOT NULL DEFAULT '{}',
    updated_at TEXT NOT NULL,
    updated_by TEXT NOT NULL DEFAULT ''
  )`,
  "CREATE UNIQUE INDEX IF NOT EXISTS link_bio_slug ON link_bio_pages (slug)",
  "CREATE UNIQUE INDEX IF NOT EXISTS link_bio_owner_client ON link_bio_pages (owner_id, client_id)",
];

export const SOCIAL_NETWORKS = ["instagram", "facebook", "tiktok", "whatsapp", "youtube", "linkedin", "x", "google", "email", "phone"] as const;
export type SocialNetwork = typeof SOCIAL_NETWORKS[number];
export const SOCIAL_LABELS: Record<SocialNetwork, string> = { instagram: "Instagram", facebook: "Facebook", tiktok: "TikTok", whatsapp: "WhatsApp", youtube: "YouTube", linkedin: "LinkedIn", x: "X", google: "Google reviews", email: "Email", phone: "Phone" };
// Each network's own published icon (its favicon), same approach as the OS brand icons — never redrawn.
export const SOCIAL_DOMAINS: Partial<Record<SocialNetwork, string>> = { instagram: "www.instagram.com", facebook: "www.facebook.com", tiktok: "www.tiktok.com", whatsapp: "www.whatsapp.com", youtube: "www.youtube.com", linkedin: "www.linkedin.com", x: "x.com", google: "www.google.com" };

export type LinkBioLink = { id: string; label: string; url: string; enabled: boolean };
export type LinkBioSocial = { network: SocialNetwork; url: string };
export type LinkBioTheme = { brand: string; background: "light" | "dark" | "brand"; buttons: "solid" | "outline" | "soft" };
export type LinkBioPage = { slug: string; title: string; bio: string; avatar: string; links: LinkBioLink[]; socials: LinkBioSocial[]; theme: LinkBioTheme };
export type LinkBioClient = { id: string; name: string; logo?: string; color?: string; brand?: string; website?: string; phone?: string; email?: string };

const RESERVED = new Set(["manage", "admin", "api", "new", "edit", "preview"]);
const hex = (value: unknown, fallback: string) => typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value.trim()) ? value.trim().toLowerCase() : fallback;
const text = (value: unknown, max: number) => String(value ?? "").replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, max);

export function slugify(value: string) {
  return value.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/&/g, " and ").replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 40).replace(/-+$/g, "");
}
export function validSlug(slug: string) { return /^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/.test(slug) && !RESERVED.has(slug); }

/** Only web, email, phone and WhatsApp links. Bare domains get https://. Returns "" when unsafe. */
export function safeUrl(raw: unknown): string {
  let value = String(raw ?? "").trim();
  if (!value || value.length > 800) return "";
  // Plain phone numbers and email addresses typed into a link box become tel:/mailto: links.
  if (/^\+?[\d\s().-]{6,20}$/.test(value) && value.replace(/\D/g, "").length >= 6) value = `tel:${value}`;
  else if (/^[^\s@<>"':/]+@[^\s@<>"']+\.[a-z]{2,}$/i.test(value)) value = `mailto:${value}`;
  if (/^(mailto|tel):/i.test(value)) {
    const [scheme, rest] = [value.slice(0, value.indexOf(":") + 1).toLowerCase(), value.slice(value.indexOf(":") + 1)];
    if (scheme === "tel:") { const digits = rest.replace(/[^\d+]/g, ""); return digits.length >= 6 ? `tel:${digits}` : ""; }
    return /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/.test(rest) ? `mailto:${rest}` : "";
  }
  if (!/^https?:\/\//i.test(value)) { if (/^[\w.-]+\.[a-z]{2,}(\/|$)/i.test(value)) value = `https://${value}`; else return ""; }
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return "";
    if (url.username || url.password) return "";
    return url.toString();
  } catch { return ""; }
}

/** Turn a handle or number into a full social link (e.g. "@proroofers" on Instagram). */
export function socialUrl(network: SocialNetwork, raw: unknown): string {
  const value = String(raw ?? "").trim();
  if (!value) return "";
  if (network === "email") return safeUrl(value.startsWith("mailto:") ? value : `mailto:${value}`);
  if (network === "phone") return safeUrl(value.startsWith("tel:") ? value : `tel:${value}`);
  if (network === "whatsapp" && !/^https?:/i.test(value) && !value.includes(".")) { const digits = value.replace(/\D/g, "").replace(/^00/, ""); return digits.length >= 8 ? `https://wa.me/${digits}` : ""; }
  const handle = value.replace(/^@/, "");
  if (!/^https?:/i.test(value) && !value.includes(".") && /^[\w.]{1,60}$/.test(handle)) {
    const base: Partial<Record<SocialNetwork, string>> = { instagram: "https://www.instagram.com/", facebook: "https://www.facebook.com/", tiktok: "https://www.tiktok.com/@", youtube: "https://www.youtube.com/@", linkedin: "https://www.linkedin.com/company/", x: "https://x.com/" };
    if (base[network]) return `${base[network]}${handle}`;
  }
  return safeUrl(value);
}

const linkId = () => Math.random().toString(36).slice(2, 10);

/** Validate and clean a page sent from the editor. Throws a plain-English error when it can't be saved. */
export function sanitizePage(raw: unknown, client: LinkBioClient): LinkBioPage {
  const input = (raw && typeof raw === "object" ? raw : {}) as Record<string, unknown>;
  const slug = slugify(String(input.slug || ""));
  if (!validSlug(slug)) throw new Error("Choose a link name of 3–40 letters, numbers or dashes.");
  const avatar = typeof input.avatar === "string" && (/^https:\/\/\S+$/.test(input.avatar) || /^\/(?!\/)\S*$/.test(input.avatar) || (/^data:image\/(png|jpeg|webp|svg\+xml);base64,[A-Za-z0-9+/=]+$/.test(input.avatar) && input.avatar.length < 400_000)) ? input.avatar : "";
  const seen = new Set<string>();
  const links = (Array.isArray(input.links) ? input.links : []).slice(0, 20).map((item) => {
    const row = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    let id = /^[a-z0-9]{4,12}$/.test(String(row.id || "")) ? String(row.id) : linkId();
    while (seen.has(id)) id = linkId();
    seen.add(id);
    return { id, label: text(row.label, 60), url: safeUrl(row.url), enabled: row.enabled !== false };
  }).filter((link) => link.label || link.url);
  const bad = links.find((link) => !link.url || !link.label);
  if (bad) throw new Error(bad.label ? `“${bad.label}” needs a valid web address, email or phone number.` : "Every link needs a button label.");
  const socials: LinkBioSocial[] = [];
  for (const item of Array.isArray(input.socials) ? input.socials : []) {
    const row = (item && typeof item === "object" ? item : {}) as Record<string, unknown>;
    const network = SOCIAL_NETWORKS.find((key) => key === row.network);
    if (!network || socials.some((s) => s.network === network)) continue;
    const url = socialUrl(network, row.url);
    if (url) socials.push({ network, url });
  }
  const theme = (input.theme && typeof input.theme === "object" ? input.theme : {}) as Record<string, unknown>;
  return {
    slug,
    title: text(input.title, 60) || client.name,
    bio: text(input.bio, 160),
    avatar,
    links,
    socials,
    theme: {
      brand: hex(theme.brand, hex(client.brand, hex(client.color, "#1b8cf6"))),
      background: theme.background === "dark" || theme.background === "brand" ? theme.background : "light",
      buttons: theme.buttons === "outline" || theme.buttons === "soft" ? theme.buttons : "solid",
    },
  };
}

/** A starting page built only from what the OS already knows about the client (no invented links). */
export function defaultPage(client: LinkBioClient): LinkBioPage {
  const site = safeUrl(client.website);
  const phone = safeUrl(client.phone ? `tel:${client.phone}` : "");
  const email = safeUrl(client.email ? `mailto:${client.email}` : "");
  const links: LinkBioLink[] = [];
  if (site) links.push({ id: linkId(), label: "Visit our website", url: site, enabled: true });
  if (phone) links.push({ id: linkId(), label: "Call us", url: phone, enabled: true });
  if (email) links.push({ id: linkId(), label: "Email us", url: email, enabled: true });
  return { slug: slugify(client.name) || "my-links", title: client.name, bio: "", avatar: client.logo && /^(https:|data:image\/|\/)/.test(client.logo) ? client.logo : "", links, socials: [], theme: { brand: hex(client.brand, hex(client.color, "#1b8cf6")), background: "light", buttons: "solid" } };
}

function esc(value: string) { return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;"); }
function luminance(colour: string) {
  const n = parseInt(colour.slice(1), 16); const f = (v: number) => { const c = v / 255; return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
  return 0.2126 * f((n >> 16) & 255) + 0.7152 * f((n >> 8) & 255) + 0.0722 * f(n & 255);
}
const ICON_MAIL = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>`;
const ICON_PHONE = `<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 16.9v3a2 2 0 0 1-2.2 2 19.8 19.8 0 0 1-8.6-3.1 19.5 19.5 0 0 1-6-6A19.8 19.8 0 0 1 2.1 4.2 2 2 0 0 1 4.1 2h3a2 2 0 0 1 2 1.7c.1.9.4 1.8.7 2.7a2 2 0 0 1-.5 2.1L8 9.8a16 16 0 0 0 6 6l1.3-1.3a2 2 0 0 1 2.1-.4c.9.3 1.8.6 2.7.7a2 2 0 0 1 1.7 2z"/></svg>`;

/** The public page. `hrefFor` decides where buttons point (the click-counting redirect when live, the real URL in previews). */
export function renderLinkBioHtml(page: LinkBioPage, options: { canonical?: string; hrefFor?: (link: LinkBioLink) => string; preview?: boolean } = {}) {
  const brand = hex(page.theme.brand, "#1b8cf6");
  const brandLight = luminance(brand) > 0.45;
  const onBrand = brandLight ? "#0f1722" : "#ffffff";
  const bg = page.theme.background === "dark" ? "#0e1116" : page.theme.background === "brand" ? brand : "#f5f7fa";
  const ink = page.theme.background === "dark" || (page.theme.background === "brand" && !brandLight) ? "#ffffff" : "#0f1722";
  const muted = ink === "#ffffff" ? "rgba(255,255,255,.75)" : "#5b6675";
  // On a brand-coloured background the buttons flip to white so they never blend in.
  const btnBg = page.theme.background === "brand" ? (brandLight ? "#0f1722" : "#ffffff") : brand;
  const btnInk = page.theme.background === "brand" ? (brandLight ? "#ffffff" : brand) : onBrand;
  const card = page.theme.background === "dark" ? "#181c23" : "#ffffff";
  const buttonCss = page.theme.buttons === "outline"
    ? `background:transparent;color:${ink};border:2px solid ${btnBg}`
    : page.theme.buttons === "soft"
      ? `background:${card};color:${ink};border:1px solid ${ink === "#ffffff" ? "rgba(255,255,255,.14)" : "#e3e8ee"};box-shadow:0 4px 14px rgba(15,23,34,.07)`
      : `background:${btnBg};color:${btnInk};border:0`;
  const hrefFor = options.hrefFor || ((link: LinkBioLink) => link.url);
  const links = page.links.filter((link) => link.enabled && link.url).map((link) => {
    const external = /^https?:/i.test(link.url);
    return `<a class="btn" href="${esc(hrefFor(link))}"${external ? ' target="_blank" rel="noopener"' : ""}>${esc(link.label)}</a>`;
  }).join("");
  const socials = page.socials.map((social) => {
    const domain = SOCIAL_DOMAINS[social.network];
    const icon = domain ? `<img src="https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&amp;sz=64" alt="" width="22" height="22" loading="lazy">` : social.network === "email" ? ICON_MAIL : ICON_PHONE;
    const external = /^https?:/i.test(social.url);
    return `<a class="soc" href="${esc(social.url)}" aria-label="${esc(SOCIAL_LABELS[social.network])}" title="${esc(SOCIAL_LABELS[social.network])}"${external ? ' target="_blank" rel="noopener"' : ""}>${icon}</a>`;
  }).join("");
  const initials = page.title.split(/\s+/).filter(Boolean).slice(0, 2).map((word) => word[0]?.toUpperCase() || "").join("") || "•";
  const avatar = page.avatar ? `<img class="av" src="${esc(page.avatar)}" alt="${esc(page.title)} logo">` : `<div class="av av-txt">${esc(initials)}</div>`;
  const description = page.bio || `Links for ${page.title}`;
  return `<!doctype html><html lang="en-IE"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(page.title)}</title><meta name="description" content="${esc(description)}">${options.preview ? '<meta name="robots" content="noindex">' : ""}
${options.canonical ? `<link rel="canonical" href="${esc(options.canonical)}"><meta property="og:url" content="${esc(options.canonical)}">` : ""}
<meta property="og:title" content="${esc(page.title)}"><meta property="og:description" content="${esc(description)}">${page.avatar && /^https:/.test(page.avatar) ? `<meta property="og:image" content="${esc(page.avatar)}">` : ""}
<meta name="theme-color" content="${bg}">
<style>
*{box-sizing:border-box}html,body{margin:0;min-height:100%}body{background:${bg};color:${ink};font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;-webkit-font-smoothing:antialiased}
main{max-width:520px;margin:0 auto;padding:48px 20px 32px;display:flex;flex-direction:column;align-items:center;text-align:center;min-height:100vh}
.av{width:96px;height:96px;border-radius:50%;object-fit:contain;background:${card};box-shadow:0 8px 28px rgba(15,23,34,.12);padding:10px}
.av-txt{display:grid;place-items:center;font-weight:800;font-size:32px;color:${brand};padding:0}
h1{font-size:22px;margin:16px 0 4px;letter-spacing:-.01em}p.bio{margin:0;color:${muted};font-size:15px;line-height:1.5;max-width:420px}
.socials{display:flex;flex-wrap:wrap;justify-content:center;gap:10px;margin:18px 0 6px}
.soc{width:44px;height:44px;border-radius:50%;display:grid;place-items:center;background:${card};color:${ink === "#ffffff" && page.theme.background === "dark" ? "#fff" : "#0f1722"};box-shadow:0 3px 12px rgba(15,23,34,.1);transition:transform .15s}
.soc:hover{transform:translateY(-2px)}.soc img{border-radius:5px}
.links{width:100%;display:flex;flex-direction:column;gap:12px;margin-top:22px}
.btn{display:block;width:100%;padding:16px 18px;border-radius:14px;font-weight:700;font-size:16px;text-decoration:none;${buttonCss};transition:transform .15s,box-shadow .15s}
.btn:hover{transform:translateY(-2px);box-shadow:0 8px 22px rgba(15,23,34,.16)}
.btn:focus-visible,.soc:focus-visible{outline:3px solid ${ink === "#ffffff" ? "#fff" : brand};outline-offset:3px}
.empty{color:${muted};font-size:14px;margin-top:24px}
footer{margin-top:auto;padding-top:36px;font-size:12px;color:${muted}}footer a{color:inherit}
@media (prefers-reduced-motion:reduce){.btn,.soc{transition:none}.btn:hover,.soc:hover{transform:none}}
</style></head><body><main>
${avatar}<h1>${esc(page.title)}</h1>${page.bio ? `<p class="bio">${esc(page.bio)}</p>` : ""}
${socials ? `<nav class="socials" aria-label="Social links">${socials}</nav>` : ""}
${links ? `<div class="links">${links}</div>` : '<p class="empty">Links coming soon.</p>'}
<footer>Made by <a href="https://f2bmedia.com/?utm_source=link_in_bio&amp;utm_medium=referral" target="_blank" rel="noopener">F2B Media</a></footer>
</main></body></html>`;
}
