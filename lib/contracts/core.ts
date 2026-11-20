// Client contracts — pure logic (no Cloudflare imports, so it can be unit tested with node --test).
// Scope of work comes from the services picked for the contract; the standard terms are F2B's house terms:
// 90-day minimum term, 30 days' notice, billed monthly in advance on the 1st, discount for subscription
// (automatic recurring) payments, services paused when an invoice is 14 days overdue, and ad-account
// downtime is the client's to resolve with fees still payable. GDPR / data processing terms included.

export type ContractService = { name: string; monthlyFee: number; setupFee: number; notes: string };
export type ContractTerms = {
  startDate: string; currency: "EUR" | "GBP" | "USD"; minimumTermDays: number; noticeDays: number; billingDay: number;
  overdueDays: number; subscriptionDiscountPct: number; extraTerms: string;
};
export type ContractParties = {
  providerName: string; providerAddress: string; providerEmail: string; providerSigner: string; governingLaw: string;
  clientName: string; clientAddress: string; signerName: string; signerEmail: string;
};
export type ContractSignature = { name: string; image: string; signedAt: string; ip: string; country: string; userAgent: string; hash: string };
export type ContractData = { title: string; services: ContractService[]; terms: ContractTerms; parties: ContractParties };

export const STANDARD = { minimumTermDays: 90, noticeDays: 30, billingDay: 1, overdueDays: 14 } as const;
export const GOVERNING_LAWS = ["Ireland", "England and Wales", "Northern Ireland", "Scotland"] as const;

// Plain-English scope per service. Keys match the service names used on client cards.
export const SERVICE_SCOPES: Record<string, { summary: string; includes: string[]; excludes?: string[] }> = {
  "Google Ads": {
    summary: "Planning, building and managing Google Ads campaigns to bring in enquiries.",
    includes: ["Account setup or audit of the existing account", "Keyword research, negative keywords and campaign structure", "Writing and testing ads, extensions and assets", "Conversion tracking (Google Ads and Google Analytics 4) for calls and forms", "Ongoing bid, budget, keyword and search-term optimisation", "A monthly performance report"],
    excludes: ["Ad spend, which the Client pays directly to Google", "New landing pages, unless Web Design & Development is included"],
  },
  "Meta Ads": {
    summary: "Running Facebook and Instagram advertising campaigns.",
    includes: ["Business Manager, ad account, pixel and Conversions API setup", "Audience research, targeting and retargeting", "Ad copy and creative made from supplied or approved images and video", "Ongoing optimisation and testing", "A monthly performance report"],
    excludes: ["Ad spend, which the Client pays directly to Meta", "Professional photo or video shoots"],
  },
  SEO: {
    summary: "Improving the Client's visibility in Google search, maps and AI search tools.",
    includes: ["Technical SEO audit and fixes on sites we manage", "Keyword research and on-page optimisation (titles, descriptions, headings, internal links)", "An agreed number of advice articles or page updates each month", "Local SEO and Google Business Profile alignment", "Rank tracking and Search Console monitoring", "A monthly SEO report"],
    excludes: ["Guaranteed rankings or positions — search engines decide rankings", "Paid link schemes or anything against Google's guidelines"],
  },
  "Google Business Profile": {
    summary: "Managing the Client's Google Business Profile (Maps listing).",
    includes: ["Profile optimisation (categories, services, photos, details)", "Regular business posts", "Drafting replies to reviews for approval", "Monitoring questions and listing changes"],
  },
  "AI Reviews": {
    summary: "Automatically asking happy customers for Google reviews.",
    includes: ["Review request messages after completed jobs or appointments", "Follow-up reminders", "Drafted replies to new reviews"],
    excludes: ["Fake, incentivised or gated reviews of any kind"],
  },
  "Social Posts": {
    summary: "Planning and publishing social media content.",
    includes: ["A monthly content calendar", "Post copy and graphics from supplied or approved images", "Scheduling to connected Facebook, Instagram and Google accounts", "Approval of posts before they go live"],
  },
  "Community Questions": {
    summary: "Finding relevant community questions and drafting helpful answers.",
    includes: ["Monitoring Reddit, Boards.ie and Quora style questions", "Drafting genuine, helpful replies for approval", "Posting manually where community rules allow"],
  },
  "Email Marketing": {
    summary: "Email campaigns to the Client's customers and leads.",
    includes: ["Branded email templates", "Campaign and automation setup", "List management based on valid consent", "Sending on an agreed schedule and reporting"],
  },
  "AI Chat": {
    summary: "An AI assistant that replies to SMS, WhatsApp and website chat on the Client's behalf.",
    includes: ["Training on the Client's services, prices and past conversations", "Lead capture into the CRM", "Booking links and invoices are only sent after approval", "Ongoing tuning of replies"],
    excludes: ["Messaging and WhatsApp usage costs, billed monthly as used"],
  },
  "AI Phone Agent": {
    summary: "An AI phone agent that answers calls, takes details and books appointments.",
    includes: ["Voice, greeting and training setup", "Booking into chosen calendars", "Call recordings and transcripts in the CRM, with a recording announcement", "Optional outbound follow-up calls"],
    excludes: ["Phone number and call minute costs, billed monthly as used"],
  },
  "AI Automation": {
    summary: "Building and maintaining agreed automations in the CRM.",
    includes: ["Automation design and build (follow-ups, reminders, notifications)", "Testing and monitoring", "Changes to agreed automations"],
  },
  "Web Design & Development": {
    summary: "Designing, building and hosting the Client's website.",
    includes: ["Design and build of the agreed pages", "Hosting, SSL certificate and security monitoring", "Contact and quote forms connected to the CRM", "Basic on-page SEO and redirects from old pages", "Edits and small updates during the term"],
    excludes: ["Copywriting and photography beyond what is agreed", "Domain registration fees, unless agreed"],
  },
  CRM: {
    summary: "Access to and setup of the F2B CRM.",
    includes: ["CRM account for the Client's team", "Pipeline, forms and conversations inbox setup", "Scheduling and calendar setup", "Training and support"],
  },
  "Lead Generation": {
    summary: "Building lead lists and running outreach campaigns.",
    includes: ["Ideal customer profile and list building", "Outreach campaigns run in line with GDPR and ePrivacy rules", "Positive replies passed into the CRM"],
  },
};
export const SERVICE_NAMES = Object.keys(SERVICE_SCOPES);
export function scopeFor(name: string) {
  return SERVICE_SCOPES[name] || { summary: `${name} services as agreed between the parties.`, includes: ["Work as described in the notes for this service"] };
}

