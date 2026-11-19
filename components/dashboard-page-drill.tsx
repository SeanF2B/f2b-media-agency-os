"use client";
import { useEffect, useMemo, useState } from "react";

// Dashboard → Marketing → Landing pages / Assets, in full. Each page row opens to show its meta tags,
// keywords, searches, ads, sitelinks and results. Data from /api/dashboard-pages (cached server-side).

type OrgPage = { path: string; url: string; clicks: number; impressions: number; position: number | null; ctr: number | null; title: string; description: string; metaKeywords: string; h1: string; canonical: string; robots: string; httpStatus: number | null; targetKeyword: string; supportingKeywords: string; builder?: { slug: string; title: string; description: string; focusKeyword: string } | null; queries: Array<{ query: string; clicks: number; impressions: number; position: number | null }>; visits: number | null; allVisits: number | null; conversions: number | null; calls: number | null; leads: number | null; allCalls: number | null; allLeads: number | null; whatsapp: number | null; emails: number | null };
type Ad = { adId: string; campaign: string; adGroup: string; status: string; headlines: string[]; descriptions: string[]; impressions: number; clicks: number; spend: number; conversions: number; calls: number | null };
type AdsPage = { path: string; url: string; clicks: number; impressions: number; spend: number; conversions: number; cpc: number | null; adCalls: number | null; calls: number | null; leads: number | null; visits: number | null; ads: Ad[]; keywords: Array<{ keyword: string; matchType: string; clicks: number; impressions: number; spend: number; conversions: number; qualityScore: number | null }>; sitelinks: Array<{ text: string[]; campaign: string; clicks: number; impressions: number; conversions: number }> };
type Asset = { type: string; fieldType: string; scope: string; campaign: string; adGroup: string; status: string; performance: string; text: string[]; finalUrls: string[]; imageUrl: string; clicks: number; impressions: number; spend: number; conversions: number };
type Payload = { pages: Array<OrgPage | AdsPage>; assets?: Asset[]; notes?: Record<string, string>; error?: string };

const cacheMem = new Map<string, Payload>();
const n = (v: number | null | undefined) => v == null ? "—" : new Intl.NumberFormat("en-IE", { maximumFractionDigits: 1 }).format(v);
const pathOf = (u: string) => { try { return new URL(u).pathname || "/"; } catch { return u || "/"; } };
const nice = (t: string) => t.replace(/_/g, " ").toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

function Stat({ label, value, tone = "" }: { label: string; value: string; tone?: string }) {
  return <div className={`pd-stat ${tone}`}><small>{label}</small><b>{value}</b></div>;
}
function Field({ label, value, max }: { label: string; value: string; max?: number }) {
  const len = value.length;
  return <div className="pd-field"><small>{label}{max ? <em className={len === 0 ? "bad" : len > max ? "warn" : ""}>{len}/{max}</em> : null}</small><p>{value || <i>Missing</i>}</p></div>;
}


