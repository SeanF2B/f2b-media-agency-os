"use client";
import { useEffect, useMemo, useState } from "react";

// Dashboard → Marketing → Web pages → click a page: one pop-up manager with everything about that page
// and easy editing. Agency staff only (the Marketing section and these APIs are agency-level).
//  - Live Google preview that updates as you type
//  - Meta title / description / focus keyword (saved through the website builder, preview copy)
//  - Target + supporting keywords (SEO page targets)
//  - Google searches, trending searches, on-page keywords, results
//  - AI recommendations from the page's real numbers, with "Apply" to fill the fields

export type ManagedPage = {
  path: string; url: string; clicks: number; impressions: number; position: number | null; ctr: number | null;
  title: string; description: string; metaKeywords: string; h1: string; canonical: string; robots: string; httpStatus: number | null;
  targetKeyword: string; supportingKeywords: string;
  builder?: { slug: string; title: string; description: string; focusKeyword: string } | null;
  queries: Array<{ query: string; clicks: number; impressions: number; position: number | null }>;
  trending?: Array<{ query: string; impressions: number; previous: number; change: number; position: number | null; previousPosition: number | null; isNew: boolean }>;
  visits: number | null; allVisits: number | null; conversions: number | null; calls: number | null; leads: number | null;
};
type Review = { summary: string; recommendations: Array<{ priority: "high" | "medium" | "low"; title: string; why: string; action: string }>; title: string; description: string; targetKeyword: string };

const n = (v: number | null | undefined) => v == null ? "—" : new Intl.NumberFormat("en-IE", { maximumFractionDigits: 1 }).format(v);
const pos = (v: number | null | undefined) => v == null ? "—" : `#${v}`;
const tone = (p: number | null) => p == null ? "" : p <= 3 ? "good" : p <= 10 ? "" : "bad";
const reviewCache = new Map<string, Review>();

