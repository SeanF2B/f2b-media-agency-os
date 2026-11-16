"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type MutableRefObject } from "react";
import { appConfirm } from "./app-dialog";
import { competitionLabel, competitionLevel, type SavedKeywordData } from "./saved-keywords-panel";

// Reports → Keywords: search keyword ideas, tick them, add to a group, then pick which groups go in the report.
// Uses the same APIs as SEO → Keywords (Google Ads Keyword Planner + saved keywords), so both stay in sync.

type Idea = { keyword: string; avgMonthlySearches: number | null; competition: string; competitionIndex: number | null; lowTopOfPageBid: number | null; highTopOfPageBid: number | null; difficulty?: number | null };
const num = (v: number | null | undefined) => v == null ? "—" : v.toLocaleString("en-IE");
const bid = (lo: number | null, hi: number | null) => lo == null && hi == null ? "—" : `€${(lo ?? 0).toFixed(2)}–€${(hi ?? lo ?? 0).toFixed(2)}`;
const NEW_GROUP = "__new__";

// Saves ticked keywords into a group when Generate preview is pressed before anything was grouped, and returns the groups to report on.
export type KeywordPrepare = () => Promise<string[]>;

export function KeywordReportBuilder({ clientId, clientName, picked, onPicked, prepareRef, onTicked }: { clientId: string; clientName: string; picked: string[]; onPicked: (ids: string[]) => void; prepareRef?: MutableRefObject<KeywordPrepare | null>; onTicked?: (count: number) => void }) {
  const [saved, setSaved] = useState<SavedKeywordData | null>(null);
  const [seeds, setSeeds] = useState("");
  const [area, setArea] = useState("Ireland");
  const [ideas, setIdeas] = useState<Idea[] | null>(null);
  const [location, setLocation] = useState("Ireland");
  const [ticked, setTicked] = useState<Set<string>>(new Set());
  const [groupId, setGroupId] = useState("");
  const [newGroup, setNewGroup] = useState("");
  const [busy, setBusy] = useState("");
  const [msg, setMsg] = useState("");
  const [scan, setScan] = useState<{ site: string; summary: string } | null>(null);
  const scanned = useRef("");

  const loadSaved = useCallback(async () => {
    try { const r = await fetch(`/api/seo/saved-keywords?clientId=${encodeURIComponent(clientId)}`, { cache: "no-store" }); if (r.ok) setSaved(await r.json() as SavedKeywordData); } catch { /* shown as empty */ }
  }, [clientId]);
  useEffect(() => { setIdeas(null); setTicked(new Set()); setMsg(""); setScan(null); void loadSaved(); }, [loadSaved]);
  useEffect(() => { onTicked?.(ticked.size); }, [ticked, onTicked]);

  // AI reads the client's own website and fills in the services to research (cached per client so it's one AI call).
  const scanSite = useCallback(async (auto = false) => {
    const cacheKey = `f2b-kw-seeds:${clientId}`;
    if (auto) { try { const hit = JSON.parse(window.localStorage.getItem(cacheKey) || "null") as { seeds: string[]; area: string; site: string; summary: string } | null; if (hit?.seeds?.length) { setSeeds(hit.seeds.join(", ")); if (hit.area) setArea(hit.area); setScan({ site: hit.site, summary: hit.summary }); return; } } catch { /* no cache */ } }
    setBusy("scan"); if (!auto) setMsg("");
    try {
      const r = await fetch("/api/seo/keyword-seeds", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId }) });
      const j = await r.json().catch(() => ({})) as { seeds?: string[]; area?: string; website?: string; summary?: string; error?: string };
      if (!r.ok || !j.seeds?.length) throw new Error(j.error || "Couldn't scan the website.");
      setSeeds((cur) => auto && cur.trim() ? cur : j.seeds!.join(", ")); if (j.area) setArea(j.area);
      setScan({ site: j.website || "", summary: j.summary || "" });
      try { window.localStorage.setItem(cacheKey, JSON.stringify({ seeds: j.seeds, area: j.area || "", site: j.website || "", summary: j.summary || "" })); } catch { /* storage unavailable */ }
    } catch (e) { if (!auto) setMsg(e instanceof Error ? e.message : "Couldn't scan the website."); }
    finally { setBusy((b) => b === "scan" ? "" : b); }
  }, [clientId]);
  useEffect(() => { if (scanned.current === clientId) return; scanned.current = clientId; void scanSite(true); }, [clientId, scanSite]);

  // Every group is in the report unless you untick it.
  const groupIds = useMemo(() => [...(saved?.groups || []).map((g) => g.id), ...((saved?.keywords || []).some((k) => !k.groupId) ? ["ungrouped"] : [])], [saved]);
  useEffect(() => { if (groupIds.length && !picked.length) onPicked(groupIds); }, [groupIds]); // eslint-disable-line react-hooks/exhaustive-deps

  const savedKeys = useMemo(() => new Set((saved?.keywords || []).map((k) => k.keyword.toLowerCase())), [saved]);

  const search = async () => {
    const list = seeds.split(/[\n,]+/).map((s) => s.trim()).filter(Boolean).slice(0, 10);
    if (!list.length) { setMsg("Type a service or topic first, e.g. boiler repair, heat pump installation."); return; }
    setBusy("search"); setMsg("");
    try {
      const r = await fetch("/api/seo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId, seeds: list, geo: "2372", locationName: area.trim() || "Ireland" }) });
      const j = await r.json() as { results?: Idea[]; location?: string; error?: string; message?: string };
      if (!r.ok) throw new Error(j.error || j.message || "Keyword ideas couldn't be found.");
      setIdeas(j.results || []); setLocation(j.location || area || "Ireland"); setTicked(new Set());
      if (!j.results?.length) setMsg("No ideas came back. Try broader words.");
    } catch (e) { setMsg(e instanceof Error ? e.message : "Keyword ideas couldn't be found."); }
    finally { setBusy(""); }
  };

  const call = async (body: Record<string, unknown>) => {
    const r = await fetch("/api/seo/saved-keywords", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId, ...body }) });
    const j = await r.json().catch(() => ({})) as SavedKeywordData & { message?: string; error?: string };
    if (!r.ok) throw new Error(j.error || "That couldn't be saved.");
    setSaved({ groups: j.groups, keywords: j.keywords, tags: j.tags });
    return j;
  };

  const addToGroup = async () => {
    const rows = (ideas || []).filter((i) => ticked.has(i.keyword));
    if (!rows.length) return;
    setBusy("save"); setMsg("");
    try {
      let target = groupId === NEW_GROUP ? "" : groupId;
      if (groupId === NEW_GROUP) {
        const name = newGroup.trim(); if (!name) throw new Error("Name the new group first.");
        const after = await call({ action: "createGroup", name });
        target = after.groups.find((g) => g.name.toLowerCase() === name.toLowerCase())?.id || "";
        if (target && !picked.includes(target)) onPicked([...picked, target]);
        setNewGroup(""); setGroupId(target);
      }
      const j = await call({ action: "save", groupId: target, keywords: rows.map((i) => ({ keyword: i.keyword, location, geo: "2372", language: "English", avgMonthlySearches: i.avgMonthlySearches, competition: i.competition, competitionIndex: i.competitionIndex, lowTopOfPageBid: i.lowTopOfPageBid, highTopOfPageBid: i.highTopOfPageBid, difficulty: i.difficulty ?? null, source: "Google Keyword Planner", checkedAt: new Date().toISOString() })) });
      if (!target && !picked.includes("ungrouped")) onPicked([...picked, "ungrouped"]);
      setTicked(new Set()); setMsg(j.message || "Saved.");
    } catch (e) { setMsg(e instanceof Error ? e.message : "That couldn't be saved."); }
    finally { setBusy(""); }
  };

  // Generate preview with nothing grouped yet: put the ticked keywords in a group named after the search, then report on it.
  const latest = useRef({ ideas, ticked, saved, seeds, picked, location });
  latest.current = { ideas, ticked, saved, seeds, picked, location };
  useEffect(() => {
    if (!prepareRef) return;
    prepareRef.current = async () => {
      const cur = latest.current;
      const rows = (cur.ideas || []).filter((i) => cur.ticked.has(i.keyword));
      if (!rows.length) return cur.picked;
      const name = (cur.seeds.split(/[\n,]+/)[0] || "Keywords").trim().replace(/^./, (c) => c.toUpperCase()).slice(0, 60);
      const existing = (cur.saved?.groups || []).find((g) => g.name.toLowerCase() === name.toLowerCase());
      const after = existing ? null : await call({ action: "createGroup", name });
      const target = existing?.id || after?.groups.find((g) => g.name.toLowerCase() === name.toLowerCase())?.id || "";
      await call({ action: "save", groupId: target, keywords: rows.map((i) => ({ keyword: i.keyword, location: cur.location, geo: "2372", language: "English", avgMonthlySearches: i.avgMonthlySearches, competition: i.competition, competitionIndex: i.competitionIndex, lowTopOfPageBid: i.lowTopOfPageBid, highTopOfPageBid: i.highTopOfPageBid, difficulty: i.difficulty ?? null, source: "Google Keyword Planner", checkedAt: new Date().toISOString() })) });
      setTicked(new Set());
      const ids = [...new Set([...cur.picked, target || "ungrouped"])];
      onPicked(ids);
      return ids;
    };
    return () => { prepareRef.current = null; };
  }); // eslint-disable-line react-hooks/exhaustive-deps

  const groups = [...(saved?.groups || []).map((g) => ({ id: g.id, name: g.name })), ...((saved?.keywords || []).some((k) => !k.groupId) ? [{ id: "ungrouped", name: "Ungrouped" }] : [])];
  const inGroup = (id: string) => (saved?.keywords || []).filter((k) => (id === "ungrouped" ? !k.groupId : k.groupId === id)).sort((a, b) => (b.avgMonthlySearches || 0) - (a.avgMonthlySearches || 0));
  // Delete a group and the keywords in it (or clear Ungrouped). Asks first.
  const deleteGroup = async (id: string, name: string) => {
    const list = inGroup(id);
    if (!(await appConfirm(`Delete the “${name}” group and its ${list.length} keyword${list.length === 1 ? "" : "s"}?`))) return;
    setBusy("delete"); setMsg("");
    try {
      if (list.length) await call({ action: "remove", ids: list.map((k) => k.id) });
      if (id !== "ungrouped") await call({ action: "deleteGroup", groupId: id });
      onPicked(picked.filter((g) => g !== id)); setMsg(`Deleted “${name}”.`);
    } catch (e) { setMsg(e instanceof Error ? e.message : "That group couldn't be deleted."); }
    finally { setBusy(""); }
  };
  const removeKeyword = async (id: string) => { try { await call({ action: "remove", ids: [id] }); } catch (e) { setMsg(e instanceof Error ? e.message : "That keyword couldn't be removed."); } };
  const toggleGroup = (id: string) => onPicked(picked.includes(id) ? picked.filter((g) => g !== id) : [...picked, id]);

  return <div className="krb">
    <div className="krb-step"><span className="krb-n">1</span><div><b>Find keywords</b><small>Services or topics for {clientName}, separated by commas.</small></div></div>
    <form className="krb-search" onSubmit={(e) => { e.preventDefault(); void search(); }}>
      <input value={seeds} onChange={(e) => setSeeds(e.target.value)} placeholder={busy === "scan" ? `Scanning ${clientName}'s website…` : `Services ${clientName} offers, or press Scan website`} aria-label="Services or topics" data-no-ai />
      <input value={area} onChange={(e) => setArea(e.target.value)} placeholder="Ireland" aria-label="Target area" className="krb-area" />
      <button type="button" className="secondary-button krb-scan" disabled={busy === "scan"} onClick={() => void scanSite()} title="AI reads the client's website and fills in the services to research">{busy === "scan" ? "Scanning…" : "✨ Scan website"}</button>
      <button type="submit" className="primary-button" disabled={busy === "search" || busy === "scan"}>{busy === "search" ? "Searching…" : "Find keywords"}</button>
    </form>
    {scan && <p className="krb-scanned">Read from <b>{scan.site}</b>{scan.summary ? ` — ${scan.summary}` : ""} Edit the list if anything's missing.</p>}

    {ideas && ideas.length > 0 && <div className="krb-results">
      <div className="krb-bar">
        <label className="krb-all"><input type="checkbox" checked={ideas.every((i) => ticked.has(i.keyword))} onChange={(e) => setTicked(e.target.checked ? new Set(ideas.map((i) => i.keyword)) : new Set())} /> {ticked.size ? `${ticked.size} ticked` : `${ideas.length} ideas`}</label>
        <span className="krb-legend"><i className="lv-low" />Low <i className="lv-medium" />Medium <i className="lv-high" />High competition</span>
        <span className="krb-spacer" />
        <select value={groupId} onChange={(e) => setGroupId(e.target.value)} aria-label="Group to add to"><option value="">Add to: Ungrouped</option>{(saved?.groups || []).map((g) => <option key={g.id} value={g.id}>Add to: {g.name}</option>)}<option value={NEW_GROUP}>+ New group…</option></select>
        {groupId === NEW_GROUP && <input value={newGroup} onChange={(e) => setNewGroup(e.target.value)} placeholder="Group name" aria-label="New group name" className="krb-newgroup" />}
        <button type="button" className="primary-button" disabled={!ticked.size || busy === "save"} onClick={() => void addToGroup()}>{busy === "save" ? "Adding…" : `Add ${ticked.size || ""} to group`}</button>
      </div>
      <div className="krb-table" role="table" aria-label="Keyword ideas">
        <div className="krb-row head" role="row"><span /><span>Keyword</span><span>Searches / mo</span><span>Competition</span><span>Bid range</span></div>
        {ideas.slice(0, 120).map((i) => { const lv = competitionLevel(i.competition); const isSaved = savedKeys.has(i.keyword.toLowerCase()); return <label key={i.keyword} className={`krb-row lv-${lv}${ticked.has(i.keyword) ? " on" : ""}`} role="row">
          <input type="checkbox" checked={ticked.has(i.keyword)} onChange={() => setTicked((cur) => { const next = new Set(cur); if (next.has(i.keyword)) next.delete(i.keyword); else next.add(i.keyword); return next; })} />
          <span className="krb-kw">{i.keyword}{isSaved && <em>Saved</em>}</span><span>{num(i.avgMonthlySearches)}</span><span><b className={`krb-pill lv-${lv}`}>{competitionLabel[lv]}</b></span><span>{bid(i.lowTopOfPageBid, i.highTopOfPageBid)}</span>
        </label>; })}
      </div>
    </div>}
    {msg && <p className="krb-msg" role="status">{msg}</p>}

    <div className="krb-step"><span className="krb-n">2</span><div><b>Pick the groups for the report</b><small>Ticked groups go into the report. Colours show competition.</small></div></div>
    {!groups.length ? <p className="muted">No keyword groups yet. Find keywords above and add them to a group.</p> : <div className="krb-groups">{groups.map((g) => { const list = inGroup(g.id); const vol = list.reduce((n, k) => n + (k.avgMonthlySearches || 0), 0); return <div key={g.id} className={`krb-group${picked.includes(g.id) ? " on" : ""}`}>
      <label className="krb-group-head"><input type="checkbox" checked={picked.includes(g.id)} onChange={() => toggleGroup(g.id)} /><b>{g.name}</b><small>{list.length} keyword{list.length === 1 ? "" : "s"} · {num(vol)} searches/mo</small><button type="button" className="krb-del" disabled={busy === "delete"} onClick={(e) => { e.preventDefault(); e.stopPropagation(); void deleteGroup(g.id, g.name); }} aria-label={`Delete group ${g.name}`} title="Delete group"><svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3" /></svg></button></label>
      <div className="krb-chips">{list.slice(0, 18).map((k) => { const lv = competitionLevel(k.competition); return <span key={k.id} className={`krb-chip lv-${lv}`} title={`${num(k.avgMonthlySearches)}/mo · ${competitionLabel[lv]} competition · ${bid(k.lowTopOfPageBid, k.highTopOfPageBid)}`}>{k.keyword}<small>{num(k.avgMonthlySearches)}</small><button type="button" className="krb-chip-x" onClick={() => void removeKeyword(k.id)} aria-label={`Remove ${k.keyword}`} title="Remove keyword">×</button></span>; })}{list.length > 18 && <span className="krb-more">+{list.length - 18} more</span>}</div>
    </div>; })}</div>}
    <div className="krb-step"><span className="krb-n">3</span><div><b>Generate the report</b><small>Press Generate preview — ticked keywords are grouped for you if you haven't already.</small></div></div>
  </div>;
}
