import { env } from "cloudflare:workers";
import { getChatGPTUser } from "../../chatgpt-auth";
import { aiConfigured, aiEndpoint, aiHeaders, aiModel, resolveAiProvider } from "@/lib/ai-provider";
import { buildClientReport } from "@/lib/client-report-data";
import { postWithCreditRetry } from "@/lib/ai-credit";

// AI employees in the chat widget. GET-like call (no prompt) returns the data that employee can see for the
// selected client; with a prompt it answers using only that data. Read-only: nothing is changed from here.
export const dynamic = "force-dynamic";
const respond = (body: Record<string, unknown>, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });

const EMPLOYEES = {
  google_ads: { name: "Google Ads Specialist", role: "a senior Google Ads specialist for local service businesses" },
  seo: { name: "SEO & Local Specialist", role: "an SEO and Google Business Profile specialist" },
  bookkeeper: { name: "Bookkeeper", role: "an Irish small-business bookkeeper (not a tax adviser)" },
  creatives: { name: "Creatives", role: "a creative director for ads, social posts and job photos" },
  copywriter: { name: "Copywriter (Claude)", role: "a concise, natural UK/Irish English copywriter" },
  agency: { name: "Agency Overview", role: "the agency's operations lead who sees every client" },
  developer: { name: "Developer", role: "a web developer who manages client sites, tracking and integrations" },
  lead_gen: { name: "Lead Gen", role: "a lead generation and sales pipeline specialist" },
} as const;
type EmployeeId = keyof typeof EMPLOYEES;
type Row = { label: string; value: string; tone?: "good" | "bad" | "expense" };
type Client = { id: string; name: string; status?: string; website?: string; wordpressSiteUrl?: string; googleAdsAccountId?: string; metaAdsAccountId?: string; googleAnalyticsAccountId?: string; searchConsoleSiteUrl?: string; gbpLocationId?: string; services?: Array<{ name?: string; service?: string; fee?: number }>; branding?: { primary?: string; secondary?: string }; currency?: string };
type Ws = { ownerId?: string; staff?: Array<{ id?: string; email?: string; isBot?: boolean; role?: string; limitClientAccess?: boolean; clientAccessIds?: string[] }>; clients?: Client[]; tasks?: Array<{ clientId?: string; status?: string; due?: string; title?: string }>; financeRecords?: Array<{ kind: string; amount: number; date: string; clientId?: string; category?: string; description?: string }> };

const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
const fmtMoney = (n: number, c = "EUR") => { try { return new Intl.NumberFormat("en-IE", { style: "currency", currency: c, maximumFractionDigits: n < 100 ? 2 : 0 }).format(n); } catch { return `€${n.toFixed(0)}`; } };
const fmt = (n: number | null | undefined) => n == null ? "—" : new Intl.NumberFormat("en-IE").format(Math.round(n));

