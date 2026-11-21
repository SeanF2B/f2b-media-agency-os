"use client";

import { lazy, Suspense, useCallback, useEffect, useState, type CSSProperties } from "react";
import { BrandIcon } from "./brand-icon";
import { ChannelIcon } from "./channel-icon";

const WhatsAppSetup = lazy(() => import("./whatsapp-setup").then((m) => ({ default: m.WhatsAppSetup })));

type Item = { id: string; section: "operations" | "messaging" | "business" | "account"; name: string; detail: string; linked: boolean; required: boolean; available: boolean; href?: string; action?: "createFeed" | "whatsapp" };
export type AccountSetup = { name: string; staffId: string; isOwner: boolean; agencyAdmin: boolean; accountAdmin?: boolean; accountId?: string; blocked: boolean; items: Item[] };

const ICONS: Record<string, string> = { calendar: "📅", social: "📣", "google-ads": "📈", "search-console": "🔎", ga4: "📊", "business-profile": "📍", "meta-ads": "📱", "google-drive": "🗂️", gmail: "🧾" };

/** Signed-in person's setup status. Re-checks when the tab comes back (after an OAuth round trip). */
export function useAccountSetup(enabled: boolean) {
  const [setup, setSetup] = useState<AccountSetup | null>(null);
  const load = useCallback(async () => {
    if (!enabled) { setSetup(null); return; }
    try {
      const res = await fetch("/api/account-setup", { cache: "no-store", credentials: "same-origin" });
      if (!res.ok) throw new Error();
      setSetup(await res.json() as AccountSetup);
    } catch { setSetup(null); } // a failed check never locks anyone out
  }, [enabled]);
  useEffect(() => {
    void load();
    const again = () => { if (document.visibilityState === "visible") void load(); };
    document.addEventListener("visibilitychange", again);
    return () => document.removeEventListener("visibilitychange", again);
  }, [load]);
  return { setup, reload: load };
}

