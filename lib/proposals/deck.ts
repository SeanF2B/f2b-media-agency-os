// Proposal Studio · deck model.
// A proposal is a list of slides. Each slide has a kind (which layout/graphic it uses) and plain editable
// text data. buildDeck() always produces a complete, valid deck from the proposal inputs and the catalogue;
// AI copy (when available) is merged on top, so a failed or partial AI reply never breaks a proposal.
// Pure module: used by the API, the public share page and the in-browser live editor.

import { SERVICE_CATALOGUE, catalogueByKey, type CatalogueService } from "./catalogue";

export type SlideKind = "cover" | "goal" | "audience" | "findings" | "service" | "examples" | "cycle" | "dashboard" | "implementation" | "timeline" | "expect" | "investment" | "addons" | "closing";
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
  { kind: "audience", label: "Target audience", hint: "Who we'll reach" },
  { kind: "findings", label: "Where you are now", hint: "Key findings from audits and reports" },
  { kind: "service", label: "Service", hint: "One service with its graphic" },
  { kind: "examples", label: "Examples", hint: "Their pages shown on devices" },
  { kind: "cycle", label: "Marketing cycle", hint: "Discovery → visibility → capture → retarget → conversion" },
  { kind: "dashboard", label: "Dashboard & tracking", hint: "CRM, lead count, ad spend and pipeline" },
  { kind: "implementation", label: "Implementation", hint: "Phase-by-phase plan" },
  { kind: "timeline", label: "Project timeline", hint: "Month-by-month roadmap" },
  { kind: "expect", label: "What to expect", hint: "Realistic expectations" },
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
};