async function gather(employee: EmployeeId, ws: Ws, client: Client | null, db: D1Database, ownerId: string): Promise<{ rows: Row[]; context: string; note: string }> {
  const period = { start: day(-30), end: day(0) };
  const cur = client?.currency || "EUR";
  const rows: Row[] = []; const extra: string[] = []; let note = "";
  const ok = <T,>(s?: { status: string; data?: T; note?: string }) => s?.status === "ok" ? s.data || null : null;
  if (employee === "google_ads") {
    const targets = client ? [client] : (ws.clients || []).filter((c) => c.googleAdsAccountId);
    if (!targets.length || (client && !client.googleAdsAccountId)) return { rows, context: "", note: "No Google Ads account is linked to this client yet." };
    const reports = await Promise.all(targets.slice(0, 12).map((c) => buildClientReport(db as never, ws as never, c.id, "ads", period).catch(() => null)));
    let spend = 0, clicks = 0, conv = 0, impr = 0; const camps: string[] = []; let any = false;
    for (const r of reports) { const d = ok(r?.ads); if (!d) { if (r?.ads?.note && client) note = r.ads.note; continue; } any = true; spend += d.current.spend; clicks += d.current.clicks; conv += d.current.conversions; impr += d.current.impressions; for (const c of d.campaigns.slice(0, 6)) camps.push(`${r!.client.name} · ${c.name} (${c.status}): spend ${c.spend.toFixed(2)}, clicks ${c.clicks}, conv ${c.conversions}`); }
    if (any) { rows.push({ label: "Spend · 30 days", value: fmtMoney(spend, cur), tone: "expense" }, { label: "Clicks", value: fmt(clicks) }, { label: "Impressions", value: fmt(impr) }, { label: "Conversions", value: fmt(conv), tone: conv ? "good" : undefined }, { label: "Avg. CPC", value: clicks ? fmtMoney(spend / clicks, cur) : "—" }, { label: "Cost / conversion", value: conv ? fmtMoney(spend / conv, cur) : "—" }); extra.push("Campaigns:", ...camps.slice(0, 20)); }
  } else if (employee === "seo") {
    if (!client) return { rows, context: "", note: "Pick a client at the top to see their SEO and Google Business data." };
    const r = await buildClientReport(db as never, ws as never, client.id, "seo", period).catch(() => null);
    const t = ok(r?.traffic), rk = ok(r?.rankings), b = ok(r?.business), ai = ok(r?.aiVisibility), bl = ok(r?.backlinks);
    if (t) rows.push({ label: t.metric.split("(")[0].trim(), value: fmt(t.current) });
    if (b) rows.push({ label: "Google Business views", value: fmt(b.impressions) }, { label: "Calls from Google", value: fmt(b.calls), tone: b.calls ? "good" : undefined }, { label: "Directions", value: fmt(b.directions) }, { label: "Profile website clicks", value: fmt(b.websiteClicks) });
    if (rk) { const pos = rk.keywords.map((k) => k.position).filter((p): p is number => typeof p === "number"); rows.push({ label: "Keywords tracked", value: fmt(rk.tracked) }, { label: "Avg. Google position", value: pos.length ? `#${(pos.reduce((a, x) => a + x, 0) / pos.length).toFixed(1)}` : "—" }); extra.push("Keywords:", ...rk.keywords.slice(0, 25).map((k) => `${k.keyword}: position ${k.position ?? "none"} (was ${k.previousPosition ?? "none"}), volume ${k.volume ?? "?"}`)); }
    if (ai) rows.push({ label: "ChatGPT/Claude mentions", value: `${Math.round(ai.overall)}%` });
    if (bl) rows.push({ label: "Referring domains", value: fmt(bl.referringDomains) });
    note = (r?.missing || []).map((m) => `${m.label}: ${m.note}`).slice(0, 3).join(" · ");
  } else if (employee === "bookkeeper") {
    const recs = (ws.financeRecords || []).filter((f) => !client || f.clientId === client.id);
    const month = day(0).slice(0, 7), year = day(0).slice(0, 4);
    const sum = (list: typeof recs, kind: string) => list.filter((f) => f.kind === kind).reduce((a, f) => a + (Number(f.amount) || 0), 0);
    const m = recs.filter((f) => f.date?.startsWith(month)), y = recs.filter((f) => f.date?.startsWith(year));
    const inc = sum(m, "Income"), exp = sum(m, "Expense"), yi = sum(y, "Income"), ye = sum(y, "Expense");
    rows.push({ label: "Income · this month", value: fmtMoney(inc, cur), tone: "good" }, { label: "Expenses · this month", value: fmtMoney(exp, cur), tone: "expense" }, { label: "Net · this month", value: fmtMoney(inc - exp, cur), tone: inc - exp >= 0 ? "good" : "bad" }, { label: `Income · ${year}`, value: fmtMoney(yi, cur) }, { label: `Expenses · ${year}`, value: fmtMoney(ye, cur) });
    const cats = new Map<string, number>(); for (const f of y.filter((f) => f.kind === "Expense")) cats.set(f.category || "Other", (cats.get(f.category || "Other") || 0) + Number(f.amount || 0));
    extra.push("Expense categories this year:", ...[...cats].sort((a, b) => b[1] - a[1]).slice(0, 10).map(([k, v]) => `${k}: ${v.toFixed(2)}`), "Recent records:", ...recs.slice(-15).map((f) => `${f.date} ${f.kind} ${f.amount} ${f.category || ""} ${f.description || ""}`));
  } else if (employee === "lead_gen" || employee === "agency") {
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const where = client ? " AND o.client_id=?3" : ""; const bind = client ? [ownerId, since, client.id] : [ownerId, since];
    const opp = await db.prepare(`SELECT COUNT(*) AS n, COALESCE(SUM(o.value),0) AS v, SUM(CASE WHEN o.created_at>=?2 THEN 1 ELSE 0 END) AS n30, SUM(CASE WHEN s.category='won' THEN o.value ELSE 0 END) AS won, SUM(CASE WHEN s.category='open' OR s.category IS NULL THEN o.value ELSE 0 END) AS open FROM crm_opportunities o LEFT JOIN crm_pipeline_stages s ON s.id=o.stage_id WHERE o.owner_id=?1${where}`).bind(...bind).first<{ n: number; v: number; n30: number; won: number; open: number }>().catch(() => null);
    const src = (await db.prepare(`SELECT COALESCE(NULLIF(o.source,''),'Not recorded') AS source, COUNT(*) AS n FROM crm_opportunities o WHERE o.owner_id=?1 AND o.created_at>=?2${where} GROUP BY 1 ORDER BY n DESC LIMIT 8`).bind(...bind).all<{ source: string; n: number }>().catch(() => null))?.results || [];
    rows.push({ label: "New leads · 30 days", value: fmt(opp?.n30), tone: opp?.n30 ? "good" : undefined }, { label: "Open pipeline", value: fmtMoney(opp?.open || 0, cur) }, { label: "Won value", value: fmtMoney(opp?.won || 0, cur), tone: "good" });
    extra.push("Leads by source (30 days):", ...src.map((s) => `${s.source}: ${s.n}`));
    if (employee === "agency") {
      const tasks = (ws.tasks || []).filter((t) => !client || t.clientId === client.id); const open = tasks.filter((t) => !/^done$/i.test(t.status || ""));
      const overdue = open.filter((t) => t.due && t.due < day(0));
      const active = (ws.clients || []).filter((c) => !/inactive|archived/i.test(c.status || ""));
      rows.unshift({ label: "Active clients", value: fmt(client ? 1 : active.length) }, { label: "Open tasks", value: fmt(open.length) }, { label: "Overdue tasks", value: fmt(overdue.length), tone: overdue.length ? "bad" : "good" });
      extra.push("Overdue tasks:", ...overdue.slice(0, 15).map((t) => `${t.title} (due ${t.due})`), "Clients:", ...active.slice(0, 40).map((c) => `${c.name}: ${(c.services || []).map((s) => s.name || s.service).filter(Boolean).join(", ")}`));
    }
  } else if (employee === "developer") {
    const list = client ? [client] : (ws.clients || []).filter((c) => !/inactive|archived/i.test(c.status || ""));
    const has = (k: keyof Client) => list.filter((c) => c[k]).length;
    rows.push({ label: "Websites", value: `${has("website")} / ${list.length}` }, { label: "GA4 linked", value: `${has("googleAnalyticsAccountId")} / ${list.length}` }, { label: "Search Console", value: `${has("searchConsoleSiteUrl")} / ${list.length}` }, { label: "Google Ads linked", value: `${has("googleAdsAccountId")} / ${list.length}` }, { label: "Meta Ads linked", value: `${has("metaAdsAccountId")} / ${list.length}` });
    extra.push(...list.slice(0, 40).map((c) => `${c.name}: site ${c.website || c.wordpressSiteUrl || "none"}; GA4 ${c.googleAnalyticsAccountId ? "yes" : "no"}; GSC ${c.searchConsoleSiteUrl ? "yes" : "no"}; Ads ${c.googleAdsAccountId ? "yes" : "no"}; Meta ${c.metaAdsAccountId ? "yes" : "no"}`));
  } else {
    // creatives / copywriter: brand and services context.
    if (!client) return { rows, context: "", note: "Pick a client at the top so I can write for their brand." };
    const services = (client.services || []).map((s) => s.name || s.service).filter(Boolean) as string[];
    rows.push({ label: "Business", value: client.name }, { label: "Website", value: client.website || client.wordpressSiteUrl || "—" }, { label: "Services", value: services.slice(0, 4).join(", ") || "—" });
    if (client.branding?.primary) rows.push({ label: "Brand colours", value: [client.branding.primary, client.branding.secondary].filter(Boolean).join(" · ") });
    extra.push(`Services: ${services.join(", ")}`);
  }
  const context = [client ? `Client: ${client.name}${client.website ? ` (${client.website})` : ""}` : "Scope: whole agency (all clients)", "Figures (last 30 days unless stated):", ...rows.map((r) => `${r.label}: ${r.value}`), ...extra].join("\n").slice(0, 9000);
  return { rows, context, note };
}

