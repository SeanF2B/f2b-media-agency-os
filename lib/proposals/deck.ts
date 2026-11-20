// Proposal Studio · deck model.
// A proposal is a list of slides. Each slide has a kind (which layout/graphic it uses) and plain editable
// text data. buildDeck() always produces a complete, valid deck from the proposal inputs and the catalogue;
// AI copy (when available) is merged on top, so a failed or partial AI reply never breaks a proposal.
// Pure module: used by the API, the public share page and the in-browser live editor.

import { SERVICE_CATALOGUE, catalogueByKey, type CatalogueService } from "./catalogue";

export type SlideKind = "aiteam" | "cover" | "goal" | "audience" | "findings" | "service" | "examples" | "cycle" | "dashboard" | "implementation" | "timeline" | "expect" | "investment" | "addons" | "closing";
export type Slide = { id: string; kind: SlideKind; hidden?: boolean; data: Record<string, any> };
export type ProposalDeck = { version: 1; accent: string; slides: Slide[] };

export type ProposalBrand = {
  businessName: string; website: string; logo: string; colours: string[];
  description: string; services: string; areas: string; audience: string;
  screenshotDesktop: string; screenshotMobile: string; images: string[];
};
export type ProposalSource = { id: string; label: string; kind: "audit" | "report" | "notes" | "crm" | "upload"; text: string };
export type ProposalUpload = { id: string; name: string; kind: string; size: number; image: boolean };
export type ProposalInputs = {
  goal: string; audience: string; discoveryNotes: string; requirements: string; instructions: string;
  startMonth: string; currency: string; terms: string; sources: ProposalSource[];
};
export type SelectedService = { key: string; setupFee: number; monthlyFee: number; addon: boolean };

export const SLIDE_KINDS: Array<{ kind: SlideKind; label: string; hint: string }> = [
  { kind: "cover", label: "Cover", hint: "Welcome slide with their website on a desktop" },
  { kind: "goal", label: "Goal", hint: "What we're setting out to achieve" },
  { kind: "service", label: "Service", hint: "One service with a branded example" },
  { kind: "timeline", label: "Project timeline", hint: "Month-by-month roadmap" },
  { kind: "dashboard", label: "CRM & AI assistant", hint: "Their CRM dashboard, pipeline and AI bot" },
  { kind: "aiteam", label: "Your AI team", hint: "Telegram briefing bot, CRM assistant and Conversation AI" },
  { kind: "investment", label: "Investment", hint: "Pricing summary" },
  { kind: "addons", label: "Optional add-ons", hint: "Extras not included" },
  { kind: "closing", label: "Next steps", hint: "Closing slide and call to action" },
];

