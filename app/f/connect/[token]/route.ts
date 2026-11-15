import { env } from "cloudflare:workers";
import { readConnectToken } from "@/lib/client-connect";

// Public (no login) page a client opens from the agency's quick link to connect their accounts. It explains
// how to give the agency access to each missing service and lets them send the IDs, which are saved to their
// record. Only the fields listed below can be written, and only for the client the signed link belongs to.
export const dynamic = "force-dynamic";
type RouteContext = { params: Promise<{ token: string }> };
type Client = { id: string; name: string; logo?: string; color?: string; website?: string; wordpressSiteUrl?: string; googleAdsAccountId?: string; metaAdsAccountId?: string; googleSearchConsoleAccountId?: string; googleAnalyticsAccountId?: string; googleBusinessProfileLocationId?: string; googleBusinessProfileAccountId?: string; connectNotes?: string };
const esc = (v: unknown) => String(v ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const secret = () => String((env as unknown as Record<string, string>).GOOGLE_ADS_TOKEN_ENCRYPTION_KEY || "");

const ITEMS: Array<{ key: keyof Client; label: string; done: (c: Client) => boolean; help: string; placeholder: string }> = [
  { key: "website", label: "Website", done: (c) => Boolean(c.website || c.wordpressSiteUrl), help: "Your website address.", placeholder: "https://yourbusiness.ie" },
  { key: "googleAdsAccountId", label: "Google Ads", done: (c) => Boolean(c.googleAdsAccountId), help: "In Google Ads, your 10-digit Customer ID is at the top right (e.g. 123-456-7890). We’ll send a manager-access request to accept.", placeholder: "123-456-7890" },
  { key: "metaAdsAccountId", label: "Meta (Facebook & Instagram) Ads", done: (c) => Boolean(c.metaAdsAccountId), help: "In Meta Business Settings → Accounts → Ad accounts, copy your ad account ID. We’ll send a partner request to approve.", placeholder: "e.g. 1234567890" },
  { key: "googleBusinessProfileAccountId", label: "Google Business Profile", done: (c) => Boolean(c.googleBusinessProfileLocationId || c.googleBusinessProfileAccountId), help: "Type your business name exactly as it shows on Google Maps. We’ll request manager access for you to approve.", placeholder: "Your business name on Google" },
  { key: "googleAnalyticsAccountId", label: "Google Analytics", done: (c) => Boolean(c.googleAnalyticsAccountId), help: "In Google Analytics → Admin → Property details, copy the Property ID (numbers only).", placeholder: "e.g. 412345678" },
  { key: "googleSearchConsoleAccountId", label: "Google Search Console", done: (c) => Boolean(c.googleSearchConsoleAccountId), help: "The website property you verified in Search Console (your domain).", placeholder: "yourbusiness.ie" },
];

function page(title: string, body: string, color = "#0b74b8") {
  return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${esc(title)}</title><style>
  :root{--c:${esc(color)}}*{box-sizing:border-box}body{margin:0;font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif;background:#f4f6f9;color:#1f2a33}
  main{max-width:640px;margin:0 auto;padding:28px 18px 60px}.top{display:flex;align-items:center;gap:12px;margin-bottom:18px}.top img{height:44px;max-width:140px;object-fit:contain;border-radius:10px;background:#fff;padding:4px}
  h1{font-size:24px;margin:0}p.lead{color:#475467;margin:4px 0 20px}.card{background:#fff;border:1px solid #e4e7ec;border-radius:16px;padding:16px 18px;margin:0 0 12px;border-top:4px solid var(--c)}
  .card h2{font-size:16px;margin:0 0 4px;display:flex;justify-content:space-between;gap:8px}.ok{font-size:12px;font-weight:700;color:#067647;background:#ecfdf3;border-radius:999px;padding:2px 9px}.todo{font-size:12px;font-weight:700;color:#b54708;background:#fffaeb;border-radius:999px;padding:2px 9px}
  .card p{margin:0 0 10px;color:#475467;font-size:14px}input,textarea{width:100%;padding:11px 12px;border:1px solid #d0d5dd;border-radius:10px;font:inherit}input:focus,textarea:focus{outline:none;border-color:var(--c);box-shadow:0 0 0 3px color-mix(in srgb,var(--c) 20%,transparent)}
  button{width:100%;padding:13px;border:0;border-radius:12px;background:var(--c);color:#fff;font:600 16px system-ui;cursor:pointer;margin-top:6px}.foot{margin-top:18px;font-size:12px;color:#98a2b3;text-align:center}
  </style></head><body><main>${body}</main></body></html>`, { headers: { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex", "Referrer-Policy": "no-referrer" } });
}

async function load(token: string) {
  if (!env.DB || !secret()) return null;
  const clientId = await readConnectToken(secret(), token);
  if (!clientId) return null;
  const row = await env.DB.prepare("SELECT data, updated_at FROM workspace_documents WHERE id = ?1").bind("f2b-agency").first<{ data: string; updated_at: string }>();
  if (!row) return null;
  const data = JSON.parse(row.data) as { clients?: Client[]; settings?: { branding?: { agencyName?: string } } };
  const client = (data.clients || []).find((item) => item.id === clientId);
  return client ? { client, data, updatedAt: row.updated_at } : null;
}

export async function GET(_request: Request, context: RouteContext) {
  const { token } = await context.params;
  const found = await load(token);
  if (!found) return page("Link not valid", `<h1>This link isn’t valid</h1><p class="lead">Ask your agency to send you a new connection link.</p>`);
  const { client } = found;
  const rows = ITEMS.map((item) => { const done = item.done(client); return `<section class="card"><h2>${esc(item.label)} ${done ? `<span class="ok">Connected</span>` : `<span class="todo">To do</span>`}</h2>${done ? "" : `<p>${esc(item.help)}</p><input name="${esc(item.key)}" placeholder="${esc(item.placeholder)}" maxlength="160">`}</section>`; }).join("");
  const todo = ITEMS.filter((item) => !item.done(client)).length;
  return page(`Connect your accounts · ${client.name}`, `<div class="top">${client.logo && /^(https:|data:image\/)/.test(client.logo) ? `<img src="${esc(client.logo)}" alt="">` : ""}<div><h1>${esc(client.name)}</h1></div></div>
    <p class="lead">${todo ? `Fill in what you can below and press Send — it goes straight to your marketing team. ${todo} item${todo === 1 ? "" : "s"} to go.` : "Everything is connected. Thank you!"}</p>
    ${todo ? `<form method="post">${rows}<section class="card"><h2>Anything else?</h2><textarea name="connectNotes" rows="3" maxlength="600" placeholder="Questions, or anything you couldn’t find"></textarea></section><button type="submit">Send to my marketing team</button></form>` : rows}
    <p class="foot">Secure link for ${esc(client.name)} only. No passwords are ever needed here.</p>`, client.color);
}

export async function POST(request: Request, context: RouteContext) {
  const { token } = await context.params;
  const found = await load(token);
  if (!found) return page("Link not valid", `<h1>This link isn’t valid</h1><p class="lead">Ask your agency to send you a new connection link.</p>`);
  const form = await request.formData().catch(() => null);
  if (!form) return page("Try again", `<h1>Something went wrong</h1><p class="lead">Please go back and try again.</p>`);
  const updates: Partial<Client> = {};
  for (const item of ITEMS) { const value = String(form.get(String(item.key)) || "").trim().slice(0, 160); if (value && !item.done(found.client)) (updates as Record<string, string>)[item.key] = item.key === "googleAdsAccountId" ? value.replace(/[^\d-]/g, "") : value; }
  const notes = String(form.get("connectNotes") || "").trim().slice(0, 600);
  if (!Object.keys(updates).length && !notes) return page("Nothing sent", `<h1>Nothing to send yet</h1><p class="lead">Go back and fill in at least one box.</p>`, found.client.color);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const current = attempt === 0 ? found : await load(token);
    if (!current) break;
    const clients = (current.data.clients || []).map((item) => item.id === current.client.id ? { ...item, ...updates, ...(notes ? { connectNotes: [item.connectNotes, `${new Date().toISOString().slice(0, 10)}: ${notes}`].filter(Boolean).join("\n").slice(-2000) } : {}) } : item);
    const activity = [{ id: crypto.randomUUID(), title: "Client sent account details", detail: `${current.client.name} filled in their connect link: ${[...Object.keys(updates).map((key) => ITEMS.find((item) => item.key === key)?.label || key), notes ? "a note" : ""].filter(Boolean).join(", ")}.`, icon: "🔗", at: new Date().toISOString(), actor: current.client.name, clientId: current.client.id }, ...(((current.data as { activity?: unknown[] }).activity) || [])].slice(0, 300);
    const next = { ...current.data, clients, activity };
    const saved = await env.DB!.prepare("UPDATE workspace_documents SET data = ?1, updated_at = ?2 WHERE id = ?3 AND updated_at = ?4").bind(JSON.stringify(next), `client-connect-${crypto.randomUUID()}`, "f2b-agency", current.updatedAt).run();
    if (saved.meta?.changes) return page("Thank you", `<h1>Thanks, ${esc(current.client.name)}!</h1><p class="lead">Your details are with your marketing team. They’ll send any access requests to approve. You can close this page.</p>`, current.client.color);
  }
  return page("Try again", `<h1>Please try again</h1><p class="lead">We couldn’t save that just now. Go back and press Send again.</p>`, found.client.color);
}
