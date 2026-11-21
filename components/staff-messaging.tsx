"use client";
// Messaging connections for people and sub-accounts:
//  · StaffConnectionIcons — integration icons on each Team card (like Operations → Clients), incl. calendars
//  · StaffMessagingPanel  — per-person channel switches + email name / reply-to / signature (in the staff pop-up)
//  · MessagingLaunchpad   — Launchpad → Messaging: WhatsApp, Instagram, Facebook and Email per sub-account
import { useCallback, useEffect, useState } from "react";
import { BrandIcon } from "./brand-icon";
import { ChannelIcon } from "./channel-icon";
import { appConfirm } from "./app-dialog";

type ChannelSet = { whatsapp: string[]; sms: string[]; messenger: string[]; instagram: string[] };
type StaffMsg = { channels: Record<string, boolean>; emailName: string; emailReplyTo: string; signature: string; notify: boolean };
type TeamData = { channels: Record<string, ChannelSet>; staff: Record<string, StaffMsg>; defaults: StaffMsg; google: Record<string, string>; feeds: string[]; emailReady: boolean; canEdit: boolean };
type Member = { id: string; name: string; isBot?: boolean; clientAccessIds?: string[] };
type Client = { id: string; name: string; logo?: string };

async function call<T>(url: string, body?: unknown): Promise<T> {
  const res = await fetch(url, body ? { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) } : { cache: "no-store" });
  const json = await res.json().catch(() => ({})) as T & { error?: string };
  if (!res.ok) throw new Error(json.error || "Something went wrong.");
  return json;
}

// One shared fetch for every Team card on the page (keeps D1 reads low).
let teamCache: { at: number; promise: Promise<TeamData | null> } | null = null;
const listeners = new Set<(d: TeamData | null) => void>();
function loadTeam(force = false) {
  if (!force && teamCache && Date.now() - teamCache.at < 60_000) return teamCache.promise;
  const promise = call<TeamData>("/api/meta-messaging?view=staff").catch(() => null);
  teamCache = { at: Date.now(), promise };
  void promise.then((d) => listeners.forEach((fn) => fn(d)));
  return promise;
}
function useTeamData() {
  const [data, setData] = useState<TeamData | null>(null);
  useEffect(() => { let live = true; void loadTeam().then((d) => { if (live) setData(d); }); listeners.add(setData); return () => { live = false; listeners.delete(setData); }; }, []);
  return data;
}

const MSG_KEYS = [
  { key: "whatsapp", label: "WhatsApp", brand: "whatsapp" },
  { key: "instagram", label: "Instagram", brand: "instagram" },
  { key: "messenger", label: "Facebook Messenger", brand: "messenger" },
  { key: "email", label: "Email", brand: "email" },
] as const;

/** Integration icons on a Team card: green dot = connected and switched on for this person, red = not connected, grey = switched off. */
export function StaffConnectionIcons({ member, onOpen }: { member: Member; onOpen?: () => void }) {
  const data = useTeamData();
  if (!data || member.isBot) return null;
  const accounts = Array.isArray(member.clientAccessIds) ? member.clientAccessIds : Object.keys(data.channels);
  const live = (key: keyof ChannelSet) => accounts.some((id) => (data.channels[id]?.[key] || []).length > 0);
  const prefs = data.staff[member.id] || data.defaults;
  const items: Array<{ key: string; label: string; icon: React.ReactNode; state: "ok" | "missing" | "off"; detail: string }> = [
    ...MSG_KEYS.map((c) => {
      const connected = c.key === "email" ? data.emailReady : live(c.key as keyof ChannelSet);
      const on = prefs.channels[c.key] !== false;
      return { key: c.key, label: c.label, icon: <ChannelIcon channel={c.key} size={16} />, state: (!on ? "off" : connected ? "ok" : "missing") as "ok" | "missing" | "off", detail: !on ? "switched off for this person" : connected ? "connected" : "not connected for their accounts yet" };
    }),
    { key: "gcal", label: "Google Calendar", icon: <BrandIcon id="google-calendar" size={16} fallback={<span>📅</span>} />, state: data.google[member.id] ? "ok" : "missing", detail: data.google[member.id] ? `synced with ${data.google[member.id]}` : "not connected" },
    { key: "ical", label: "Apple / Outlook calendar", icon: <svg viewBox="0 0 24 24" width={16} height={16} aria-hidden="true"><rect x="3" y="4" width="18" height="17" rx="4" fill="#fff" stroke="#c9ced3" /><path d="M3 8a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4v1H3Z" fill="#ff3b30" /><text x="12" y="18.5" textAnchor="middle" fontSize="8.5" fontWeight="700" fill="#1f2a30" fontFamily="Arial,sans-serif">31</text></svg>, state: data.feeds.includes(member.id) ? "ok" : "missing", detail: data.feeds.includes(member.id) ? "calendar feed on" : "no calendar feed yet" },
  ];
  const done = items.filter((i) => i.state === "ok").length;
  return <div className="staff-conn" aria-label={`${member.name}'s connections: ${done} of ${items.length}`}>
    {items.map((i) => <button key={i.key} type="button" className={i.state} title={`${i.label}: ${i.detail}`} aria-label={`${i.label} ${i.detail}`} onClick={onOpen} disabled={!onOpen}>{i.icon}<i /></button>)}
  </div>;
}

