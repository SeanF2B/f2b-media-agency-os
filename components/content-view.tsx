"use client";
import { useCallback, useEffect, useMemo, useState } from "react";
import { PostEditor, SocialPlanner, STATUS_LABEL, type Post } from "./social-planner";

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
      <a className="cv-drive" href="/api/media-library/drive?mine=1" title="Connect your own Google Drive to pick images from it">Connect my Google Drive</a>
    </div>
    {msg && <p className="cv-msg" role="status">{msg}</p>}

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
        <span className="cv-main"><b>{p.caption.split("\n")[0].slice(0, 90) || "Untitled post"}</b><small>{when(p.postAt)} · {p.platforms.map((x) => PLATFORMS.find((q) => q[0] === x)?.[1] || x).join(", ")}{!clientId ? ` · ${clientName(p.clientId)}` : ""}</small></span>
        <span className="cv-by">{p.createdByName || "—"}<small>{p.authorType === "subaccount" ? "Client team" : "Agency"}</small></span>
        <span className={`sp-badge ${p.status}`}>{STATUS_LABEL[p.status] || p.status}</span>
      </button>)}
    </div>}
    {edit && <PostEditor post={edit} clientId={edit.clientId} clientName={clientName(edit.clientId)} media={[]} canApprove={isAgency} onMedia={() => undefined} onClose={() => setEdit(null)} onSaved={(m) => { setEdit(null); setMsg(m); setSeed((n) => n + 1); }} />}
  </section>;
}

const CSS = `
.cv{display:flex;flex-direction:column;gap:14px}
.cv .cv-bar{display:flex;flex-wrap:wrap;gap:8px;align-items:center}
.cv .cv-bar select{padding:8px 10px;border-radius:10px;border:1px solid rgba(127,127,127,.28);background:var(--f2b-white,#fff);color:inherit;font:inherit;font-size:13px}
.cv .cv-seg{display:inline-flex;gap:3px;padding:3px;border-radius:11px;background:color-mix(in srgb,currentColor 6%,transparent)}
.cv .cv-seg button{border:0;background:transparent;color:inherit;font:inherit;font-size:13px;font-weight:700;padding:6px 12px;border-radius:8px;cursor:pointer}
.cv .cv-seg button.on{background:var(--brand-primary,#101828);color:#fff}
.cv .cv-drive{margin-left:auto;font-size:13px;font-weight:700;color:var(--brand-primary,#101828)}
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
@media (max-width:760px){.cv .cv-row{grid-template-columns:48px minmax(0,1fr) auto}.cv .cv-by{display:none}.cv .cv-drive{margin-left:0}}
`;
