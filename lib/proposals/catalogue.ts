// Proposal Studio · reusable service catalogue.
// Default copy and prices for every service F2B proposes. The agency can override any entry in
// Operations → Reports → Proposals → Catalogue (saved per agency in proposal_settings.catalogue).
// Pure data — imported by the API, the renderer and the browser editor.

export type ServiceVisual = "search" | "maps" | "seo" | "ai" | "site" | "landing" | "social" | "retarget" | "email" | "whatsapp" | "dashboard";

export type CatalogueService = {
  key: string;
  name: string;
  group: "Search" | "Websites" | "Social" | "Automation";
  /** One-line promise shown under the slide heading. */
  tagline: string;
  /** Short paragraph for the white feature card on the service slide. */
  summary: string;
  deliverables: string[];
  /** Default pricing in the agency currency. 0 = not charged / scoped separately. */
  setupFee: number;
  monthlyFee: number;
  /** Suggested media budget line (paid separately to the platform), e.g. "€25/day". */
  mediaNote?: string;
  visual: ServiceVisual;
  /** Usually sold as an optional add-on rather than the core package. */
  addon?: boolean;
};

export const SERVICE_CATALOGUE: CatalogueService[] = [
  { key: "google-ads", name: "Google Ads", group: "Search", visual: "search", setupFee: 497, monthlyFee: 597, mediaNote: "€25/day recommended starting budget, paid directly to Google",
    tagline: "Be the first business they see when they're ready to buy.",
    summary: "Search campaigns built around high-intent keywords, with landing pages that match what people are actually searching for, so your budget goes on enquiries rather than browsing.",
    deliverables: ["Keyword research & campaign structure", "Ad copy and assets written for each service", "Conversion tracking on calls and forms", "Weekly optimisation and negative keyword management", "Monthly performance report"] },
  { key: "seo", name: "SEO", group: "Search", visual: "seo", setupFee: 0, monthlyFee: 297,
    tagline: "Long-term visibility that keeps working when ads are paused.",
    summary: "Technical fixes, service and location pages and ongoing content that help you rank for the searches your customers make, using real search data to decide what to write.",
    deliverables: ["Technical SEO audit & fixes", "Service and location pages", "Keyword tracking (15 priority keywords)", "On-page optimisation", "Monthly ranking report"] },
  { key: "geo", name: "GEO — Generative Engine Optimisation", group: "Search", visual: "ai", setupFee: 0, monthlyFee: 197, addon: true,
    tagline: "Get recommended by ChatGPT, Gemini and Perplexity.",
    summary: "We structure your content, reviews and brand mentions so AI assistants understand who you are and recommend you when people ask for a business like yours.",
    deliverables: ["AI visibility baseline test", "Entity & brand consistency fixes", "Content written for AI citation", "Structured data (schema)", "Monthly AI visibility tracking"] },
  { key: "aeo", name: "AEO — Answer Engine Optimisation", group: "Search", visual: "ai", setupFee: 0, monthlyFee: 147, addon: true,
    tagline: "Own the answer to your customers' questions.",
    summary: "Clear, expert answers to the questions your customers ask, formatted for Google's AI Overviews, featured snippets and voice search.",
    deliverables: ["Customer question research", "FAQ and answer content", "FAQ / HowTo schema", "Featured snippet targeting", "Answer visibility tracking"] },
  { key: "gbp", name: "Google Business Profile", group: "Search", visual: "maps", setupFee: 149, monthlyFee: 97,
    tagline: "Stand out on Google Maps in your area.",
    summary: "A fully optimised Google Business Profile with regular posts, photos and a steady flow of reviews, so you show up in the map pack when locals search.",
    deliverables: ["Profile audit & full optimisation", "Weekly Google posts", "Review request automation", "Review reply drafts", "Local ranking grid tracking"] },
  { key: "website", name: "Website Design & Development", group: "Websites", visual: "site", setupFee: 1497, monthlyFee: 49,
    tagline: "A fast, modern website built to turn visitors into enquiries.",
    summary: "A custom-designed, mobile-first website with clear service pages, strong calls to action and lead capture connected straight into your CRM.",
    deliverables: ["Custom design in your branding", "Up to 8 pages incl. service pages", "Mobile-first, fast loading", "Forms connected to your CRM", "Hosting, SSL & care plan"] },
  { key: "landing", name: "Landing Pages & CRO", group: "Websites", visual: "landing", setupFee: 397, monthlyFee: 97,
    tagline: "Pages designed to convert, tested to keep improving.",
    summary: "Dedicated landing pages for each campaign and service, with one clear action, social proof and ongoing conversion testing to lower your cost per lead.",
    deliverables: ["Campaign landing pages", "Lead forms with thank-you tracking", "Heatmap & behaviour review", "A/B testing", "Monthly conversion report"] },
  { key: "meta-ads", name: "Meta Ads", group: "Social", visual: "social", setupFee: 297, monthlyFee: 397, mediaNote: "€15/day recommended starting budget, paid directly to Meta",
    tagline: "Reach the right people on Facebook and Instagram.",
    summary: "Scroll-stopping Facebook and Instagram campaigns aimed at your ideal customers, with lead forms and tracking that connect straight into your pipeline.",
    deliverables: ["Audience research & targeting", "Ad creative and copy", "Lead form or landing page setup", "Pixel & conversion tracking", "Weekly optimisation"] },
  { key: "retargeting", name: "Retargeting", group: "Social", visual: "retarget", setupFee: 0, monthlyFee: 147, mediaNote: "€10/day recommended re-targeting budget", addon: true,
    tagline: "Stay visible to people who've already shown interest.",
    summary: "Light-touch ads that follow up with people who visited your website, keeping your work in front of them without pushing too hard.",
    deliverables: ["Website visitor audiences", "Instagram, Facebook & Google retargeting", "Creative refreshed monthly", "Frequency caps", "Assisted conversion reporting"] },
  { key: "social", name: "Social Media Management", group: "Social", visual: "social", setupFee: 0, monthlyFee: 347, addon: true,
    tagline: "A consistent, professional presence on social.",
    summary: "A planned content calendar with posts, reels and stories written and designed in your brand voice, published for you every week.",
    deliverables: ["Monthly content calendar", "12 posts / month", "Stories & reels", "Community replies", "Monthly engagement report"] },
  { key: "email", name: "Email Marketing", group: "Automation", visual: "email", setupFee: 0, monthlyFee: 85, addon: true,
    tagline: "Stay in touch. Turn interest into enquiries.",
    summary: "Automated follow-ups and regular newsletters that keep you front of mind, share your latest work and make the next step easy.",
    deliverables: ["Welcome & follow-up sequences", "Monthly newsletter", "List segmentation", "Templates in your branding", "Open & click reporting"] },
  { key: "whatsapp", name: "WhatsApp & AI Automation", group: "Automation", visual: "whatsapp", setupFee: 0, monthlyFee: 20, addon: true,
    tagline: "Reply to every enquiry in seconds, day or night.",
    summary: "When someone submits a form they get an instant WhatsApp follow-up, and an AI assistant can answer questions and book them in.",
    deliverables: ["Instant WhatsApp follow-up", "AI replies to common questions", "Appointment booking", "Missed-call text back", "Hand-over to your team"] },
  { key: "crm", name: "CRM, Tracking & Reporting", group: "Automation", visual: "dashboard", setupFee: 0, monthlyFee: 97,
    tagline: "See every lead, sale and euro in one place.",
    summary: "Every enquiry, call and sale tracked in one CRM and mobile app, with a live dashboard showing ad spend, leads, cost per lead and revenue.",
    deliverables: ["CRM & mobile app", "Call and form tracking", "Live reporting dashboard", "Pipeline & stage values", "Monthly review call"] },
];

