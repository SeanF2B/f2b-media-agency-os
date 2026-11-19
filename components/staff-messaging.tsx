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
    { key: "ical", label: "Apple / Outlook calendar", icon: <BrandIcon id="apple-calendar" size={16} fallback={<span>🗓</span>} />, state: data.feeds.includes(member.id) ? "ok" : "missing", detail: data.feeds.includes(member.id) ? "calendar feed on" : "no calendar feed yet" },
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
  const [pickFor, setPickFor] = useState<string | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [showSetup, setShowSetup] = useState(false);
  const load = useCallback(async () => { try { const d = await call<Overview>("/api/meta-messaging"); setData(d); setError(""); return d; } catch (e) { setError(e instanceof Error ? e.message : "Couldn't load."); return null; } }, []);
  useEffect(() => {
    void load().then((d) => {
      const q = new URLSearchParams(window.location.search), result = q.get("metaMessaging");
      if (!result) return;
      const cid = q.get("clientId") || "";
      if (result === "pick" && d) { setPickFor(cid); setPicked(d.pages.filter((p) => p.clientId === cid && p.status === "pending").map((p) => p.pageId).slice(0, 1)); }
      else if (result !== "pick") setError(({ "not-configured": "The Meta app isn't set up on the server yet (see the setup steps below).", "version-not-configured": "Set META_MARKETING_API_VERSION on the server first.", cancelled: "Facebook connection was cancelled.", "no-pages": "That Facebook login doesn't manage any Pages. Log in with an account that's an admin of the business's Page.", "admin-required": "Only an admin can connect messaging." } as Record<string, string>)[result] || "Facebook connection didn't finish. Try again.");
      q.delete("metaMessaging"); q.delete("clientId");
      window.history.replaceState(null, "", `${window.location.pathname}${q.toString() ? `?${q}` : ""}${window.location.hash}`);
    });
  }, [load]);
  const rows = [{ id: "", name: "F2B Media (agency)" }, ...clients];
  const pending = data?.pages.filter((p) => p.clientId === (pickFor ?? "") && p.status === "pending") || [];
  const pick = async () => { setBusy(true); try { const r = await call<{ errors: string[] }>("/api/meta-messaging", { action: "pick", clientId: pickFor || "agency", pageIds: picked }); setPickFor(null); if (r.errors.length) setError(r.errors.join(" ")); await load(); } catch (e) { setError(e instanceof Error ? e.message : "Couldn't connect."); } finally { setBusy(false); } };
  const disconnect = async (p: Page) => { if (!(await appConfirm(`Disconnect ${p.pageName}${p.igUsername ? ` and @${p.igUsername}` : ""}? New messages will stop coming into Conversations.`))) return; setBusy(true); try { await call("/api/meta-messaging", { action: "disconnect", clientId: p.clientId || "agency", pageId: p.pageId }); await load(); } catch (e) { setError(e instanceof Error ? e.message : "Couldn't disconnect."); } finally { setBusy(false); } };
  const connectHref = (clientId: string) => `/api/meta-messaging/connect?clientId=${encodeURIComponent(clientId || "agency")}`;
  const badge = (on: boolean, label: string) => on ? <span className="lp-msg-badge on">Connected</span> : <span className="lp-msg-badge">{label}</span>;
  return <section className="lp-msg" aria-label="Messaging connections">
    <div className="lp-msg-head"><div><h2>Messaging</h2><p className="muted">Connect each account's WhatsApp, Instagram and Facebook so every chat lands in Conversations.</p></div><button type="button" className="secondary-button" onClick={() => setShowSetup(!showSetup)}>{showSetup ? "Hide" : "Meta app"} setup</button></div>
    {error && <div className="cv-error" role="alert">{error}</div>}
    {showSetup && data && <div className="lp-msg-setup"><p>One-off, in the Meta developer app (the same app as Meta Ads): add <b>Messenger</b> and <b>Instagram</b>, request <code>pages_messaging</code> and <code>instagram_manage_messages</code>, then set the webhook for both <i>Page</i> and <i>Instagram</i> (field <code>messages</code>):</p><div className="lp-msg-copy"><span>Callback URL</span><code>{data.webhook.url}</code><button type="button" onClick={() => void navigator.clipboard?.writeText(data.webhook.url)}>Copy</button></div><div className="lp-msg-copy"><span>Verify token</span><code>{data.webhook.verifyToken || "Add META_APP_SECRET first"}</code><button type="button" disabled={!data.webhook.verifyToken} onClick={() => void navigator.clipboard?.writeText(data.webhook.verifyToken)}>Copy</button></div>{!data.configured && <p className="iv-small">The server is missing the Meta app settings, so Connect won't work yet.</p>}</div>}
    {!data ? <p className="iv-small">Loading…</p> : <div className="lp-msg-table" role="table">
      <div className="lp-msg-row lp-msg-th" role="row"><span>Account</span><span><ChannelIcon channel="whatsapp" size={16} /> WhatsApp</span><span><ChannelIcon channel="instagram" size={16} /> Instagram</span><span><ChannelIcon channel="messenger" size={16} /> Facebook</span><span><ChannelIcon channel="email" size={16} /> Email</span></div>
      {rows.map((c) => { const ch = data.channels[c.id] || { whatsapp: [], sms: [], messenger: [], instagram: [] }; const pages = data.pages.filter((p) => p.clientId === c.id && p.status === "connected"); const logo = (c as Client).logo;
        return <div className="lp-msg-row" role="row" key={c.id || "agency"}>
          <span className="lp-msg-account">{logo ? <img src={logo} alt="" /> : <i>{c.name.slice(0, 1)}</i>}<b>{c.name}</b></span>
          <span>{badge(ch.whatsapp.length > 0, "Not set up")}{ch.whatsapp[0] && <small>{ch.whatsapp[0]}</small>}{onOpenWhatsApp && <button type="button" className="lp-msg-link" onClick={() => onOpenWhatsApp(c.id)}>{ch.whatsapp.length ? "Manage" : "Set up"}</button>}</span>
          <span>{badge(ch.instagram.length > 0, "Not connected")}{ch.instagram[0] && <small>{ch.instagram[0]}</small>}{!ch.instagram.length && pages.length > 0 && <small className="muted">Link an Instagram professional account to {pages[0].pageName} in Meta</small>}</span>
          <span>{badge(pages.length > 0, "Not connected")}{pages.map((p) => <small key={p.pageId} className="lp-msg-page">{p.pageName}<button type="button" aria-label={`Disconnect ${p.pageName}`} title="Disconnect" disabled={busy} onClick={() => void disconnect(p)}>×</button></small>)}<a className="lp-msg-link" href={connectHref(c.id)}>{pages.length ? "Add / reconnect" : "Connect Facebook & Instagram"}</a></span>
          <span>{badge(data.emailReady, "Not set up")}{data.emailReady && <small>Replies from {data.emailFrom.replace(/^.*</, "").replace(/>$/, "")}</small>}</span>
        </div>; })}
    </div>}
    {pickFor !== null && <div className="cv-modal" role="dialog" aria-modal="true" aria-label="Choose Facebook Pages" onMouseDown={(e) => { if (e.target === e.currentTarget) setPickFor(null); }}><div className="cv-dialog lp-msg-pick"><h3>Which Page is {rows.find((r) => r.id === pickFor)?.name || "this account"}'s?</h3><p className="muted">Messages to the Page (and its linked Instagram) will come into this account's Conversations.</p>
      <div className="lp-msg-pages">{pending.map((p) => <label key={p.pageId} className={picked.includes(p.pageId) ? "on" : ""}><input type="checkbox" checked={picked.includes(p.pageId)} onChange={(e) => setPicked(e.target.checked ? [...picked, p.pageId] : picked.filter((x) => x !== p.pageId))} />{p.picture ? <img src={p.picture} alt="" /> : <ChannelIcon channel="messenger" size={28} />}<span><b>{p.pageName}</b><small>{p.igUsername ? <><ChannelIcon channel="instagram" size={12} /> @{p.igUsername}</> : "No Instagram linked"}</small></span></label>)}{!pending.length && <p className="iv-small">No Pages waiting. Connect again.</p>}</div>
      <div className="iv-actions"><button type="button" className="secondary-button" onClick={() => setPickFor(null)}>Cancel</button><button type="button" className="primary-button" disabled={busy || !picked.length} onClick={() => void pick()}>{busy ? "Connecting…" : `Connect ${picked.length || ""}`}</button></div></div></div>}
  </section>;
}
