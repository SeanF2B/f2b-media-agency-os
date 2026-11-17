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
  { key: "google-ads", name: "Google Ads", group: "Search", visual: "search", setupFee: 497, monthlyFee: 597, mediaNote: "€25/day suggested ad budget, paid straight to Google",
    tagline: "Be the first business people see when they search for what you do.",
    summary: "Your business appears at the top of Google the moment someone searches for your services. You only pay when someone clicks, and we track every call and enquiry so you can see exactly what you're getting back.",
    deliverables: ["Your ads at the top of Google", "Only shown to people looking for you", "Every call and enquiry tracked", "A simple monthly report"] },
  { key: "seo", name: "SEO", group: "Search", visual: "seo", setupFee: 0, monthlyFee: 297,
    tagline: "Show up on Google for free, month after month.",
    summary: "We help your website climb Google's free results for the searches your customers make, so new enquiries keep coming in without paying for every click.",
    deliverables: ["Climb Google's free results", "A page for each of your services", "Website fixes so Google loves it", "Monthly ranking updates"] },
  { key: "geo", name: "GEO — Get recommended by AI", group: "Search", visual: "ai", setupFee: 0, monthlyFee: 197, addon: true,
    tagline: "Get recommended when people ask ChatGPT or Google's AI.",
    summary: "More people now ask ChatGPT and Google's AI who to call. We make sure your business is the one they recommend.",
    deliverables: ["Recommended by ChatGPT & Google AI", "Your details correct everywhere", "Content AI tools trust", "Monthly AI check-up"] },
  { key: "aeo", name: "AEO — Answer your customers' questions", group: "Search", visual: "ai", setupFee: 0, monthlyFee: 147, addon: true,
    tagline: "Be the answer when customers ask a question online.",
    summary: "We write clear answers to the questions your customers ask, so Google and voice assistants show your business as the answer.",
    deliverables: ["Answers to real customer questions", "Shown in Google's answer boxes", "Works with voice search", "Monthly progress check"] },
  { key: "gbp", name: "Google Business Profile", group: "Search", visual: "maps", setupFee: 149, monthlyFee: 97,
    tagline: "Stand out on Google Maps in your area.",
    summary: "Your Google Maps listing kept fresh with posts, photos and a steady stream of 5-star reviews, so you're the business locals call first.",
    deliverables: ["Your Maps listing fully set up", "Weekly posts and photos", "More 5-star reviews", "Replies to every review"] },
  { key: "website", name: "Website", group: "Websites", visual: "site", setupFee: 1497, monthlyFee: 49,
    tagline: "A modern website that turns visitors into enquiries.",
    summary: "A fast, good-looking website in your branding, with a page for each of your services and a quote form on every page, so visitors become enquiries.",
    deliverables: ["Designed in your branding", "A page for every service", "A quote form on every page", "Looks great on phones", "Hosting and care included"] },
  { key: "meta-ads", name: "Facebook & Instagram Ads", group: "Social", visual: "social", setupFee: 297, monthlyFee: 397, mediaNote: "€15/day suggested ad budget, paid straight to Meta",
    tagline: "Reach the right local people on Facebook and Instagram.",
    summary: "Eye-catching ads for your services shown to people in your area, with a simple way to get in touch. Every enquiry lands straight in your CRM.",
    deliverables: ["Ads for each of your services", "Shown to people in your area", "Great photos and wording", "Enquiries straight to your phone"] },
  { key: "retargeting", name: "Retargeting", group: "Social", visual: "retarget", setupFee: 0, monthlyFee: 147, mediaNote: "€10/day suggested budget", addon: true,
    tagline: "Stay in front of people who've already visited your website.",
    summary: "Friendly reminder ads for people who've already looked at your website, so they think of you when they're ready to book.",
    deliverables: ["Reminds website visitors", "On Facebook, Instagram & Google", "Fresh ads every month", "Never pushy"] },
  { key: "social", name: "Social Media", group: "Social", visual: "social", setupFee: 0, monthlyFee: 347, addon: true,
    tagline: "A professional social media presence, done for you.",
    summary: "We plan, design and post content for you every week, so your pages always look active and professional.",
    deliverables: ["12 posts a month", "Stories and short videos", "Written in your voice", "Monthly round-up"] },
  { key: "email", name: "Email Marketing", group: "Automation", visual: "email", setupFee: 0, monthlyFee: 85, addon: true,
    tagline: "Stay in touch and turn interest into bookings.",
    summary: "Friendly emails that follow up with new enquiries and keep past customers coming back, sent automatically in your branding.",
    deliverables: ["Automatic follow-ups", "A monthly newsletter", "Designed in your branding", "See who opens and clicks"] },
  { key: "whatsapp", name: "WhatsApp & AI Assistant", group: "Automation", visual: "whatsapp", setupFee: 0, monthlyFee: 20, addon: true,
    tagline: "Reply to every enquiry in seconds, day or night.",
    summary: "When someone gets in touch they get an instant, friendly reply on WhatsApp, and our AI assistant can answer questions and book them in for you.",
    deliverables: ["Instant WhatsApp replies", "Answers common questions", "Books appointments for you", "Hands over to you anytime"] },
  { key: "crm", name: "CRM & Reporting", group: "Automation", visual: "dashboard", setupFee: 0, monthlyFee: 97,
    tagline: "See every enquiry and sale in one place.",
    summary: "Every call, form and message in one simple app, with a clear view of what your marketing costs and what it brings in.",
    deliverables: ["All your enquiries in one app", "Calls and forms tracked", "See what each lead is worth", "Monthly results chat"] },
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
