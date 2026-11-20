// Proposal Studio · reusable service catalogue.
// Default copy and prices for every service F2B proposes. The agency can override any entry in
// Operations → Reports → Proposals → Catalogue (saved per agency in proposal_settings.catalogue).
// Pure data — imported by the API, the renderer and the browser editor.

export type ServiceVisual = "search" | "maps" | "seo" | "ai" | "site" | "landing" | "handover" | "social" | "retarget" | "email" | "whatsapp" | "calls" | "dashboard";

export type CatalogueService = {
  key: string;
  name: string;
  /** Matches the client "Add service" groups so proposals and client services line up. */
  group: "Google" | "Marketing" | "AI" | "Websites & CRM";
  /** The client service line this becomes when the prospect is onboarded (empty = one-off, no client service). */
  clientService?: string;
  /** Campaign label on the client service line (e.g. Retargeting under Meta Ads). */
  clientCampaign?: string;
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
  { key: "google-ads", name: "Google Ads", group: "Google", clientService: "Google Ads", visual: "search", setupFee: 497, monthlyFee: 597, mediaNote: "€25/day suggested ad budget, paid straight to Google",
    tagline: "Be the first business people see when they search for what you do.",
    summary: "Your business appears at the top of Google the moment someone searches for your services. You only pay when someone clicks, and we track every call and enquiry so you can see exactly what you're getting back.",
    deliverables: ["Your ads at the top of Google", "Only shown to people looking for you", "Every call and enquiry tracked", "A simple monthly report"] },
  { key: "seo", name: "SEO", group: "Google", clientService: "SEO", visual: "seo", setupFee: 0, monthlyFee: 297,
    tagline: "Show up on Google and in AI answers, month after month.",
    summary: "We fix the technical side of your website, write advice posts that answer your customers' questions, and get you showing up on Google and in ChatGPT's answers, all tracked in Search Console and Analytics.",
    deliverables: ["Technical fixes and faster pages", "Advice posts answering real questions", "Found in ChatGPT & Google AI answers", "Search Console & Analytics reports"] },
  { key: "geo", name: "GEO — Get recommended by AI", group: "Google", clientService: "SEO", clientCampaign: "GEO", visual: "ai", setupFee: 0, monthlyFee: 197, addon: true,
    tagline: "Get recommended when people ask ChatGPT or Google's AI.",
    summary: "More people now ask ChatGPT and Google's AI who to call. We make sure your business is the one they recommend.",
    deliverables: ["Recommended by ChatGPT & Google AI", "Your details correct everywhere", "Content AI tools trust", "Monthly AI check-up"] },
  { key: "aeo", name: "AEO — Answer your customers' questions", group: "Google", clientService: "SEO", clientCampaign: "AEO", visual: "ai", setupFee: 0, monthlyFee: 147, addon: true,
    tagline: "Be the answer when customers ask a question online.",
    summary: "We write clear answers to the questions your customers ask, so Google and voice assistants show your business as the answer.",
    deliverables: ["Answers to real customer questions", "Shown in Google's answer boxes", "Works with voice search", "Monthly progress check"] },
  { key: "gbp", name: "Google Business Profile", group: "Google", clientService: "Google Business Profile", visual: "maps", setupFee: 149, monthlyFee: 97,
    tagline: "Stand out on Google Maps in your area.",
    summary: "Your Google Maps listing kept fresh with posts, photos and a steady stream of 5-star reviews, so you're the business locals call first.",
    deliverables: ["Your Maps listing fully set up", "Weekly posts and photos", "More 5-star reviews", "Replies to every review"] },
  { key: "reviews", name: "AI Reviews", group: "Google", clientService: "AI Reviews", visual: "maps", setupFee: 0, monthlyFee: 49, addon: true,
    tagline: "More 5-star Google reviews, on autopilot.",
    summary: "After every job your customers get a friendly text or email asking for a review, and unhappy customers are sent to you first. AI drafts a reply to every review for you to approve.",
    deliverables: ["Review requests after every job", "Unhappy customers come to you first", "AI-drafted review replies", "More stars, more calls"] },
  { key: "website", name: "Website", group: "Websites & CRM", clientService: "Web Design & Development", visual: "site", setupFee: 1497, monthlyFee: 49,
    tagline: "A modern website that turns visitors into enquiries.",
    summary: "A fast, good-looking website in your branding, with a page for each of your services and a quote form on every page, so visitors become enquiries.",
    deliverables: ["Designed in your branding", "A page for every service", "A quote form on every page", "Looks great on phones", "Hosting and care included"] },
  { key: "meta-ads", name: "Facebook & Instagram Ads", group: "Marketing", clientService: "Meta Ads", visual: "social", setupFee: 297, monthlyFee: 397, mediaNote: "€15/day suggested ad budget, paid straight to Meta",
    tagline: "Reach the right local people on Facebook and Instagram.",
    summary: "Eye-catching ads for your services shown to people in your area, with a simple way to get in touch. Every enquiry lands straight in your CRM.",
    deliverables: ["Ads for each of your services", "Shown to people in your area", "Great photos and wording", "Enquiries straight to your phone"] },
  { key: "retargeting", name: "Retargeting", group: "Marketing", clientService: "Meta Ads", clientCampaign: "Retargeting", visual: "retarget", setupFee: 0, monthlyFee: 147, mediaNote: "€10/day suggested budget", addon: true,
    tagline: "Stay in front of people who've already visited your website.",
    summary: "Friendly reminder ads for people who've already looked at your website, so they think of you when they're ready to book.",
    deliverables: ["Reminds website visitors", "On Facebook, Instagram & Google", "Fresh ads every month", "Never pushy"] },
  { key: "social", name: "Social Media", group: "Marketing", clientService: "Social Posts", visual: "social", setupFee: 0, monthlyFee: 347, addon: true,
    tagline: "A professional social media presence, done for you.",
    summary: "We plan, design and post content for you every week, so your pages always look active and professional.",
    deliverables: ["12 posts a month", "Stories and short videos", "Written in your voice", "Monthly round-up"] },
  { key: "email", name: "Email Marketing", group: "Marketing", clientService: "Email Marketing", visual: "email", setupFee: 0, monthlyFee: 85, addon: true,
    tagline: "Stay in touch and turn interest into bookings.",
    summary: "Friendly emails that follow up with new enquiries and keep past customers coming back, sent automatically in your branding.",
    deliverables: ["Automatic follow-ups", "A monthly newsletter", "Designed in your branding", "See who opens and clicks"] },
  { key: "whatsapp", name: "WhatsApp & AI Assistant", group: "AI", clientService: "AI Chat", visual: "whatsapp", setupFee: 0, monthlyFee: 20, addon: true,
    tagline: "Reply to every enquiry in seconds, day or night.",
    summary: "Every enquiry gets an instant, friendly reply on WhatsApp. The assistant learns from your past conversations so it sounds like you, and it never sends an invoice or booking link without your approval.",
    deliverables: ["Instant replies, day or night", "Learns to sound like you", "Answers questions for you", "Invoices & booking links need your OK"] },
  { key: "ai-calls", name: "AI Call Answering", group: "AI", clientService: "AI Phone Agent", visual: "calls", setupFee: 0, monthlyFee: 97, addon: true,
    tagline: "Every call answered, even when you're busy on a job.",
    summary: "A friendly AI receptionist answers your calls day or night, takes the caller's details, answers common questions and offers appointment times. Every call is recorded and summarised in your CRM, so no enquiry slips through.",
    deliverables: ["Every call answered, 24/7", "Natural, friendly voice", "Call notes & recordings in your CRM", "Missed calls get a text back"] },
  { key: "setup", name: "Technical Setup & Handover", group: "Websites & CRM", visual: "handover", setupFee: 0, monthlyFee: 0,
    tagline: "We handle the whole switch-over — fast, with no setbacks.",
    summary: "We take care of the entire handover: your domain, Google Analytics (GA4) and call & form tracking. Your Google rankings belong to your domain, so all your existing SEO work is kept. It's done quickly, with no downtime and no setbacks.",
    deliverables: ["Domain and email moved safely", "Google Analytics (GA4) set up", "Call & form tracking working", "All your SEO work kept"] },
  { key: "crm", name: "CRM & Reporting", group: "Websites & CRM", clientService: "CRM", visual: "dashboard", setupFee: 0, monthlyFee: 97,
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
    else if (clean.name) out.push({ key: raw.key.replace(/[^a-z0-9-]/gi, "").slice(0, 40) || `custom-${out.length}`, group: "Websites & CRM", visual: "dashboard", tagline: "", summary: "", deliverables: [], setupFee: 0, monthlyFee: 0, ...clean } as CatalogueService);
  }
  return out;
}