const num = (value: unknown, min: number, max: number, fallback: number) => { const n = Number(value); return Number.isFinite(n) ? Math.min(max, Math.max(min, Math.round(n * 100) / 100)) : fallback; };
const str = (value: unknown, n: number) => String(value ?? "").replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, "").trim().slice(0, n);
const isoDate = (value: unknown) => /^\d{4}-\d{2}-\d{2}$/.test(String(value || "")) && !Number.isNaN(Date.parse(String(value))) ? String(value) : "";
const email = (value: unknown) => { const e = str(value, 200).toLowerCase(); return /^[^\s@<>,;]+@[^\s@<>,;]+\.[^\s@<>,;]+$/.test(e) ? e : ""; };

export function defaultData(today = new Date().toISOString().slice(0, 10)): ContractData {
  return {
    title: "Marketing Services Agreement",
    services: [],
    terms: { startDate: today, currency: "EUR", ...STANDARD, subscriptionDiscountPct: 5, extraTerms: "" },
    parties: { providerName: "F2B Media", providerAddress: "", providerEmail: "", providerSigner: "", governingLaw: "Ireland", clientName: "", clientAddress: "", signerName: "", signerEmail: "" },
  };
}

/** Cleans anything coming from the browser. The standard terms are fixed — only the discount and extra terms can change. */
export function sanitizeData(input: Partial<ContractData> | undefined, base: ContractData = defaultData()): ContractData {
  const src = input || {};
  const t = (src.terms || {}) as Partial<ContractTerms>, p = (src.parties || {}) as Partial<ContractParties>;
  const seen = new Set<string>();
  const services = (Array.isArray(src.services) ? src.services : base.services).map((s) => ({
    name: str(s?.name, 80), monthlyFee: num(s?.monthlyFee, 0, 1_000_000, 0), setupFee: num(s?.setupFee, 0, 1_000_000, 0), notes: str(s?.notes, 600),
  })).filter((s) => s.name && !seen.has(`${s.name}|${s.notes}`) && seen.add(`${s.name}|${s.notes}`)).slice(0, 20);
  const currency = (["EUR", "GBP", "USD"] as const).find((c) => c === t.currency) || base.terms.currency;
  const law = (GOVERNING_LAWS as readonly string[]).includes(String(p.governingLaw)) ? String(p.governingLaw) : base.parties.governingLaw;
  return {
    title: str(src.title, 120) || base.title,
    services,
    terms: { ...STANDARD, startDate: isoDate(t.startDate) || base.terms.startDate, currency, subscriptionDiscountPct: num(t.subscriptionDiscountPct ?? base.terms.subscriptionDiscountPct, 0, 50, 0), extraTerms: str(t.extraTerms ?? base.terms.extraTerms, 3000) },
    parties: {
      providerName: str(p.providerName ?? base.parties.providerName, 120) || "F2B Media", providerAddress: str(p.providerAddress ?? base.parties.providerAddress, 300), providerEmail: email(p.providerEmail ?? base.parties.providerEmail), providerSigner: str(p.providerSigner ?? base.parties.providerSigner, 120), governingLaw: law,
      clientName: str(p.clientName ?? base.parties.clientName, 160), clientAddress: str(p.clientAddress ?? base.parties.clientAddress, 300), signerName: str(p.signerName ?? base.parties.signerName, 120), signerEmail: email(p.signerEmail ?? base.parties.signerEmail),
    },
  };
}