const sid = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID().slice(0, 8) : Math.random().toString(36).slice(2, 10));
const money = (value: number, currency: string) => {
  const symbol = currency === "GBP" ? "£" : currency === "USD" ? "$" : "€";
  return `${symbol}${Math.round(value).toLocaleString("en-IE")}`;
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function monthsFrom(start: string, count: number) {
  const [y, m] = /^\d{4}-\d{2}$/.test(start) ? start.split("-").map(Number) : [new Date().getFullYear(), new Date().getMonth() + 2];
  return Array.from({ length: count }, (_, index) => MONTHS[(m - 1 + index) % 12]);
}
const first = (text: string, fallback: string) => (String(text || "").trim() || fallback);

/** AI copy shape — every field is plain text; merged onto the deterministic deck. */
export type AiCopy = {
  coverEyebrow: string; coverTitle: string; coverHighlight: string; coverSubtitle: string;
  goalHeading: string; goal: string;
  audienceHeading: string; audience: string[];
  findingsIntro: string; findings: Array<{ title: string; detail: string }>;
  services: Array<{ key: string; heading: string; cardTitle: string; cardBody: string; bullets: string[]; labels: string[] }>;
  phases: Array<{ title: string; text: string }>;
  timeline: Array<{ caption: string }>;
  expectHeading: string; expect: string[];
  closingHeading: string; closing: string;
  /** What people type into Google to find this business (their services + area), e.g. "boiler repair dublin". */
  keywords: string[];
  searchAd: { headline: string; description: string };
  /** Example Meta/Instagram ads: each promotes one of THEIR services with an offer. */
  ads: Array<{ service: string; primaryText: string; headline: string; offer: string; cta: string }>;
};

const F2B_SERVICE_NAMES = /^(google ads|seo|geo|aeo|google business profile|gbp|meta ads|facebook ads|retargeting|social media( management)?|email( marketing)?|website( design)?|landing pages?|cro|crm|whatsapp)$/i;
const titleCase = (text: string) => text.replace(/\b\w/g, (c) => c.toUpperCase());
/** The business's OWN services (never F2B's), from the extracted services field or their description. */
export function businessServices(brand: Pick<ProposalBrand, "services" | "description">): string[] {
  const listed = String(brand.services || "").split(/[,\n;•|]+/).map((item) => item.trim()).filter((item) => item && !F2B_SERVICE_NAMES.test(item));
  if (listed.length) return listed.slice(0, 8);
  const match = String(brand.description || "").match(/(?:provides?|offers?|specialis\w* in|delivers?|does|for)\s+(.+?)(?:\s+(?:across|in|throughout|for|to)\s+[A-Z]|[.!]|$)/);
  return match ? match[1].split(/,|\band\b|&/).map((item) => item.trim().replace(/^(?:all|professional|expert|reliable)\s+/i, "")).filter((item) => item.length > 2 && item.length < 40).slice(0, 6) : [];
}
export function businessArea(brand: Pick<ProposalBrand, "areas" | "description">): string {
  const area = String(brand.areas || "").split(/[,\n;]/)[0].trim();
  if (area && area.length > 2) return area;
  return String(brand.description || "").match(/(?:across|in|throughout|serving)\s+((?:County |Co\. )?[A-Z][a-z]+(?:\s[A-Z][a-z]+)?)/)?.[1] || "";
}
/** Fallback search keywords from their services + area. */
export function defaultKeywords(brand: ProposalBrand): string[] {
  const area = businessArea(brand).toLowerCase();
  const services = businessServices(brand).map((item) => item.toLowerCase());
  const base = services.length ? services : [String(brand.businessName || "local service").toLowerCase()];
  const out = base.flatMap((service) => [area ? `${service} ${area}` : service, `${service} near me`]);
  return [...new Set(out)].slice(0, 6);
}
export function defaultAds(brand: ProposalBrand) {
  const services = businessServices(brand);
  const area = businessArea(brand);
  const picks = (services.length ? services : ["Our services"]).slice(0, 3);
  while (picks.length < 3) picks.push(picks[picks.length - 1]);
  const offers = ["Free quote in 24 hours", "10% off your first job", "Limited slots this month"];
  const ctas = ["Get Quote", "Book Now", "Learn More"];
  return picks.map((service, index) => ({
    service: titleCase(service),
    primaryText: index === 0 ? `Need ${service.toLowerCase()}${area ? ` in ${area}` : ""}? ${brand.businessName || "We"} can help — fast, friendly and fully sorted.` : index === 1 ? `${titleCase(service)} done right, first time. Trusted by homeowners${area ? ` across ${area}` : ""}.` : `Planning ${service.toLowerCase()}? Talk to the local team at ${brand.businessName || "our team"}.`,
    headline: titleCase(service) + (area ? ` · ${area}` : ""),
    offer: offers[index],
    cta: ctas[index],
  }));
}

export function buildDeck(input: {
  brand: ProposalBrand; inputs: ProposalInputs; services: SelectedService[]; catalogue?: CatalogueService[]; ai?: Partial<AiCopy> | null; agencyContact?: string;
}): ProposalDeck {
  const { brand, inputs } = input;
  const ai = input.ai || {};
  const catalogue = catalogueByKey(input.catalogue || SERVICE_CATALOGUE);
  const name = first(brand.businessName, "Your business");
  const picked = input.services.map((item) => ({ ...item, def: catalogue.get(item.key) })).filter((item): item is SelectedService & { def: CatalogueService } => Boolean(item.def));
  const core = picked.filter((item) => !item.addon);
  const handover = core.find((item) => item.key === "setup");
  const coreServices = core.filter((item) => item.key !== "setup").sort((a, b) => storyRank(a.key) - storyRank(b.key));
  const addons = picked.filter((item) => item.addon);
  const currency = inputs.currency || "EUR";
  const aiService = (key: string) => (ai.services || []).find((item) => item?.key === key);
  const slides: Slide[] = [];
  const add = (kind: SlideKind, data: Record<string, any>) => slides.push({ id: sid(), kind, data });

  add("cover", {
    eyebrow: first(ai.coverEyebrow || "", "Welcome to"),
    title: first(ai.coverTitle || "", "Your Client"),
    highlight: first(ai.coverHighlight || "", "Acquisition System"),
    subtitle: first(ai.coverSubtitle || "", `Prepared for ${name}`),
  });
  add("goal", {
    heading: first(ai.goalHeading || "", "Goal:"),
    body: first(ai.goal || inputs.goal, `Build a more predictable pipeline of enquiries for ${name} through ${core.map((item) => item.def.name).slice(0, 3).join(", ") || "search and your website"}, with a website journey that makes it easy for the right people to get in touch.`),
    notification: "New enquiry",
    notificationText: "You have received a new enquiry.",
  });
  // Kept simple like the original proposals: cover, goal, one slide per service, timeline, CRM, investment.
  coreServices.forEach((item, index) => {
    const copy = aiService(item.key);
    add("service", {
      serviceKey: item.key,
      eyebrow: `Phase ${index + 1}`,
      heading: first(copy?.heading || "", `Phase ${index + 1}: ${item.def.name}`),
      cardTitle: first(copy?.cardTitle || "", item.def.name),
      cardBody: first(copy?.cardBody || "", item.def.summary),
      bullets: (copy?.bullets?.length ? copy.bullets : item.def.deliverables).slice(0, 4),
      ...(item.def.visual === "search" ? {
        keywords: (ai.keywords?.filter(Boolean).length ? ai.keywords : defaultKeywords(brand)).slice(0, 6),
        adHeadline: first(ai.searchAd?.headline || "", `${brand.businessName || name} | ${titleCase(businessServices(brand)[0] || "Local Experts")}`),
        adDescription: first(ai.searchAd?.description || "", String(brand.description || "").slice(0, 150)),
      } : {}),
      ...(["social", "retarget"].includes(item.def.visual) ? { ads: (ai.ads?.filter((ad) => ad?.primaryText).length ? ai.ads : defaultAds(brand)).slice(0, 3) } : {}),
    });
  });
  const months = monthsFrom(inputs.startMonth, 4);
  const captions = ["In this stage we will be working together closely", "Launch — testing & optimising", "Starting to see an increase in enquiries", "Organic growth supports paid campaigns with a steady flow of enquiries"];
  add("timeline", { heading: "Project Timeline", steps: months.map((month, index) => ({ month, caption: first(ai.timeline?.[index]?.caption || "", captions[index]) })) });
  add("dashboard", { heading: "Your CRM & AI Assistant", cardTitle: "One place for every lead", cardBody: `Every call, form and message lands in one simple app with the ${name} logo. Our AI assistant replies straight away, answers questions and books customers in, day or night.`, bullets: ["See every enquiry in one place", "AI replies and books for you", "Calls, forms & WhatsApp together", "Simple monthly results"], labels: ["Lead Count", "Ad Spend", "Pipeline"] });
  add("aiteam", aiTeamData(name));
  const setup = core.reduce((sum, item) => sum + item.setupFee, 0);
  const monthly = core.reduce((sum, item) => sum + item.monthlyFee, 0);
  if (handover) {
    const copy = aiService("setup");
    add("service", { serviceKey: "setup", heading: "Technical Setup & Handover", cardTitle: first(copy?.cardTitle || "", "We handle everything"), cardBody: first(copy?.cardBody || "", handover.def.summary), bullets: (copy?.bullets?.length ? copy.bullets : handover.def.deliverables).slice(0, 4) });
  }
  add("investment", {
    heading: "Investment",
    packageName: "Client Acquisition System",
    setupLabel: `Initial setup: ${money(setup, currency)} / one time`,
    setupItems: core.filter((item) => item.setupFee > 0).map((item) => `${item.def.name} setup`),
    monthlyLabel: `Ongoing: ${money(monthly, currency)} / month`,
    monthlyItems: core.map((item) => `${item.def.name} — ${item.monthlyFee || item.setupFee ? money(item.monthlyFee, currency) : "included"}`),
    mediaLabel: core.some((item) => item.def.mediaNote) ? "Ad spend" : "",
    mediaItems: core.map((item) => item.def.mediaNote).filter(Boolean),
    addonsLabel: addons.length ? "Optional add-ons (see below)" : "",
    addonItems: addons.map((item) => `${item.def.name} — ${money(item.monthlyFee, currency)}/month`),
    terms: first(inputs.terms, "3-month minimum. Onboarding begins once the setup fee is received. Monthly fee billed every 30 days thereafter."),
    note: "Additional website pages, SEO or larger development work are scoped separately.",
  });
  if (addons.length) {
    add("addons", { heading: "Optional Add-ons", eyebrow: "(Not included)", items: addons.map((item) => ({ serviceKey: item.key, title: item.def.name, text: item.def.tagline, price: `${money(item.monthlyFee, currency)}/month` })) });
  }
  add("closing", {
    heading: first(ai.closingHeading || "", "Let's get started"),
    body: first(ai.closing || "", `We're excited to help ${name} grow. Approve this proposal and we'll book your onboarding call this week.`),
    cta: "Approve & get started",
    contact: input.agencyContact || "hello@f2bmedia.com · f2bmedia.com",
  });
  return { version: 1, accent: "#1463ff", slides };
}

/** JSON schema for the AI copy reply (strict structured output). */
export const AI_COPY_SCHEMA = {
  type: "object", additionalProperties: false,
  properties: {
    coverEyebrow: { type: "string" }, coverTitle: { type: "string" }, coverHighlight: { type: "string" }, coverSubtitle: { type: "string" },
    goalHeading: { type: "string" }, goal: { type: "string" },
    audienceHeading: { type: "string" }, audience: { type: "array", items: { type: "string" } },
    findingsIntro: { type: "string" },
    findings: { type: "array", items: { type: "object", additionalProperties: false, properties: { title: { type: "string" }, detail: { type: "string" } }, required: ["title", "detail"] } },
    services: { type: "array", items: { type: "object", additionalProperties: false, properties: { key: { type: "string" }, heading: { type: "string" }, cardTitle: { type: "string" }, cardBody: { type: "string" }, bullets: { type: "array", items: { type: "string" } }, labels: { type: "array", items: { type: "string" } } }, required: ["key", "heading", "cardTitle", "cardBody", "bullets", "labels"] } },
    phases: { type: "array", items: { type: "object", additionalProperties: false, properties: { title: { type: "string" }, text: { type: "string" } }, required: ["title", "text"] } },
    timeline: { type: "array", items: { type: "object", additionalProperties: false, properties: { caption: { type: "string" } }, required: ["caption"] } },
    expectHeading: { type: "string" }, expect: { type: "array", items: { type: "string" } },
    closingHeading: { type: "string" }, closing: { type: "string" },
    keywords: { type: "array", items: { type: "string" } },
    searchAd: { type: "object", additionalProperties: false, properties: { headline: { type: "string" }, description: { type: "string" } }, required: ["headline", "description"] },
    ads: { type: "array", items: { type: "object", additionalProperties: false, properties: { service: { type: "string" }, primaryText: { type: "string" }, headline: { type: "string" }, offer: { type: "string" }, cta: { type: "string" } }, required: ["service", "primaryText", "headline", "offer", "cta"] } },
  },
  required: ["coverEyebrow", "coverTitle", "coverHighlight", "coverSubtitle", "goalHeading", "goal", "audienceHeading", "audience", "findingsIntro", "findings", "services", "phases", "timeline", "expectHeading", "expect", "closingHeading", "closing", "keywords", "searchAd", "ads"],
} as const;

export const AI_COPY_INSTRUCTIONS = [
  "You write premium, personalised marketing proposals for F2B Media, a digital marketing agency in Ireland. UK/Irish English.",
  "The reader is a busy business owner, not a marketer. Write in plain, everyday English: say what they get and why it helps them win more customers.",
  "NO jargon or acronyms: never say CRO, CTR, CPC, ROAS, conversion rate, A/B testing, pixel, schema, SERP, funnel, optimisation, KPIs, negative keywords, impressions or similar. Say 'enquiries', 'calls', 'customers', 'top of Google' instead.",
  "Tone: confident, warm, specific to this business. Short punchy slide copy — never generic AI filler, no buzzwords, no emojis, no exclamation marks.",
  "Use ONLY facts from the business profile, website text, imported audits/reports, discovery notes, requirements and uploaded documents. Never invent statistics, results, awards, client names, prices or guarantees.",
  "Findings: up to 4, only from the supplied audits/reports/notes (empty array if none). Each title 2–4 words; detail one sentence with the real number if given.",
  "services: one entry for every selected core service key, in the order given. heading like 'Phase 1: Paid Search' (max 6 words). cardTitle 1–3 words. cardBody 35–55 words explaining how this service works for THIS business. bullets: 3–4 plain-English benefits, max 7 words each (e.g. 'Your ads at the top of Google'). labels: up to 3 of the business's own services/pages (1–3 words each) to label example screenshots.",
  "coverTitle + coverHighlight read as one headline split in two (e.g. 'Your Client' + 'Acquisition System', or 'Bringing Digital Support' + 'to Your Existing Pipeline'). coverSubtitle max 10 words.",
  "goal: 35–55 words. audience: 2–5 short audience groups. phases: one per core service plus tracking and optimisation, title like 'Phase 1 - Google Ads Launch', text one or two sentences.",
  "timeline: exactly 4 captions, max 12 words each, for months 1–4. expect: 2–4 short realistic paragraphs (max 35 words each), no guaranteed numbers unless supplied.",
  "closing: 20–35 words inviting them to approve and book onboarding. Follow any extra instructions from the agency.",
  "keywords: 6 real Google searches a customer would type to find THIS business — their own services plus their town/area where known (e.g. 'boiler repair dublin', 'emergency plumber near me'). Never marketing terms like 'google ads' or 'seo'.",
  "searchAd: a Google search ad for the business itself — headline max 30 chars per part, can use ' | ' (e.g. 'Heatwise | Boiler Repairs Dublin'); description max 90 chars about their service.",
  "ads: exactly 3 Facebook/Instagram ads, each promoting a DIFFERENT one of the business's own services. primaryText: 1–2 short sentences in their voice. headline max 40 chars. offer: a short, realistic promotional hook to suggest (e.g. 'Free quote in 24 hours', '10% off first service') — never claim discounts are already running. cta: one of Get Quote, Book Now, Learn More, Call Now, Send Message.",
].join("\n");


/** Wording from the first catalogue (too technical). Saved decks still using it unedited get today's plain-English copy. */
const LEGACY_COPY: Record<string, { summary: string; deliverables: string[] }> = {"google-ads": {"summary": "Search campaigns built around high-intent keywords, with landing pages that match what people are actually searching for, so your budget goes on enquiries rather than browsing.", "deliverables": ["Keyword research & campaign structure", "Ad copy and assets written for each service", "Conversion tracking on calls and forms", "Weekly optimisation and negative keyword management", "Monthly performance report"]}, "seo": {"summary": "Technical fixes, service and location pages and ongoing content that help you rank for the searches your customers make, using real search data to decide what to write.", "deliverables": ["Technical SEO audit & fixes", "Service and location pages", "Keyword tracking (15 priority keywords)", "On-page optimisation", "Monthly ranking report"]}, "geo": {"summary": "We structure your content, reviews and brand mentions so AI assistants understand who you are and recommend you when people ask for a business like yours.", "deliverables": ["AI visibility baseline test", "Entity & brand consistency fixes", "Content written for AI citation", "Structured data (schema)", "Monthly AI visibility tracking"]}, "aeo": {"summary": "Clear, expert answers to the questions your customers ask, formatted for Google's AI Overviews, featured snippets and voice search.", "deliverables": ["Customer question research", "FAQ and answer content", "FAQ / HowTo schema", "Featured snippet targeting", "Answer visibility tracking"]}, "gbp": {"summary": "A fully optimised Google Business Profile with regular posts, photos and a steady flow of reviews, so you show up in the map pack when locals search.", "deliverables": ["Profile audit & full optimisation", "Weekly Google posts", "Review request automation", "Review reply drafts", "Local ranking grid tracking"]}, "website": {"summary": "A custom-designed, mobile-first website with clear service pages, strong calls to action and lead capture connected straight into your CRM.", "deliverables": ["Custom design in your branding", "Up to 8 pages incl. service pages", "Mobile-first, fast loading", "Forms connected to your CRM", "Hosting, SSL & care plan"]}, "landing": {"summary": "Dedicated landing pages for each campaign and service, with one clear action, social proof and ongoing conversion testing to lower your cost per lead.", "deliverables": ["Campaign landing pages", "Lead forms with thank-you tracking", "Heatmap & behaviour review", "A/B testing", "Monthly conversion report"]}, "meta-ads": {"summary": "Scroll-stopping Facebook and Instagram campaigns aimed at your ideal customers, with lead forms and tracking that connect straight into your pipeline.", "deliverables": ["Audience research & targeting", "Ad creative and copy", "Lead form or landing page setup", "Pixel & conversion tracking", "Weekly optimisation"]}, "retargeting": {"summary": "Light-touch ads that follow up with people who visited your website, keeping your work in front of them without pushing too hard.", "deliverables": ["Website visitor audiences", "Instagram, Facebook & Google retargeting", "Creative refreshed monthly", "Frequency caps", "Assisted conversion reporting"]}, "social": {"summary": "A planned content calendar with posts, reels and stories written and designed in your brand voice, published for you every week.", "deliverables": ["Monthly content calendar", "12 posts / month", "Stories & reels", "Community replies", "Monthly engagement report"]}, "email": {"summary": "Automated follow-ups and regular newsletters that keep you front of mind, share your latest work and make the next step easy.", "deliverables": ["Welcome & follow-up sequences", "Monthly newsletter", "List segmentation", "Templates in your branding", "Open & click reporting"]}, "whatsapp": {"summary": "When someone submits a form they get an instant WhatsApp follow-up, and an AI assistant can answer questions and book them in.", "deliverables": ["Instant WhatsApp follow-up", "AI replies to common questions", "Appointment booking", "Missed-call text back", "Hand-over to your team"]}, "crm": {"summary": "Every enquiry, call and sale tracked in one CRM and mobile app, with a live dashboard showing ad spend, leads, cost per lead and revenue.", "deliverables": ["CRM & mobile app", "Call and form tracking", "Live reporting dashboard", "Pipeline & stage values", "Monthly review call"]}};
/** Phase numbers always follow slide order (1, 2, 3…) — after removing, hiding or reordering service slides. */
/** Phases follow one story: build the base → get found now → get found for free → stay front of mind → never miss a lead → see the results. */
export const STORY_ORDER = ["website", "gbp", "google-ads", "seo", "aeo", "geo", "meta-ads", "retargeting", "social", "whatsapp", "ai-calls", "email", "crm"];
export const STORY_CHAPTER: Record<string, string> = { website: "Build the base", gbp: "Get found now", "google-ads": "Get found now", seo: "Get found for free", aeo: "Get found for free", geo: "Get found for free", "meta-ads": "Stay front of mind", retargeting: "Stay front of mind", social: "Stay front of mind", whatsapp: "Never miss a lead", "ai-calls": "Never miss a lead", email: "Never miss a lead", crm: "See the results", setup: "We handle the switch" };
function storyRank(key: string) { const index = STORY_ORDER.indexOf(key); return index < 0 ? STORY_ORDER.length : index; }
export function renumberPhases(deck: ProposalDeck): ProposalDeck {
  let phase = 0;
  const slides = deck.slides.map((slide) => {
    if (slide.kind !== "service" || slide.hidden) return slide;
    phase += 1;
    const data = { ...slide.data };
    if (typeof data.heading === "string") data.heading = /^\s*Phase\s*\d+/i.test(data.heading) ? data.heading.replace(/^\s*Phase\s*\d+/i, `Phase ${phase}`) : data.heading;
    if (typeof data.eyebrow === "string" && /^\s*Phase\s*\d+/i.test(data.eyebrow)) data.eyebrow = `Phase ${phase}`;
    return { ...slide, data };
  });
  return { ...deck, slides };
}
/** "Your AI Team" slide: Telegram briefing bot, AI assistant in the CRM, and Conversation AI that learns from past chats. */
export function aiTeamData(name: string) {
  return {
    heading: "Your AI Team",
    intro: `Three AI helpers working for ${name || "you"} around the clock — so nothing slips through the cracks.`,
    columns: [
      { title: "AI Briefing Bot on Telegram", body: "Every morning you get a short message with everything that matters — no logging in needed.", bullets: ["New enquiries and bookings", "Ad spend and results", "Who needs a call back", "Ask it questions any time"] },
      { title: "AI Assistant in your CRM", body: "Ask it anything about your business in plain English and it gets it done.", bullets: ["'Who hasn't been called back?'", "Writes follow-up messages", "Summarises calls and chats", "Creates tasks and reminders"] },
      { title: "Conversation AI", body: "Replies to customers on your website chat, WhatsApp and Facebook in seconds — day or night — and books them in.", bullets: ["Learns from your past conversations", "Picks up your prices, tone and FAQs", "You approve what it learns", "Gets smarter every week"] },
    ],
  };
}
/** Validates a stored deck from the database/browser. Unknown kinds are dropped; text is clipped. */
export function sanitizeDeck(value: unknown): ProposalDeck | null {
  const raw = value as Partial<ProposalDeck> | null;
  if (!raw || !Array.isArray(raw.slides)) return null;
  const kinds = new Set(SLIDE_KINDS.map((item) => item.kind));
  const clip = (input: unknown, depth = 0): unknown => {
    if (depth > 4) return null;
    if (typeof input === "string") return input.slice(0, 2000);
    if (typeof input === "number" || typeof input === "boolean") return input;
    if (Array.isArray(input)) return input.slice(0, 20).map((item) => clip(item, depth + 1));
    if (input && typeof input === "object") return Object.fromEntries(Object.entries(input).slice(0, 30).map(([key, item]) => [key.slice(0, 40), clip(item, depth + 1)]));
    return null;
  };
  const slides = raw.slides.slice(0, 40).filter((slide) => slide && kinds.has(slide.kind as SlideKind) && !(slide.kind === "service" && (slide.data as Record<string, unknown>)?.serviceKey === "landing")).map((slide) => ({ id: String(slide.id || sid()).slice(0, 20), kind: slide.kind as SlideKind, hidden: Boolean(slide.hidden), data: (clip(slide.data) || {}) as Record<string, any> }));
  const current = catalogueByKey(SERVICE_CATALOGUE);
  // Copy that was the default before the latest catalogue update (upgraded automatically if untouched).
  const PREV_COPY: Record<string, { summary: string; deliverables: string[] }> = { whatsapp: { summary: "When someone gets in touch they get an instant, friendly reply on WhatsApp, and our AI assistant can answer questions and book them in for you.", deliverables: ["Instant WhatsApp replies", "Answers common questions", "Books appointments for you", "Hands over to you anytime"] }, seo: { summary: "We help your website climb Google's free results for the searches your customers make, so new enquiries keep coming in without paying for every click.", deliverables: ["Climb Google's free results", "A page for each of your services", "Website fixes so Google loves it", "Monthly ranking updates"] } };
  for (const slide of slides) {
    const key = String(slide.data.serviceKey || "");
    const prev = PREV_COPY[key], next = current.get(key);
    if (slide.kind === "service" && prev && next) {
      if (slide.data.cardBody === prev.summary) slide.data.cardBody = next.summary;
      if (Array.isArray(slide.data.bullets) && slide.data.bullets.every((item: unknown) => prev.deliverables.includes(String(item)))) slide.data.bullets = next.deliverables.slice(0, 4);
    }
    const old = LEGACY_COPY[key], now = current.get(key);
    if (slide.kind !== "service" || !old || !now) continue;
    if (slide.data.cardBody === old.summary) slide.data.cardBody = now.summary;
    if (Array.isArray(slide.data.bullets) && slide.data.bullets.every((item: unknown) => old.deliverables.includes(String(item)))) slide.data.bullets = now.deliverables.slice(0, 4);
    if (typeof slide.data.heading === "string") slide.data.heading = slide.data.heading.replace(/Landing Pages & CRO|Website Design & Development/, now.name).replace(/: Meta Ads$/, ": Facebook & Instagram Ads");
    if (typeof slide.data.cardTitle === "string" && /^(Website Design & Development|Meta Ads|CRM, Tracking & Reporting|Social Media Management|WhatsApp & AI Automation)$/.test(slide.data.cardTitle)) slide.data.cardTitle = now.name;
  }
  const accent = /^#[0-9a-f]{6}$/i.test(String(raw.accent || "")) ? String(raw.accent) : "#1463ff";
  const crmIndex = slides.findIndex((slide) => slide.kind === "dashboard");
  if (crmIndex >= 0 && !slides.some((slide) => slide.kind === "aiteam")) slides.splice(crmIndex + 1, 0, { id: sid(), kind: "aiteam", hidden: false, data: aiTeamData("") });
  return renumberPhases({ version: 1, accent, slides });
}

/** A blank slide of a kind (used by "Add slide" in the editor). */
export function blankSlide(kind: SlideKind, brand: ProposalBrand, currency = "EUR"): Slide {
  const deck = buildDeck({ brand, inputs: { goal: "", audience: "Homeowners, Local businesses", discoveryNotes: "", requirements: "", instructions: "", startMonth: "", currency, terms: "", sources: [{ id: "x", label: "", kind: "audit", text: "" }] }, services: [{ key: "google-ads", setupFee: 497, monthlyFee: 597, addon: false }, { key: "email", setupFee: 0, monthlyFee: 85, addon: true }] });
  const found = deck.slides.find((slide) => slide.kind === kind);
  return { id: sid(), kind, data: found ? JSON.parse(JSON.stringify(found.data)) : { heading: "New slide" } };
}