// Edit a page's meta title / description / focus keyword through the website builder (saves to the
// preview working copy, same as the builder), or its target keywords (SEO → Pages targets).
function MetaEditor({ page, clientId, onSaved }: { page: OrgPage; clientId: string; onSaved: (patch: Partial<OrgPage>, note: string) => void }) {
  const b = page.builder;
  const [title, setTitle] = useState(b?.title || page.title);
  const [desc, setDesc] = useState(b?.description || page.description);
  const [focus, setFocus] = useState(b?.focusKeyword || page.targetKeyword);
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState("");
  if (!b) return <p className="pd-note">This page isn’t in the OS website builder, so its meta tags are edited where the site is built (e.g. WordPress). Target keywords can still be set above.</p>;
  const save = async () => {
    setBusy(true); setMsg("");
    try {
      const r = await fetch(`/api/client-site?op=builder-read&clientId=${encodeURIComponent(clientId)}&slug=${encodeURIComponent(b.slug)}`); const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Couldn’t open the page.");
      const pg = { ...j.page, seo: { ...(j.page?.seo || {}), title: title.trim(), description: desc.trim(), focusKeyword: focus.trim() } };
      const w = await fetch("/api/client-site", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "builder-save", clientId, slug: b.slug, page: pg, baseSha: j.sha, message: `SEO: meta tags for ${page.path}` }) });
      const k = await w.json().catch(() => ({}));
      if (!w.ok) throw new Error(k.error || "Couldn’t save.");
      onSaved({ builder: { ...b, title: title.trim(), description: desc.trim(), focusKeyword: focus.trim() } }, k.unchanged ? "No changes." : k.previewNote || "Saved.");
      setMsg(k.unchanged ? "No changes to save." : "Saved to the website builder. Publish the site for it to go live.");
    } catch (e) { setMsg(e instanceof Error ? e.message : "Couldn’t save."); } finally { setBusy(false); }
  };
  return <div className="pd-edit">
    <label>Meta title <em className={title.length > 60 ? "warn" : ""}>{title.length}/60</em><input value={title} onChange={(e) => setTitle(e.target.value)} /></label>
    <label>Meta description <em className={desc.length > 155 ? "warn" : ""}>{desc.length}/155</em><textarea rows={3} value={desc} onChange={(e) => setDesc(e.target.value)} /></label>
    <label>Focus keyword<input value={focus} onChange={(e) => setFocus(e.target.value)} /></label>
    <div className="pd-edit-foot"><button type="button" className="pd-btn" disabled={busy || title.length > 60 || desc.length > 155} onClick={save}>{busy ? "Saving…" : "Save meta tags"}</button>{msg && <small>{msg}</small>}</div>
  </div>;
}
function KeywordEditor({ page, clientId, onSaved }: { page: OrgPage; clientId: string; onSaved: (patch: Partial<OrgPage>) => void }) {
  const [primary, setPrimary] = useState(page.targetKeyword);
  const [supporting, setSupporting] = useState(String(page.supportingKeywords || "").split(/\n/).filter(Boolean).join(", "));
  const [busy, setBusy] = useState(false); const [msg, setMsg] = useState("");
  const save = async () => {
    setBusy(true); setMsg("");
    try {
      const r = await fetch(`/api/seo/pages?clientId=${encodeURIComponent(clientId)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: page.url, primary, supporting }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Couldn’t save.");
      onSaved({ targetKeyword: j.primary || "", supportingKeywords: j.supporting || "" }); setMsg("Target keywords saved.");
    } catch (e) { setMsg(e instanceof Error ? e.message : "Couldn’t save."); } finally { setBusy(false); }
  };
  return <div className="pd-edit pd-edit-row">
    <label>Target keyword<input value={primary} placeholder="e.g. roof repair galway" onChange={(e) => setPrimary(e.target.value)} /></label>
    <label>Supporting keywords<input value={supporting} placeholder="comma separated" onChange={(e) => setSupporting(e.target.value)} /></label>
    <div className="pd-edit-foot"><button type="button" className="pd-btn" disabled={busy} onClick={save}>{busy ? "Saving…" : "Save keywords"}</button>{msg && <small>{msg}</small>}</div>
  </div>;
}

export function PageDrill({ kind, clientId, start, end, currency = "EUR", onClose }: { kind: "organic" | "ads" | "assets" | "keywords"; clientId: string; start: string; end: string; currency?: string; onClose: () => void }) {
  const api = kind === "organic" || kind === "keywords" ? "organic" : "ads";
  const key = `${api}:${clientId}:${start}:${end}`;
  const [data, setData] = useState<Payload | null>(cacheMem.get(key) || null);
  const [err, setErr] = useState("");
  const [open, setOpen] = useState("");
  const [q, setQ] = useState("");
  const patchPage = (path: string, patch: Partial<OrgPage>) => setData((cur) => { if (!cur) return cur; const next = { ...cur, pages: (cur.pages as OrgPage[]).map((p) => p.path === path ? { ...p, ...patch } : p) }; cacheMem.set(key, next); return next; });
  const money = useMemo(() => new Intl.NumberFormat("en-IE", { style: "currency", currency, maximumFractionDigits: 2 }), [currency]);
  useEffect(() => {
    let live = true; setErr(""); setOpen("");
    const hit = cacheMem.get(key); if (hit) { setData(hit); return; }
    setData(null);
    fetch(`/api/dashboard-pages?kind=${api}&clientId=${encodeURIComponent(clientId)}&start=${start}&end=${end}`).then(async (r) => { const j = await r.json().catch(() => ({})) as Payload; if (!r.ok) throw new Error(j.error || "Couldn’t load page data."); return j; })
      .then((j) => { if (!live) return; cacheMem.set(key, j); setData(j); }).catch((e) => { if (live) setErr(e instanceof Error ? e.message : "Couldn’t load page data."); });
    return () => { live = false; };
  }, [key, api, clientId, start, end]);

  const title = kind === "keywords" ? "Organic keywords" : kind === "organic" ? "Web pages" : kind === "ads" ? "Ad landing pages" : "Google Ads assets";
  const sub = kind === "keywords" ? "Google searches · position · ranking page · meta title & description" : kind === "organic" ? "Click a page for its keywords and meta tags" : kind === "ads" ? "Ads · keywords · sitelinks · clicks · impressions · spend · calls · leads" : "Sitelinks · callouts · snippets · calls · images, with results";
  const notes = Object.values(data?.notes || {}).filter(Boolean);
  const term = q.trim().toLowerCase();

  return <div className="dh-rank-drop dh-detail pd">
    <style>{CSS}</style>
    <div className="dh-rank-drop-head"><b>{title}</b><span><small>{sub}</small><button type="button" className="text-button" onClick={onClose}>Close</button></span></div>
    {!data && !err && <p className="dh-muted pd-loading">Loading every page…</p>}
    {err && <p className="dh-muted">{err}</p>}
    {data && notes.length > 0 && <p className="pd-notes">{notes.join(" · ")}</p>}
    {data && kind !== "assets" && kind !== "keywords" && data.pages.length > 6 && <input className="pd-search" placeholder="Search pages, titles or keywords…" value={q} onChange={(e) => setQ(e.target.value)} />}

    {data && kind === "organic" && (() => {
      const rows = (data.pages as OrgPage[]).filter((p) => !term || `${p.path} ${p.title} ${p.description} ${p.targetKeyword} ${p.queries.map((x) => x.query).join(" ")}`.toLowerCase().includes(term));
      if (!rows.length) return <p className="dh-muted">No pages found.</p>;
      return <div className="pd-list">
        <div className="pd-row pd-headrow"><span>Page</span><span>Clicks</span><span>Impr.</span><span>Pos.</span><span>Visits</span><span>Calls</span><span>Leads</span><span>Conv.</span></div>
        {rows.map((p) => { const isOpen = open === p.path; return <div key={p.path} className={`pd-item ${isOpen ? "open" : ""}`}>
          <button type="button" className="pd-row" onClick={() => setOpen(isOpen ? "" : p.path)} aria-expanded={isOpen}>
            <span className="pd-page"><i>{isOpen ? "▾" : "▸"}</i><b>{p.path}</b><small>{p.queries.length ? `${p.queries.length} keyword${p.queries.length === 1 ? "" : "s"} · ` : ""}{p.title || "No title tag"}</small></span>
            <span>{n(p.clicks)}</span><span>{n(p.impressions)}</span><span>{p.position != null ? `#${p.position}` : "—"}</span><span>{n(p.visits)}</span><span className={p.calls ? "good" : ""}>{n(p.calls)}</span><span className={p.leads ? "good" : ""}>{n(p.leads)}</span><span>{n(p.conversions)}</span>
          </button>
          {isOpen && <div className="pd-body">
            {(() => { const targets = [p.targetKeyword, ...String(p.supportingKeywords || "").split(/[,\n]/)].map((x) => x.trim()).filter((t) => t && !p.queries.some((x) => x.query.toLowerCase() === t.toLowerCase()));
              return <details className="pd-dd" open><summary>Keywords <small>({p.queries.length + targets.length})</small></summary>{p.queries.length || targets.length ? <table><thead><tr><th>Keyword</th><th>Pos.</th><th>Clicks</th><th>Impr.</th><th>CTR</th></tr></thead><tbody>
                {p.queries.map((x) => <tr key={x.query}><td>{x.query}</td><td className={x.position == null ? "" : x.position <= 3 ? "good" : x.position > 10 ? "bad" : ""}>{x.position != null ? `#${x.position}` : "—"}</td><td>{n(x.clicks)}</td><td>{n(x.impressions)}</td><td>{x.impressions ? `${n(x.clicks / x.impressions * 100)}%` : "—"}</td></tr>)}
                {targets.map((t) => <tr key={`t-${t}`}><td>{t} <small>· target, no Google data yet</small></td><td>—</td><td>—</td><td>—</td><td>—</td></tr>)}
              </tbody></table> : <p className="dh-muted">No Google searches for this page in this period yet. Set a target keyword below.</p>}<KeywordEditor page={p} clientId={clientId} onSaved={(x) => patchPage(p.path, x)} /></details>; })()}
            <details className="pd-dd"><summary>Meta details <small>{[!p.title && "no title", !p.description && "no description", p.title.length > 60 && "title too long", p.description.length > 160 && "description too long"].filter(Boolean).join(" · ") || "title · description · H1"}</small></summary>
              <div className="pd-serp"><small>{(() => { try { return new URL(p.url).hostname.replace(/^www\./, "") + p.path; } catch { return p.path; } })()}</small><b>{p.title || "No title tag"}</b><p>{p.description || "No meta description"}</p></div>
              <Field label="Meta title" value={p.title} max={60} />
                <Field label="Meta description" value={p.description} max={160} />
                <Field label="H1" value={p.h1} />
                {p.metaKeywords && <Field label="Meta keywords" value={p.metaKeywords} />}
                <div className="pd-mini"><span>Target keyword: <b>{p.targetKeyword || "—"}</b></span>{p.supportingKeywords && <span>Supporting: <b>{p.supportingKeywords}</b></span>}{p.canonical && <span>Canonical: <b>{pathOf(p.canonical)}</b></span>}{p.robots && <span>Robots: <b>{p.robots}</b></span>}{p.httpStatus != null && p.httpStatus !== 200 && <span className="bad">HTTP {p.httpStatus || "unreachable"}</span>}<a href={p.url} target="_blank" rel="noreferrer">Open page ↗</a></div>
              
              <MetaEditor key={`${p.path}-${p.builder?.slug || ""}`} page={p} clientId={clientId} onSaved={(x) => patchPage(p.path, x)} />
            </details>
            <div className="pd-cols pd-statsrow">
              <div>
                <div className="pd-stats"><Stat label="Google clicks" value={n(p.clicks)} /><Stat label="Impressions" value={n(p.impressions)} /><Stat label="CTR" value={p.ctr != null ? `${p.ctr}%` : "—"} /><Stat label="Avg. position" value={p.position != null ? `#${p.position}` : "—"} /><Stat label="Organic visits" value={n(p.visits)} /><Stat label="Calls" value={n(p.calls)} tone={p.calls ? "good" : ""} /><Stat label="Leads" value={n(p.leads)} tone={p.leads ? "good" : ""} /><Stat label="Conversions" value={n(p.conversions)} /></div>
                <small className="pd-cap">All channels: {n(p.allVisits)} visits · {n(p.allCalls)} calls · {n(p.allLeads)} leads{p.whatsapp ? ` · ${n(p.whatsapp)} WhatsApp` : ""}{p.emails ? ` · ${n(p.emails)} emails` : ""}</small>
              </div>
            </div>
          </div>}
        </div>; })}
      </div>;
    })()}

    {data && kind === "keywords" && (() => {
      // Pivot pages → keywords: each Google search with its totals and the page(s) that rank for it.
      const pages = data.pages as OrgPage[];
      type Kw = { term: string; clicks: number; impressions: number; posW: number; posN: number; pages: Array<{ page: OrgPage; clicks: number; impressions: number; position: number | null }>; target: boolean };
      const map = new Map<string, Kw>();
      for (const pg of pages) for (const q of pg.queries) {
        const k = map.get(q.query) || { term: q.query, clicks: 0, impressions: 0, posW: 0, posN: 0, pages: [], target: false };
        k.clicks += q.clicks; k.impressions += q.impressions; if (q.position != null) { k.posW += q.position * Math.max(1, q.impressions); k.posN += Math.max(1, q.impressions); }
        k.pages.push({ page: pg, clicks: q.clicks, impressions: q.impressions, position: q.position }); map.set(q.query, k);
      }
      // Saved target keywords show too, even before Google has data for them.
      for (const pg of pages) for (const t of [pg.targetKeyword, ...String(pg.supportingKeywords || "").split(/[,\n]/)].map((x) => x.trim()).filter(Boolean)) {
        const key = [...map.keys()].find((x) => x.toLowerCase() === t.toLowerCase()) || t;
        const k = map.get(key) || { term: t, clicks: 0, impressions: 0, posW: 0, posN: 0, pages: [], target: false };
        k.target = true; if (!k.pages.some((x) => x.page.path === pg.path)) k.pages.push({ page: pg, clicks: 0, impressions: 0, position: null }); map.set(key, k);
      }
      const all = [...map.values()].map((k) => ({ ...k, position: k.posN ? Math.round(k.posW / k.posN * 10) / 10 : null, pages: k.pages.sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions) })).sort((a, b) => b.clicks - a.clicks || b.impressions - a.impressions || a.term.localeCompare(b.term));
      const rows = all.filter((k) => !term || `${k.term} ${k.pages.map((x) => `${x.page.path} ${x.page.title} ${x.page.description}`).join(" ")}`.toLowerCase().includes(term));
      const tone = (p: number | null) => p == null ? "" : p <= 3 ? "good" : p <= 10 ? "" : "bad";
      if (!all.length) return <p className="dh-muted">No Google searches for this site in this period yet{notes.length ? "" : ", and no target keywords saved in Operations → SEO"}.</p>;
      return <>
        {all.length > 6 && <input className="pd-search" placeholder="Search keywords, pages or meta tags…" value={q} onChange={(e) => setQ(e.target.value)} />}
        <div className="pd-list pd-kw">
          <div className="pd-row pd-headrow"><span>Keyword · ranking page</span><span>Pos.</span><span>Clicks</span><span>Impr.</span><span>CTR</span></div>
          {rows.length ? rows.map((k) => { const isOpen = open === k.term; const top = k.pages[0]?.page; return <div key={k.term} className={`pd-item ${isOpen ? "open" : ""}`}>
            <button type="button" className="pd-row" onClick={() => setOpen(isOpen ? "" : k.term)} aria-expanded={isOpen}>
              <span className="pd-page"><i>{isOpen ? "▾" : "▸"}</i><b>{k.term}</b><small>{top ? `${top.path}${k.pages.length > 1 ? ` +${k.pages.length - 1} more` : ""}` : ""}{k.target ? " · target" : ""}</small></span>
              <span className={tone(k.position)}>{k.position != null ? `#${k.position}` : "—"}</span><span>{n(k.clicks)}</span><span>{n(k.impressions)}</span><span>{k.impressions ? `${n(k.clicks / k.impressions * 100)}%` : "—"}</span>
            </button>
            {isOpen && <div className="pd-body">{k.pages.map(({ page: pg, clicks, impressions, position }) => <div key={pg.path} className="pd-kwpage">
              <div className="pd-serp"><small>{(() => { try { return new URL(pg.url).hostname.replace(/^www\./, "") + pg.path; } catch { return pg.path; } })()}</small><b>{pg.title || "No title tag"}</b><p>{pg.description || "No meta description"}</p></div>
              <div className="pd-cols">
                <div><Field label="Meta title" value={pg.title} max={60} /><Field label="Meta description" value={pg.description} max={160} /><Field label="H1" value={pg.h1} />
                  <div className="pd-mini"><span>Target keyword: <b>{pg.targetKeyword || "—"}</b></span>{pg.title && !pg.title.toLowerCase().includes(k.term.toLowerCase()) && <span className="bad">Keyword not in title</span>}<a href={pg.url} target="_blank" rel="noreferrer">Open page ↗</a></div></div>
                <div className="pd-stats"><Stat label="Position" value={position != null ? `#${position}` : "—"} /><Stat label="Clicks" value={n(clicks)} /><Stat label="Impressions" value={n(impressions)} /><Stat label="CTR" value={impressions ? `${n(clicks / impressions * 100)}%` : "—"} /></div>
              </div>
            </div>)}</div>}
          </div>; }) : <p className="dh-muted">No keywords match.</p>}
        </div>
      </>;
    })()}

    {data && kind === "ads" && (() => {
      const rows = (data.pages as AdsPage[]).filter((p) => !term || `${p.path} ${p.keywords.map((k) => k.keyword).join(" ")} ${p.ads.flatMap((a) => a.headlines).join(" ")}`.toLowerCase().includes(term));
      if (!rows.length) return <p className="dh-muted">No ad landing pages in this period.</p>;
      return <div className="pd-list">
        <div className="pd-row pd-headrow"><span>Page</span><span>Clicks</span><span>Impr.</span><span>Spend</span><span>CPC</span><span>Calls</span><span>Leads</span><span>Conv.</span></div>
        {rows.map((p) => { const isOpen = open === p.path; const calls = p.adCalls ?? p.calls; return <div key={p.path} className={`pd-item ${isOpen ? "open" : ""}`}>
          <button type="button" className="pd-row" onClick={() => setOpen(isOpen ? "" : p.path)} aria-expanded={isOpen}>
            <span className="pd-page"><i>{isOpen ? "▾" : "▸"}</i><b>{p.path}</b><small>{p.ads.length} ad{p.ads.length === 1 ? "" : "s"} · {p.keywords.length} keyword{p.keywords.length === 1 ? "" : "s"} · {p.sitelinks.length} sitelink{p.sitelinks.length === 1 ? "" : "s"}</small></span>
            <span>{n(p.clicks)}</span><span>{n(p.impressions)}</span><span>{money.format(p.spend)}</span><span>{p.cpc != null ? money.format(p.cpc) : "—"}</span><span className={calls ? "good" : ""}>{n(calls)}</span><span className={p.leads ? "good" : ""}>{n(p.leads)}</span><span className={p.conversions ? "good" : ""}>{n(p.conversions)}</span>
          </button>
          {isOpen && <div className="pd-body">
            <div className="pd-stats"><Stat label="Ad clicks" value={n(p.clicks)} /><Stat label="Impressions" value={n(p.impressions)} /><Stat label="CTR" value={p.impressions ? `${n(p.clicks / p.impressions * 100)}%` : "—"} /><Stat label="Spend" value={money.format(p.spend)} /><Stat label="Conversions" value={n(p.conversions)} tone={p.conversions ? "good" : ""} /><Stat label="Calls from ads" value={n(p.adCalls)} /><Stat label="Calls on page (GA4)" value={n(p.calls)} /><Stat label="Leads (GA4)" value={n(p.leads)} tone={p.leads ? "good" : ""} /></div>
            <div className="pd-sub"><b>Ads sending people here</b>{p.ads.length ? p.ads.map((a) => <div key={a.adId} className="pd-ad">
              <div className="pd-ad-head"><span>{a.campaign} › {a.adGroup}</span><small>{nice(a.status)} · {n(a.clicks)} clicks · {n(a.impressions)} impr. · {money.format(a.spend)} · {n(a.conversions)} conv{a.calls != null ? ` · ${n(a.calls)} calls` : ""}</small></div>
              <div className="pd-ad-preview"><small>Sponsored · {pathOf(p.url)}</small><b>{a.headlines.slice(0, 3).join(" | ")}</b><p>{a.descriptions[0] || ""}</p></div>
              <div className="pd-chips"><small>Headlines ({a.headlines.length})</small>{a.headlines.map((h, i) => <span key={i}>{h}</span>)}</div>
              <div className="pd-chips"><small>Descriptions ({a.descriptions.length})</small>{a.descriptions.map((h, i) => <span key={i} className="long">{h}</span>)}</div>
            </div>) : <p className="dh-muted">No responsive search ads point at this page (it may come from a sitelink or Performance Max).</p>}</div>
            <div className="pd-sub"><b>Keywords</b>{p.keywords.length ? <table><thead><tr><th>Keyword</th><th>Match</th><th>Clicks</th><th>Impr.</th><th>Spend</th><th>Conv.</th><th>QS</th></tr></thead><tbody>{p.keywords.map((k, i) => <tr key={i}><td>{k.keyword}</td><td>{nice(k.matchType)}</td><td>{n(k.clicks)}</td><td>{n(k.impressions)}</td><td>{money.format(k.spend)}</td><td>{n(k.conversions)}</td><td>{k.qualityScore ?? "—"}</td></tr>)}</tbody></table> : <p className="dh-muted">No keywords with activity for this page in this period.</p>}</div>
            {p.sitelinks.length > 0 && <div className="pd-sub"><b>Sitelinks to this page</b><table><thead><tr><th>Sitelink</th><th>Campaign</th><th>Clicks</th><th>Impr.</th><th>Conv.</th></tr></thead><tbody>{p.sitelinks.map((s, i) => <tr key={i}><td><b>{s.text[0]}</b>{s.text.slice(1).length ? <small> · {s.text.slice(1).join(" · ")}</small> : null}</td><td>{s.campaign || "Account"}</td><td>{n(s.clicks)}</td><td>{n(s.impressions)}</td><td>{n(s.conversions)}</td></tr>)}</tbody></table></div>}
          </div>}
        </div>; })}
      </div>;
    })()}

    {data && kind === "assets" && (() => {
      const list = data.assets || [];
      if (!list.length) return <p className="dh-muted">No assets found on this Google Ads account.</p>;
      const groups = new Map<string, Asset[]>();
      for (const a of list) { const k = a.type || "OTHER"; groups.set(k, [...(groups.get(k) || []), a]); }
      return <div className="pd-list">{[...groups.entries()].map(([type, rows]) => <div key={type} className="pd-sub">
        <b>{nice(type)}s <small>({rows.length})</small></b>
        <table><thead><tr><th>Asset</th><th>Where</th><th>Status</th><th>Clicks</th><th>Impr.</th><th>Spend</th><th>Conv.</th></tr></thead><tbody>
          {rows.map((a, i) => <tr key={i}>
            <td>{a.imageUrl ? <img src={a.imageUrl} alt="" className="pd-img" /> : null}<b>{a.text[0] || nice(a.fieldType)}</b>{a.text.slice(1).length ? <small> · {a.text.slice(1).join(" · ")}</small> : null}{a.finalUrls[0] ? <small className="pd-url"> → {pathOf(a.finalUrls[0])}</small> : null}</td>
            <td>{a.scope === "Account" ? "Account" : `${a.campaign}${a.adGroup ? ` › ${a.adGroup}` : ""}`}</td>
            <td>{nice(a.status || "")}{a.performance && !/UNSPECIFIED|UNKNOWN|PENDING/i.test(a.performance) ? ` · ${nice(a.performance)}` : ""}</td>
            <td>{n(a.clicks)}</td><td>{n(a.impressions)}</td><td>{money.format(a.spend || 0)}</td><td>{n(a.conversions)}</td>
          </tr>)}
        </tbody></table>
      </div>)}</div>;
    })()}
  </div>;
}

