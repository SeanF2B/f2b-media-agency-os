import { env } from "cloudflare:workers";
import { authorizeAdmin, respond } from "@/lib/settings-auth";

// Settings → APIs → "Every service the OS uses": one read-only list of every API/integration, where its key lives
// (server secret, saved in the OS, a sign-in, or a client connection), whether it's set, and where to manage it.
// Agency admins only. Never returns a secret: at most its last four characters.
export const dynamic = "force-dynamic";

type Row = { group: string; name: string; domain: string; use: string; source: string; status: "connected" | "missing" | "partial" | "via"; detail: string; manage: string };
const last4 = (v: unknown) => { const s = String(v || ""); return s.length > 8 ? `ending ${s.slice(-4)}` : s ? "set" : ""; };

export async function GET() {
  const auth = await authorizeAdmin("view API connections");
  if (auth.error) return auth.error;
  const db = env.DB!; const owner = auth.ownerId; const e = env as unknown as Record<string, unknown>;
  const one = async <T,>(sql: string, ...args: unknown[]): Promise<T | null> => { try { return await db.prepare(sql).bind(...args).first<T>(); } catch { return null; } };
  const count = async (sql: string, ...args: unknown[]) => Number((await one<{ n: number }>(sql, ...args))?.n || 0);
  const [orKey, customRows, twilio, meta, gads, gbp, drive, gcal, stripe, mailboxes, outreachConn] = await Promise.all([
    one<{ key_fingerprint: string }>("SELECT key_fingerprint FROM agency_api_keys WHERE owner_id=?1 AND provider='openrouter'", owner),
    db.prepare("SELECT label, key_fingerprint FROM agency_custom_api_keys WHERE owner_id=?1").bind(owner).all<{ label: string; key_fingerprint: string }>().then((r) => r.results || []).catch(() => []),
    one<{ account_sid: string; token_last4: string; enc_token: string }>("SELECT account_sid, token_last4, enc_token FROM conv_settings WHERE owner_id=?1", owner),
    count("SELECT COUNT(*) AS n FROM conv_meta_pages WHERE owner_id=?1", owner),
    count("SELECT COUNT(*) AS n FROM google_ads_connections"),
    count("SELECT COUNT(*) AS n FROM gbp_connections"),
    count("SELECT COUNT(*) AS n FROM google_drive_connections"),
    count("SELECT COUNT(*) AS n FROM sched_google_connections"),
    one<{ t: string; l: string }>("SELECT stripe_test_key AS t, stripe_live_key AS l FROM onboarding_settings WHERE owner_id=?1", owner),
    count("SELECT COUNT(*) AS n FROM outreach_mailboxes"),
    count("SELECT COUNT(*) AS n FROM outreach_connections"),
  ]);
  const cfToken = await one<{ key_fingerprint: string }>("SELECT key_fingerprint FROM agency_cloudflare_dns_token WHERE owner_id=?1", owner);
  const custom = (re: RegExp) => customRows.find((r) => re.test(r.label));
  const envOrSaved = (envKey: string, re: RegExp): Pick<Row, "source" | "status" | "detail"> => {
    const saved = custom(re);
    if (saved) return { source: "Saved in the OS", status: "connected", detail: `ending ${saved.key_fingerprint}` };
    if (e[envKey]) return { source: "Server secret", status: "connected", detail: last4(e[envKey]) };
    return { source: "Not set", status: "missing", detail: "" };
  };
  const secret = (k: string): Pick<Row, "source" | "status" | "detail"> => e[k] ? { source: "Server secret", status: "connected", detail: last4(e[k]) } : { source: "Server secret", status: "missing", detail: "Not set" };
  const conn = (n: number, what: string): Pick<Row, "source" | "status" | "detail"> => ({ source: "Sign-in / connection", status: n ? "connected" : "missing", detail: n ? `${n} ${what}${n === 1 ? "" : "s"}` : "None connected" });
  const aiOn = Boolean(orKey || e.OPENROUTER_API_KEY);
  const rows: Row[] = [
    // AI
    { group: "AI", name: "OpenRouter", domain: "openrouter.ai", use: "Gateway for every AI model in the OS", ...(orKey ? { source: "Saved in the OS", status: "connected", detail: `ending ${orKey.key_fingerprint}` } : secret("OPENROUTER_API_KEY")), manage: "AI provider above" },
    { group: "AI", name: "Grok (xAI)", domain: "x.ai", use: `AI employees, keyword ideas, community leads · model ${String(e.OPENROUTER_MODEL || "x-ai/grok-4.7")}`, source: "Through OpenRouter", status: aiOn ? "via" : "missing", detail: aiOn ? "Uses the OpenRouter key" : "Needs OpenRouter", manage: "Team → AI employee models" },
    { group: "AI", name: "Claude (Anthropic)", domain: "anthropic.com", use: "AI employees set to a Claude model", ...(custom(/anthropic|claude/i) ? { source: "Saved in the OS", status: "connected", detail: `ending ${custom(/anthropic|claude/i)!.key_fingerprint}` } : { source: "Through OpenRouter", status: aiOn ? "via" : "missing", detail: aiOn ? "Uses the OpenRouter key" : "Needs OpenRouter" }), manage: "Team → AI employee models" },
    { group: "AI", name: "OpenAI", domain: "openai.com", use: "Direct GPT access (fallback) and the AI phone agent voice", ...envOrSaved("OPENAI_API_KEY", /openai/i), manage: "Add API key" },
    { group: "AI", name: "AI images", domain: "openrouter.ai", use: `Image generation · ${String(e.OPENROUTER_IMAGE_MODEL || "default model")}`, source: "Through OpenRouter", status: aiOn ? "via" : "missing", detail: aiOn ? "Uses the OpenRouter key" : "Needs OpenRouter", manage: "AI provider above" },
    // Messaging & email
    { group: "Messaging & email", name: "Twilio", domain: "twilio.com", use: "WhatsApp, SMS, phone numbers and the AI phone agent", source: "Saved in the OS", status: twilio?.enc_token && twilio.account_sid ? "connected" : "missing", detail: twilio?.account_sid ? `Account ${twilio.account_sid.slice(0, 6)}… · token ending ${twilio.token_last4 || "····"}` : "Not connected", manage: "Leads → Conversations → ⚙" },
    { group: "Messaging & email", name: "WhatsApp (Meta coexistence)", domain: "whatsapp.com", use: "Linking a client's own WhatsApp Business number", ...(e.WHATSAPP_ES_CONFIG_ID ? { source: "Server secret", status: "connected" as const, detail: "Embedded signup set up" } : { source: "Server secret", status: "missing" as const, detail: "Embedded signup not set up" }), manage: "Conversations settings" },
    { group: "Messaging & email", name: "Meta (Facebook & Instagram)", domain: "facebook.com", use: "Messenger, Instagram DMs, Meta Ads, page posting", source: e.META_APP_ID ? "Server secret + page sign-ins" : "Server secret", status: e.META_APP_ID && e.META_APP_SECRET ? (meta ? "connected" : "partial") : "missing", detail: e.META_APP_ID ? `App ${String(e.META_APP_ID).slice(-4)} · ${meta} page${meta === 1 ? "" : "s"} connected` : "Meta app not set", manage: "Launchpad" },
    { group: "Messaging & email", name: "Resend", domain: "resend.com", use: "All emails: lead alerts, invoices, reports, chess invites, staff invites, campaigns", ...envOrSaved("RESEND_API_KEY", /resend/i), manage: "Add API key" },
    { group: "Messaging & email", name: "Sending address", domain: "resend.com", use: "From address on system emails", source: "Server secret", status: e.TASK_NOTIFICATION_FROM ? "connected" : "missing", detail: String(e.TASK_NOTIFICATION_FROM || "Not set").replace(/^.*<|>$/g, ""), manage: "Server" },
    { group: "Messaging & email", name: "Microsoft 365", domain: "microsoft.com", use: "Outreach mailboxes", source: "Sign-in / connection", status: outreachConn ? "connected" : "missing", detail: outreachConn ? `${mailboxes} mailbox${mailboxes === 1 ? "" : "es"}` : "Not connected", manage: "Leads → Outreach → ⚙" },
    { group: "Messaging & email", name: "Telegram bot", domain: "telegram.org", use: "Positive-reply and alert messages to the F2B bot", ...(custom(/tele/i) ? { source: "Saved in the OS", status: "connected" as const, detail: `ending ${custom(/tele/i)!.key_fingerprint}` } : { source: "Not set", status: "missing" as const, detail: "" }), manage: "Add API key" },
    // Google
    { group: "Google", name: "Google sign-in (OAuth app)", domain: "google.com", use: "Lets the OS connect Ads, Search Console, GA4, Business Profile, Calendar, Drive", ...secret("GOOGLE_ADS_CLIENT_ID"), manage: "Server" },
    { group: "Google", name: "Google Ads", domain: "ads.google.com", use: "Campaigns, keywords, reports", ...conn(gads, "account connection"), manage: "Launchpad" },
    { group: "Google", name: "Google Business Profile", domain: "business.google.com", use: "Posts, reviews, insights", ...conn(gbp, "connection"), manage: "Launchpad" },
    { group: "Google", name: "Google Calendar", domain: "calendar.google.com", use: "Staff calendars in Scheduling", ...conn(gcal, "staff calendar"), manage: "Scheduling / Your setup" },
    { group: "Google", name: "Google Drive", domain: "drive.google.com", use: "Media library and content uploads", ...conn(drive, "Drive"), manage: "Media library" },
    { group: "Google", name: "PageSpeed Insights", domain: "pagespeed.web.dev", use: "Site speed checks in audits", ...secret("GOOGLE_PAGESPEED_API_KEY"), manage: "Server" },
    // SEO & data
    { group: "SEO & data", name: "DataForSEO", domain: "dataforseo.com", use: "Keyword research, rank tracking, backlinks, map ranks, audits", ...(custom(/dataforseo/i) ? { source: "Saved in the OS", status: "connected" as const, detail: `ending ${custom(/dataforseo/i)!.key_fingerprint}` } : e.DATAFORSEO_API_LOGIN ? { source: "Server secret", status: "connected" as const, detail: String(e.DATAFORSEO_API_LOGIN) } : { source: "Not set", status: "missing" as const, detail: "" }), manage: "Add API key" },
    { group: "SEO & data", name: "Windsor.ai", domain: "windsor.ai", use: "Ad platform data for reports", ...secret("WINDSOR_API_KEY"), manage: "Server" },
    { group: "SEO & data", name: "Pexels", domain: "pexels.com", use: "Stock photo search in the Media library", ...envOrSaved("PEXELS_API_KEY", /pexels/i), manage: "Add API key" },
    { group: "SEO & data", name: "Unsplash", domain: "unsplash.com", use: "Stock photo search in the Media library", ...envOrSaved("UNSPLASH_ACCESS_KEY", /unsplash/i), manage: "Add API key" },
    { group: "SEO & data", name: "Pixabay", domain: "pixabay.com", use: "Stock photo search in the Media library", ...envOrSaved("PIXABAY_API_KEY", /pixabay/i), manage: "Add API key" },
    // Payments
    { group: "Payments", name: "Stripe", domain: "stripe.com", use: "Onboarding checkout and card payments", source: "Saved in the OS", status: stripe?.l ? "connected" : stripe?.t ? "partial" : "missing", detail: stripe?.l ? "Live key saved" : stripe?.t ? "Test mode only" : "Not connected", manage: "Onboarding → Payments" },
    // Infrastructure
    { group: "Infrastructure", name: "Cloudflare DNS", domain: "cloudflare.com", use: "Domains, DNS, Domain Guard, outreach domains", ...(cfToken ? { source: "Saved in the OS", status: "connected" as const, detail: `ending ${cfToken.key_fingerprint}` } : secret("CLOUDFLARE_DNS_API_TOKEN")), manage: "Server" },
    { group: "Infrastructure", name: "Cloudflare Access", domain: "cloudflare.com", use: "Staff sign-in and invites", ...secret("CLOUDFLARE_ACCESS_API_TOKEN"), manage: "Server" },
    { group: "Infrastructure", name: "GitHub", domain: "github.com", use: "Publishing client website content", ...secret("GITHUB_CONTENT_TOKEN"), manage: "Server" },
    { group: "Infrastructure", name: "GoHighLevel", domain: "gohighlevel.com", use: "Importing from GHL sub-accounts", source: "Server secret", status: e.GHL_CLIENT_ID ? "connected" : "missing", detail: e.GHL_CLIENT_ID ? "App set up" : "Not set", manage: "Server" },
  ];
  // Anything saved under "Add API key" that isn't one of the above still shows.
  const known = /pixabay|openrouter|anthropic|claude|openai|resend|tele|dataforseo|pexels|unsplash|developer token|google ads/i;
  for (const r of customRows) if (!known.test(r.label)) rows.push({ group: "Other", name: r.label, domain: "", use: "Saved key", source: "Saved in the OS", status: "connected", detail: `ending ${r.key_fingerprint}`, manage: "Other services above" });
  return respond({ rows, connected: rows.filter((r) => r.status === "connected" || r.status === "via").length, total: rows.length });
}
