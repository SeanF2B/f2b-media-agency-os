"use client";

import { useMemo, useState } from "react";

export type SavedKeyword = { id: string; keyword: string; location: string; geo: string; language: string; groupId: string; tags: string[]; avgMonthlySearches: number | null; competition: string; competitionIndex: number | null; lowTopOfPageBid: number | null; highTopOfPageBid: number | null; difficulty: number | null; source: string; metricsSource: string; lastCheckedAt: string | null; createdAt: string };
export type KeywordGroup = { id: string; name: string; sortOrder: number };
export type SavedKeywordData = { groups: KeywordGroup[]; keywords: SavedKeyword[]; tags: string[] };
export type SavedKeywordCall = (body: Record<string, unknown>) => Promise<boolean>;

const num = (value: number | null | undefined) => value == null ? "—" : value.toLocaleString("en-IE", { maximumFractionDigits: 0 });
const bid = (low: number | null, high: number | null) => low == null || high == null ? "—" : `${low.toFixed(2)}–${high.toFixed(2)}`;
export function competitionLevel(value: string) { const c = String(value || "").toLowerCase(); return c.includes("high") ? "high" : c.includes("medium") ? "medium" : c.includes("low") ? "low" : "unknown"; }
export const competitionLabel = { high: "High", medium: "Medium", low: "Low", unknown: "—" } as const;

type Sort = "volume" | "cpc" | "competition" | "keyword" | "checked";
const UNGROUPED = "__ungrouped";

