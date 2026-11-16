import { convertCents } from "./fx.mjs";
// Monthly infrastructure + AI cost, from real records only. Every line says where its number
// came from; anything not known is shown as unknown, never guessed.

/**
 * All lines come out in your account currency. Prices you typed (mailbox seats) are taken as
 * account-currency amounts; provider prices billed in US$ (Cloudflare domains, OpenRouter AI,
 * Instantly, Workers plan) are converted at the ECB rate. A missing rate leaves the line unpriced.
 * @param {object} p
 * @param {Array<{monthly_cost_cents:number|null, status:string}>} p.mailboxes  seat price you entered, account currency
 * @param {Array<{annual_cost_cents:number|null, protected?:number}>} p.domains  Cloudflare renewal price, US$
 * @param {Array<{cost_usd:number, tokens_in:number, tokens_out:number, calls:number}>} p.aiUsage  this month's rows
 * @param {string} [p.currency]  account currency (e.g. "EUR")
 * @param {{date:string, rates:Record<string,number>}|null} [p.fx]  US$-based rates
 */
export function monthlyCosts({ mailboxes = [], domains = [], aiUsage = [], openRouterMonthUsd = null, workersPlanCents = null, subscriptions = [], currency = "USD", fx = null }) {
  const usd = (cents) => convertCents(cents, "USD", currency, fx);
  const active = mailboxes.filter((mailbox) => mailbox.status !== "removed");
  const priced = active.filter((mailbox) => Number.isFinite(mailbox.monthly_cost_cents));
  const sending = domains.filter((domain) => !domain.protected);
  const domainPriced = sending.filter((domain) => Number.isFinite(domain.annual_cost_cents));
  const domainCents = usd(Math.round(domainPriced.reduce((sum, domain) => sum + domain.annual_cost_cents, 0) / 12));
  const aiCents = usd(Math.round(aiUsage.reduce((sum, row) => sum + (row.cost_usd || 0), 0) * 100));
  const converted = currency.toUpperCase() !== "USD";
  const lines = [
    { key: "mailboxes", label: `Mailboxes (${active.length})`, cents: priced.reduce((sum, mailbox) => sum + mailbox.monthly_cost_cents, 0), source: "Your seat price × mailboxes", complete: priced.length === active.length },
    { key: "domains", label: `Domains (${sending.length})`, cents: domainCents ?? 0, source: `Cloudflare renewal price ÷ 12${converted ? " · from US$" : ""}`, complete: domainPriced.length === sending.length && domainCents !== null },
    { key: "ai", label: "AI (Outreach)", cents: aiCents ?? 0, source: `Cost reported by OpenRouter per call${converted ? " · from US$" : ""}`, complete: aiCents !== null, detail: `${aiUsage.reduce((sum, row) => sum + row.calls, 0)} calls · ${aiUsage.reduce((sum, row) => sum + (row.tokens_in || 0) + (row.tokens_out || 0), 0).toLocaleString("en-IE")} tokens` },
  ];
  for (const item of subscriptions) if (Number.isFinite(item.cents)) { const cents = item.currency && item.currency !== currency ? convertCents(item.cents, item.currency, currency, fx) : item.cents; lines.push({ key: item.key, label: item.label, cents: cents ?? 0, source: `${item.source || "Plan price"}${item.currency && item.currency !== currency ? ` · from ${item.currency === "USD" ? "US$" : item.currency}` : ""}`, complete: cents !== null }); }
  if (workersPlanCents !== null) { const cents = usd(workersPlanCents); lines.push({ key: "workers", label: "Cloudflare Workers plan", cents: cents ?? 0, source: `Plan price${converted ? " · from US$" : ""}`, complete: cents !== null }); }
  const total = lines.reduce((sum, line) => sum + line.cents, 0);
  return { currency, fxDate: converted ? fx?.date || null : null, lines, totalCents: total, complete: lines.every((line) => line.complete), openRouterAccountMonthUsd: openRouterMonthUsd, perMailboxCents: active.length ? Math.round(total / active.length) : null };
}