/** In the staff pop-up: which channels this person handles, and how their emails go out. Admins only. */
export function StaffMessagingPanel({ staffId, staffName = "" }: { staffId: string; staffName?: string }) {
  const data = useTeamData();
  const [draft, setDraft] = useState<StaffMsg | null>(null);
  const [status, setStatus] = useState("");
  useEffect(() => { if (data && staffId) setDraft(data.staff[staffId] || data.defaults); }, [data, staffId]);
  if (!staffId) return null;
  if (!data || !draft) return <section className="sch-panel staff-msg-panel"><div className="sch-panel-head"><b>Messaging</b></div><p className="iv-small">Loading…</p></section>;
  if (!data.canEdit) return null;
  const set = (patch: Partial<StaffMsg>) => setDraft({ ...draft, ...patch });
  const save = async () => { setStatus("Saving…"); try { await call("/api/meta-messaging", { action: "staff-save", staffId, data: draft }); setStatus("Saved ✓"); void loadTeam(true); } catch (e) { setStatus(e instanceof Error ? e.message : "Couldn't save."); } };
  return <section className="sch-panel staff-msg-panel">
    <div className="sch-panel-head"><b>Messaging</b><small>Channels {staffName || "this person"} handles in Conversations</small><span className="sch-showcase-status">{status}</span></div>
    <div className="staff-msg-channels">{[...MSG_KEYS, { key: "sms", label: "SMS", brand: "sms" } as const].map((c) => <label key={c.key} className={`staff-msg-chip ${draft.channels[c.key] !== false ? "on" : ""}`}><input type="checkbox" checked={draft.channels[c.key] !== false} onChange={(e) => set({ channels: { ...draft.channels, [c.key]: e.target.checked } })} /><ChannelIcon channel={c.key} size={16} /><span>{c.label}</span></label>)}</div>
    <div className="form-grid staff-msg-email">
      <label className="field"><span>Email sender name</span><input value={draft.emailName} maxLength={80} placeholder={staffName ? `${staffName} · F2B Media` : "Name shown on emails"} onChange={(e) => set({ emailName: e.target.value })} /></label>
      <label className="field"><span>Replies go to</span><input type="email" value={draft.emailReplyTo} maxLength={200} placeholder="their own email address" onChange={(e) => set({ emailReplyTo: e.target.value })} /></label>
      <label className="field wide"><span>Email signature</span><textarea rows={2} value={draft.signature} maxLength={600} placeholder={"Kind regards,\n" + (staffName || "Name")} onChange={(e) => set({ signature: e.target.value })} /></label>
    </div>
    <p className="iv-small">Emails send from your verified system address with this name, and replies land in their inbox. Sub-account staff only see the channels ticked here.</p>
    <div className="iv-actions" style={{ justifyContent: "flex-start" }}><button type="button" className="primary-button" onClick={() => void save()}>Save messaging</button></div>
  </section>;
}

