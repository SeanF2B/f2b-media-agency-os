"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PostEditor, SocialPlanner, STATUS_LABEL, splitCaption, type Post } from "./social-planner";
import { PlatformIcon } from "./platform-icon";
import { MediaLibraryView } from "./media-library-view";

// Top-bar → Content: one content calendar for every social platform, for the agency and every sub-account.
//  · Calendar (one client), List and Approvals (agency) views; filter by person, platform and status
//  · Sub-account posts go to the agency for approval; approved posts auto-publish to Facebook, Instagram and
//    Google Business when connected (LinkedIn / TikTok show as "Ready to post")
//  · Images upload from the device, the Media Library or the person's own Google Drive, tagged to whoever added them

type Client = { id: string; name: string; logo?: string };
type ListPost = Post & { clientId: string };
const PLATFORMS: Array<[string, string]> = [["facebook", "Facebook"], ["instagram", "Instagram"], ["google", "Google Business"], ["linkedin", "LinkedIn"], ["tiktok", "TikTok"]];
const iso = (d: Date) => d.toISOString();
const when = (s: string) => new Date(s).toLocaleString("en-IE", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export function ContentView({ clients, scopeClientId = "", isAgency }: { clients: Client[]; scopeClientId?: string; isAgency: boolean }) {
  const [clientId, setClientId] = useState(() => scopeClientId || (() => { try { return localStorage.getItem("f2b-content-client") || ""; } catch { return ""; } })());
  const [view, setView] = useState<"calendar" | "list" | "approvals">(scopeClientId ? "calendar" : "list");
  const [person, setPerson] = useState(""); const [platform, setPlatform] = useState(""); const [status, setStatus] = useState("");
  const [posts, setPosts] = useState<ListPost[] | null>(null);
  const [pending, setPending] = useState(0);
  const [edit, setEdit] = useState<ListPost | null>(null);
  const [msg, setMsg] = useState("");
  const [gbp, setGbp] = useState<{ connected: boolean; email: string; locations: Array<{ location: string; title: string; clientId: string }> } | null>(null);
  const [seed, setSeed] = useState(0);
  const [mediaOpen, setMediaOpen] = useState(false);
  const [drive, setDrive] = useState<{ connected: boolean; mine: boolean; email: string } | null>(null);
  useEffect(() => { let live = true; fetch("/api/media-library?status=1", { cache: "no-store" }).then((r) => r.ok ? r.json() : null).then((j) => { if (live && j?.drive) setDrive(j.drive); }).catch(() => undefined); return () => { live = false; }; }, []);
  useEffect(() => { if (!mediaOpen) return; const esc = (e: KeyboardEvent) => { if (e.key === "Escape") setMediaOpen(false); }; document.addEventListener("keydown", esc); return () => document.removeEventListener("keydown", esc); }, [mediaOpen]);
  const [editMedia, setEditMedia] = useState<Array<{ id: string; url: string; name: string; kind: string; createdBy?: string }>>([]);
  // The list view's editor gets that client's Media Library too.
  useEffect(() => { if (!edit) return; let live = true; fetch(`/api/media-library?scope=${encodeURIComponent(edit.clientId)}&kind=image`, { cache: "no-store" }).then((r) => r.ok ? r.json() : null).then((j) => { if (live && j) setEditMedia(j.items || []); }).catch(() => undefined); return () => { live = false; }; }, [edit]);
  const client = clients.find((c) => c.id === clientId);
  useEffect(() => { if (!scopeClientId) { try { localStorage.setItem("f2b-content-client", clientId); } catch { /* ignore */ } } }, [clientId, scopeClientId]);
  useEffect(() => { try { const u = new URL(window.location.href); const r = u.searchParams.get("gbpConnection") || u.searchParams.get("driveConnection"); if (r) setMsg(r === "connected" ? "Connected ✓" : `Connection: ${r.replace(/-/g, " ")}`); } catch { /* ignore */ } }, []);

  const load = useCallback(async () => {
    const target = clientId || (isAgency ? "all" : "");
    if (!target) { setPosts([]); return; }
    const q = new URLSearchParams({ clientId: target, from: iso(new Date(Date.now() - 60 * 86_400_000)), to: iso(new Date(Date.now() + 120 * 86_400_000)) });
    try { const r = await fetch(`/api/social-posts?${q}`, { cache: "no-store" }); const j = await r.json(); if (!r.ok) throw new Error(j.error || "Couldn’t load posts."); setPosts(j.posts || []); setPending(j.pending || 0); }
    catch (e) { setMsg(e instanceof Error ? e.message : "Couldn’t load posts."); setPosts([]); }
  }, [clientId, isAgency]);
  useEffect(() => { void load(); }, [load, seed]);
  useEffect(() => { if (!isAgency) return; let live = true; fetch("/api/gbp", { cache: "no-store" }).then((r) => r.ok ? r.json() : null).then((j) => { if (live && j) setGbp(j); }).catch(() => undefined); return () => { live = false; }; }, [isAgency, seed]);

  const people = useMemo(() => [...new Set((posts || []).map((p) => p.createdByName).filter(Boolean) as string[])].sort(), [posts]);
  const shown = (posts || []).filter((p) => (!person || p.createdByName === person) && (!platform || p.platforms.includes(platform)) && (!status || p.status === status) && (view !== "approvals" || p.status === "pending"));
  const clientName = (id: string) => clients.find((c) => c.id === id)?.name || "Client";
  const location = gbp?.locations.find((l) => l.clientId === clientId);
  const post = async (body: Record<string, unknown>) => { const r = await fetch("/api/gbp", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); const j = await r.json(); if (!r.ok) throw new Error(j.error || "Couldn’t save."); return j; };

  return <section className="cv content-page">
    <style>{CSS}</style>
    <div className="page-heading"><div><p className="eyebrow">FACEBOOK · INSTAGRAM · GOOGLE · LINKEDIN · TIKTOK</p><h1>Content</h1><p className="muted">Plan every social post in one calendar. {isAgency ? "Client teams can add their own posts; they come to you for approval before going out." : "Posts you add go to F2B for approval before they’re published."}</p></div></div>

    <div className="cv-bar">
      {!scopeClientId && <select value={clientId} onChange={(e) => setClientId(e.target.value)} aria-label="Client"><option value="">{isAgency ? "All clients" : "Choose a client"}</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}
      <div className="cv-seg">{([["calendar", "Calendar"], ["list", "List"], ...(isAgency ? [["approvals", `Approvals${pending ? ` (${pending})` : ""}`]] : [])] as Array<[typeof view, string]>).map(([k, l]) => <button key={k} type="button" className={view === k ? "on" : ""} onClick={() => setView(k)}>{l}</button>)}</div>
      <select value={person} onChange={(e) => setPerson(e.target.value)} aria-label="Person"><option value="">Everyone</option>{people.map((p) => <option key={p}>{p}</option>)}</select>
      <select value={platform} onChange={(e) => setPlatform(e.target.value)} aria-label="Platform"><option value="">All platforms</option>{PLATFORMS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      <select value={status} onChange={(e) => setStatus(e.target.value)} aria-label="Status"><option value="">Any status</option>{Object.entries(STATUS_LABEL).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
      <span className="cv-tools">
        <button type="button" className="cv-tool" onClick={() => setMediaOpen(true)} title="Open the Media Library"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="3" /><circle cx="9" cy="9" r="2" /><path d="m21 15-3.5-3.5L8 21" /></svg>Media</button>
        <a className={`cv-tool${drive?.mine ? " on" : ""}`} href="/api/media-library/drive?mine=1" title={drive?.mine ? `Connected as ${drive.email}. Click to use a different account.` : "Connect your own Google Drive to pick photos and videos from it"}><svg width="16" height="16" viewBox="0 0 87.3 78" aria-hidden="true"><path d="m6.6 66.85 3.85 6.65c.8 1.4 1.95 2.5 3.3 3.3L27.5 53H0c0 1.55.4 3.1 1.2 4.5z" fill="#0066da" /><path d="M43.65 25 29.9 1.2c-1.35.8-2.5 1.9-3.3 3.3L1.2 48.5A9 9 0 0 0 0 53h27.5z" fill="#00ac47" /><path d="M73.55 76.8c1.35-.8 2.5-1.9 3.3-3.3l1.6-2.75 7.65-13.25c.8-1.4 1.2-2.95 1.2-4.5H59.8l5.85 11.5z" fill="#ea4335" /><path d="M43.65 25 57.4 1.2C56.05.4 54.5 0 52.9 0H34.4c-1.6 0-3.15.45-4.5 1.2z" fill="#00832d" /><path d="M59.8 53H27.5L13.75 76.8c1.35.8 2.9 1.2 4.5 1.2h50.8c1.6 0 3.15-.45 4.5-1.2z" fill="#2684fc" /><path d="M73.4 26.5 60.7 4.5c-.8-1.4-1.95-2.5-3.3-3.3L43.65 25 59.8 53h27.45c0-1.55-.4-3.1-1.2-4.5z" fill="#ffba00" /></svg>{drive?.mine ? "Google Drive connected" : "Connect Google Drive"}</a>
      </span>
    </div>
    {msg && <p className="cv-msg" role="status">{msg}</p>}
    {mediaOpen && <div className="cv-media-pop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) setMediaOpen(false); }}>
      <div className="cv-media-box" role="dialog" aria-modal="true" aria-label="Media Library">
        <header><b>Media Library{client ? ` · ${client.name}` : ""}</b><small>Upload photos and videos here, or import them from Google Drive. They show up in every post's picker.</small><button type="button" className="cv-media-x" aria-label="Close" onClick={() => { setMediaOpen(false); setSeed((n) => n + 1); }}>×</button></header>
        <div className="cv-media-body"><MediaLibraryView scopeClientId={scopeClientId || clientId} clients={clients} active /></div>
      </div>
    </div>}

    {isAgency && clientId && <div className="cv-conn">
      <span><b>Facebook &amp; Instagram posting</b><a href={`/api/meta-messaging/connect?clientId=${encodeURIComponent(clientId)}&posting=1`}>Connect / reconnect with posting →</a></span>
      <span><b>Google Business Profile</b>{!gbp?.connected ? <a href="/api/gbp/connect">Connect Google Business Profile →</a> : <select value={location?.location || ""} onChange={(e) => { void post({ action: "match", clientId, location: e.target.value }).then(() => setSeed((n) => n + 1)).catch((er) => setMsg(er.message)); }} aria-label="Business Profile location"><option value="">Pick {client?.name || "this client"}’s profile…</option>{gbp.locations.map((l) => <option key={l.location} value={l.location}>{l.title}{l.clientId && l.clientId !== clientId ? ` (${clientName(l.clientId)})` : ""}</option>)}</select>}{gbp?.connected && <button type="button" className="text-button" onClick={() => void post({ action: "sync" }).then((j) => { setMsg(`${j.found} Business Profile locations found.`); setSeed((n) => n + 1); }).catch((er) => setMsg(er.message))}>Refresh</button>}</span>
      <span className="cv-muted">LinkedIn &amp; TikTok: posts show as “Ready to post” with copy and download buttons.</span>
    </div>}

    {view === "calendar" && (clientId ? <SocialPlanner key={`${clientId}-${seed}`} clientId={clientId} clientName={client?.name || ""} canApprove={isAgency} filters={{ createdBy: person, platform, status }} onChanged={() => setSeed((n) => n + 1)} /> : <p className="cv-muted">Pick a client to see their calendar, or use List / Approvals for every client at once.</p>)}

    {view !== "calendar" && <div className="cv-list">
      {!posts && <p className="cv-muted">Loading posts…</p>}
      {posts && !shown.length && <p className="cv-muted">{view === "approvals" ? "Nothing waiting for approval." : "No posts match. Open the Calendar and click a day to add one."}</p>}
      {shown.map((p) => <button key={p.id} type="button" className={`cv-row ${p.status}`} onClick={() => setEdit(p)}>
        {p.images[0] ? <img src={p.images[0]} alt="" loading="lazy" /> : <span className="cv-noimg">Aa</span>}
        <span className="cv-main"><b>{p.caption.split("\n")[0].slice(0, 90) || "Untitled post"}</b><small>{when(p.postAt)} <span className="sp-icons">{p.platforms.map((x) => <PlatformIcon key={x} id={x} size={13} title={PLATFORMS.find((q) => q[0] === x)?.[1]} />)}</span>{!clientId ? ` · ${clientName(p.clientId)}` : ""}{splitCaption(p.caption).tags.length ? ` · ${splitCaption(p.caption).tags.slice(0, 3).join(" ")}` : ""}</small></span>
        <span className="cv-by">{p.createdByName || "—"}<small>{p.authorType === "subaccount" ? "Client team" : "Agency"}</small></span>
        <span className={`sp-badge ${p.status}`}>{STATUS_LABEL[p.status] || p.status}</span>
      </button>)}
    </div>}
    {edit && <PostEditor post={edit} clientId={edit.clientId} clientName={clientName(edit.clientId)} media={editMedia} canApprove={isAgency} onMedia={(m) => setEditMedia((cur) => [m, ...cur])} onClose={() => setEdit(null)} onSaved={(m) => { setEdit(null); setMsg(m); setSeed((n) => n + 1); }} />}
  </section>;
}

const CSS = `
.cv{display:flex;flex-direction:column;gap:14px}
.cv .cv-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.cv .cv-bar select{padding:8px 10px;border-radius:10px;border:1px solid rgba(127,127,127,.28);background:var(--f2b-white,#fff);color:inherit;font:inherit;font-size:13px}
.cv .cv-seg{display:inline-flex;gap:3px;padding:3px;border-radius:11px;background:color-mix(in srgb,currentColor 6%,transparent)}
.cv .cv-seg button{border:0;background:transparent;color:inherit;font:inherit;font-size:13px;font-weight:700;padding:6px 12px;border-radius:8px;cursor:pointer}
.cv .cv-seg button.on{background:var(--brand-primary,#101828);color:#fff}
.cv .cv-tools{margin-left:auto;display:flex;gap:8px;flex-wrap:wrap}
.cv .cv-tool{display:inline-flex;align-items:center;gap:7px;height:38px;padding:0 14px;border-radius:12px;border:1px solid rgba(16,24,40,.12);background:rgba(255,255,255,.7);color:inherit;font:inherit;font-size:13px;font-weight:700;text-decoration:none;cursor:pointer;transition:transform .15s,box-shadow .15s,border-color .15s}
.cv .cv-tool:hover{transform:translateY(-1px);border-color:var(--brand-secondary,var(--brand-primary,#101828));box-shadow:0 6px 16px rgba(16,24,40,.1)}
.cv .cv-tool.on{border-color:#16a34a55}
.dark-mode .cv .cv-tool{background:#1b2227;border-color:#2f3a41;color:#e7edf1}
.cv-media-pop{position:fixed;inset:0;z-index:1000;background:rgba(15,23,42,.5);display:flex;align-items:center;justify-content:center;padding:18px}
.cv-media-box{width:min(1200px,100%);height:min(90vh,920px);background:#fff;color:#0f172a;border-radius:18px;box-shadow:0 30px 80px rgba(0,0,0,.3);display:flex;flex-direction:column;overflow:hidden}
.cv-media-box>header{display:flex;align-items:baseline;gap:12px;padding:14px 18px;border-bottom:1px solid #eef2f5;flex-wrap:wrap}.cv-media-box>header b{font-size:16px}.cv-media-box>header small{color:#667085;font-size:12.5px;flex:1}
.cv-media-x{border:0;background:#f1f5f9;width:34px;height:34px;border-radius:50%;font-size:20px;cursor:pointer;color:inherit}
.cv-media-body{flex:1;overflow:auto;padding:4px 14px 14px}
.dark-mode .cv-media-box{background:#1b2227;color:#e7edf1}.dark-mode .cv-media-box>header{border-color:#2f3a41}.dark-mode .cv-media-x{background:#2a343b}
@media(max-width:760px){.cv-media-pop{padding:0}.cv-media-box{height:100%;border-radius:0}}
.cv .cv-msg{margin:0;font-size:13px;padding:8px 12px;border-radius:10px;background:color-mix(in srgb,currentColor 5%,transparent)}
.cv .cv-conn{display:flex;flex-wrap:wrap;gap:10px 22px;align-items:center;padding:12px 14px;border:1px solid rgba(127,127,127,.16);border-radius:14px;font-size:13px}
.cv .cv-conn span{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.cv .cv-conn a{font-weight:700;color:var(--brand-primary,#101828)}
.cv .cv-conn select{padding:6px 9px;border-radius:9px;border:1px solid rgba(127,127,127,.28);background:transparent;color:inherit;font:inherit;font-size:12.5px}
.cv .cv-muted{font-size:12.5px;opacity:.65}
.cv .cv-list{display:flex;flex-direction:column;gap:6px}
.cv .cv-row{display:grid;grid-template-columns:56px minmax(0,1fr) 160px 130px;gap:12px;align-items:center;padding:8px 12px 8px 8px;border:1px solid rgba(127,127,127,.14);border-radius:14px;background:var(--f2b-white,#fff);color:inherit;font:inherit;text-align:left;cursor:pointer;transition:transform .15s,border-color .15s}
.cv .cv-row:hover{transform:translateY(-1px);border-color:var(--brand-primary,#101828)}
.cv .cv-row.pending{box-shadow:inset 3px 0 0 #d97706}.cv .cv-row.failed{box-shadow:inset 3px 0 0 #dc2626}
.cv .cv-row img,.cv .cv-noimg{width:56px;height:56px;border-radius:10px;object-fit:cover;display:grid;place-items:center;background:color-mix(in srgb,currentColor 6%,transparent);font-weight:800;opacity:.9}
.cv .cv-main{display:flex;flex-direction:column;min-width:0}.cv .cv-main b{font-size:14px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.cv .cv-main small{font-size:12px;opacity:.65}
.cv .cv-by{display:flex;flex-direction:column;font-size:13px;font-weight:600}.cv .cv-by small{font-weight:400;opacity:.6;font-size:11.5px}
body.f2b-dark .cv .cv-row,.dark-mode .cv .cv-row{background:rgba(255,255,255,.03)}
@media (max-width:760px){.cv .cv-row{grid-template-columns:48px minmax(0,1fr) auto}.cv .cv-by{display:none}.cv .cv-tools{margin-left:0}}
`;
