"use client";

import { useEffect, useMemo, useRef, useState } from "react";

// Guided client onboarding (Operations → Onboarding). Saves into the existing client record and creates
// setup checklists in the existing Tasks system — one per selected service, never duplicated.

export type OnboardingClient = {
  id: string; name: string; company?: string; contact?: string; email?: string; phone?: string; website?: string; wordpressSiteUrl?: string;
  logo?: string; color?: string; branding?: { primary?: string; secondary?: string; logo?: string };
  services?: Array<{ name: string; fee: number; mediaSpend: number }>; seoLocations?: string[];
  googleAdsAccountId?: string; metaAdsAccountId?: string; googleSearchConsoleAccountId?: string; googleAnalyticsAccountId?: string;
  googleBusinessProfileAccountId?: string; googleBusinessProfileLocationId?: string;
  onboarding?: OnboardingAnswers;
};
export type OnboardingAnswers = {
  description: string; serviceAreas: string; targetCustomers: string; competitors: string;
  websiteGoal: string; websitePages: string; websiteStyle: string; websiteReferences: string; websiteNotes: string;
  services: string[]; completedAt?: string; updatedAt?: string;
};
export type OnboardingResult = {
  clientId: string | null; // null = new client
  client: Partial<OnboardingClient> & { name: string };
  answers: OnboardingAnswers;
  servicesToSetUp: string[];
};

export const ONBOARDING_SERVICES: Array<{ key: string; label: string; serviceLine: string; hint: string }> = [
  { key: "Google Ads", label: "Google Ads", serviceLine: "Google Ads", hint: "Search campaigns, keywords, landing page relevance" },
  { key: "SEO", label: "SEO", serviceLine: "SEO", hint: "Technical, on-page and local SEO" },
  { key: "Website", label: "Website", serviceLine: "Web Design & Development", hint: "Design, build and launch in the website builder" },
  { key: "Google Business Profile", label: "Google Business Profile", serviceLine: "SEO", hint: "Profile, posts, photos and reviews" },
  { key: "Meta Ads", label: "Meta Ads", serviceLine: "Meta Ads", hint: "Facebook and Instagram campaigns" },
  { key: "Email Marketing", label: "Email Marketing", serviceLine: "Email Marketing", hint: "Nurture sequences and newsletters" },
];

const blankAnswers: OnboardingAnswers = { description: "", serviceAreas: "", targetCustomers: "", competitors: "", websiteGoal: "", websitePages: "", websiteStyle: "", websiteReferences: "", websiteNotes: "", services: [] };
const FREE_MAIL = /(^|\.)(gmail|googlemail|hotmail|outlook|live|yahoo|icloud|me|aol|eircom|proton|protonmail|msn)\./i;
const websiteFromEmail = (email?: string) => { const domain = String(email || "").split("@")[1]?.trim().toLowerCase() || ""; return domain && domain.includes(".") && !FREE_MAIL.test(domain) ? `https://${domain}` : ""; };
const servicesSummary = (client?: OnboardingClient) => { const names = [...new Set((client?.services || []).map((service) => service.name).filter(Boolean))]; return names.length ? `Services with us: ${names.join(", ")}` : ""; };
const STEPS = ["Business", "Branding", "Services", "Website brief", "Connections", "Review"] as const;
const hex = (value: string, fallback: string) => /^#[0-9a-fA-F]{6}$/.test(value.trim()) ? value.trim().toLowerCase() : fallback;
const servicesFromClient = (client?: OnboardingClient) => {
  const names = new Set((client?.services || []).map((service) => service.name));
  return ONBOARDING_SERVICES.filter((item) => item.key === "Google Business Profile" ? Boolean(client?.googleBusinessProfileLocationId) && names.has("SEO") : names.has(item.serviceLine) || (item.key === "Website" && names.has("Sites"))).map((item) => item.key);
};