/** "Your setup" panel at the top of Launchpad. Everyone has it; staff come back here any time. */
export function AccountSetupPanel({ setup, reload, clients, compact = false }: { setup: AccountSetup; reload: () => void; clients: Array<{ id: string; name: string }>; /** Admin Launchpad: only your own links; the tiles and Messaging table below cover the rest. */ compact?: boolean }) {
  const [busy, setBusy] = useState("");
  const [note, setNote] = useState("");
  const [waOpen, setWaOpen] = useState(false);
  const required = setup.items.filter((i) => i.required);
  const left = required.filter((i) => !i.linked).length;
  const pct = required.length ? Math.round(((required.length - left) / required.length) * 100) : 100;
  const makeFeed = async () => {
    setBusy("calendar"); setNote("");
    try {
      const r = await fetch("/api/scheduling", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "createFeed", staffId: setup.staffId }) });
      const j = await r.json() as { feedUrl?: string; error?: string };
      if (!r.ok || !j.feedUrl) throw new Error(j.error || "Couldn’t create your calendar link.");
      if (/iPhone|iPad|iPod|Macintosh/.test(navigator.userAgent)) window.location.href = j.feedUrl.replace(/^https?:/, "webcal:");
      else { await navigator.clipboard?.writeText(j.feedUrl).catch(() => undefined); setNote("Calendar link copied. In Outlook: Add calendar → From internet → paste."); }
      reload();
    } catch (e) { setNote(e instanceof Error ? e.message : "Couldn’t create your calendar link."); }
    setBusy("");
  };
  const row = (item: Item) => <li key={item.id} className={item.linked ? "on" : !item.available ? "off" : ""}>
    <span className="asp-ico" aria-hidden="true">{item.section === "messaging" ? <ChannelIcon channel={item.id === "msg-whatsapp" ? "whatsapp" : item.id === "msg-instagram" ? "instagram" : "messenger"} size={18} /> : ICONS[item.id] || "🔗"}</span>
    <div className="asp-txt"><b>{item.name}{item.required && !item.linked && <em>Recommended</em>}</b><small>{item.detail}</small></div>
    <div className="asp-act">
      {item.linked ? <span className="asp-ok">✓ Linked</span> : <>
        {item.href && <a className="asp-btn" href={item.href}>{item.id === "calendar" ? "Google Calendar" : "Connect"}</a>}
        {item.action === "createFeed" && <button type="button" className="asp-ghost" disabled={busy === "calendar"} onClick={() => void makeFeed()}>{busy === "calendar" ? "…" : "Apple / Outlook"}</button>}
        {item.action === "whatsapp" && <button type="button" className="asp-btn" onClick={() => setWaOpen(true)}>Link or buy number</button>}
      </>}
    </div>
  </li>;
  const ops = setup.items.filter((i) => i.section === "operations");
  const biz = setup.items.filter((i) => i.section === "business" && !i.linked);
  const msg = setup.items.filter((i) => i.section === "messaging");
  const acct = setup.items.filter((i) => i.section === "account");
  if (compact) {
    const mine = ops.filter((i) => !i.linked && i.available);
    const bizLeft = setup.items.filter((i) => i.section === "business" && i.required && !i.linked).map((i) => i.name);
    if (!mine.length && !bizLeft.length) return null;
    return <section className="asp asp-compact" aria-label="Your setup">
      <style>{CSS}</style>
      <p className="asp-line"><b>Your setup · {left} left</b>{bizLeft.length > 0 && <span> Also connect below: {bizLeft.join(", ")}.</span>}</p>
      {mine.length > 0 && <ul>{mine.map(row)}</ul>}
      {note && <p className="asp-note" role="status">{note}</p>}
    </section>;
  }
  // Same look as the agency Launchpad: progress ring, then a grid of tool cards per section.
  const brandFor: Record<string, string> = { calendar: "google-calendar", social: "facebook", "msg-whatsapp": "whatsapp", "msg-instagram": "instagram", "msg-messenger": "messenger", gmail: "gmail" };
  const card = (item: Item, index: number) => <article className={`lp-card asp-card ${item.linked ? "status-ready" : ""} ${!item.available && !item.linked ? "asp-card-off" : ""}`} style={{ "--lp-delay": `${index * 55}ms` } as CSSProperties} key={item.id}>
    <div className="lp-icon" aria-hidden="true"><BrandIcon id={brandFor[item.id] || item.id} size={24} fallback={item.section === "messaging" ? <ChannelIcon channel={item.id === "msg-whatsapp" ? "whatsapp" : item.id === "msg-instagram" ? "instagram" : "messenger"} size={22} /> : ICONS[item.id] || "🔗"} /></div>
    <div className="lp-body"><h3>{item.name}</h3><p>{item.detail}</p>{item.required && !item.linked && <small className="lp-chip asp-rec">Recommended</small>}</div>
    <div className="lp-action asp-actions">{item.linked ? <span className="lp-done" role="img" aria-label="Connected">✓ Connected</span> : !item.available ? <span className="asp-soon">Coming soon</span> : <>
      {item.href && <a className="lp-button" href={item.href}>{item.id === "calendar" ? "Google Calendar" : "Connect"}</a>}
      {item.action === "createFeed" && <button type="button" className="lp-button asp-ghost-btn" disabled={busy === "calendar"} onClick={() => void makeFeed()}>{busy === "calendar" ? "…" : "Apple / Outlook"}</button>}
      {item.action === "whatsapp" && <button type="button" className="lp-button" onClick={() => setWaOpen(true)}>Link or buy number</button>}
    </>}</div>
  </article>;
  const groups: Array<[string, string, Item[], boolean?]> = [
    ["Operations", "Calendars and social media for posts.", ops],
    ...(setup.agencyAdmin ? [["Business connections", "Only what isn’t linked yet.", biz] as [string, string, Item[]]] : []),
    ...(acct.length ? [["Business connections", "Your business’s Google accounts, linked by F2B.", acct] as [string, string, Item[]]] : []),
    ["Messaging", "WhatsApp, Instagram and Facebook chats in one inbox.", msg, true],
  ];
  let n = 0;
  return <section className="asp asp-launchpad" aria-label="Your setup">
    <style>{CSS}</style>
    <header className="launchpad-heading"><div><p className="eyebrow">🚀 YOUR SETUP</p><h1>{left ? `Hi ${setup.name.split(" ")[0] || "there"}, let’s get you set up` : "You’re all set up"}</h1><p className="muted">{left ? "Link these when you’re ready so bookings and messages land in the right place. Everything else works in the meantime." : "Come back here any time to add or change a connection."}</p></div></header>
    <section className="lp-hero" aria-label="Setup progress">
      <div className="lp-ring" style={{ "--lp-percent": `${pct}%` } as CSSProperties}><span>{pct}%</span></div>
      <div><b>{required.length - left} of {required.length} recommended connections linked</b><p>{left ? `${left} left — the rest are optional.` : "You’re all set 🎉"}</p></div>
    </section>
    {groups.filter(([, , list]) => list.length).map(([title, sub, list, optional]) => <div className="asp-group" key={title + sub}>
      <h2 className="asp-group-title">{title}{optional && <span className="asp-opt">Optional · add later</span>}</h2><p className="asp-group-sub">{sub}</p>
      <div className="lp-grid">{list.map((item) => card(item, n++))}</div>
    </div>)}
    {setup.agencyAdmin && !biz.length && <p className="asp-note">✓ All business connections are linked.</p>}
    {note && <p className="asp-note" role="status">{note}</p>}
    {waOpen && <Suspense fallback={null}><WhatsAppSetup clients={setup.accountId ? clients.filter((c) => c.id === setup.accountId) : clients} initialClientId={setup.accountId || ""} onClose={() => { setWaOpen(false); reload(); }} onLive={reload} /></Suspense>}
  </section>;
}

