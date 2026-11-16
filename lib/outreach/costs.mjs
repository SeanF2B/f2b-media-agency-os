// Monthly infrastructure + AI cost, from real records only. Every line says where its number
// came from; anything not known is shown as unknown, never guessed.

/**
 * @param {object} p
 * @param {Array<{monthly_cost_cents:number|null, status:string}>} p.mailboxes  seat price you entered (from your invoice) per mailbox
 * @param {Array<{annual_cost_cents:number|null, currency?:string, protected?:number}>} p.domains  renewal price from Cloudflare Registrar
 * @param {Array<{cost_usd:number, tokens_in:number, tokens_out:number, calls:number}>} p.aiUsage  this month's rows
 * @param {number|null} [p.openRouterMonthUsd]  account-wide OpenRouter spend this month, if the key reports it
 * @param {number} [p.workersPlanCents]  Cloudflare Workers plan you're on (0 for Free)
 */
export function monthlyCosts({ mailboxes = [], domains = [], aiUsage = [], openRouterMonthUsd = null, workersPlanCents = null, subscriptions = [] }) {
  const active = mailboxes.filter((mailbox) => mailbox.status !== "removed");
  const priced = active.filter((mailbox) => Number.isFinite(mailbox.monthly_cost_cents));
  const sending = domains.filter((domain) => !domain.protected);
  const domainPriced = sending.filter((domain) => Number.isFinite(domain.annual_cost_cents));
  const lines = [
    { key: "mailboxes", label: `Mailboxes (${active.length})`, cents: priced.reduce((sum, mailbox) => sum + mailbox.monthly_cost_cents, 0), source: "Your seat price × mailboxes", complete: priced.length === active.length },
    { key: "domains", label: `Domains (${sending.length})`, cents: Math.round(domainPriced.reduce((sum, domain) => sum + domain.annual_cost_cents, 0) / 12), source: "Cloudflare renewal price ÷ 12", complete: domainPriced.length === sending.length },
    { key: "ai", label: "AI (Outreach)", cents: Math.round(aiUsage.reduce((sum, row) => sum + (row.cost_usd || 0), 0) * 100), source: "Cost reported by OpenRouter per call", complete: true, detail: `${aiUsage.reduce((sum, row) => sum + row.calls, 0)} calls · ${aiUsage.reduce((sum, row) => sum + row.tokens_in + row.tokens_out, 0).toLocaleString("en-IE")} tokens` },
  ];
  for (const item of subscriptions) if (Number.isFinite(item.cents)) lines.push({ key: item.key, label: item.label, cents: item.cents, source: item.source || "Plan price", complete: true });
  if (workersPlanCents !== null) lines.push({ key: "workers", label: "Cloudflare Workers plan", cents: workersPlanCents, source: "Plan price", complete: true });
  const total = lines.reduce((sum, line) => sum + line.cents, 0);
  return { lines, totalCents: total, complete: lines.every((line) => line.complete), openRouterAccountMonthUsd: openRouterMonthUsd, perMailboxCents: active.length ? Math.round(total / active.length) : null };
}