export function OnboardingWizard({ clients, initialClientId = "", existingSetupServices, onSave, onCancel, onOpenLaunchpad }: {
  clients: OnboardingClient[]; initialClientId?: string; existingSetupServices: (clientId: string) => string[];
  onSave: (result: OnboardingResult) => Promise<boolean> | boolean; onCancel: () => void; onOpenLaunchpad: () => void;
}) {
  const [clientId, setClientId] = useState(initialClientId);
  const existing = clients.find((client) => client.id === clientId);
  const [step, setStep] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const seed = (client?: OnboardingClient) => ({
    name: client?.name || "", company: client?.company || "", contact: client?.contact || "", email: client?.email || "", phone: client?.phone || "",
    website: client?.website || client?.wordpressSiteUrl || websiteFromEmail(client?.email), logo: client?.branding?.logo || client?.logo || "",
    primary: client?.branding?.primary || client?.color || "#1f2328", secondary: client?.branding?.secondary || "#6b6250",
    googleAdsAccountId: client?.googleAdsAccountId || "", metaAdsAccountId: client?.metaAdsAccountId || "", googleSearchConsoleAccountId: client?.googleSearchConsoleAccountId || "",
    googleAnalyticsAccountId: client?.googleAnalyticsAccountId || "", googleBusinessProfileLocationId: client?.googleBusinessProfileLocationId || "",
  });
  const [form, setForm] = useState(() => seed(existing));
  const [answers, setAnswers] = useState<OnboardingAnswers>(() => ({ ...blankAnswers, description: servicesSummary(existing), serviceAreas: (existing?.seoLocations || []).join(", "), ...(existing?.onboarding || {}), services: existing?.onboarding?.services?.length ? existing.onboarding.services : servicesFromClient(existing) }));
  const pickClient = (id: string) => { const next = clients.find((client) => client.id === id); setClientId(id); setForm(seed(next)); setScrape({}); autoReadFor.current = ""; setAnswers({ ...blankAnswers, description: servicesSummary(next), serviceAreas: (next?.seoLocations || []).join(", "), ...(next?.onboarding || {}), services: next?.onboarding?.services?.length ? next.onboarding.services : servicesFromClient(next) }); };
  const set = (key: keyof typeof form) => (event: { target: { value: string } }) => setForm((current) => ({ ...current, [key]: event.target.value }));
  const setA = (key: keyof OnboardingAnswers) => (event: { target: { value: string } }) => setAnswers((current) => ({ ...current, [key]: event.target.value }));
  const already = useMemo(() => new Set(clientId ? existingSetupServices(clientId) : []), [clientId, existingSetupServices]);
  const newSetups = answers.services.filter((service) => !already.has(service));
  const removedServices = (existing?.onboarding?.services || []).filter((service) => !answers.services.includes(service));
  const wantsWebsite = answers.services.includes("Website");
  const connections = [
    { key: "googleAdsAccountId", label: "Google Ads customer ID", needed: answers.services.includes("Google Ads"), placeholder: "123-456-7890" },
    { key: "metaAdsAccountId", label: "Meta ad account ID", needed: answers.services.includes("Meta Ads"), placeholder: "act_123456789" },
    { key: "googleSearchConsoleAccountId", label: "Search Console property", needed: answers.services.includes("SEO"), placeholder: "sc-domain:example.ie" },
    { key: "googleAnalyticsAccountId", label: "GA4 property ID", needed: answers.services.includes("SEO") || wantsWebsite, placeholder: "properties/123456789" },
    { key: "googleBusinessProfileLocationId", label: "Business Profile location", needed: answers.services.includes("Google Business Profile") || answers.services.includes("SEO"), placeholder: "locations/123…" },
  ] as const;
  const [scrape, setScrape] = useState<{ busy?: boolean; message?: string; error?: string }>({});
  const fillFromWebsite = async () => {
    if (!form.website.trim()) { setScrape({ error: "Add the current website address first." }); return; }
    setScrape({ busy: true });
    const controller = new AbortController(); const timer = window.setTimeout(() => controller.abort(), 35_000);
    try {
      const response = await fetch("/api/onboarding-scrape", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: form.website.trim(), name: form.name }), signal: controller.signal });
      const j = await response.json().catch(() => ({})) as Record<string, string | number>;
      if (!response.ok) throw new Error(String(j.error || "Couldn’t read the website."));
      let filled = 0;
      const pick = (current: string, next: unknown) => { const value = String(next || "").trim(); if (!current.trim() && value) { filled += 1; return value; } return current; };
      setForm((current) => ({ ...current, company: pick(current.company, j.company), contact: pick(current.contact, j.contact), email: pick(current.email, j.email), phone: pick(current.phone, j.phone), logo: current.logo || (j.logo ? (filled += 1, String(j.logo)) : ""), primary: j.primaryColour && (!existing?.branding?.primary) ? (filled += 1, String(j.primaryColour)) : current.primary, secondary: j.secondaryColour && (!existing?.branding?.secondary) ? (filled += 1, String(j.secondaryColour)) : current.secondary }));
      setAnswers((current) => ({ ...current, description: (() => { const scraped = [j.description, j.services ? `Services: ${j.services}` : ""].filter(Boolean).join("\n"); if (scraped && current.description.startsWith("Services with us:")) { filled += 1; return `${scraped}\n${current.description}`; } return pick(current.description, scraped); })(), serviceAreas: pick(current.serviceAreas, j.serviceAreas), targetCustomers: pick(current.targetCustomers, j.idealCustomers), websitePages: pick(current.websitePages, j.websitePages) }));
      setScrape({ message: `Read ${j.pagesRead || 1} page${Number(j.pagesRead) === 1 ? "" : "s"} and filled the empty fields. Check everything before saving — existing answers weren’t changed.` });
    } catch (reason) { setScrape({ error: reason instanceof Error && reason.name === "AbortError" ? "The website took too long to read. Fill the fields in by hand or try again." : reason instanceof Error ? reason.message : "Couldn’t read the website." }); }
    finally { window.clearTimeout(timer); }
  };
  // Existing clients with no website saved: find it from where their Google Ads send people, then the auto-read below fills the rest.
  const adsLookupFor = useRef("");
  useEffect(() => {
    if (!clientId || form.website.trim() || !form.googleAdsAccountId.trim() || adsLookupFor.current === clientId) return;
    adsLookupFor.current = clientId;
    const forClient = clientId;
    setScrape({ busy: true, message: "Finding the website from Google Ads…" });
    fetch(`/api/onboarding-scrape?googleAdsAccountId=${encodeURIComponent(form.googleAdsAccountId)}`, { cache: "no-store" }).then((response) => response.json()).then((j: { website?: string }) => {
      setScrape({});
      if (j.website && adsLookupFor.current === forClient) setForm((current) => current.website.trim() ? current : { ...current, website: j.website || "" });
    }).catch(() => setScrape({}));
  }, [clientId, form.website, form.googleAdsAccountId]);
  // Existing clients: read their website automatically once (only when there's a site and key details are still empty).
  const autoReadFor = useRef("");
  useEffect(() => {
    if (!clientId || !form.website.trim() || scrape.busy || autoReadFor.current === clientId) return;
    const missing = [form.contact, form.email, form.phone, answers.description.startsWith("Services with us:") ? "" : answers.description, answers.targetCustomers].filter((value) => !String(value || "").trim()).length;
    if (missing < 2 || existing?.onboarding?.completedAt) return;
    autoReadFor.current = clientId;
    void fillFromWebsite();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId, form.website]);
  const stepValid = step === 0 ? form.name.trim().length > 1 : step === 2 ? answers.services.length > 0 : true;

  const onLogo = (file?: File) => {
    if (!file) return;
    if (!/^image\/(png|jpeg|webp|svg\+xml)$/.test(file.type) || file.size > 600_000) { setError("Use a PNG, JPG, WebP or SVG logo under 600 KB."); return; }
    const reader = new FileReader(); reader.onload = () => setForm((current) => ({ ...current, logo: String(reader.result || "") })); reader.readAsDataURL(file);
  };
  const submit = async () => {
    setSaving(true); setError("");
    const primary = hex(form.primary, "#1f2328"), secondary = hex(form.secondary, "#6b6250");
    const result: OnboardingResult = {
      clientId: clientId || null,
      client: {
        name: form.name.trim(), company: form.company.trim(), contact: form.contact.trim(), email: form.email.trim(), phone: form.phone.trim(), website: form.website.trim(),
        logo: form.logo, color: primary, branding: { primary, secondary, logo: form.logo },
        seoLocations: answers.serviceAreas.split(/[,\n]/).map((item) => item.trim()).filter(Boolean).slice(0, 30),
        googleAdsAccountId: form.googleAdsAccountId.trim(), metaAdsAccountId: form.metaAdsAccountId.trim(), googleSearchConsoleAccountId: form.googleSearchConsoleAccountId.trim(),
        googleAnalyticsAccountId: form.googleAnalyticsAccountId.trim(), googleBusinessProfileLocationId: form.googleBusinessProfileLocationId.trim(),
      },
      answers: { ...answers, updatedAt: new Date().toISOString(), completedAt: answers.completedAt || new Date().toISOString() },
      servicesToSetUp: newSetups,
    };
    try { const ok = await onSave(result); if (!ok) setError("Couldn’t save onboarding. Try again."); }
    catch (reason) { setError(reason instanceof Error ? reason.message : "Couldn’t save onboarding."); }
    finally { setSaving(false); }
  };

  return <div className="onb">
    <div className="onb-head">
      <label className="onb-field onb-client"><span>Client</span><select value={clientId} onChange={(event) => pickClient(event.target.value)}><option value="">＋ New client</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name}</option>)}</select></label>
      <ol className="onb-steps">{STEPS.map((label, index) => <li key={label} className={index === step ? "active" : index < step ? "done" : ""}><button type="button" onClick={() => (index <= step || stepValid) && setStep(index)}>{index < step ? "✓" : index + 1}<span>{label}</span></button></li>)}</ol>
    </div>

    <div className="onb-body">
      {step === 0 && <div className="onb-grid">
        <label className="onb-field"><span>Business name *</span><input value={form.name} onChange={set("name")} placeholder="Red Island Interiors" /></label>
        <label className="onb-field"><span>Legal / company name</span><input value={form.company} onChange={set("company")} /></label>
        <label className="onb-field"><span>Contact person</span><input value={form.contact} onChange={set("contact")} /></label>
        <label className="onb-field"><span>Email</span><input type="email" value={form.email} onChange={set("email")} /></label>
        <label className="onb-field"><span>Phone</span><input value={form.phone} onChange={set("phone")} /></label>
        <label className="onb-field"><span>Current website</span><span className="onb-scrape"><input value={form.website} onChange={set("website")} placeholder="https://" /><button type="button" className="secondary-button" disabled={scrape.busy} onClick={() => void fillFromWebsite()}>{scrape.busy ? "Reading site…" : "✨ Fill from website"}</button></span></label>
        {(scrape.message || scrape.error) && <p className={`onb-note wide ${scrape.error ? "onb-error" : ""}`} role="status">{scrape.error || scrape.message}</p>}
        <label className="onb-field wide"><span>What the business does</span><textarea rows={3} value={answers.description} onChange={setA("description")} placeholder="Services, specialities, what makes them different" /></label>
        <label className="onb-field wide"><span>Service areas</span><input value={answers.serviceAreas} onChange={setA("serviceAreas")} placeholder="Galway, Mayo, Clare" /></label>
        <label className="onb-field"><span>Ideal customers</span><input value={answers.targetCustomers} onChange={setA("targetCustomers")} /></label>
        <label className="onb-field"><span>Main competitors</span><input value={answers.competitors} onChange={setA("competitors")} /></label>
      </div>}

      {step === 1 && <div className="onb-grid">
        <div className="onb-field wide"><span>Logo</span><div className="onb-logo">{form.logo ? <img src={form.logo} alt="Logo preview" /> : <i>No logo</i>}<label className="secondary-button">Upload<input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden onChange={(event) => onLogo(event.target.files?.[0])} /></label>{form.logo && <button type="button" className="text-button" onClick={() => setForm((current) => ({ ...current, logo: "" }))}>Remove</button>}</div></div>
        <label className="onb-field"><span>Primary colour</span><span className="onb-colour"><input type="color" value={hex(form.primary, "#1f2328")} onChange={set("primary")} /><input value={form.primary} onChange={set("primary")} /></span></label>
        <label className="onb-field"><span>Secondary colour</span><span className="onb-colour"><input type="color" value={hex(form.secondary, "#6b6250")} onChange={set("secondary")} /><input value={form.secondary} onChange={set("secondary")} /></span></label>
        <div className="onb-brand-preview wide" style={{ background: hex(form.primary, "#1f2328") }}><span>{form.logo ? <img src={form.logo} alt="" /> : null}<b>{form.name || "Client name"}</b></span><em style={{ background: hex(form.secondary, "#6b6250") }}>Get a quote</em></div>
      </div>}

      {step === 2 && <div className="onb-services">{ONBOARDING_SERVICES.map((service) => { const on = answers.services.includes(service.key); return <label key={service.key} className={on ? "on" : ""}><input type="checkbox" checked={on} onChange={(event) => setAnswers((current) => ({ ...current, services: event.target.checked ? [...current.services, service.key] : current.services.filter((item) => item !== service.key) }))} /><b>{service.label}</b><small>{service.hint}</small>{already.has(service.key) && <em>Setup already created</em>}</label>; })}</div>}

      {step === 3 && (wantsWebsite ? <div className="onb-grid">
        <label className="onb-field wide"><span>Main goal of the website</span><input value={answers.websiteGoal} onChange={setA("websiteGoal")} placeholder="Get quote requests from homeowners in Galway" /></label>
        <label className="onb-field wide"><span>Pages needed</span><textarea rows={2} value={answers.websitePages} onChange={setA("websitePages")} placeholder="Home, Services, Kitchen renovations, Gallery, About, Contact" /></label>
        <label className="onb-field"><span>Style & tone</span><input value={answers.websiteStyle} onChange={setA("websiteStyle")} placeholder="Premium, warm, minimal" /></label>
        <label className="onb-field"><span>Sites they like</span><input value={answers.websiteReferences} onChange={setA("websiteReferences")} placeholder="Links, separated by commas" /></label>
        <label className="onb-field wide"><span>Must-haves & notes</span><textarea rows={3} value={answers.websiteNotes} onChange={setA("websiteNotes")} placeholder="Reviews, finance options, before/after gallery, booking form…" /></label>
      </div> : <p className="onb-note">No website service selected — skip this step.</p>)}

      {step === 4 && <div className="onb-grid">
        {connections.filter((item) => item.needed).map((item) => { const value = form[item.key]; return <label key={item.key} className="onb-field"><span>{item.label} <em className={value ? "ok" : "missing"}>{value ? "✓ Connected" : "Missing"}</em></span><input value={value} onChange={set(item.key)} placeholder={item.placeholder} /></label>; })}
        {!connections.some((item) => item.needed) && <p className="onb-note wide">The selected services don’t need extra account connections.</p>}
        <p className="onb-note wide">Account access itself (Google, Meta) is granted in <button type="button" className="text-button" onClick={onOpenLaunchpad}>Launchpad</button>. Missing items can be added later — they’ll show as missing connections in Operations.</p>
      </div>}

      {step === 5 && <div className="onb-review">
        <div><small>Client</small><b>{form.name || "—"}</b><span>{clientId ? "Existing client — details will be updated" : "New client will be created"}</span></div>
        <div><small>Services</small><b>{answers.services.join(", ") || "—"}</b></div>
        <div><small>Setup checklists to create</small><b>{newSetups.length ? newSetups.join(", ") : "None — already set up"}</b><span>Added to Tasks in To do, assigned to the matching AI employee. Nothing runs until you start it.</span></div>
        {removedServices.length > 0 && <div><small>Services switched off</small><b>{removedServices.join(", ")}</b><span>Their recurring and scheduled tasks will be paused (not deleted). Fees in the client profile are unchanged.</span></div>}
        <div><small>Missing connections</small><b>{connections.filter((item) => item.needed && !form[item.key]).map((item) => item.label).join(", ") || "None"}</b></div>
      </div>}
    </div>

    {error && <p className="onb-error" role="alert">{error}</p>}
    <div className="onb-foot">
      <button type="button" className="text-button" onClick={onCancel}>Cancel</button>
      <span />
      {step > 0 && <button type="button" className="secondary-button" onClick={() => setStep(step - 1)}>Back</button>}
      {step < STEPS.length - 1 ? <button type="button" className="primary-button" disabled={!stepValid} onClick={() => setStep(step + 1)}>Next</button>
        : <button type="button" className="primary-button" disabled={saving || !form.name.trim()} onClick={() => void submit()}>{saving ? "Saving…" : clientId ? "Save & create checklists" : "Create client & checklists"}</button>}
    </div>
  </div>;
}