export async function POST(request: Request) {
  const user = await getChatGPTUser();
  if (!user) return respond({ error: "Sign in first." }, 401);
  if (!env.DB) return respond({ error: "The workspace database is unavailable." }, 503);
  const body = await request.json().catch(() => ({})) as { employee?: string; clientId?: string; prompt?: string; history?: Array<{ from: string; text: string }> };
  const employee = (Object.keys(EMPLOYEES).includes(String(body.employee)) ? body.employee : "agency") as EmployeeId;
  const row = await env.DB.prepare("SELECT owner_id, data FROM workspace_documents WHERE id = 'f2b-agency'").first<{ owner_id: string; data: string }>();
  if (!row) return respond({ error: "The workspace is unavailable." }, 503);
  const ws = JSON.parse(row.data) as Ws; const ownerId = String(ws.ownerId || row.owner_id);
  const owner = ownerId === user.userId;
  const me = (ws.staff || []).find((s) => !s.isBot && (s.id === user.userId || s.email?.toLowerCase() === user.email.toLowerCase()));
  if (!owner && !me) return respond({ error: "Only workspace members can use AI employees." }, 403);
  const admin = owner || ["Owner", "Admin"].includes(me?.role || "");
  if (!admin && (employee === "bookkeeper" || employee === "agency")) return respond({ error: "Only an admin can use this AI employee." }, 403);
  let client = (ws.clients || []).find((c) => c.id === body.clientId) || null;
  if (!admin && me?.limitClientAccess) { const allowed = me.clientAccessIds || []; if (!client || !allowed.includes(client.id)) client = (ws.clients || []).find((c) => allowed.includes(c.id)) || null; }
  const data = await gather(employee, ws, client, env.DB, ownerId);
  const info = EMPLOYEES[employee];
  const prompt = String(body.prompt || "").trim().slice(0, 1500);
  if (!prompt) return respond({ employee, name: info.name, client: client?.name || "", rows: data.rows, note: data.note });
  const provider = await resolveAiProvider(env as never, ownerId);
  if (!aiConfigured(env as never, provider)) return respond({ error: "Connect an AI provider in Settings → API Keys." }, 503);
  const history = (body.history || []).slice(-8).map((m) => ({ role: m.from === "me" ? "user" : "assistant", content: String(m.text || "").slice(0, 1200) }));
  const system = [`You are ${info.role}, working inside F2B Media's agency software as the "${info.name}" AI employee.`,
    "Answer using ONLY the data below. If something isn't in the data, say it isn't available and what would need connecting — never invent figures.",
    "Be concise and practical: short paragraphs or up to 5 bullets, plain UK/Irish English, give concrete next steps.",
    employee === "bookkeeper" ? "Point out this is guidance, not tax advice, only when giving tax-related answers." : "",
    "DATA:", data.context || "(no data available)", data.note ? `Missing/limits: ${data.note}` : ""].filter(Boolean).join("\n");
  const isOpenRouter = /openrouter/i.test(JSON.stringify(provider ?? "")) || /openrouter/i.test(aiEndpoint(env as never, "responses", provider)!);
  const models = [employee === "copywriter" && isOpenRouter ? "anthropic/claude-sonnet-5.5" : "", aiModel(env as never, undefined, provider) || ""].filter(Boolean);
  let lastError = "";
  for (const model of models) {
    try {
      const result = await postWithCreditRetry(aiEndpoint(env as never, "responses", provider)!, { headers: aiHeaders(env as never, provider)!, timeoutMs: 45000,
        body: { model, max_output_tokens: 700, input: [{ role: "system", content: system }, ...history, { role: "user", content: prompt }], ...(isOpenRouter ? { reasoning: { effort: "low" } } : {}) } });
      if (!result.ok) { lastError = result.message; continue; }
      const payload = result.payload;
      let text = typeof payload?.output_text === "string" ? payload.output_text : "";
      if (!text) for (const item of payload?.output || []) for (const c of item?.content || []) if (c?.type === "output_text" && typeof c.text === "string") text += c.text;
      if (text.trim()) return respond({ employee, name: info.name, reply: text.trim().slice(0, 4000), rows: data.rows });
    } catch { /* try next model */ }
  }
  return respond({ error: lastError || "The AI couldn’t answer just now. Try again in a moment." }, 502);
}