const CSS = `
.pd .pd-notes{font-size:12px;opacity:.7;margin:4px 0 8px}
.pd .pd-loading{padding:8px 0}
.pd .pd-search{width:100%;margin:2px 0 10px;padding:8px 12px;border-radius:10px;border:1px solid rgba(127,127,127,.25);background:transparent;color:inherit;font:inherit;font-size:13px}
.pd .pd-list{display:flex;flex-direction:column;gap:2px}
.pd .pd-row{display:grid;grid-template-columns:minmax(0,1fr) repeat(7,72px);gap:8px;align-items:center;width:100%;padding:9px 6px;border:0;border-bottom:1px solid rgba(127,127,127,.12);background:transparent;color:inherit;font:inherit;font-size:13px;text-align:right;cursor:pointer}
.pd .pd-row>span:first-child{text-align:left}
.pd button.pd-row:hover{background:rgba(127,127,127,.06)}
.pd .pd-headrow{cursor:default;font-size:11px;text-transform:uppercase;letter-spacing:.04em;opacity:.6;padding-top:2px}
.pd .pd-page{display:flex;align-items:baseline;gap:8px;min-width:0}
.pd .pd-page i{font-style:normal;opacity:.5;width:10px}
.pd .pd-page b{white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:45%}
.pd .pd-page small{opacity:.6;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
.pd .good{color:#15803d;font-weight:700}
.pd .bad{color:#b91c1c}
.pd .pd-item.open{background:rgba(127,127,127,.04);border-radius:12px}
.pd .pd-body{padding:6px 12px 16px 24px;display:flex;flex-direction:column;gap:14px}
.pd .pd-cols{display:grid;grid-template-columns:1.2fr 1fr;gap:18px}
.pd .pd-field{margin-bottom:8px}
.pd .pd-field small{display:flex;gap:8px;font-size:11px;text-transform:uppercase;letter-spacing:.04em;opacity:.65}
.pd .pd-field small em{font-style:normal;opacity:.9}
.pd .pd-field small em.warn{color:#b45309}.pd .pd-field small em.bad{color:#b91c1c}
.pd .pd-field p{margin:2px 0 0;font-size:13px;line-height:1.4}
.pd .pd-field p i{opacity:.55}
.pd .pd-mini{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:12px;opacity:.85}
.pd .pd-mini a{color:inherit;text-decoration:underline}
.pd .pd-stats{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:8px}
.pd .pd-stat{border:1px solid rgba(127,127,127,.15);border-radius:10px;padding:8px 10px}
.pd .pd-stat small{display:block;font-size:11px;opacity:.65}
.pd .pd-stat b{font-size:16px}
.pd .pd-stat.good b{color:#15803d}
.pd .pd-cap{display:block;margin-top:6px;font-size:12px;opacity:.65}
.pd .pd-sub>b{display:block;font-size:13px;margin-bottom:6px}
.pd table{width:100%;border-collapse:collapse;font-size:12.5px}
.pd th{text-align:right;font-weight:600;opacity:.6;font-size:11px;padding:4px 6px;border-bottom:1px solid rgba(127,127,127,.15)}
.pd td{text-align:right;padding:5px 6px;border-bottom:1px solid rgba(127,127,127,.08)}
.pd th:first-child,.pd td:first-child,.pd th:nth-child(2):not(:last-child),.pd td:nth-child(2):not(:last-child){text-align:left}
.pd td small{opacity:.65}
.pd .pd-url{opacity:.55}
.pd .pd-img{width:28px;height:28px;object-fit:cover;border-radius:6px;vertical-align:middle;margin-right:6px}
.pd .pd-ad{border:1px solid rgba(127,127,127,.15);border-radius:12px;padding:10px 12px;margin-bottom:8px}
.pd .pd-ad-head{display:flex;justify-content:space-between;gap:10px;flex-wrap:wrap;font-size:12.5px;font-weight:600}
.pd .pd-ad-head small{font-weight:400;opacity:.7}
.pd .pd-ad-preview{margin:8px 0;padding:8px 10px;border-radius:8px;background:rgba(127,127,127,.06)}
.pd .pd-ad-preview small{font-size:11px;opacity:.7}
.pd .pd-ad-preview b{display:block;color:#1a0dab;font-size:14px;font-weight:500;margin:2px 0}
.pd .pd-ad-preview p{margin:0;font-size:12.5px;opacity:.85}
.pd .pd-chips{display:flex;flex-wrap:wrap;gap:4px;margin-top:6px;align-items:center}
.pd .pd-chips small{font-size:11px;opacity:.6;margin-right:4px;width:100%}
.pd .pd-chips span{font-size:12px;padding:3px 8px;border-radius:999px;border:1px solid rgba(127,127,127,.2)}
.pd .pd-chips span.long{border-radius:8px}
html.dark .pd .pd-ad-preview b,[data-theme=dark] .pd .pd-ad-preview b{color:#8ab4f8}
.pd .pd-kw .pd-row{grid-template-columns:minmax(0,1fr) repeat(4,72px)}
.pd .pd-kwpage{display:flex;flex-direction:column;gap:10px;padding-bottom:12px;border-bottom:1px dashed rgba(127,127,127,.2)}
.pd .pd-kwpage:last-child{border-bottom:0;padding-bottom:0}
.pd .pd-serp{padding:10px 12px;border-radius:10px;background:rgba(127,127,127,.06);max-width:640px}
.pd .pd-serp small{font-size:12px;opacity:.7}
.pd .pd-serp b{display:block;color:#1a0dab;font-size:17px;font-weight:500;margin:2px 0;line-height:1.3}
.pd .pd-serp p{margin:0;font-size:13px;opacity:.85;line-height:1.45}
html.dark .pd .pd-serp b,[data-theme=dark] .pd .pd-serp b{color:#8ab4f8}
.pd .pd-dd{border:1px solid rgba(127,127,127,.15);border-radius:12px;padding:0 12px}
.pd .pd-dd>summary{cursor:pointer;list-style:none;padding:10px 0;font-size:13px;font-weight:700;display:flex;gap:8px;align-items:baseline}
.pd .pd-dd>summary::-webkit-details-marker{display:none}
.pd .pd-dd>summary::before{content:"▸";opacity:.5;font-size:11px}
.pd .pd-dd[open]>summary::before{content:"▾"}
.pd .pd-dd>summary small{font-weight:400;opacity:.6}
.pd .pd-dd[open]{padding-bottom:12px}
.pd .pd-dd .pd-serp{margin-bottom:10px}
.pd .pd-statsrow{grid-template-columns:1fr}
.pd .pd-note{font-size:12.5px;opacity:.7;margin:8px 0 0}
.pd .pd-edit{display:flex;flex-direction:column;gap:8px;margin-top:12px;padding-top:12px;border-top:1px solid rgba(127,127,127,.15)}
.pd .pd-edit-row{display:grid;grid-template-columns:1fr 1.4fr;gap:10px}
.pd .pd-edit-row .pd-edit-foot{grid-column:1/-1}
.pd .pd-edit label{display:flex;flex-direction:column;gap:4px;font-size:11px;text-transform:uppercase;letter-spacing:.04em;opacity:.9}
.pd .pd-edit label em{font-style:normal;opacity:.7;text-transform:none}.pd .pd-edit label em.warn{color:#b45309;opacity:1}
.pd .pd-edit input,.pd .pd-edit textarea{font:inherit;font-size:13px;text-transform:none;letter-spacing:0;padding:8px 10px;border-radius:10px;border:1px solid rgba(127,127,127,.25);background:transparent;color:inherit;resize:vertical;transition:border-color .15s,transform .15s,box-shadow .15s}
.pd .pd-edit input:hover,.pd .pd-edit textarea:hover{border-color:var(--secondary,#c81e1e);transform:translateY(-1px)}
.pd .pd-edit-foot{display:flex;align-items:center;gap:10px}
.pd .pd-edit-foot small{font-size:12px;opacity:.75}
.pd .pd-btn{padding:7px 14px;border-radius:999px;border:0;background:var(--primary,#c81e1e);color:#fff;font:inherit;font-size:13px;font-weight:600;cursor:pointer;transition:transform .15s,box-shadow .15s}
.pd .pd-btn:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 4px 12px rgba(0,0,0,.15)}
.pd .pd-btn:disabled{opacity:.5;cursor:default}
@media (max-width:900px){.pd .pd-edit-row{grid-template-columns:1fr}}
@media (max-width:900px){.pd .pd-row{grid-template-columns:minmax(0,1fr) repeat(3,56px)}.pd .pd-row>span:nth-child(n+5){display:none}.pd .pd-cols{grid-template-columns:1fr}.pd .pd-stats{grid-template-columns:repeat(2,minmax(0,1fr))}.pd .pd-kw .pd-row>span:nth-child(n+5){display:none}.pd .pd-page{flex-direction:column;gap:0}.pd .pd-page b{max-width:100%}}
`;