/** Saved keywords for one client, organised into groups. All changes go through `call` (the saved-keywords API). */
export function SavedKeywordsPanel({ clientId, clientName, data, busy, message, call, onCreateTask }: {
  clientId: string; clientName: string; data: SavedKeywordData | null; busy: boolean; message: string; call: SavedKeywordCall;
  onCreateTask: (title: string, notes: string, checklist: string) => void;
}) {
  const [groupView, setGroupView] = useState("all");
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [tagFilter, setTagFilter] = useState("");
  const [competition, setCompetition] = useState("");
  const [minVolume, setMinVolume] = useState("");
  const [maxCpc, setMaxCpc] = useState("");
  const [sort, setSort] = useState<Sort>("volume");
  const [newGroup, setNewGroup] = useState("");
  const [renaming, setRenaming] = useState("");
  const [renameValue, setRenameValue] = useState("");
  const [moveTo, setMoveTo] = useState("");
  const [tagChoice, setTagChoice] = useState("");
  const [rankNote, setRankNote] = useState("");

  const groups = data?.groups || [];
  const keywords = data?.keywords || [];
  const groupName = (id: string) => groups.find((group) => group.id === id)?.name || "Ungrouped";
  const counts = useMemo(() => { const map = new Map<string, number>(); for (const item of keywords) map.set(item.groupId || UNGROUPED, (map.get(item.groupId || UNGROUPED) || 0) + 1); return map; }, [keywords]);

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase(); const min = Number(minVolume) || 0; const max = maxCpc === "" ? Infinity : Number(maxCpc);
    const order = { low: 0, medium: 1, high: 2, unknown: 3 } as const;
    return keywords.filter((item) => (groupView === "all" || (groupView === UNGROUPED ? !item.groupId : item.groupId === groupView))
      && (!q || item.keyword.toLowerCase().includes(q)) && (!tagFilter || item.tags.includes(tagFilter))
      && (!competition || competitionLevel(item.competition) === competition) && (item.avgMonthlySearches || 0) >= min
      && (max === Infinity || (item.highTopOfPageBid ?? 0) <= max))
      .sort((a, b) => sort === "keyword" ? a.keyword.localeCompare(b.keyword) : sort === "cpc" ? (b.highTopOfPageBid || 0) - (a.highTopOfPageBid || 0) : sort === "competition" ? order[competitionLevel(a.competition)] - order[competitionLevel(b.competition)] : sort === "checked" ? String(b.lastCheckedAt).localeCompare(String(a.lastCheckedAt)) : (b.avgMonthlySearches || 0) - (a.avgMonthlySearches || 0));
  }, [keywords, groupView, query, tagFilter, competition, minVolume, maxCpc, sort]);

  const selected = keywords.filter((item) => picked.has(item.id));
  const ids = [...picked];
  const act = async (body: Record<string, unknown>, clear = false) => { const ok = await call(body); if (ok && clear) setPicked(new Set()); return ok; };

  const sendToRankTracking = async () => {
    if (!selected.length) return;
    setRankNote("Adding to rank tracking…");
    const byLocation = new Map<string, SavedKeyword[]>();
    for (const item of selected) byLocation.set(item.location, [...(byLocation.get(item.location) || []), item]);
    let added = 0; const errors: string[] = [];
    for (const [location, list] of byLocation) {
      const response = await fetch("/api/seo/rank-tracking", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId, action: "add", keywords: list.map((item) => item.keyword), location, device: "desktop", group: list[0].groupId ? groupName(list[0].groupId) : "" }) });
      const json = await response.json().catch(() => ({})) as { added?: number; error?: string };
      if (!response.ok) errors.push(json.error || `Couldn’t add keywords for ${location}.`); else added += json.added || 0;
    }
    setRankNote(errors.length ? errors.join(" ") : `${added} keyword${added === 1 ? "" : "s"} added to rank tracking (existing ones are skipped). Open Rankings to check positions.`);
  };

  const batchTask = () => {
    if (!selected.length) return;
    const lines = selected.map((item) => `- ${item.keyword} · ${item.location} · ${num(item.avgMonthlySearches)}/mo · CPC ${bid(item.lowTopOfPageBid, item.highTopOfPageBid)} · ${competitionLabel[competitionLevel(item.competition)]} competition${item.tags.length ? ` · ${item.tags.join(", ")}` : ""} · ${groupName(item.groupId)}`);
    onCreateTask(`Review ${selected.length} saved keyword${selected.length === 1 ? "" : "s"} for ${clientName}`, `Client: ${clientName}\nKeywords (${selected.length}):\n${lines.join("\n")}\n\nMetrics are estimates from ${[...new Set(selected.map((item) => item.metricsSource || item.source))].join(", ")}.`, "Check each keyword fits the client’s services and target area\nMap keywords to existing or new pages\nDecide which go to SEO, Google Ads or negatives\nGet approval before changing the site or ads");
  };

  return <section className="saved-kw">
    <aside className="saved-kw-groups" aria-label="Keyword groups">
      {[["all", "All keywords", keywords.length], [UNGROUPED, "Ungrouped", counts.get(UNGROUPED) || 0]].map(([id, label, count]) => <button type="button" key={id as string} className={groupView === id ? "active" : ""} onClick={() => setGroupView(id as string)}><span>{label}</span><b>{count}</b></button>)}
      {groups.map((group, index) => renaming === group.id
        ? <form key={group.id} className="saved-kw-rename" onSubmit={(event) => { event.preventDefault(); void act({ action: "renameGroup", groupId: group.id, name: renameValue }).then((ok) => { if (ok) setRenaming(""); }); }}><input autoFocus value={renameValue} onChange={(event) => setRenameValue(event.target.value)} aria-label="Group name" /><button type="submit" className="text-button">Save</button></form>
        : <div key={group.id} className={`saved-kw-group ${groupView === group.id ? "active" : ""}`}>
          <button type="button" onClick={() => setGroupView(group.id)}><span>{group.name}</span><b>{counts.get(group.id) || 0}</b></button>
          <details className="saved-kw-group-menu"><summary aria-label={`Options for ${group.name}`}>⋯</summary><div>
            <button type="button" onClick={() => { setRenaming(group.id); setRenameValue(group.name); }}>Rename</button>
            <button type="button" disabled={index === 0} onClick={() => { const order = groups.map((item) => item.id); [order[index - 1], order[index]] = [order[index], order[index - 1]]; void act({ action: "reorderGroups", order }); }}>Move up</button>
            <button type="button" disabled={index === groups.length - 1} onClick={() => { const order = groups.map((item) => item.id); [order[index + 1], order[index]] = [order[index], order[index + 1]]; void act({ action: "reorderGroups", order }); }}>Move down</button>
            <button type="button" className="danger" onClick={() => { if (window.confirm(`Delete the group “${group.name}”? Its keywords move to Ungrouped.`)) void act({ action: "deleteGroup", groupId: group.id }).then(() => { if (groupView === group.id) setGroupView("all"); }); }}>Delete group</button>
          </div></details>
        </div>)}
      <form className="saved-kw-new" onSubmit={(event) => { event.preventDefault(); if (!newGroup.trim()) return; void act({ action: "createGroup", name: newGroup }).then((ok) => { if (ok) setNewGroup(""); }); }}><input value={newGroup} onChange={(event) => setNewGroup(event.target.value)} placeholder="New group, e.g. Extensions" aria-label="New group name" /><button type="submit" className="secondary-button" disabled={!newGroup.trim() || busy}>Add</button></form>
    </aside>

    <div className="saved-kw-main">
      <div className="kw-filters">
        <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search saved keywords" aria-label="Search saved keywords" />
        <label><span>Min. volume</span><input type="number" min={0} value={minVolume} onChange={(event) => setMinVolume(event.target.value)} placeholder="0" /></label>
        <label><span>Max. CPC</span><input type="number" min={0} step="0.1" value={maxCpc} onChange={(event) => setMaxCpc(event.target.value)} placeholder="Any" /></label>
        <label><span>Competition</span><select value={competition} onChange={(event) => setCompetition(event.target.value)}><option value="">Any</option><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label>
        <label><span>Tag</span><select value={tagFilter} onChange={(event) => setTagFilter(event.target.value)}><option value="">Any</option>{(data?.tags || []).map((tag) => <option key={tag}>{tag}</option>)}</select></label>
        <label><span>Sort</span><select value={sort} onChange={(event) => setSort(event.target.value as Sort)}><option value="volume">Search volume</option><option value="cpc">CPC</option><option value="competition">Competition</option><option value="keyword">A–Z</option><option value="checked">Last checked</option></select></label>
      </div>

      {picked.size > 0 && <div className="kw-bulk" role="toolbar" aria-label="Bulk actions for selected keywords">
        <b>{picked.size} selected</b>
        <span className="kw-bulk-group"><select aria-label="Move selected to group" value={moveTo} onChange={(event) => setMoveTo(event.target.value)}><option value="">Move to…</option><option value={UNGROUPED}>Ungrouped</option>{groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select><button type="button" className="secondary-button" disabled={!moveTo || busy} onClick={() => void act({ action: "move", ids, groupId: moveTo === UNGROUPED ? "" : moveTo }).then(() => setMoveTo(""))}>Move</button></span>
        <span className="kw-bulk-group"><select aria-label="Tag selected keywords" value={tagChoice} onChange={(event) => setTagChoice(event.target.value)}><option value="">Tag…</option>{(data?.tags || []).map((tag) => <option key={tag}>{tag}</option>)}</select><button type="button" className="secondary-button" disabled={!tagChoice || busy} onClick={() => void act({ action: "tag", ids, add: [tagChoice] })}>Add tag</button><button type="button" className="text-button" disabled={!tagChoice || busy} onClick={() => void act({ action: "tag", ids, remove: [tagChoice] })}>Remove tag</button></span>
        <button type="button" className="secondary-button" disabled={busy} onClick={() => void act({ action: "refresh", ids })} title="Re-check search volume, CPC and competition in Google Keyword Planner">↻ Refresh metrics</button>
        <button type="button" className="secondary-button" disabled={busy} onClick={() => void sendToRankTracking()}>Send to rank tracking</button>
        <button type="button" className="primary-button" onClick={batchTask}>Create review task</button>
        <button type="button" className="text-button danger" disabled={busy} onClick={() => { if (window.confirm(`Remove ${picked.size} keyword(s) from saved keywords?`)) void act({ action: "remove", ids }, true); }}>Remove</button>
        <button type="button" className="text-button" onClick={() => setPicked(new Set())}>Clear</button>
      </div>}
      {(message || rankNote) && <p className="kw-note" role="status">{[message, rankNote].filter(Boolean).join(" ")}</p>}

      {!data ? <p className="kw-empty">Loading saved keywords…</p> : !keywords.length ? <p className="kw-empty">No saved keywords for {clientName} yet. Run research, tick keywords and choose “Save”.</p> : !visible.length ? <p className="kw-empty">No saved keywords match these filters.</p> :
        <div className="kw-table-wrap"><table className="kw-table">
          <thead><tr><th className="kw-check"><input type="checkbox" aria-label="Select all shown" checked={visible.every((item) => picked.has(item.id))} onChange={(event) => setPicked((current) => { const next = new Set(current); visible.forEach((item) => event.target.checked ? next.add(item.id) : next.delete(item.id)); return next; })} /></th><th>Keyword</th><th>Volume</th><th>CPC</th><th>Competition</th><th>Tags</th>{groupView === "all" && <th>Group</th>}<th>Location</th><th>Source · checked</th></tr></thead>
          <tbody>{visible.map((item) => { const level = competitionLevel(item.competition); return <tr key={item.id} className={picked.has(item.id) ? "picked" : ""}>
            <td className="kw-check"><input type="checkbox" aria-label={`Select ${item.keyword}`} checked={picked.has(item.id)} onChange={() => setPicked((current) => { const next = new Set(current); if (next.has(item.id)) next.delete(item.id); else next.add(item.id); return next; })} /></td>
            <td><b>{item.keyword}</b>{item.difficulty != null && <small>SEO difficulty {item.difficulty}/100</small>}</td>
            <td className="num">{num(item.avgMonthlySearches)}</td>
            <td className="num">{bid(item.lowTopOfPageBid, item.highTopOfPageBid)}</td>
            <td><span className={`kw-comp ${level}`}>{competitionLabel[level]}</span></td>
            <td>{item.tags.map((tag) => <span key={tag} className={`kw-tag kw-tag-${tag.toLowerCase().replace(/\s+/g, "-")}`}>{tag}</span>)}</td>
            {groupView === "all" && <td>{groupName(item.groupId)}</td>}
            <td>{item.location}</td>
            <td><small>{item.metricsSource || item.source}{item.metricsSource && item.metricsSource !== item.source ? ` (found via ${item.source})` : ""} · {item.lastCheckedAt ? new Date(item.lastCheckedAt).toLocaleDateString("en-IE", { day: "numeric", month: "short", year: "numeric" }) : "—"}</small></td>
          </tr>; })}</tbody>
        </table></div>}
    </div>
  </section>;
}