type Page = { pageId: string; pageName: string; igId: string; igUsername: string; clientId: string; status: "pending" | "connected"; picture: string };
type Overview = { configured: boolean; webhook: { url: string; verifyToken: string }; channels: Record<string, ChannelSet>; pages: Page[]; emailReady: boolean; emailFrom: string };

/** Launchpad → Messaging: one row per sub-account with WhatsApp, Instagram, Facebook and Email. */
export function MessagingLaunchpad({ clients, onOpenWhatsApp }: { clients: Client[]; onOpenWhatsApp?: (clientId: string) => void }) {
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const load = useCallback(async () => { try { const d = await call<Overview>("/api/meta-messaging"); setData(d); setError(""); return d; } catch (e) { setError(e instanceof Error ? e.message : "Couldn't load."); return null; } }, []);
  useEffect(() => { void load(); const again = () => void load(); window.addEventListener("f2b-messaging-changed", again); return () => window.removeEventListener("f2b-messaging-changed", again); }, [load]);
  const rows = [{ id: "", name: "F2B Media (agency)" }, ...clients];
  const disconnect = async (p: Page) => { if (!(await appConfirm(`Disconnect ${p.pageName}${p.igUsername ? ` and @${p.igUsername}` : ""}? New messages will stop coming into Conversations.`))) return; setBusy(true); try { await call("/api/meta-messaging", { action: "disconnect", clientId: p.clientId || "agency", pageId: p.pageId }); await load(); } catch (e) { setError(e instanceof Error ? e.message : "Couldn't disconnect."); } finally { setBusy(false); } };
  const connectHref = (clientId: string) => `/api/meta-messaging/connect?clientId=${encodeURIComponent(clientId || "agency")}`;
    return <section className="lp-msg" aria-label="Messaging connections">
    <div className="lp-msg-head"><div><h2>Messaging</h2><p className="muted">Connect each account's WhatsApp, Instagram and Facebook so every chat lands in Conversations.</p></div><button type="button" className="secondary-button" onClick={() => setShowSetup(!showSetup)}>{showSetup ? "Hide" : "Meta app"} setup</button></div>
    {error && <div className="cv-error" role="alert">{error}</div>}
    {showSetup && data && <div className="lp-msg-setup"><p>One-off, in the Meta developer app (the same app as Meta Ads): add <b>Messenger</b> and <b>Instagram</b>, request <code>pages_messaging</code> and <code>instagram_manage_messages</code>, then set the webhook for both <i>Page</i> and <i>Instagram</i> (field <code>messages</code>):</p><div className="lp-msg-copy"><span>Callback URL</span><code>{data.webhook.url}</code><button type="button" onClick={() => void navigator.clipboard?.writeText(data.webhook.url)}>Copy</button></div><div className="lp-msg-copy"><span>Verify token</span><code>{data.webhook.verifyToken || "Add META_APP_SECRET first"}</code><button type="button" disabled={!data.webhook.verifyToken} onClick={() => void navigator.clipboard?.writeText(data.webhook.verifyToken)}>Copy</button></div>{!data.configured && <p className="iv-small">The server is missing the Meta app settings, so Connect won't work yet.</p>}</div>}
    {!data ? <p className="iv-small">Loading…</p> : <div className="lp-msg-cards">
      <style>{MSG_CARDS_CSS}</style>
      {rows.map((c) => { const ch = data.channels[c.id] || { whatsapp: [], sms: [], messenger: [], instagram: [] }; const pages = data.pages.filter((p) => p.clientId === c.id && p.status === "connected"); const logo = (c as Client).logo;
        // Same look as the client cards: one icon per channel with a green (connected) or red (not connected) dot.
        const items = [
          { key: "whatsapp", label: "WhatsApp", ok: ch.whatsapp.length > 0, info: ch.whatsapp[0] || "", act: onOpenWhatsApp ? () => onOpenWhatsApp(c.id) : undefined, href: "" },
          { key: "instagram", label: "Instagram", ok: ch.instagram.length > 0, info: ch.instagram[0] || (pages.length ? `Link an Instagram professional account to ${pages[0].pageName} in Meta` : ""), href: connectHref(c.id) },
          { key: "messenger", label: "Facebook", ok: pages.length > 0, info: pages.map((p) => p.pageName).join(", "), href: connectHref(c.id) },
          { key: "email", label: "Email", ok: data.emailReady, info: data.emailReady ? `Replies from ${data.emailFrom.replace(/^.*</, "").replace(/>$/, "")}` : "", href: "" },
        ];
        const done = items.filter((i) => i.ok).length, pct = Math.round(done / items.length * 100);
        return <article className="lp-msg-card" key={c.id || "agency"}>
          <header>{logo ? <img src={logo} alt="" /> : <i>{c.name.slice(0, 1)}</i>}<b title={c.name}>{c.name}</b></header>
          <span className="ops-conn">
            <span className={`ops-conn-pct ${pct >= 80 ? "good" : pct >= 50 ? "mid" : "low"}`} style={{ ["--pct" as string]: `${pct}%` }} title={`${done} of ${items.length} connected`}><b>{pct}%</b></span>
            {items.map((i) => { const title = `${i.label}: ${i.ok ? `connected${i.info ? ` · ${i.info}` : ""}` : `not connected${i.act || i.href ? " — click to set up" : ""}`}`;
              const inner = <><ChannelIcon channel={i.key as "whatsapp"} size={16} /><i /></>;
              return i.act ? <button key={i.key} type="button" className={i.ok ? "ok" : "missing"} title={title} aria-label={title} onClick={i.act}>{inner}</button>
                : i.href && !i.ok ? <a key={i.key} className={`lp-msg-ico missing`} href={i.href} title={title} aria-label={title}>{inner}</a>
                : <button key={i.key} type="button" className={i.ok ? "ok" : "missing"} title={title} aria-label={title} disabled={!i.ok}>{inner}</button>; })}
          </span>
          {pages.length > 0 && <div className="lp-msg-pages-on">{pages.map((p) => <small key={p.pageId}>{p.pageName}<button type="button" aria-label={`Disconnect ${p.pageName}`} title="Disconnect" disabled={busy} onClick={() => void disconnect(p)}>×</button></small>)}</div>}
        </article>; })}
    </div>}
  </section>;
}

/** After Facebook login (any page, any account): pick which Page belongs to the account, or show why it didn't work. */
export function MetaPickPrompt({ clients }: { clients: Client[] }) {
  const [state, setState] = useState<{ clientId: string; pages: Page[]; picked: string[]; error: string; busy: boolean } | null>(null);
  useEffect(() => {
    const q = new URLSearchParams(window.location.search), result = q.get("metaMessaging");
    if (!result) return;
    const clientId = q.get("clientId") || "";
    q.delete("metaMessaging"); q.delete("clientId");
    window.history.replaceState(null, "", `${window.location.pathname}${q.toString() ? `?${q}` : ""}${window.location.hash}`);
    if (result !== "pick") { setState({ clientId, pages: [], picked: [], busy: false, error: ({ "not-configured": "Facebook messaging isn't switched on for this workspace yet. Ask your agency to finish the Meta app setup.", "version-not-configured": "Facebook messaging isn't fully set up on the server yet.", cancelled: "Facebook connection was cancelled.", "no-pages": "That Facebook login doesn't manage any Pages. Log in with an account that's an admin of the business's Page.", "admin-required": "You can only connect your own business's Page." } as Record<string, string>)[result] || "Facebook connection didn't finish. Try again." }); return; }
    void call<{ pages: Page[] }>(`/api/meta-messaging?view=pending&clientId=${encodeURIComponent(clientId || "agency")}`).then((r) => setState({ clientId, pages: r.pages, picked: r.pages.slice(0, 1).map((p) => p.pageId), busy: false, error: "" })).catch((e) => setState({ clientId, pages: [], picked: [], busy: false, error: e instanceof Error ? e.message : "Couldn't load your Pages." }));
  }, []);
  if (!state) return null;
  const name = clients.find((c) => c.id === state.clientId)?.name || (state.clientId ? "this account" : "the agency");
  const pick = async () => { setState({ ...state, busy: true, error: "" }); try { const r = await call<{ errors: string[] }>("/api/meta-messaging", { action: "pick", clientId: state.clientId || "agency", pageIds: state.picked }); void loadTeam(true); window.dispatchEvent(new Event("f2b-messaging-changed")); if (r.errors.length) setState({ ...state, busy: false, pages: [], error: r.errors.join(" ") }); else setState(null); } catch (e) { setState({ ...state, busy: false, error: e instanceof Error ? e.message : "Couldn't connect." }); } };
  return <div className="cv-modal" role="dialog" aria-modal="true" aria-label="Connect Facebook and Instagram" onMouseDown={(e) => { if (e.target === e.currentTarget) setState(null); }}><div className="cv-dialog lp-msg-pick">
    <h3>{state.pages.length ? `Which Page is ${name}'s?` : "Facebook & Instagram"}</h3>
    {state.error && <div className="cv-error" role="alert">{state.error}</div>}
    {state.pages.length > 0 && <><p className="muted">Messages to the Page (and its linked Instagram) will come into Conversations for {name}.</p>
      <div className="lp-msg-pages">{state.pages.map((p) => <label key={p.pageId} className={state.picked.includes(p.pageId) ? "on" : ""}><input type="checkbox" checked={state.picked.includes(p.pageId)} onChange={(e) => setState({ ...state, picked: e.target.checked ? [...state.picked, p.pageId] : state.picked.filter((x) => x !== p.pageId) })} />{p.picture ? <img src={p.picture} alt="" /> : <ChannelIcon channel="messenger" size={28} />}<span><b>{p.pageName}</b><small>{p.igUsername ? <><ChannelIcon channel="instagram" size={12} /> @{p.igUsername}</> : "No Instagram linked"}</small></span></label>)}</div></>}
    <div className="iv-actions"><button type="button" className="secondary-button" onClick={() => setState(null)}>{state.pages.length ? "Cancel" : "Close"}</button>{state.pages.length > 0 && <button type="button" className="primary-button" disabled={state.busy || !state.picked.length} onClick={() => void pick()}>{state.busy ? "Connecting…" : `Connect ${state.picked.length || ""}`}</button>}</div>
  </div></div>;
}


const MSG_CARDS_CSS = `
.lp-msg-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(230px,1fr));gap:10px}
.lp-msg-card{border:1px solid rgba(127,127,127,.22);border-radius:14px;padding:12px;display:flex;flex-direction:column;gap:10px;transition:transform .15s,border-color .15s}
.lp-msg-card:hover{transform:translateY(-1px);border-color:var(--brand-secondary,var(--brand-primary,#287cac))}
.lp-msg-card header{display:flex;align-items:center;gap:8px;min-width:0}.lp-msg-card header img,.lp-msg-card header i{width:26px;height:26px;border-radius:7px;object-fit:contain;flex:none;display:grid;place-items:center;font-style:normal;font-weight:800;background:rgba(127,127,127,.12)}
.lp-msg-card header b{font-size:13.5px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.lp-msg-card .ops-conn{display:flex;align-items:center;gap:6px;flex-wrap:wrap}
.lp-msg-card .ops-conn a.lp-msg-ico{position:relative;display:grid;place-items:center;width:28px;height:28px;border:1px solid rgba(127,127,127,.3);border-radius:8px;color:inherit}
.lp-msg-card .ops-conn a.lp-msg-ico i{position:absolute;right:-3px;top:-3px;width:9px;height:9px;border-radius:50%;background:#dc2626;border:2px solid var(--f2b-white,#fff)}
.lp-msg-card .ops-conn a.lp-msg-ico:hover{transform:translateY(-1px);border-color:var(--brand-secondary,var(--brand-primary,#287cac))}
.lp-msg-card .ops-conn button:disabled{cursor:default}
.lp-msg-pages-on{display:flex;flex-wrap:wrap;gap:4px}.lp-msg-pages-on small{display:inline-flex;align-items:center;gap:4px;font-size:11.5px;padding:2px 8px;border-radius:99px;background:rgba(34,197,94,.12)}
.lp-msg-pages-on button{border:0;background:none;color:inherit;cursor:pointer;font-size:13px;line-height:1;padding:0}
`;