export function buildDeck(input: {
  brand: ProposalBrand; inputs: ProposalInputs; services: SelectedService[]; catalogue?: CatalogueService[]; ai?: Partial<AiCopy> | null; agencyContact?: string;
}): ProposalDeck {
  const { brand, inputs } = input;
  const ai = input.ai || {};
  const catalogue = catalogueByKey(input.catalogue || SERVICE_CATALOGUE);
  const name = first(brand.businessName, "Your business");
  const picked = input.services.map((item) => ({ ...item, def: catalogue.get(item.key) })).filter((item): item is SelectedService & { def: CatalogueService } => Boolean(item.def));
  const core = picked.filter((item) => !item.addon);
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
  const audience = (ai.audience && ai.audience.length ? ai.audience : String(inputs.audience || brand.audience || "").split(/[,\n;]+/)).map((item) => String(item).trim()).filter(Boolean).slice(0, 6);
  if (audience.length) add("audience", { heading: first(ai.audienceHeading || "", "Target Audience:"), items: audience });
  const findings = (ai.findings || []).filter((item) => item?.title).slice(0, 4);
  if (findings.length || inputs.sources.some((source) => source.kind === "audit" || source.kind === "report")) {
    add("findings", {
      heading: "Where you are now",
      intro: first(ai.findingsIntro || "", "What we found reviewing your current marketing."),
      items: findings.length ? findings : [{ title: "Visibility", detail: "Add audit findings here." }, { title: "Website", detail: "Add audit findings here." }, { title: "Tracking", detail: "Add audit findings here." }],
    });
  }
  core.forEach((item, index) => {
    const copy = aiService(item.key);
    add("service", {
      serviceKey: item.key,
      eyebrow: `Phase ${index + 1}`,
      heading: first(copy?.heading || "", `Phase ${index + 1}: ${item.def.name}`),
      cardTitle: first(copy?.cardTitle || "", item.def.name),
      cardBody: first(copy?.cardBody || "", item.def.summary),
      bullets: (copy?.bullets?.length ? copy.bullets : item.def.deliverables).slice(0, 5),
      searchTerm: `${(brand.services.split(/[,\n]/)[0] || item.def.name).trim().toLowerCase()} ${(brand.areas.split(/[,\n]/)[0] || "").trim().toLowerCase()}`.trim(),
    });
    if (index === 0 && (item.def.visual === "search" || item.def.visual === "landing" || item.def.visual === "site")) {
      const labels = (copy?.labels?.length ? copy.labels : brand.services.split(/[,\n]/)).map((label) => String(label).trim()).filter(Boolean).slice(0, 3);
      add("examples", { heading: "Example:", cardTitle: item.def.name, cardBody: "Splitting keywords and landing pages by service keeps every ad matched to search intent and maximises your chance of conversion.", labels: labels.length ? labels : ["Service one", "Service two", "Service three"] });
    }
  });
  if (picked.some((item) => ["google-ads", "meta-ads", "retargeting", "landing"].includes(item.key))) {
    add("cycle", { heading: "Marketing Cycle", stages: [
      { title: "Discovery", text: "Users search for your services" }, { title: "Paid Visibility", text: "Your brand appears at the right moment" },
      { title: "Capture", text: "You capture leads on your landing page" }, { title: "Retarget", text: "Re-engage visitors on social" }, { title: "Conversion", text: "Qualified enquiries are turned into real sales" },
    ] });
  }
  add("dashboard", { heading: "Dashboard / Tracking", cardTitle: "CRM / Mobile App", cardBody: "Track every sale, lead and enquiry in one centralised CRM system and mobile app.", labels: ["Lead Count", "Ad Spend", "Pipeline"], leadCount: "75", spend: money(788, currency), cpl: money(23, currency) });
  const phases = (ai.phases && ai.phases.length ? ai.phases : [
    ...core.map((item, index) => ({ title: `Phase ${index + 1} - ${item.def.name}`, text: item.def.summary })),
    { title: `Phase ${core.length + 1} - Tracking & Reporting`, text: "Call and form tracking with a clear lead view and monthly reporting." },
    { title: `Phase ${core.length + 2} - Optimisation`, text: "Review search behaviour, lead quality and campaign performance to guide ongoing improvements." },
  ]).slice(0, 6);
  add("implementation", { heading: "Marketing Implementation", phases });
  const months = monthsFrom(inputs.startMonth, 4);
  const captions = ["In this stage we will be working together closely", "Launch — testing & optimising", "Starting to see an increase in enquiries", "Organic growth supports paid campaigns with a steady flow of enquiries"];
  add("timeline", { heading: "Project Timeline", steps: months.map((month, index) => ({ month, caption: first(ai.timeline?.[index]?.caption || "", captions[index]) })) });
  add("expect", { heading: first(ai.expectHeading || "", "What to Expect (Realistically)"), paragraphs: (ai.expect && ai.expect.length ? ai.expect : [
    "Results build over the first 60–90 days as campaigns gather data and we refine targeting.",
    "Success is judged on the quality of conversations and booked work, not just volume.",
    "In practice, a small number of additional enquiries can cover the investment many times over.",
  ]).slice(0, 4) });
  const setup = core.reduce((sum, item) => sum + item.setupFee, 0);
  const monthly = core.reduce((sum, item) => sum + item.monthlyFee, 0);
  add("investment", {
    heading: "Investment",
    packageName: "Client Acquisition System",
    setupLabel: `Initial setup: ${money(setup, currency)} / one time`,
    setupItems: core.filter((item) => item.setupFee > 0).map((item) => `${item.def.name} setup`),
    monthlyLabel: `Ongoing: ${money(monthly, currency)} / month`,
    monthlyItems: core.map((item) => `${item.def.name} — ${money(item.monthlyFee, currency)}`),
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
    cta: "Approve proposal",
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
  },
  required: ["coverEyebrow", "coverTitle", "coverHighlight", "coverSubtitle", "goalHeading", "goal", "audienceHeading", "audience", "findingsIntro", "findings", "services", "phases", "timeline", "expectHeading", "expect", "closingHeading", "closing"],
} as const;

export const AI_COPY_INSTRUCTIONS = [
  "You write premium, personalised marketing proposals for F2B Media, a digital marketing agency in Ireland. UK/Irish English.",
  "Tone: confident, warm, plain-spoken, specific to this business. Short punchy slide copy — never generic AI filler, no buzzwords, no emojis, no exclamation marks.",
  "Use ONLY facts from the business profile, website text, imported audits/reports, discovery notes, requirements and uploaded documents. Never invent statistics, results, awards, client names, prices or guarantees.",
  "Findings: up to 4, only from the supplied audits/reports/notes (empty array if none). Each title 2–4 words; detail one sentence with the real number if given.",
  "services: one entry for every selected core service key, in the order given. heading like 'Phase 1: Paid Search' (max 6 words). cardTitle 1–3 words. cardBody 35–55 words explaining how this service works for THIS business. bullets: 3–5 deliverables, max 8 words each. labels: up to 3 of the business's own services/pages (1–3 words each) to label example screenshots.",
  "coverTitle + coverHighlight read as one headline split in two (e.g. 'Your Client' + 'Acquisition System', or 'Bringing Digital Support' + 'to Your Existing Pipeline'). coverSubtitle max 10 words.",
  "goal: 35–55 words. audience: 2–5 short audience groups. phases: one per core service plus tracking and optimisation, title like 'Phase 1 - Google Ads Launch', text one or two sentences.",
  "timeline: exactly 4 captions, max 12 words each, for months 1–4. expect: 2–4 short realistic paragraphs (max 35 words each), no guaranteed numbers unless supplied.",
  "closing: 20–35 words inviting them to approve and book onboarding. Follow any extra instructions from the agency.",
].join("\n");

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
  const slides = raw.slides.slice(0, 40).filter((slide) => slide && kinds.has(slide.kind as SlideKind)).map((slide) => ({ id: String(slide.id || sid()).slice(0, 20), kind: slide.kind as SlideKind, hidden: Boolean(slide.hidden), data: (clip(slide.data) || {}) as Record<string, any> }));
  const accent = /^#[0-9a-f]{6}$/i.test(String(raw.accent || "")) ? String(raw.accent) : "#1463ff";
  return { version: 1, accent, slides };
}

/** A blank slide of a kind (used by "Add slide" in the editor). */
export function blankSlide(kind: SlideKind, brand: ProposalBrand, currency = "EUR"): Slide {
  const deck = buildDeck({ brand, inputs: { goal: "", audience: "Homeowners, Local businesses", discoveryNotes: "", requirements: "", instructions: "", startMonth: "", currency, terms: "", sources: [{ id: "x", label: "", kind: "audit", text: "" }] }, services: [{ key: "google-ads", setupFee: 497, monthlyFee: 597, addon: false }, { key: "email", setupFee: 0, monthlyFee: 85, addon: true }] });
  const found = deck.slides.find((slide) => slide.kind === kind);
  return { id: sid(), kind, data: found ? JSON.parse(JSON.stringify(found.data)) : { heading: "New slide" } };
}
