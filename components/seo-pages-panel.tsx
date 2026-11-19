"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowDownRight, ArrowUpRight, ExternalLink, Minus, PenLine, Search, X } from "lucide-react";
import { PageManager, type ManagedPage } from "./dashboard-page-manager";

// SEO → Performance → Pages: each page's target keywords next to its real organic Google traffic.
type Page = { key: string; url: string; title: string; known: boolean; primary: string; supporting: string; suggested: string; targetsUpdatedAt: string; clicks: number | null; impressions: number | null; prevClicks: number | null };
type Payload = { status: "connected" | "not_mapped" | "missing_connection" | "unavailable"; message?: string; period: { start: string; end: string }; previous: { start: string; end: string }; pages: Page[] };
type Query = { query: string; clicks: number; impressions: number; ctr: number; position: number | null };

const PRESETS: Array<[string, string, number]> = [["28", "Last 28 days", 28], ["90", "Last 3 months", 90], ["180", "Last 6 months", 180]];
const iso = (d: Date) => d.toISOString().slice(0, 10);
const num = (v: number | null | undefined) => v == null ? "—" : v.toLocaleString("en-IE");
const pathOf = (url: string) => { try { return new URL(url).pathname; } catch { return url; } };

export function SeoPagesPanel({ clientId, clientName, onOpenWebsite, onConnect }: { clientId: string; clientName: string; onOpenWebsite?: (pageUrl?: string) => void; onConnect?: () => void }) {
  const [preset, setPreset] = useState("28");
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [filter, setFilter] = useState<"all" | "up" | "down" | "none" | "nokw">("all");
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState<Page | null>(null);
  const range = useMemo(() => { const end = new Date(Date.now() - 2 * 86_400_000); const days = PRESETS.find(([k]) => k === preset)?.[2] || 28; return { start: iso(new Date(end.getTime() - (days - 1) * 86_400_000)), end: iso(end) }; }, [preset]);
  const load = useCallback(async () => {
    setError("");
    try {
      const response = await fetch(`/api/seo/pages?${new URLSearchParams({ clientId, ...range })}`, { cache: "no-store" });
      const json = await response.json().catch(() => ({})) as Payload & { error?: string };
      if (!response.ok) throw new Error(json.error || "Pages couldn’t load.");
      setData(json);
    } catch (e) { setError(e instanceof Error ? e.message : "Pages couldn’t load."); }
  }, [clientId, range]);
  useEffect(() => { setData((cur) => cur && cur.pages ? cur : null); void load(); }, [load]);
  useEffect(() => { setOpen(null); setData(null); }, [clientId]);

  const connected = data?.status === "connected";
  const change = (p: Page) => p.clicks == null || p.prevClicks == null ? null : p.clicks - p.prevClicks;
  const rows = (data?.pages || []).filter((p) => {
    if (query.trim() && !`${p.title} ${p.url} ${p.primary}`.toLowerCase().includes(query.trim().toLowerCase())) return false;
    const c = change(p);
    if (filter === "up") return (c ?? 0) > 0;
    if (filter === "down") return (c ?? 0) < 0;
    if (filter === "none") return connected && !p.clicks && !p.impressions;
    if (filter === "nokw") return !p.primary;
    return true;
  });
  const counts = useMemo(() => { const list = data?.pages || []; return { up: list.filter((p) => (change(p) ?? 0) > 0).length, down: list.filter((p) => (change(p) ?? 0) < 0).length, none: connected ? list.filter((p) => !p.clicks && !p.impressions).length : 0, nokw: list.filter((p) => !p.primary).length }; }, [data, connected]); // eslint-disable-line react-hooks/exhaustive-deps
  const totals = useMemo(() => (data?.pages || []).reduce((t, p) => ({ clicks: t.clicks + (p.clicks || 0), prev: t.prev + (p.prevClicks || 0), impressions: t.impressions + (p.impressions || 0) }), { clicks: 0, prev: 0, impressions: 0 }), [data]);
  const fmtDay = (d: string) => new Date(`${d}T00:00:00`).toLocaleDateString("en-IE", { day: "numeric", month: "short" });

  return <div className="spp">
    <div className="spp-bar">
      <select value={preset} onChange={(e) => setPreset(e.target.value)} aria-label="Date range">{PRESETS.map(([k, label]) => <option key={k} value={k}>{label}</option>)}</select>
      {data && <span className="spp-period">{fmtDay(data.period.start)} – {fmtDay(data.period.end)} vs {fmtDay(data.previous.start)} – {fmtDay(data.previous.end)}</span>}
      <span className="spp-search"><Search size={14} aria-hidden="true" /><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Find a page or keyword" aria-label="Find a page" /></span>
    </div>
    {data && !connected && <div className="spp-connect"><div><b>{data.status === "not_mapped" ? "No Search Console property linked" : data.status === "missing_connection" ? "Search Console isn’t connected" : "Search Console data unavailable"}</b><span>{data.message} You can still set target keywords for each page.</span></div>{onConnect && <button type="button" className="primary-button" onClick={onConnect}>Connect Search Console</button>}</div>}
    {connected && <div className="spp-totals"><span><b>{num(totals.clicks)}</b> organic clicks</span><span><b>{num(totals.impressions)}</b> impressions</span><span className={totals.clicks - totals.prev > 0 ? "up" : totals.clicks - totals.prev < 0 ? "down" : ""}>{totals.clicks - totals.prev > 0 ? "▲" : totals.clicks - totals.prev < 0 ? "▼" : "•"} {num(Math.abs(totals.clicks - totals.prev))} vs previous period</span><small>Source: Google Search Console</small></div>}
    <div className="spp-filters" role="tablist" aria-label="Filter pages">{([["all", "All pages", data?.pages.length || 0], ["up", "Gaining", counts.up], ["down", "Losing", counts.down], ["none", "No activity", counts.none], ["nokw", "No target keyword", counts.nokw]] as Array<[typeof filter, string, number]>).filter(([k]) => connected || (k !== "up" && k !== "down" && k !== "none")).map(([k, label, n]) => <button key={k} type="button" role="tab" aria-selected={filter === k} className={`${filter === k ? "on" : ""} ${k}`} onClick={() => setFilter(k)}>{label}<i>{n}</i></button>)}</div>
    {error && <p className="ops-empty" role="alert">{error}</p>}
    {!data && !error && <div className="page-loading" role="status" aria-label="Loading pages…"><i /></div>}
    {data && (rows.length ? <div className="spp-table-wrap"><table className="spp-table">
      <thead><tr><th>Page</th><th>Primary target keyword</th><th className="num">Clicks</th><th className="num">Impressions</th><th className="num">Change</th></tr></thead>
      <tbody>{rows.map((p) => { const c = change(p); return <tr key={p.key} className={open?.key === p.key ? "on" : ""} onClick={() => setOpen(p)}>
        <td><b>{p.title === p.key ? pathOf(p.url) : p.title}</b><small>{pathOf(p.url)}{!p.known ? " · from Search Console" : ""}</small></td>
        <td>{p.primary ? <span className="spp-kw">{p.primary}</span> : p.suggested ? <span className="spp-kw suggested" title="Focus keyword from the website builder (not saved as a target yet)">{p.suggested} · builder</span> : <span className="spp-add"><PenLine size={13} /> Set keyword</span>}</td>
        <td className="num">{connected ? num(p.clicks) : <span className="spp-na">—</span>}</td>
        <td className="num">{connected ? num(p.impressions) : <span className="spp-na">—</span>}</td>
        <td className="num">{!connected ? <span className="spp-na">Unavailable</span> : !p.clicks && !p.impressions && !p.prevClicks ? <span className="spp-na">No activity</span> : c == null ? "—" : <span className={`spp-delta ${c > 0 ? "up" : c < 0 ? "down" : ""}`}>{c > 0 ? <ArrowUpRight size={13} /> : c < 0 ? <ArrowDownRight size={13} /> : <Minus size={13} />}{c > 0 ? "+" : ""}{num(c)}</span>}</td>
      </tr>; })}</tbody>
    </table></div> : <p className="ops-empty">{(data.pages || []).length ? "No pages match." : `No pages found for ${clientName} yet. Pages appear once the site is built in Websites or Search Console reports traffic.`}</p>)}
    {open && <OpsPageManager key={`m-${open.key}`} page={open} clientId={clientId} period={data?.period} onClose={() => setOpen(null)} onTargets={(primary, supporting) => setData((cur) => cur ? { ...cur, pages: cur.pages.map((p) => p.key === open.key ? { ...p, primary, supporting } : p) } : cur)} fallback={<PageDetail key={open.key} page={open} clientId={clientId} period={data?.period} connected={connected} statusMessage={data?.message || ""} onClose={() => setOpen(null)} onSaved={(primary, supporting) => { setData((cur) => cur ? { ...cur, pages: cur.pages.map((p) => p.key === open.key ? { ...p, primary, supporting } : p) } : cur); setOpen((cur) => cur ? { ...cur, primary, supporting } : cur); }} onOpenWebsite={onOpenWebsite} onConnect={onConnect} />} />}
  </div>;
}