export function onPageKeywords(p: Pick<ManagedPage, "title" | "h1" | "metaKeywords">) {
  const clean = (t: string) => t.toLowerCase().replace(/[“”"']/g, "").replace(/\s+/g, " ").trim();
  const out: string[] = [];
  const add = (t: string) => { const c = clean(t); if (c.length >= 3 && c.split(" ").length <= 7 && !out.includes(c)) out.push(c); };
  const segs = String(p.title || "").split(/\s[|–—-]\s/);
  if (segs[0]) add(segs[0]);
  for (const s of segs.slice(1)) if (/\b(galway|cork|dublin|ireland|near me)\b/i.test(s)) add(s);
  if (p.h1 && p.h1.split(" ").length <= 7) add(p.h1);
  for (const k of String(p.metaKeywords || "").split(",")) add(k);
  return out.slice(0, 8);
}

export function PageManager({ page, clientId, onClose, onSaved, readOnly = false }: { page: ManagedPage; clientId: string; onClose: () => void; onSaved: (patch: Partial<ManagedPage>) => void; readOnly?: boolean }) {
  const b = page.builder || null;
  const [title, setTitle] = useState(b?.title || page.title);
  const [desc, setDesc] = useState(b?.description || page.description);
  const [focus, setFocus] = useState(b?.focusKeyword || page.targetKeyword);
  const [primary, setPrimary] = useState(page.targetKeyword);
  const [supporting, setSupporting] = useState(String(page.supportingKeywords || "").split(/\n/).filter(Boolean).join(", "));
  const [metaMsg, setMetaMsg] = useState(""); const [kwMsg, setKwMsg] = useState("");
  const [busy, setBusy] = useState<"" | "meta" | "kw" | "ai">("");
  const [review, setReview] = useState<Review | null>(reviewCache.get(`${clientId}:${page.path}`) || null);
  const [aiErr, setAiErr] = useState("");
  const onPage = useMemo(() => onPageKeywords(page), [page]);
  const host = useMemo(() => { try { return new URL(page.url).hostname.replace(/^www\./, ""); } catch { return ""; } }, [page.url]);

  useEffect(() => {
    const esc = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("keydown", esc);
    const prev = document.body.style.overflow; document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", esc); document.body.style.overflow = prev; };
  }, [onClose]);

  const saveMeta = async () => {
    if (!b) return;
    setBusy("meta"); setMetaMsg("");
    try {
      const r = await fetch(`/api/client-site?op=builder-read&clientId=${encodeURIComponent(clientId)}&slug=${encodeURIComponent(b.slug)}`); const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Couldn’t open the page.");
      const pg = { ...j.page, seo: { ...(j.page?.seo || {}), title: title.trim(), description: desc.trim(), focusKeyword: focus.trim() } };
      const w = await fetch("/api/client-site", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ op: "builder-save", clientId, slug: b.slug, page: pg, baseSha: j.sha, message: `SEO: meta tags for ${page.path}` }) });
      const k = await w.json().catch(() => ({}));
      if (!w.ok) throw new Error(k.error || "Couldn’t save.");
      onSaved({ builder: { ...b, title: title.trim(), description: desc.trim(), focusKeyword: focus.trim() } });
      setMetaMsg(k.unchanged ? "No changes to save." : "Saved to the website builder. Publish the site for it to go live.");
    } catch (e) { setMetaMsg(e instanceof Error ? e.message : "Couldn’t save."); } finally { setBusy(""); }
  };
  const saveKeywords = async () => {
    setBusy("kw"); setKwMsg("");
    try {
      const r = await fetch(`/api/seo/pages?clientId=${encodeURIComponent(clientId)}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ url: page.url, primary, supporting }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Couldn’t save.");
      onSaved({ targetKeyword: j.primary || "", supportingKeywords: j.supporting || "" }); setKwMsg("Target keywords saved.");
    } catch (e) { setKwMsg(e instanceof Error ? e.message : "Couldn’t save."); } finally { setBusy(""); }
  };
  const askAi = async () => {
    setBusy("ai"); setAiErr("");
    try {
      const r = await fetch("/api/seo-suggest", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({
        mode: "review", clientId, url: page.url, title, description: desc, h1: page.h1, targetKeyword: primary || focus, supportingKeywords: supporting,
        clicks: page.clicks, impressions: page.impressions, ctr: page.ctr, position: page.position, queries: page.queries.slice(0, 25), trending: (page.trending || []).slice(0, 10),
        visits: page.visits, calls: page.calls, leads: page.leads,
      }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Couldn’t get recommendations.");
      reviewCache.set(`${clientId}:${page.path}`, j as Review); setReview(j as Review);
    } catch (e) { setAiErr(e instanceof Error ? e.message : "Couldn’t get recommendations."); } finally { setBusy(""); }
  };
  const addSupporting = (t: string) => { const list = supporting.split(",").map((x) => x.trim()).filter(Boolean); if (!list.some((x) => x.toLowerCase() === t.toLowerCase())) setSupporting([...list, t].join(", ")); };
  const applyAi = () => { if (!review) return; if (review.title) setTitle(review.title); if (review.description) setDesc(review.description); if (review.targetKeyword) { setPrimary(review.targetKeyword); setFocus(review.targetKeyword); } setMetaMsg("AI suggestions filled in. Review, then save."); };

  return <div className="pm-overlay" role="dialog" aria-modal="true" aria-label={`Page manager ${page.path}`} onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <style>{CSS}</style>
    <div className="pm">
      <header className="pm-head">
        <div><small>{readOnly ? "Page overview · view only" : "Page manager"}</small><h2>{page.path}</h2></div>
        <div className="pm-head-tools"><a className="pm-ghost" href={page.url} target="_blank" rel="noreferrer">Open page ↗</a><button type="button" className="pm-x" aria-label="Close" onClick={onClose}>×</button></div>
      </header>

      <div className="pm-stats">
        {[["Clicks", n(page.clicks)], ["Impressions", n(page.impressions)], ["CTR", page.ctr != null ? `${page.ctr}%` : "—"], ["Avg. position", pos(page.position)], ["Visits", n(page.visits)], ["Calls", n(page.calls)], ["Leads", n(page.leads)], ["Conversions", n(page.conversions)]].map(([l, v]) => <div key={l} className="pm-stat"><small>{l}</small><b>{v}</b></div>)}
      </div>

      <div className="pm-grid">
        <div className="pm-col">
          <section className="pm-card">
            <h3>Google preview</h3>
            <a className="pm-serp" href={page.url} target="_blank" rel="noreferrer"><small>{host}{page.path} ↗</small><b>{title || "No title tag"}</b><p>{desc || "No meta description"}</p></a>
          </section>

          {readOnly ? <section className="pm-card">
            <h3>Meta details</h3>
            <div className="pm-read"><span>Meta title <em className={page.title.length > 60 ? "warn" : ""}>{page.title.length}/60</em></span><p>{page.title || <i>Missing</i>}</p></div>
            <div className="pm-read"><span>Meta description <em className={page.description.length > 155 ? "warn" : ""}>{page.description.length}/155</em></span><p>{page.description || <i>Missing</i>}</p></div>
            <div className="pm-read"><span>H1</span><p>{page.h1 || <i>Missing</i>}</p></div>
            {page.metaKeywords && <div className="pm-read"><span>Meta keywords</span><p>{page.metaKeywords}</p></div>}
          </section> : <section className="pm-card">
            <h3>Meta details {!b && <em>not in the OS website builder</em>}</h3>
            <label>Meta title <em className={title.length > 60 ? "warn" : title.length === 0 ? "bad" : ""}>{title.length}/60</em><input value={title} disabled={!b} onChange={(e) => setTitle(e.target.value)} /></label>
            <label>Meta description <em className={desc.length > 155 ? "warn" : desc.length === 0 ? "bad" : ""}>{desc.length}/155</em><textarea rows={3} value={desc} disabled={!b} onChange={(e) => setDesc(e.target.value)} /></label>
            <label>Focus keyword<input value={focus} disabled={!b} onChange={(e) => setFocus(e.target.value)} /></label>
            <div className="pm-read"><span>H1</span><p>{page.h1 || <i>Missing</i>}</p></div>
            {(page.canonical || page.robots || (page.httpStatus != null && page.httpStatus !== 200)) && <div className="pm-mini">{page.canonical && <span>Canonical: <b>{page.canonical}</b></span>}{page.robots && <span>Robots: <b>{page.robots}</b></span>}{page.httpStatus != null && page.httpStatus !== 200 && <span className="bad">HTTP {page.httpStatus || "unreachable"}</span>}</div>}
            {b ? <div className="pm-foot"><button type="button" className="pm-btn" disabled={busy !== "" || title.length > 60 || desc.length > 155} onClick={saveMeta}>{busy === "meta" ? "Saving…" : "Save meta tags"}</button>{metaMsg && <small>{metaMsg}</small>}</div>
              : <p className="pm-note">This page’s meta tags are edited where the site is built (e.g. WordPress). Keywords below can still be set here.</p>}
          </section>}

          {readOnly ? <section className="pm-card">
            <h3>Target keywords</h3>
            <div className="pm-read"><span>Target keyword</span><p>{page.targetKeyword || <i>Not set</i>}</p></div>
            <div className="pm-read"><span>Supporting</span><p>{String(page.supportingKeywords || "").split(/\n/).filter(Boolean).join(", ") || <i>None</i>}</p></div>
            {onPage.length > 0 && <div className="pm-chips ro"><small>On the page now (title, H1, meta)</small>{onPage.map((t) => <span key={t}>{t}</span>)}</div>}
            <p className="pm-note">To change meta tags or keywords, open this client in Operations → SEO.</p>
          </section> : <section className="pm-card">
            <h3>Target keywords</h3>
            {onPage.length > 0 && <div className="pm-chips"><small>On the page now (title, H1, meta)</small>{onPage.map((t) => <button type="button" key={t} onClick={() => primary ? addSupporting(t) : setPrimary(t)} title={primary ? "Add as supporting" : "Use as target"}>{t}</button>)}</div>}
            <label>Target keyword<input value={primary} placeholder={onPage[0] ? `e.g. ${onPage[0]}` : "e.g. roof repair galway"} onChange={(e) => setPrimary(e.target.value)} /></label>
            <label>Supporting keywords<input value={supporting} placeholder="comma separated" onChange={(e) => setSupporting(e.target.value)} /></label>
            <div className="pm-foot"><button type="button" className="pm-btn" disabled={busy !== ""} onClick={saveKeywords}>{busy === "kw" ? "Saving…" : "Save keywords"}</button>{kwMsg && <small>{kwMsg}</small>}</div>
          </section>}
        </div>

        <div className="pm-col">
          <section className="pm-card pm-ai">
            <h3>AI recommendations</h3>
            {!review && !busy && <p className="pm-note">Reviews this page’s real Google searches, positions and CTR with its title, description and H1, then suggests what to change.</p>}
            {aiErr && <p className="pm-note bad">{aiErr}</p>}
            {busy === "ai" && <p className="pm-note pm-pulse">Reviewing the page…</p>}
            {review && <>
              {review.summary && <p className="pm-summary">{review.summary}</p>}
              <ol className="pm-recs">{review.recommendations.map((r, i) => <li key={i} className={r.priority}><div><span className={`pm-pri ${r.priority}`}>{r.priority}</span><b>{r.title}</b></div><p>{r.why}</p><p className="pm-act">→ {r.action}</p></li>)}</ol>
              {(review.title || review.description || review.targetKeyword) && <div className="pm-suggest"><small>Suggested</small>{review.targetKeyword && <p><span>Keyword</span>{review.targetKeyword}</p>}{review.title && <p><span>Title</span>{review.title}</p>}{review.description && <p><span>Description</span>{review.description}</p>}{!readOnly && <button type="button" className="pm-btn" onClick={applyAi}>Apply to fields</button>}</div>}
            </>}
            <div className="pm-foot"><button type="button" className={review ? "pm-ghost" : "pm-btn"} disabled={busy !== ""} onClick={askAi}>{busy === "ai" ? "Working…" : review ? "Refresh recommendations" : "Get AI recommendations"}</button></div>
          </section>

          <section className="pm-card">
            <h3>Google searches <em>{page.queries.length}</em></h3>
            {page.queries.length ? <table><thead><tr><th>Search</th><th>Pos.</th><th>Clicks</th><th>Impr.</th><th>CTR</th><th></th></tr></thead><tbody>
              {page.queries.map((q) => <tr key={q.query}><td>{q.query}</td><td className={tone(q.position)}>{pos(q.position)}</td><td>{n(q.clicks)}</td><td>{n(q.impressions)}</td><td>{q.impressions ? `${n(q.clicks / q.impressions * 100)}%` : "—"}</td><td>{!readOnly && <button type="button" className="pm-link" onClick={() => primary ? addSupporting(q.query) : setPrimary(q.query)}>{primary ? "+ supporting" : "Use as target"}</button>}</td></tr>)}
            </tbody></table> : <p className="pm-note">No Google searches for this page in this period yet.</p>}
          </section>

          <section className="pm-card">
            <h3>Trending <em>vs previous period</em></h3>
            {page.trending?.length ? <table><thead><tr><th>Search</th><th>Impr.</th><th>Change</th><th>Pos.</th></tr></thead><tbody>
              {page.trending.map((t) => <tr key={t.query}><td>{t.query}{t.isNew && <span className="pm-new">new</span>}</td><td>{n(t.impressions)}</td><td className="good">{t.change > 0 ? `▲ ${n(t.change)}` : "—"}</td><td>{pos(t.position)}{t.previousPosition != null && t.position != null && t.previousPosition !== t.position ? <small className={t.previousPosition > t.position ? "good" : "bad"}> {t.previousPosition > t.position ? "▲" : "▼"}{n(Math.abs(t.previousPosition - t.position))}</small> : null}</td></tr>)}
            </tbody></table> : <p className="pm-note">No searches growing for this page compared with the previous period.</p>}
          </section>
        </div>
      </div>
    </div>
  </div>;
}

const CSS = `
.pm-overlay{position:fixed;inset:0;z-index:1000;background:rgba(16,24,40,.45);display:flex;align-items:flex-start;justify-content:center;padding:4vh 16px;overflow-y:auto}
.pm{width:min(1180px,100%);background:#fff;color:#101828;border-radius:20px;box-shadow:0 24px 60px rgba(16,24,40,.25);padding:20px 22px 24px;display:flex;flex-direction:column;gap:16px}
body.f2b-dark .pm,.dark-mode .pm,html.dark .pm{background:#161b21;color:#e7ebef}
.pm-head{display:flex;justify-content:space-between;align-items:flex-start;gap:12px}
.pm-head small{font-size:11px;text-transform:uppercase;letter-spacing:.06em;opacity:.6}
.pm-head h2{margin:2px 0 0;font-size:22px;font-weight:800;word-break:break-all}
.pm-head-tools{display:flex;gap:8px;align-items:center}
.pm-x{width:34px;height:34px;border-radius:999px;border:1px solid rgba(127,127,127,.25);background:transparent;color:inherit;font-size:20px;line-height:1;cursor:pointer;transition:transform .15s,border-color .15s}
.pm-x:hover{transform:translateY(-1px);border-color:var(--brand-primary,#101828)}
.pm-stats{display:grid;grid-template-columns:repeat(8,minmax(0,1fr));gap:8px}
.pm-stat{border:1px solid rgba(127,127,127,.16);border-radius:12px;padding:8px 10px}
.pm-stat small{display:block;font-size:11px;opacity:.6}.pm-stat b{font-size:17px}
.pm-grid{display:grid;grid-template-columns:1fr 1fr;gap:14px;align-items:start}
.pm-col{display:flex;flex-direction:column;gap:14px;min-width:0}
.pm-card{border:1px solid rgba(127,127,127,.16);border-radius:16px;padding:14px 16px;display:flex;flex-direction:column;gap:10px;min-width:0}
.pm-card h3{margin:0;font-size:14px;font-weight:800;display:flex;gap:8px;align-items:baseline}
.pm-card h3 em{font-style:normal;font-weight:500;font-size:12px;opacity:.6}
.pm-card label{display:flex;flex-direction:column;gap:4px;font-size:11px;text-transform:uppercase;letter-spacing:.04em}
.pm-card label em{font-style:normal;text-transform:none;opacity:.7;margin-left:6px}.pm-card label em.warn{color:#b45309;opacity:1}.pm-card label em.bad{color:#b91c1c;opacity:1}
.pm-card input,.pm-card textarea{font:inherit;font-size:14px;text-transform:none;letter-spacing:0;padding:9px 11px;border-radius:10px;border:1px solid rgba(127,127,127,.28);background:transparent;color:inherit;resize:vertical;transition:border-color .15s,transform .15s}
.pm-card input:hover:not(:disabled),.pm-card textarea:hover:not(:disabled){border-color:var(--brand-primary,#101828);transform:translateY(-1px)}
.pm-card input:disabled,.pm-card textarea:disabled{opacity:.6}
.pm-read em{font-style:normal;margin-left:6px;opacity:.8}.pm-read em.warn{color:#b45309}
.pm-read span{font-size:11px;text-transform:uppercase;letter-spacing:.04em;opacity:.7}.pm-read p{margin:2px 0 0;font-size:14px}
.pm-mini{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:12px;opacity:.8;word-break:break-all}
.pm-serp{display:block;padding:12px 14px;border-radius:12px;background:rgba(127,127,127,.06);color:inherit;text-decoration:none;transition:transform .15s,box-shadow .15s}
.pm-serp:hover{transform:translateY(-1px);box-shadow:0 4px 14px rgba(0,0,0,.08)}.pm-serp:hover b{text-decoration:underline}
.pm-serp small{font-size:12px;opacity:.7}.pm-serp b{display:block;color:#1a0dab;font-size:18px;font-weight:500;margin:3px 0;line-height:1.3}.pm-serp p{margin:0;font-size:13.5px;opacity:.85;line-height:1.45}
body.f2b-dark .pm-serp b,.dark-mode .pm-serp b,html.dark .pm-serp b{color:#8ab4f8}
.pm-foot{display:flex;align-items:center;gap:10px;flex-wrap:wrap}.pm-foot small{font-size:12.5px;opacity:.75}
.pm .pm-btn{padding:8px 15px;border-radius:999px;border:0;background:var(--brand-primary,#101828) !important;color:#fff !important;-webkit-text-fill-color:#fff !important;font:inherit;font-size:13px;font-weight:700;cursor:pointer;transition:transform .15s,box-shadow .15s}
.pm .pm-btn:hover:not(:disabled){transform:translateY(-1px);box-shadow:0 4px 12px rgba(0,0,0,.15)}
.pm .pm-btn:disabled,.pm .pm-ghost:disabled{opacity:.45;cursor:default}
.pm .pm-ghost{padding:7px 14px;border-radius:999px;border:1px solid rgba(127,127,127,.3);background:transparent;color:inherit;font:inherit;font-size:13px;font-weight:600;cursor:pointer;text-decoration:none;transition:transform .15s,border-color .15s}
.pm .pm-ghost:hover:not(:disabled){transform:translateY(-1px);border-color:var(--brand-primary,#101828)}
.pm-link{border:0;background:none;color:inherit;font:inherit;font-size:12px;text-decoration:underline;opacity:.75;cursor:pointer;white-space:nowrap}.pm-link:hover{opacity:1}
.pm-note{margin:0;font-size:13px;opacity:.7}.pm .bad{color:#b91c1c}.pm .good{color:#15803d;font-weight:700}
.pm-chips{display:flex;flex-wrap:wrap;gap:6px;align-items:center}.pm-chips small{width:100%;font-size:11px;opacity:.6}
.pm-chips.ro span{font-size:12.5px;font-weight:600;padding:4px 10px;border-radius:999px;border:1px solid rgba(127,127,127,.25)}
.pm-chips button{font:inherit;font-size:12.5px;font-weight:600;padding:4px 10px;border-radius:999px;border:1px solid rgba(127,127,127,.25);background:transparent;color:inherit;cursor:pointer;transition:transform .15s,border-color .15s}
.pm-chips button:hover{transform:translateY(-1px);border-color:var(--brand-primary,#101828)}
.pm table{width:100%;border-collapse:collapse;font-size:13px}
.pm th{text-align:right;font-weight:600;font-size:11px;opacity:.6;padding:4px 6px;border-bottom:1px solid rgba(127,127,127,.18)}
.pm td{text-align:right;padding:6px;border-bottom:1px solid rgba(127,127,127,.08)}
.pm th:first-child,.pm td:first-child{text-align:left}
.pm-new{margin-left:6px;font-size:10px;font-weight:700;text-transform:uppercase;padding:1px 6px;border-radius:999px;background:#dcfce7;color:#166534}
.pm-summary{margin:0;font-size:13.5px;line-height:1.5}
.pm-recs{margin:0;padding:0;list-style:none;display:flex;flex-direction:column;gap:8px}
.pm-recs li{border:1px solid rgba(127,127,127,.16);border-left:3px solid #94a3b8;border-radius:10px;padding:9px 11px}
.pm-recs li.high{border-left-color:#dc2626}.pm-recs li.medium{border-left-color:#d97706}.pm-recs li.low{border-left-color:#16a34a}
.pm-recs li div{display:flex;gap:8px;align-items:center}.pm-recs li b{font-size:13.5px}
.pm-recs li p{margin:4px 0 0;font-size:13px;opacity:.85;line-height:1.45}.pm-recs .pm-act{opacity:1;font-weight:600}
.pm-pri{font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;padding:1px 7px;border-radius:999px;background:#f1f5f9;color:#475569}
.pm-pri.high{background:#fee2e2;color:#991b1b}.pm-pri.medium{background:#fef3c7;color:#92400e}.pm-pri.low{background:#dcfce7;color:#166534}
.pm-suggest{border-radius:12px;background:rgba(127,127,127,.06);padding:10px 12px;display:flex;flex-direction:column;gap:6px;align-items:flex-start}
.pm-suggest small{font-size:11px;text-transform:uppercase;letter-spacing:.05em;opacity:.6}
.pm-suggest p{margin:0;font-size:13px}.pm-suggest p span{display:inline-block;min-width:84px;font-size:11px;opacity:.6;text-transform:uppercase}
.pm-pulse{animation:pmPulse 1.2s ease-in-out infinite}@keyframes pmPulse{50%{opacity:.35}}
@media (max-width:900px){.pm-overlay{padding:0}.pm{border-radius:0;min-height:100%;padding:16px 14px 28px}.pm-grid{grid-template-columns:1fr}.pm-stats{grid-template-columns:repeat(4,minmax(0,1fr))}.pm-head h2{font-size:18px}.pm-card input,.pm-card textarea{font-size:16px}.pm td:nth-child(5),.pm th:nth-child(5){display:none}}
`;
