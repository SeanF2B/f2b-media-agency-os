"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

// Operations → Onboarding → "Online onboarding": the admin side of the public /f/start funnel.
// Share links (public, embed, personalised from CRM contacts, cold email, referral, staff), conversions by
// route and source, pricing, usage limits, Stripe (test first, live only when both live secrets are in) and settings.

type Stat = { started: number; leads: number; audits: number; booked: number; paid: number };
type Session = { id: string; entry_route: string; status: string; step: string; domain: string; business?: string; email?: string; acquisition: { channel?: string }; unlocked: number; consent_contact: number; booking_status: string; payment_status: string; staff: number; created_at: string; updated_at: string };
type PricingService = { setupFee: number; monthly: number; label: string; enabled?: boolean };
type Settings = {
  publicEnabled: boolean; embedOrigins: string[]; localCountry: string; bookingSlug: string; freeFindings: number; consentText: string; stripeMode: "test" | "live";
  stripe: { testKey: boolean; testWebhook: boolean; liveKey: boolean; liveWebhook: boolean }; turnstileReady: boolean; storageReady: boolean;
  limits: Record<string, number | boolean>; pricing: { currency: string; services: Record<string, PricingService>; bundleDiscountPercent: number; manager: { monthly: number; label: string; enabled?: boolean } };
};
type Data = { settings: Settings; sessions: Session[]; stats: { byRoute: Record<string, Stat>; byChannel: Record<string, Stat>; total: Stat }; webhookUrl: string; startUrl: string };
const SECTIONS = ["Overview", "Share", "Pricing", "Payments", "Limits", "Settings"] as const;
const LIMIT_LABELS: Record<string, string> = {
  auditsPerVisitorPerDay: "Audits per visitor per day", freshAuditsPerDomainPerDay: "Fresh audits per website per day", aiPerSessionPerDay: "AI suggestions per session per day", aiPerVisitorPerDay: "AI suggestions per visitor per day",
  sessionsPerVisitorPerDay: "New sessions per visitor per day", uploadsPerSessionPerDay: "Uploads per session per day", globalAuditsPerDay: "All audits per day (everyone)", globalAiPerDay: "All AI calls per day (everyone)",
  staffMultiplier: "Staff links get × more", auditCacheDays: "Reuse a finished audit for (days)",
};
const ROUTE_LABEL: Record<string, string> = { grow: "I'm ready to grow", audit: "Audit my business", guidance: "I need some guidance" };
const pct = (part: number, whole: number) => whole ? `${Math.round((part / whole) * 100)}%` : "—";