function PageDetail({ page, clientId, period, connected, statusMessage, onClose, onSaved, onOpenWebsite, onConnect }: { page: Page; clientId: string; period?: { start: string; end: string }; connected: boolean; statusMessage: string; onClose: () => void; onSaved: (primary: string, supporting: string) => void; onOpenWebsite?: (pageUrl?: string) => void; onConnect?: () => void }) {
  const [primary, setPrimary] = useState(page.primary || page.suggested);
  const [supporting, setSupporting] = useState(page.supporting);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState("");
  const [queries, setQueries] = useState<Query[] | null>(null);
  const [qError, setQError] = useState("");
  useEffect(() => {
    if (!connected || !period) { setQueries([]); return; }
    void fetch(`/api/seo/pages?${new URLSearchParams({ clientId, page: page.url, start: period.start, end: period.end })}`, { cache: "no-store" }).then((r) => r.json()).then((j: { queries?: Query[]; status?: string; message?: string }) => { if (j.status && j.status !== "connected") setQError(j.message || "Search Console data unavailable."); setQueries(j.queries || []); }).catch(() => { setQError("Searches couldn’t load."); setQueries([]); });
  }, [clientId, page.url, connected, period]);
  const save = async () => {
    setSaving(true); setSaved("");
    try {
      const response = await fetch(`/api/seo/pages?clientId=${encodeURIComponent(clientId)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: page.url, primary, supporting }) });
      const json = await response.json().catch(() => ({})) as { primary?: string; supporting?: string; error?: string };
      if (!response.ok) throw new Error(json.error || "Couldn’t save.");
      onSaved(json.primary || "", json.supporting || ""); setSupporting(json.supporting || ""); setSaved("Saved · added to the SEO plan");
    } catch (e) { setSaved(e instanceof Error ? e.message : "Couldn’t save."); }
    finally { setSaving(false); }
  };
  const ranksFor = (kw: string) => queries?.find((q) => q.query.toLowerCase() === kw.trim().toLowerCase());
  const primaryHit = primary.trim() ? ranksFor(primary) : undefined;
  return <div className="spp-drawer-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <aside className="spp-drawer" role="dialog" aria-modal="true" aria-label={`SEO for ${page.title}`}>
      <header><div><b>{page.title === page.key ? pathOf(page.url) : page.title}</b><a href={page.url} target="_blank" rel="noreferrer">{page.url} <ExternalLink size={12} /></a></div><button type="button" className="spp-close" onClick={onClose} aria-label="Close"><X size={18} /></button></header>
      <section className="spp-section">
        <h4>Target keywords</h4>
        <label><span>Primary target keyword</span><input value={primary} onChange={(e) => setPrimary(e.target.value)} placeholder="e.g. roof repairs galway" /></label>
        {primaryHit ? <small className="spp-hint ok">Google already shows this page for “{primaryHit.query}”: position {primaryHit.position?.toFixed(1)}, {primaryHit.clicks} clicks.</small> : primary.trim() && connected && queries ? <small className="spp-hint">No Search Console data for this exact keyword on this page yet.</small> : null}
        <label><span>Supporting keywords (one per line)</span><textarea rows={4} value={supporting} onChange={(e) => setSupporting(e.target.value)} placeholder={"emergency roof repair galway\nroof leak repair"} /></label>
        <div className="spp-actions"><button type="button" className="primary-button" disabled={saving} onClick={() => void save()}>{saving ? "Saving…" : "Save targets"}</button>{onOpenWebsite && <button type="button" className="secondary-button" onClick={() => onOpenWebsite(page.url)}>Edit in Sites</button>}{saved && <span className="spp-saved" role="status">{saved}</span>}</div>
        <small className="spp-note">Targets are your plan for this page. To change the page’s title, headings or copy, use Edit in Sites; nothing is published from here.</small>
      </section>
      <section className="spp-section">
        <h4>Actual Google searches <small>Search Console · {period ? `${period.start} – ${period.end}` : ""}</small></h4>
        {!connected ? <div className="spp-connect small"><span>{statusMessage || "Search Console isn’t connected."}</span>{onConnect && <button type="button" className="secondary-button" onClick={onConnect}>Connect Search Console</button>}</div>
          : queries === null ? <div className="page-loading" role="status" aria-label="Loading searches…"><i /></div>
          : qError ? <p className="spp-na">{qError}</p>
          : queries.length ? <div className="spp-table-wrap"><table className="spp-table compact"><thead><tr><th>Search</th><th className="num">Clicks</th><th className="num">Impr.</th><th className="num">CTR</th><th className="num">Avg. pos.</th></tr></thead><tbody>{queries.map((q) => <tr key={q.query} className={[primary, ...supporting.split("\n")].some((k) => k.trim() && k.trim().toLowerCase() === q.query.toLowerCase()) ? "target" : ""}><td>{q.query}</td><td className="num">{num(q.clicks)}</td><td className="num">{num(q.impressions)}</td><td className="num">{(q.ctr * 100).toFixed(1)}%</td><td className="num">{q.position == null ? "—" : q.position.toFixed(1)}</td></tr>)}</tbody></table></div>
          : <p className="spp-na">No reported searches for this page in this period.</p>}
      </section>
    </aside>
  </div>;
}

// Operations → SEO → Pages: clicking a page opens the full page manager (edit meta tags, keywords, AI
// recommendations, trending). Agency-level only (Operations and these APIs are agency staff only).
const pagesCache = new Map<string, ManagedPage[]>();
const keyOf = (u: string) => { let v = "/"; try { v = decodeURIComponent(new URL(u, "https://x.invalid").pathname || "/"); } catch { v = u || "/"; } v = v.toLowerCase().replace(/\/{2,}/g, "/"); return v.length > 1 && !v.endsWith("/") && !/\.[a-z0-9]+$/i.test(v) ? `${v}/` : v; };
function OpsPageManager({ page, clientId, period, onClose, onTargets, fallback }: { page: Page; clientId: string; period?: { start: string; end: string }; onClose: () => void; onTargets: (primary: string, supporting: string) => void; fallback: ReactNode }) {
  const ck = `${clientId}:${period?.start || ""}:${period?.end || ""}`;
  const [pages, setPages] = useState<ManagedPage[] | null>(pagesCache.get(ck) || null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (pagesCache.has(ck)) return;
    let live = true;
    const q = new URLSearchParams({ kind: "organic", clientId, ...(period ? { start: period.start, end: period.end } : {}) });
    fetch(`/api/dashboard-pages?${q}`, { cache: "no-store" }).then(async (r) => { const j = await r.json().catch(() => ({})) as { pages?: ManagedPage[]; error?: string }; if (!r.ok || !j.pages) throw new Error(j.error || "failed"); return j.pages; })
      .then((list) => { if (!live) return; pagesCache.set(ck, list); setPages(list); }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [ck, clientId, period]);
  const key = keyOf(page.url || page.key);
  const mp = pages?.find((p) => p.path === key) || (pages ? { path: key, url: page.url, clicks: page.clicks || 0, impressions: page.impressions || 0, position: null, ctr: null, title: page.title === page.key ? "" : page.title, description: "", metaKeywords: "", h1: "", canonical: "", robots: "", httpStatus: null, targetKeyword: page.primary, supportingKeywords: page.supporting, builder: null, queries: [], trending: [], visits: null, allVisits: null, conversions: null, calls: null, leads: null } as ManagedPage : null);
  if (failed) return <>{fallback}</>;
  if (!mp) return <div className="pm-overlay" role="status" aria-label="Loading page" style={{ position: "fixed", inset: 0, zIndex: 1000, background: "rgba(16,24,40,.35)", display: "grid", placeItems: "center" }} onClick={onClose}><div className="page-loading"><i /></div></div>;
  return <PageManager page={mp} clientId={clientId} onClose={onClose} onSaved={(patch) => {
    setPages((cur) => { const next = (cur || []).map((p) => p.path === mp.path ? { ...p, ...patch } : p); pagesCache.set(ck, next); return next; });
    if (patch.targetKeyword !== undefined || patch.supportingKeywords !== undefined) onTargets(patch.targetKeyword ?? mp.targetKeyword, patch.supportingKeywords ?? mp.supportingKeywords);
  }} />;
}