export function totals(data: ContractData) {
  const monthly = data.services.reduce((sum, s) => sum + s.monthlyFee, 0);
  const setup = data.services.reduce((sum, s) => sum + s.setupFee, 0);
  const discounted = Math.round(monthly * (1 - data.terms.subscriptionDiscountPct / 100) * 100) / 100;
  return { monthly, setup, discounted, saving: Math.round((monthly - discounted) * 100) / 100 };
}

export function money(value: number, currency: string) {
  const symbol = currency === "GBP" ? "£" : currency === "USD" ? "$" : "€";
  return `${symbol}${value.toLocaleString("en-IE", { minimumFractionDigits: value % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
}
const longDate = (iso: string) => iso ? new Date(`${iso.slice(0, 10)}T12:00:00Z`).toLocaleDateString("en-IE", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }) : "";
export function addDays(iso: string, days: number) { const d = new Date(`${iso}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); }
const esc = (value: unknown) => String(value ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
const ordinal = (n: number) => `${n}${n % 10 === 1 && n !== 11 ? "st" : n % 10 === 2 && n !== 12 ? "nd" : n % 10 === 3 && n !== 13 ? "rd" : "th"}`;

/** The numbered clauses, as plain data (heading + paragraphs/bullets) so the HTML and the hash use the same text. */
export function clauses(data: ContractData): Array<{ heading: string; body: Array<string | string[]> }> {
  const t = data.terms, p = data.parties, cur = t.currency, tot = totals(data);
  const provider = p.providerName || "F2B Media", client = p.clientName || "the Client";
  const minEnd = addDays(t.startDate, t.minimumTermDays - 1);
  const list: Array<{ heading: string; body: Array<string | string[]> }> = [];
  list.push({ heading: "Services and scope of work", body: [
    `${provider} ("we", "us") will provide the services listed in the Schedule of Services to ${client} ("the Client", "you"). The scope for each service is set out below. Anything not listed is outside the scope and can be added by written agreement (email is fine), which may change the fees.`,
    ...data.services.flatMap((s) => { const sc = scopeFor(s.name); return [`${s.name}: ${sc.summary}${s.notes ? ` ${s.notes}` : ""}`, sc.includes.map((i) => `Includes: ${i}`).concat((sc.excludes || []).map((e) => `Not included: ${e}`))]; }),
  ] });
  list.push({ heading: "Term and notice", body: [
    `This agreement starts on ${longDate(t.startDate)} and has a minimum term of ${t.minimumTermDays} days, ending on ${longDate(minEnd)} ("the Minimum Term").`,
    `After the Minimum Term it continues month to month until either party ends it by giving at least ${t.noticeDays} days' written notice (email is fine). Notice can be given during the Minimum Term but cannot take effect before the Minimum Term ends.`,
    `Fees remain payable for the Minimum Term and for the full notice period, whether or not the Client continues to use the services during that time.`,
    `Either party may end this agreement immediately by written notice if the other seriously breaches it and does not fix the breach within 14 days of being asked to.`,
  ] });
  list.push({ heading: "Fees, invoicing and payment", body: [
    `Fees are set out in the Schedule of Services. Monthly fees are invoiced monthly and billed in advance on the ${ordinal(t.billingDay)} of every month, and are due on the date of the invoice.`,
    `The first invoice is issued when this agreement is signed and covers any setup fees and the period from the start date to the end of that month, charged pro rata. After that, every invoice is issued on the ${ordinal(t.billingDay)} of the month.`,
    t.subscriptionDiscountPct > 0
      ? `Subscription discount: if the Client pays by automatic recurring payment (a card or bank subscription set up through us), the monthly fees are reduced by ${t.subscriptionDiscountPct}% (${money(tot.monthly, cur)} becomes ${money(tot.discounted, cur)} per month). The discount stops applying from any month where the subscription is cancelled or a payment fails.`
      : `Payment can be made by bank transfer, card or automatic recurring payment.`,
    `Fees do not include VAT, which is added where it applies. Advertising spend (for example Google or Meta ad budgets) and usage-based costs such as phone, messaging and extra AI usage are not included in the fees: ad spend is paid by the Client directly to the platforms, and usage costs are billed monthly as used.`,
  ] });
  list.push({ heading: "Late payment and pausing of services", body: [
    `If any invoice is unpaid ${t.overdueDays} days after its due date, all services will be paused until every overdue invoice is paid in full. This can include pausing ad campaigns, AI agents, automations, website changes and CRM access.`,
    `Fees continue to be charged while services are paused, and the Minimum Term and notice period are not extended or reduced by a pause. Services are restarted once payment is received, which may take up to 2 working days.`,
    `We may also charge interest and compensation on late payments as allowed by law (in Ireland, the European Communities (Late Payment in Commercial Transactions) Regulations 2012; in the UK, the Late Payment of Commercial Debts (Interest) Act 1998).`,
  ] });
  list.push({ heading: "Advertising accounts and downtime", body: [
    `The Client is responsible for keeping its advertising accounts (such as Google Ads and Meta) in good standing, including valid payment methods, paying the platforms on time, business verification and following each platform's policies.`,
    `Any downtime, paused or disapproved ads, account suspensions or lost results caused by non-payment to an ad platform, failed card payments, policy or verification issues, platform outages or any other advertising-related issue outside our control are the Client's responsibility to resolve. We will reasonably help where we can.`,
    `Our fees are still charged in full during any such downtime. No refunds, credits or fee reductions are given for it.`,
  ] });
  list.push({ heading: "Client responsibilities", body: [[
    "Give us the access, logins, information and approvals we reasonably need, on time",
    "Make sure the information, images and content you give us are accurate and that you have the right to use them",
    "Review and approve work promptly; delays on your side may delay the work but do not pause fees",
    "Keep your own logins secure and tell us straight away about any suspected unauthorised access",
  ]] });
  list.push({ heading: "Results", body: [
    `Marketing results depend on many things outside our control, including competition, budgets, search engine and platform changes, and the Client's own sales process. We will provide the services with reasonable skill and care, but we do not guarantee any particular rankings, leads, sales or return on investment.`,
  ] });
  list.push({ heading: "Ownership", body: [
    `The Client owns its domain names, advertising accounts, business profiles, its own content and its customer data. Once all fees due have been paid, the Client owns the finished deliverables created specifically for it (such as ad copy and website content).`,
    `We keep ownership of our own software (including the F2B CRM), templates, tools, methods and know-how. The Client gets a licence to use them during the term. When the agreement ends, access to the CRM and any hosted tools stops, and the Client can request an export of its data within 30 days.`,
  ] });
  list.push({ heading: "Data protection (GDPR)", body: [
    `Both parties will comply with data protection law, including the EU General Data Protection Regulation (GDPR), the UK GDPR, the Irish Data Protection Acts 1988–2018 and the UK Data Protection Act 2018, as they apply.`,
    `For personal data about the Client's customers and leads (for example form submissions, messages, call recordings and contact records), the Client is the controller and we are the processor. We will:`,
    [
      "Only process that personal data on the Client's documented instructions, which include this agreement and the way the Client uses our services",
      "Make sure everyone who handles it is bound by confidentiality",
      "Keep it secure with appropriate technical and organisational measures, including encryption in transit, access controls and two-step sign-in for our team",
      "Use trusted sub-processors to deliver the services (such as Cloudflare for hosting, Google and Meta for advertising, Twilio for calls and messaging, Resend for email, Stripe for payments and AI model providers), each under written data protection terms; the Client gives general authorisation for these and we will tell the Client before adding or replacing one so it can object",
      "Only transfer data outside the EEA or UK where adequate safeguards are in place, such as an adequacy decision or Standard Contractual Clauses",
      "Help the Client respond to requests from individuals exercising their data protection rights, and with security, breach notification and impact assessments where relevant",
      "Tell the Client without undue delay, and in any case within 48 hours of becoming aware, of any personal data breach affecting its data",
      "Delete or return the Client's personal data within 30 days after the agreement ends, unless the law requires us to keep it",
      "Make available the information reasonably needed to show we are meeting these obligations",
    ],
    `The Client confirms it has a lawful basis for the personal data it collects and asks us to process, including valid consent for marketing emails and messages, and clear privacy notices on its website and forms. Where calls are recorded, the Client agrees that callers are told about the recording.`,
    `We process the contact details of the Client's own team as a controller to manage the account, send invoices and provide support, in line with our privacy notice. Each party will keep the other's confidential information private and only use it for this agreement.`,
  ] });
  list.push({ heading: "Liability", body: [
    `Nothing in this agreement limits liability for death or personal injury caused by negligence, fraud, or anything else that cannot be limited by law.`,
    `Otherwise, neither party is liable for indirect or consequential losses, or for loss of profit, revenue, data or goodwill, and our total liability under this agreement is limited to the fees paid by the Client in the three months before the claim arose.`,
  ] });
  if (t.extraTerms) list.push({ heading: "Additional terms", body: t.extraTerms.split(/\n{2,}/).map((block) => block.trim()).filter(Boolean) });
  list.push({ heading: "General", body: [
    `This agreement (including the Schedule of Services) is the entire agreement between the parties about the services. Changes must be agreed in writing (email is fine). If any part is found to be unenforceable, the rest still applies.`,
    `Neither party is responsible for delays caused by events outside its reasonable control. The Client may not transfer this agreement without our written consent.`,
    `This agreement is governed by the law of ${p.governingLaw}, and the courts of ${p.governingLaw} have exclusive jurisdiction. It may be signed electronically, and an electronic signature has the same effect as a handwritten one.`,
  ] });
  return list;
}

/** Canonical text of everything that is signed (used for the SHA-256 fingerprint stored with the signature). */
export function canonicalText(data: ContractData) {
  const tot = totals(data), cur = data.terms.currency;
  const lines = [data.title, `Provider: ${data.parties.providerName} ${data.parties.providerAddress}`, `Client: ${data.parties.clientName} ${data.parties.clientAddress}`, `Start: ${data.terms.startDate}`,
    ...data.services.map((s) => `${s.name}: ${money(s.monthlyFee, cur)}/month, setup ${money(s.setupFee, cur)} ${s.notes}`), `Monthly total: ${money(tot.monthly, cur)}; setup: ${money(tot.setup, cur)}`];
  for (const [i, c] of clauses(data).entries()) { lines.push(`${i + 1}. ${c.heading}`); for (const b of c.body) lines.push(Array.isArray(b) ? b.map((x) => `- ${x}`).join("\n") : b); }
  return lines.join("\n");
}
export async function sha256Hex(text: string) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/** Accepts only a PNG data URL of a sensible size for the drawn signature. */
export function cleanSignatureImage(value: unknown) {
  const v = String(value || "");
  return /^data:image\/png;base64,[A-Za-z0-9+/=]{200,}$/.test(v) && v.length <= 300_000 ? v : "";
}

/** The contract document (Schedule of Services, clauses, signature block). Used in the OS preview and on the public page. */
export function renderContractBody(data: ContractData, opts: { signature?: ContractSignature | null; agencySignedAt?: string; reference?: string; clientLogo?: string; agencyLogo?: string } = {}) {
  const t = data.terms, p = data.parties, cur = t.currency, tot = totals(data), sig = opts.signature;
  const para = (b: string | string[]) => Array.isArray(b) ? `<ul>${b.map((x) => `<li>${esc(x)}</li>`).join("")}</ul>` : `<p>${esc(b)}</p>`;
  const scopeBlock = (c: ReturnType<typeof clauses>[number]) => {
    // Clause 1: render per-service scope as sub-sections.
    const [intro, ...rest] = c.body; let html = para(intro as string);
    for (let i = 0; i < rest.length; i += 2) {
      const head = String(rest[i]); const bullets = (rest[i + 1] || []) as string[];
      const [name, ...summary] = head.split(": ");
      html += `<div class="ct-scope"><h4>${esc(name)}</h4><p>${esc(summary.join(": "))}</p><ul>${bullets.map((x) => x.startsWith("Not included: ") ? `<li class="out">${esc(x.slice(14))}</li>` : `<li>${esc(x.replace(/^Includes: /, ""))}</li>`).join("")}</ul></div>`;
    }
    return html;
  };
  return `<article class="ct-doc">
  <header class="ct-head">${opts.agencyLogo ? `<img class="ct-logo" src="${esc(opts.agencyLogo)}" alt="${esc(p.providerName)}">` : `<b class="ct-logo-text">${esc(p.providerName)}</b>`}${opts.clientLogo ? `<img class="ct-logo client" src="${esc(opts.clientLogo)}" alt="">` : ""}</header>
  <h1>${esc(data.title)}</h1>
  <p class="ct-meta">${opts.reference ? `Ref. ${esc(opts.reference)} · ` : ""}Start date ${esc(longDate(t.startDate))}</p>
  <section class="ct-parties"><div><small>Provider</small><b>${esc(p.providerName)}</b>${p.providerAddress ? `<span>${esc(p.providerAddress)}</span>` : ""}${p.providerEmail ? `<span>${esc(p.providerEmail)}</span>` : ""}</div><div><small>Client</small><b>${esc(p.clientName || "—")}</b>${p.clientAddress ? `<span>${esc(p.clientAddress)}</span>` : ""}${p.signerEmail ? `<span>${esc(p.signerEmail)}</span>` : ""}</div></section>
  <section><h2>Schedule of Services</h2>
    <table class="ct-table"><thead><tr><th>Service</th><th>Setup</th><th>Monthly</th></tr></thead><tbody>
    ${data.services.length ? data.services.map((s) => `<tr><td><b>${esc(s.name)}</b>${s.notes ? `<small>${esc(s.notes)}</small>` : ""}</td><td>${s.setupFee ? esc(money(s.setupFee, cur)) : "—"}</td><td>${esc(money(s.monthlyFee, cur))}</td></tr>`).join("") : `<tr><td colspan="3"><i>No services selected yet</i></td></tr>`}
    </tbody><tfoot><tr><td>Total</td><td>${tot.setup ? esc(money(tot.setup, cur)) : "—"}</td><td>${esc(money(tot.monthly, cur))}</td></tr>
    ${t.subscriptionDiscountPct > 0 && tot.monthly > 0 ? `<tr class="disc"><td>Paying by subscription (${t.subscriptionDiscountPct}% off)</td><td></td><td>${esc(money(tot.discounted, cur))}</td></tr>` : ""}</tfoot></table>
    <ul class="ct-keyterms"><li><b>${t.minimumTermDays}-day</b> minimum term</li><li><b>${t.noticeDays} days'</b> notice to end</li><li>Billed on the <b>${ordinal(t.billingDay)}</b> of every month</li><li>Services paused at <b>${t.overdueDays} days</b> overdue</li></ul>
    <p class="ct-small">Prices exclude VAT where it applies. Ad spend is paid directly to the ad platforms.</p>
  </section>
  ${clauses(data).map((c, i) => `<section><h2>${i + 1}. ${esc(c.heading)}</h2>${i === 0 ? scopeBlock(c) : c.body.map(para).join("")}</section>`).join("")}
  <section class="ct-sign"><h2>Signatures</h2><div class="ct-sign-grid">
    <div><small>For ${esc(p.providerName)}</small><div class="ct-sigline typed">${esc(p.providerSigner || p.providerName)}</div><span>${esc(p.providerSigner || "Authorised signatory")}${opts.agencySignedAt ? ` · ${esc(new Date(opts.agencySignedAt).toLocaleDateString("en-IE", { day: "numeric", month: "long", year: "numeric" }))}` : ""}</span></div>
    <div><small>For ${esc(p.clientName || "the Client")}</small>${sig ? `<div class="ct-sigline"><img src="${esc(sig.image)}" alt="Signature of ${esc(sig.name)}"></div><span>${esc(sig.name)} · ${esc(new Date(sig.signedAt).toLocaleString("en-IE", { dateStyle: "long", timeStyle: "short", timeZone: "Europe/Dublin" }))}</span>` : `<div class="ct-sigline empty">Awaiting signature</div><span>${esc(p.signerName || "Authorised signatory")}</span>`}</div>
  </div>${sig ? `<p class="ct-audit">Signed electronically from IP ${esc(sig.ip || "unknown")}${sig.country ? ` (${esc(sig.country)})` : ""} · Document fingerprint (SHA-256) ${esc(sig.hash)}</p>` : ""}</section>
</article>`;
}

export const CONTRACT_CSS = `.ct-doc{max-width:820px;margin:0 auto;background:#fff;color:#111827;font:15px/1.6 Poppins,system-ui,-apple-system,"Segoe UI",sans-serif;padding:44px 48px;border-radius:18px}
.ct-head{display:flex;justify-content:space-between;align-items:center;gap:16px;margin-bottom:26px}.ct-logo{max-height:46px;max-width:190px;object-fit:contain}.ct-logo.client{max-height:52px}.ct-logo-text{font-size:20px}
.ct-doc h1{font-size:28px;line-height:1.2;margin:0 0 4px}.ct-meta{color:#6b7280;margin:0 0 22px;font-size:13.5px}
.ct-doc h2{font-size:16px;margin:28px 0 8px;padding-top:14px;border-top:1px solid #eef0f3}.ct-doc h4{margin:0 0 2px;font-size:15px}.ct-doc p{margin:0 0 10px}.ct-doc ul{margin:4px 0 12px;padding-left:20px}.ct-doc li{margin:3px 0}
.ct-parties{display:grid;grid-template-columns:1fr 1fr;gap:14px}.ct-parties div{background:#f6f7f9;border-radius:12px;padding:14px 16px;display:grid;gap:2px}.ct-parties small,.ct-sign small{font-size:11.5px;letter-spacing:.06em;text-transform:uppercase;color:#6b7280}.ct-parties span{color:#4b5563;font-size:13.5px}
.ct-table{width:100%;border-collapse:collapse;font-size:14.5px}.ct-table th{text-align:left;font-size:12px;text-transform:uppercase;letter-spacing:.05em;color:#6b7280;border-bottom:1px solid #e5e7eb;padding:8px 6px}.ct-table td{padding:10px 6px;border-bottom:1px solid #f0f1f4;vertical-align:top}.ct-table td small{display:block;color:#6b7280}.ct-table th:not(:first-child),.ct-table td:not(:first-child){text-align:right;white-space:nowrap}.ct-table tfoot td{font-weight:700;border-bottom:0}.ct-table tr.disc td{color:#15803d;font-weight:600}
.ct-keyterms{list-style:none;padding:0!important;display:flex;flex-wrap:wrap;gap:8px;margin:14px 0 8px!important}.ct-keyterms li{background:#eef4ff;color:#1e3a8a;border-radius:999px;padding:5px 12px;font-size:13px;margin:0!important}.ct-small{font-size:12.5px;color:#6b7280}
.ct-scope{border:1px solid #eef0f3;border-radius:12px;padding:12px 16px;margin:10px 0}.ct-scope li.out{color:#9a3412}.ct-scope li.out::marker{content:"✕  "}
.ct-sign-grid{display:grid;grid-template-columns:1fr 1fr;gap:22px}.ct-sign-grid>div{display:grid;gap:6px}.ct-sigline{height:76px;border-bottom:1.5px solid #111827;display:flex;align-items:flex-end}.ct-sigline img{max-height:72px;max-width:100%}.ct-sigline.typed{font:italic 26px "Brush Script MT","Segoe Script",cursive}.ct-sigline.empty{color:#9ca3af;font-size:13px}.ct-sign span{font-size:13px;color:#4b5563}.ct-audit{font-size:11.5px;color:#6b7280;margin-top:16px;word-break:break-all}
@media (max-width:640px){.ct-doc{padding:26px 20px;border-radius:14px}.ct-parties,.ct-sign-grid{grid-template-columns:1fr}.ct-doc h1{font-size:23px}}
@media print{.ct-doc{box-shadow:none;border-radius:0;padding:0;max-width:none}.ct-doc section{break-inside:auto}.ct-scope,.ct-sign{break-inside:avoid}}`;