export const catalogueByKey = (catalogue: CatalogueService[] = SERVICE_CATALOGUE) => new Map(catalogue.map((item) => [item.key, item]));

/** Merges saved overrides onto the defaults (unknown keys are kept as custom services). */
export function mergeCatalogue(overrides: Partial<CatalogueService>[] | null | undefined): CatalogueService[] {
  const out = SERVICE_CATALOGUE.map((item) => ({ ...item, deliverables: [...item.deliverables] }));
  for (const raw of Array.isArray(overrides) ? overrides : []) {
    if (!raw || typeof raw.key !== "string") continue;
    const index = out.findIndex((item) => item.key === raw.key);
    const clean: Partial<CatalogueService> = {};
    if (typeof raw.name === "string" && raw.name.trim()) clean.name = raw.name.trim().slice(0, 80);
    if (typeof raw.tagline === "string") clean.tagline = raw.tagline.slice(0, 200);
    if (typeof raw.summary === "string") clean.summary = raw.summary.slice(0, 600);
    if (Array.isArray(raw.deliverables)) clean.deliverables = raw.deliverables.map((d) => String(d).slice(0, 120)).filter(Boolean).slice(0, 10);
    if (Number.isFinite(Number(raw.setupFee))) clean.setupFee = Math.max(0, Math.round(Number(raw.setupFee)));
    if (Number.isFinite(Number(raw.monthlyFee))) clean.monthlyFee = Math.max(0, Math.round(Number(raw.monthlyFee)));
    if (typeof raw.mediaNote === "string") clean.mediaNote = raw.mediaNote.slice(0, 160);
    if (typeof raw.addon === "boolean") clean.addon = raw.addon;
    if (index >= 0) out[index] = { ...out[index], ...clean };
    else if (clean.name) out.push({ key: raw.key.replace(/[^a-z0-9-]/gi, "").slice(0, 40) || `custom-${out.length}`, group: "Automation", visual: "dashboard", tagline: "", summary: "", deliverables: [], setupFee: 0, monthlyFee: 0, ...clean } as CatalogueService);
  }
  return out;
}