async function api(body: Record<string, unknown>) {
  const response = await fetch("/api/onboarding", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const result = await response.json().catch(() => ({})) as Record<string, any>;
  if (!response.ok) throw new Error(result.error || "Something went wrong.");
  return result;
}

export function OnboardingAdmin() {
  const [data, setData] = useState<Data | null>(null);
  const [section, setSection] = useState<(typeof SECTIONS)[number]>("Overview");
  const [error, setError] = useState("");
  const [note, setNote] = useState("");
  const load = useCallback(async () => {
    try { const response = await fetch("/api/onboarding", { cache: "no-store" }); const result = await response.json() as Data & { error?: string }; if (!response.ok) throw new Error(result.error || "Couldn’t load onboarding."); setData(result as Data); setError(""); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Couldn’t load onboarding."); }
  }, []);
  useEffect(() => { void load(); }, [load]);
  const saveSettings = async (settings: Partial<Settings> & Record<string, unknown>) => {
    try { const result = await api({ action: "settings", settings }); setData((current) => current ? { ...current, settings: result.settings } : current); setNote("Saved"); setError(""); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Couldn’t save."); }
  };
  if (!data) return <div className="onb-admin">{error ? <p className="onb-error" role="alert">{error}</p> : <div className="page-loading" role="status" aria-label="Loading online onboarding…"><i /></div>}</div>;
  const s = data.settings;
  return <div className="onb-admin">
    <div className="onb-admin-head">
      <div><h3>Online onboarding</h3><p>One engine for the public funnel at <a href={data.startUrl} target="_blank" rel="noreferrer">/f/start</a> and this wizard. {s.stripeMode === "live" ? <b className="onb-pill live">Live payments</b> : <b className="onb-pill test">Test mode — no real charges</b>}{!s.publicEnabled && <b className="onb-pill off">Paused</b>}</p></div>
      <nav className="onb-admin-tabs" role="tablist">{SECTIONS.map((name) => <button key={name} type="button" role="tab" aria-selected={section === name} className={section === name ? "on" : ""} onClick={() => { setSection(name); setNote(""); }}>{name}</button>)}</nav>
    </div>
    {error && <p className="onb-error" role="alert">{error}</p>}
    {note && <p className="onb-note" role="status">{note}</p>}
    {section === "Overview" && <Overview data={data} />}
    {section === "Share" && <Share data={data} />}
    {section === "Pricing" && <Pricing settings={s} onSave={(pricing) => void saveSettings({ pricing } as never)} />}
    {section === "Payments" && <Payments data={data} onSaved={(settings) => { setData({ ...data, settings }); setNote("Saved"); }} onError={setError} />}
    {section === "Limits" && <Limits settings={s} onSave={(limits) => void saveSettings({ limits } as never)} />}
    {section === "Settings" && <General settings={s} onSave={(patch) => void saveSettings(patch)} />}
  </div>;
}

function Overview({ data }: { data: Data }) {
  const t = data.stats.total;
  const rows = (group: Record<string, Stat>, label: (key: string) => string) => Object.entries(group).sort((a, b) => b[1].started - a[1].started).map(([key, stat]) => <tr key={key}><td>{label(key)}</td><td>{stat.started}</td><td>{stat.leads} <small>{pct(stat.leads, stat.started)}</small></td><td>{stat.audits}</td><td>{stat.booked}</td><td>{stat.paid} <small>{pct(stat.paid, stat.started)}</small></td></tr>);
  return <div className="onb-admin-body">
    <div className="onb-kpis">{([["Started", t.started], ["Leads", t.leads], ["Audits", t.audits], ["Calls booked", t.booked], ["Paid", t.paid]] as const).map(([label, value]) => <div key={label}><small>{label}</small><b>{value}</b>{label !== "Started" && <em>{pct(value, t.started)}</em>}</div>)}</div>
    <p className="onb-note">Last 30 days. Leads = left contact details with permission (they appear in Leads → Contacts with an “Onboarding” opportunity).</p>
    <div className="onb-tables">
      <table><thead><tr><th>Entry route</th><th>Started</th><th>Leads</th><th>Audits</th><th>Booked</th><th>Paid</th></tr></thead><tbody>{rows(data.stats.byRoute, (key) => ROUTE_LABEL[key] || key)}</tbody></table>
      <table><thead><tr><th>Source</th><th>Started</th><th>Leads</th><th>Audits</th><th>Booked</th><th>Paid</th></tr></thead><tbody>{rows(data.stats.byChannel, (key) => key)}</tbody></table>
    </div>
    <h4>Recent sessions</h4>
    <div className="onb-sessions">{data.sessions.slice(0, 30).map((row) => <div key={row.id}><b>{row.business || row.domain || "Anonymous visitor"}</b><span>{ROUTE_LABEL[row.entry_route] || row.entry_route} · {row.acquisition?.channel || "Direct"}{row.staff ? " · staff" : ""}</span><span>{row.consent_contact ? (row.email || "Lead") : "No contact yet"} · step: {row.step || "—"}</span><span>{[row.booking_status && `Booking ${row.booking_status}`, row.payment_status && `Payment ${row.payment_status}`].filter(Boolean).join(" · ") || ""}</span><small>{new Date(row.updated_at).toLocaleString("en-IE", { dateStyle: "medium", timeStyle: "short" })}</small></div>)}{!data.sessions.length && <p className="onb-note">No online onboarding sessions yet.</p>}</div>
  </div>;
}

function Copy({ value, label }: { value: string; label: string }) {
  const [done, setDone] = useState(false);
  return <div className="onb-copy"><span>{label}</span><code>{value}</code><button type="button" className="secondary-button" onClick={() => { void navigator.clipboard?.writeText(value).then(() => { setDone(true); window.setTimeout(() => setDone(false), 1500); }); }}>{done ? "Copied" : "Copy"}</button></div>;
}
function Share({ data }: { data: Data }) {
  const [kind, setKind] = useState<"crm" | "cold_email" | "referral" | "staff">("crm");
  const [route, setRoute] = useState("");
  const [query, setQuery] = useState("");
  const [contacts, setContacts] = useState<Array<{ id: string; name: string; email: string; company: string }>>([]);
  const [contactId, setContactId] = useState("");
  const [ref, setRef] = useState("");
  const [campaign, setCampaign] = useState("");
  const [link, setLink] = useState("");
  const [error, setError] = useState("");
  useEffect(() => {
    if (kind !== "crm" || query.trim().length < 2) { setContacts([]); return; }
    const timer = window.setTimeout(() => {
      fetch(`/api/onboarding?contacts=${encodeURIComponent(query.trim())}`, { cache: "no-store" }).then((response) => response.json()).then((result: { contacts?: unknown }) => {
        setContacts(((result.contacts || []) as Array<{ id: string; name: string; email: string; company: string }>).slice(0, 8));
      }).catch(() => setContacts([]));
    }, 300);
    return () => window.clearTimeout(timer);
  }, [query, kind]);
  const make = async () => {
    setError(""); setLink("");
    try { const result = await api({ action: "link", kind, route, contactId, ref, campaign }); setLink(result.url); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Couldn’t create the link."); }
  };
  const embed = `<iframe src="${data.startUrl}?embed=1" title="Get started with F2B Media" style="width:100%;min-height:720px;border:0;border-radius:16px" loading="lazy" allow="clipboard-write"></iframe>`;
  return <div className="onb-admin-body">
    <Copy label="Public link" value={data.startUrl} />
    <Copy label="Audit link" value={`${data.startUrl}?route=audit`} />
    <Copy label="Embed on f2bmedia.com" value={embed} />
    <p className="onb-note">Embedding works on the sites listed in Settings → Embed sites.</p>
    <h4>Personalised link</h4>
    <div className="onb-grid">
      <label className="onb-field"><span>Link for</span><select value={kind} onChange={(event) => setKind(event.target.value as typeof kind)}><option value="crm">A CRM contact (prefilled)</option><option value="cold_email">Cold email campaign</option><option value="referral">Referral partner</option><option value="staff">Staff (higher limits)</option></select></label>
      <label className="onb-field"><span>Open on</span><select value={route} onChange={(event) => setRoute(event.target.value)}><option value="">Choice of three routes</option><option value="grow">I'm ready to grow</option><option value="audit">Audit my business</option><option value="guidance">I need some guidance</option></select></label>
      {kind === "crm" && <label className="onb-field wide"><span>Contact</span><input value={query} onChange={(event) => { setQuery(event.target.value); setContactId(""); }} placeholder="Search name, email or business" data-no-ai />{contacts.length > 0 && !contactId && <div className="onb-results">{contacts.map((item) => <button key={item.id} type="button" onClick={() => { setContactId(item.id); setQuery(`${item.name}${item.company ? ` · ${item.company}` : ""}`); setContacts([]); }}><b>{item.name}</b><span>{[item.company, item.email].filter(Boolean).join(" · ")}</span></button>)}</div>}</label>}
      {kind === "referral" && <label className="onb-field"><span>Referral code</span><input value={ref} onChange={(event) => setRef(event.target.value)} placeholder="partner-name" data-no-ai /></label>}
      {kind === "cold_email" && <label className="onb-field"><span>Campaign name</span><input value={campaign} onChange={(event) => setCampaign(event.target.value)} placeholder="Roofers Galway Nov" data-no-ai /></label>}
    </div>
    <button type="button" className="primary-button" disabled={kind === "crm" && !contactId} onClick={() => void make()}>Create link</button>
    {error && <p className="onb-error" role="alert">{error}</p>}
    {link && <Copy label="Link" value={link} />}
  </div>;
}

function Pricing({ settings, onSave }: { settings: Settings; onSave: (pricing: Settings["pricing"]) => void }) {
  const [pricing, setPricing] = useState(settings.pricing);
  const setService = (key: string, patch: Partial<PricingService>) => setPricing((current) => ({ ...current, services: { ...current.services, [key]: { ...current.services[key], ...patch } } }));
  return <div className="onb-admin-body">
    <p className="onb-note">Management and setup fees only. Google and Meta bill advertising spend directly to the customer — it's never charged here.</p>
    <div className="onb-price-table">
      <div className="onb-price-row head"><span>Service</span><span>Setup (one-off)</span><span>Monthly management</span><span>Offer online</span></div>
      {Object.entries(pricing.services).map(([key, item]) => <div key={key} className="onb-price-row"><span><input value={item.label} onChange={(event) => setService(key, { label: event.target.value })} aria-label={`${key} name`} data-no-ai /><small>{key}</small></span><input type="number" min={0} value={item.setupFee} onChange={(event) => setService(key, { setupFee: Number(event.target.value) })} aria-label={`${key} setup fee`} /><input type="number" min={0} value={item.monthly} onChange={(event) => setService(key, { monthly: Number(event.target.value) })} aria-label={`${key} monthly fee`} /><input type="checkbox" checked={item.enabled !== false} onChange={(event) => setService(key, { enabled: event.target.checked })} aria-label={`Offer ${key} online`} /></div>)}
      <div className="onb-price-row"><span><input value={pricing.manager.label} onChange={(event) => setPricing({ ...pricing, manager: { ...pricing.manager, label: event.target.value } })} aria-label="Manager upsell name" data-no-ai /><small>Upsell</small></span><span>—</span><input type="number" min={0} value={pricing.manager.monthly} onChange={(event) => setPricing({ ...pricing, manager: { ...pricing.manager, monthly: Number(event.target.value) } })} aria-label="Manager monthly fee" /><input type="checkbox" checked={pricing.manager.enabled !== false} onChange={(event) => setPricing({ ...pricing, manager: { ...pricing.manager, enabled: event.target.checked } })} aria-label="Offer manager upsell" /></div>
    </div>
    <div className="onb-grid">
      <label className="onb-field"><span>Currency</span><select value={pricing.currency} onChange={(event) => setPricing({ ...pricing, currency: event.target.value })}>{["EUR", "GBP", "USD"].map((code) => <option key={code}>{code}</option>)}</select></label>
      <label className="onb-field"><span>Bundle discount on monthly fees (2+ services)</span><input type="number" min={0} max={50} value={pricing.bundleDiscountPercent} onChange={(event) => setPricing({ ...pricing, bundleDiscountPercent: Number(event.target.value) })} /></label>
    </div>
    <button type="button" className="primary-button" onClick={() => onSave(pricing)}>Save pricing</button>
  </div>;
}

function Payments({ data, onSaved, onError }: { data: Data; onSaved: (settings: Settings) => void; onError: (message: string) => void }) {
  const s = data.settings;
  const [keys, setKeys] = useState({ testKey: "", testWebhook: "", liveKey: "", liveWebhook: "" });
  const [busy, setBusy] = useState(false);
  const save = async (mode?: "test" | "live") => {
    if (mode === "live" && !window.confirm("Switch online checkout to LIVE? Real customers will be charged from now on.")) return;
    setBusy(true);
    try { const result = await api({ action: "stripe", ...keys, mode }); setKeys({ testKey: "", testWebhook: "", liveKey: "", liveWebhook: "" }); onSaved(result.settings); }
    catch (reason) { onError(reason instanceof Error ? reason.message : "Couldn’t save."); }
    finally { setBusy(false); }
  };
  const status = (ok: boolean) => <em className={ok ? "ok" : "missing"}>{ok ? "✓ Saved" : "Missing"}</em>;
  return <div className="onb-admin-body">
    <p className="onb-note">Stripe Checkout takes card payments for setup fees and monthly subscriptions. Payments sync to Books → Invoicing (marked paid) and the CRM. After paying, customers go straight to connecting their accounts. Manual invoicing is unchanged.</p>
    {!s.storageReady && <p className="onb-error">Secure key storage isn't configured on the server, so Stripe keys can't be saved yet.</p>}
    <Copy label="Webhook URL" value={data.webhookUrl} />
    <p className="onb-note">In Stripe → Developers → Webhooks, add this URL with events: checkout.session.completed, checkout.session.async_payment_succeeded, checkout.session.async_payment_failed, checkout.session.expired, invoice.paid, invoice.payment_failed, customer.subscription.updated, customer.subscription.deleted.</p>
    <div className="onb-grid">
      <label className="onb-field"><span>Test secret key {status(s.stripe.testKey)}</span><input type="password" autoComplete="off" value={keys.testKey} onChange={(event) => setKeys({ ...keys, testKey: event.target.value })} placeholder="sk_test_…" /></label>
      <label className="onb-field"><span>Test webhook secret {status(s.stripe.testWebhook)}</span><input type="password" autoComplete="off" value={keys.testWebhook} onChange={(event) => setKeys({ ...keys, testWebhook: event.target.value })} placeholder="whsec_…" /></label>
      <label className="onb-field"><span>Live secret key {status(s.stripe.liveKey)}</span><input type="password" autoComplete="off" value={keys.liveKey} onChange={(event) => setKeys({ ...keys, liveKey: event.target.value })} placeholder="sk_live_…" /></label>
      <label className="onb-field"><span>Live webhook secret {status(s.stripe.liveWebhook)}</span><input type="password" autoComplete="off" value={keys.liveWebhook} onChange={(event) => setKeys({ ...keys, liveWebhook: event.target.value })} placeholder="whsec_…" /></label>
    </div>
    <div className="onb-actions">
      <button type="button" className="primary-button" disabled={busy || !Object.values(keys).some(Boolean)} onClick={() => void save()}>Save keys</button>
      {s.stripeMode === "live" ? <button type="button" className="secondary-button" disabled={busy} onClick={() => void save("test")}>Switch back to test mode</button>
        : <button type="button" className="secondary-button" disabled={busy || !(s.stripe.liveKey && s.stripe.liveWebhook)} onClick={() => void save("live")}>Go live</button>}
    </div>
    <p className="onb-note">Currently: <b>{s.stripeMode === "live" ? "LIVE — real charges" : "Test mode — use Stripe test cards (4242 4242 4242 4242); nothing is charged"}</b>.</p>
  </div>;
}

function Limits({ settings, onSave }: { settings: Settings; onSave: (limits: Settings["limits"]) => void }) {
  const [limits, setLimits] = useState(settings.limits);
  return <div className="onb-admin-body">
    <p className="onb-note">Server-side daily limits protect API costs. Finished audits are reused from the cache instead of re-running paid checks. Staff links get higher limits.</p>
    <div className="onb-grid">{Object.entries(LIMIT_LABELS).map(([key, label]) => <label key={key} className="onb-field"><span>{label}</span><input type="number" min={0} value={Number(limits[key] ?? 0)} onChange={(event) => setLimits({ ...limits, [key]: Number(event.target.value) })} /></label>)}</div>
    <label className="onb-check"><input type="checkbox" checked={Boolean(limits.allowAnonymousGeneration)} onChange={(event) => setLimits({ ...limits, allowAnonymousGeneration: event.target.checked })} /> Let anonymous visitors (no contact details yet) generate ad and website previews</label>
    <p className="onb-note">{settings.turnstileReady ? "✓ Cloudflare Turnstile is on for the start page." : "Turnstile isn't configured yet: add TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY to the Worker. Until then the other limits still apply."}</p>
    <button type="button" className="primary-button" onClick={() => onSave(limits)}>Save limits</button>
  </div>;
}

function General({ settings, onSave }: { settings: Settings; onSave: (patch: Record<string, unknown>) => void }) {
  const [form, setForm] = useState({ publicEnabled: settings.publicEnabled, embedOrigins: settings.embedOrigins.join(", "), localCountry: settings.localCountry, bookingSlug: settings.bookingSlug, freeFindings: settings.freeFindings, consentText: settings.consentText });
  const origins = useMemo(() => form.embedOrigins.split(/[,\s]+/).map((item) => item.trim()).filter(Boolean), [form.embedOrigins]);
  return <div className="onb-admin-body">
    <label className="onb-check"><input type="checkbox" checked={form.publicEnabled} onChange={(event) => setForm({ ...form, publicEnabled: event.target.checked })} /> Public onboarding is on</label>
    <div className="onb-grid">
      <label className="onb-field wide"><span>Embed sites (domains allowed to show the funnel in an iframe)</span><input value={form.embedOrigins} onChange={(event) => setForm({ ...form, embedOrigins: event.target.value })} placeholder="f2bmedia.com" data-no-ai /></label>
      <label className="onb-field"><span>Strategy call booking page (Scheduling slug)</span><input value={form.bookingSlug} onChange={(event) => setForm({ ...form, bookingSlug: event.target.value })} placeholder="strategy-call" data-no-ai /></label>
      <label className="onb-field"><span>Country for Google Maps checks</span><input value={form.localCountry} onChange={(event) => setForm({ ...form, localCountry: event.target.value })} data-no-ai /></label>
      <label className="onb-field"><span>Free audit findings before asking for details</span><input type="number" min={1} max={10} value={form.freeFindings} onChange={(event) => setForm({ ...form, freeFindings: Number(event.target.value) })} /></label>
      <label className="onb-field wide"><span>Consent wording</span><textarea rows={2} value={form.consentText} onChange={(event) => setForm({ ...form, consentText: event.target.value })} data-no-ai /></label>
    </div>
    <button type="button" className="primary-button" onClick={() => onSave({ ...form, embedOrigins: origins })}>Save settings</button>
  </div>;
}