const CSS = `
.asp{border:1px solid rgba(127,127,127,.22);border-radius:18px;padding:20px;margin:0 0 18px;background:rgba(127,127,127,.04)}
.asp-head{display:flex;justify-content:space-between;gap:16px;align-items:flex-start}.asp-head h2{margin:2px 0 4px;font-size:20px}.asp-head .muted{margin:0;font-size:13.5px}
.asp-meter{text-align:right;flex:none}.asp-meter b{display:block;font-size:22px}.asp-meter span{font-size:12px;opacity:.7}
.asp-bar{margin:14px 0 4px;height:6px;border-radius:99px;background:rgba(127,127,127,.18);overflow:hidden}.asp-bar i{display:block;height:100%;background:var(--brand-primary,#287cac);border-radius:99px;transition:width .4s}
.asp-cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(280px,1fr));gap:18px;margin-top:12px}
.asp h3{font-size:14.5px;margin:0;display:flex;align-items:center;gap:8px}.asp-cols p{margin:2px 0 8px;font-size:12.5px;opacity:.7}.asp-opt{font-size:10.5px;font-weight:700;padding:2px 8px;border-radius:99px;background:rgba(127,127,127,.15)}
.asp ul{list-style:none;margin:0;padding:0;display:flex;flex-direction:column;gap:8px}
.asp li{display:flex;align-items:center;gap:10px;padding:10px 12px;border-radius:12px;border:1px solid rgba(127,127,127,.2);transition:transform .15s,border-color .15s}.asp li:hover{transform:translateY(-1px);border-color:var(--brand-secondary,var(--brand-primary,#287cac))}
.asp li.on{border-color:rgba(34,197,94,.5);background:rgba(34,197,94,.08)}.asp li.off{opacity:.55}
.asp-ico{width:32px;height:32px;border-radius:9px;background:rgba(127,127,127,.12);display:grid;place-items:center;font-size:16px;flex:none}
.asp-txt{flex:1;min-width:0}.asp-txt b{font-size:13.5px;display:flex;align-items:center;gap:6px;flex-wrap:wrap}.asp-txt em{font-style:normal;font-size:10px;font-weight:800;color:#b45309;border:1px solid rgba(217,119,6,.45);border-radius:99px;padding:1px 6px}.asp-txt small{display:block;margin-top:2px;font-size:12px;opacity:.72;line-height:1.4}
.asp-act{display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end}
.asp-btn{display:inline-flex;align-items:center;padding:7px 12px;border-radius:9px;border:0;background:var(--brand-primary,#287cac);color:#fff !important;font:inherit;font-size:12.5px;font-weight:700;text-decoration:none;cursor:pointer;white-space:nowrap;transition:transform .15s}.asp-btn:hover{transform:translateY(-1px)}
.asp-ghost{padding:6px 11px;border-radius:9px;border:1px solid rgba(127,127,127,.3);background:transparent;color:inherit;font:inherit;font-size:12.5px;font-weight:600;cursor:pointer;white-space:nowrap}
.asp-ok{font-size:12.5px;font-weight:800;color:#16a34a;white-space:nowrap}.asp-note{margin:12px 0 0;font-size:13px}
.asp-compact{padding:12px 14px}.asp-line{margin:0 0 8px;font-size:13px}.asp-line span{opacity:.75}
.asp-launchpad{border:0;padding:0;background:none;margin:0}
.asp-group{margin:0 0 22px}.asp-group-title{display:flex;align-items:center;gap:8px;margin:0;font-size:16px}.asp-group-sub{margin:2px 0 12px;font-size:12.5px;opacity:.7}
.asp-actions{display:flex;flex-wrap:wrap;gap:8px}.asp-ghost-btn{background:transparent !important;color:inherit !important;border:1px solid rgba(127,127,127,.35) !important;box-shadow:none !important}
.asp-rec{color:#b45309;background:rgba(217,119,6,.12)}.asp-card-off{opacity:.55}.asp-soon{font-size:12px;font-weight:700;opacity:.7}
@media (max-width:600px){.asp{padding:14px}.asp-launchpad{padding:0}.asp li{flex-wrap:wrap}.asp-act{width:100%}.asp-act>*{flex:1;justify-content:center}}
`;
