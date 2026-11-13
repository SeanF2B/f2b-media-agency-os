"use client";

import { useEffect, useMemo, useState } from "react";

type History = { at: string; position: number | null; url: string | null; competitors: Record<string, number | null>; error: string | null };
type Tracked = { id: string; keyword: string; location: string; device: string; grp: string; history: History[] };

// Google rank tracking — location-specific SERP positions from DataForSEO (not Search Console averages).
export function RankTrackingPanel({ clientId, clientName, defaultLocation }: { clientId: string; clientName: string; defaultLocation: string }) {
  const [rows, setRows] = useState<Tracked[]>([]);
  const [host, setHost] = useState("");
  const [input, setInput] = useState("");
  const [location, setLocation] = useState(defaultLocation === "Ireland" ? "Ireland" : `${defaultLocation},Ireland`);
  const [device, setDevice] = useState("desktop");
  const [group, setGroup] = useState("");
  const [competitors, setCompetitors] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState("");
  const [filter, setFilter] = useState("");
  const call = async (body: Record<string, unknown>) => {
    const response = await fetch("/api/seo/rank-tracking", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId, ...body }) });
    const json = await response.json().catch(() => ({})) as { error?: string; status?: string; message?: string; keywords?: Tracked[]; costUsd?: number; checked?: number; added?: number };
    return { response, json };
  };
  useEffect(() => { fetch(`/api/seo/rank-tracking?clientId=${encodeURIComponent(clientId)}`, { cache: "no-store" }).then((r) => r.json()).then((json: { keywords?: Tracked[]; clientHost?: string }) => { setRows(json.keywords || []); setHost(json.clientHost || ""); }).catch(() => undefined); }, [clientId]);
  const add = async () => {
    setBusy(true); setMsg("");
    const { response, json } = await call({ action: "add", keywords: input.split(/[\n,]/), location, device, group });
    setBusy(false);
    if (!response.ok) { setMsg(json.error || "Couldn’t add keywords."); return; }
    setRows(json.keywords || []); setInput(""); setMsg(`${json.added} keyword(s) added. Click “Check rankings” to get positions.`);
  };
  const check = async (ids?: string[]) => {
    setBusy(true); setMsg("");
    const comp = competitors.split(",").map((item) => item.trim()).filter(Boolean);
    let { response, json } = await call({ action: "check", ids, competitors: comp });
    if (response.status === 409 && json.status === "confirmation_required") {
      if (!window.confirm(json.message || "Run paid ranking checks?")) { setBusy(false); return; }
      ({ response, json } = await call({ action: "check", ids, competitors: comp, acknowledgeCost: true }));
    }
    setBusy(false);
    if (!response.ok) { setMsg(json.error || "Check failed."); return; }
    setRows(json.keywords || []); setMsg(`Checked ${json.checked} keyword(s) · DataForSEO cost $${(json.costUsd || 0).toFixed(3)}.`);
  };
  const remove = async (id: string) => { const { json } = await call({ action: "remove", ids: [id] }); setRows(json.keywords || []); };
  const visible = rows.filter((row) => !filter || row.keyword.includes(filter.toLowerCase()) || row.grp.toLowerCase().includes(filter.toLowerCase()));
  const latest = rows.map((row) => row.history.find((h) => !h.error)?.position ?? null);
  const bucket = (max: number) => latest.filter((p) => p != null && p <= max).length;
  const compHosts = useMemo(() => [...new Set(rows.flatMap((row) => Object.keys(row.history[0]?.competitors || {})))], [rows]);
  const exportCsv = () => {
    const lines = [["Keyword", "Group", "Location", "Device", "Position", "Previous", "URL", "Checked", ...compHosts].join(",")];
    rows.forEach((row) => { const [now, prev] = row.history.filter((h) => !h.error); lines.push([row.keyword, row.grp, row.location, row.device, now?.position ?? "", prev?.position ?? "", now?.url ?? "", now?.at ?? "", ...compHosts.map((h) => now?.competitors?.[h] ?? "")].map((v) => `"${String(v).replace(/"/g, '""')}"`).join(",")); });
    const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" })); const a = document.createElement("a"); a.href = url; a.download = `${clientName}-rankings.csv`; a.click(); URL.revokeObjectURL(url);
  };

  return <div className="rank">
    <div className="aiv-form">
      <label className="aiv-wide"><span>Keywords to track (one per line or comma-separated)</span><textarea rows={2} value={input} onChange={(event) => setInput(event.target.value)} placeholder="roof repair galway, roofers near me" /></label>
      <label><span>Location (DataForSEO name, e.g. Galway,Ireland)</span><input value={location} onChange={(event) => setLocation(event.target.value)} /></label>
      <label><span>Device</span><select value={device} onChange={(event) => setDevice(event.target.value)}><option value="desktop">Desktop</option><option value="mobile">Mobile</option></select></label>
      <label><span>Group (optional)</span><input value={group} onChange={(event) => setGroup(event.target.value)} placeholder="Services, Areas…" /></label>
      <label><span>Competitor websites to compare</span><input value={competitors} onChange={(event) => setCompetitors(event.target.value)} placeholder="competitor.ie, other.ie" /></label>
      <span className="rank-actions"><button type="button" className="secondary-button" disabled={busy || !input.trim()} onClick={() => void add()}>Add keywords</button><button type="button" className="primary-button" disabled={busy || !rows.length} onClick={() => void check()}>{busy ? "Working…" : "Check rankings"}</button>{rows.length > 0 && <button type="button" className="text-button" onClick={exportCsv}>Export CSV</button>}</span>
    </div>
    {msg && <p className="ops-notice" role="status">{msg}</p>}
    <p className="muted aiv-note">Live Google positions for {host || "the client’s website"} from DataForSEO, per location and device. This is separate from Search Console’s average position. Each keyword is checked at most once a day; up to 50 keywords per client.</p>
    {rows.length > 0 && <div className="ops-summary"><div><b>{bucket(3)}</b><span>In top 3</span></div><div><b>{bucket(10)}</b><span>In top 10</span></div><div><b>{bucket(20)}</b><span>In top 20</span></div><div><b>{latest.filter((p) => p == null).length}</b><span>Not in top 100 / not checked</span></div></div>}
    {rows.length > 0 && <div className="ops-toolbar"><input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Search keywords or groups…" /></div>}
    {rows.length > 0 && <div className="ops-table-wrap"><table className="ops-table">
      <thead><tr><th>Keyword</th><th>Position</th><th>Change</th><th>Trend</th><th>Ranking URL</th>{compHosts.map((h) => <th key={h}>{h}</th>)}<th>Checked</th><th></th></tr></thead>
      <tbody>{visible.map((row) => { const ok = row.history.filter((h) => !h.error); const [now, prev] = ok; const change = now?.position != null && prev?.position != null ? prev.position - now.position : null; const err = row.history[0]?.error; const spark = ok.slice(0, 12).reverse(); return <tr key={row.id}>
        <td><b>{row.keyword}</b><small className="muted">{[row.grp, row.location, row.device].filter(Boolean).join(" · ")}</small></td>
        <td>{now ? (now.position ?? ">100") : "—"}</td>
        <td>{change == null ? "—" : change > 0 ? <span className="aiv-yes">▲ {change}</span> : change < 0 ? <span className="aiv-no">▼ {-change}</span> : "="}{change != null && Math.abs(change) >= 5 && <small className="rank-alert"> big move</small>}</td>
        <td><span className="rank-spark">{spark.map((h, i) => <i key={i} title={`${new Date(h.at).toLocaleDateString("en-IE")}: ${h.position ?? ">100"}`} style={{ height: `${h.position ? Math.max(8, 100 - h.position) : 4}%` }} />)}</span></td>
        <td className="rank-url">{now?.url ? <a href={now.url} target="_blank" rel="noreferrer">{now.url.replace(/^https?:\/\/(www\.)?/, "")}</a> : err ? <span className="ops-error">{err}</span> : "—"}</td>
        {compHosts.map((h) => <td key={h}>{now?.competitors?.[h] ?? "—"}</td>)}
        <td>{row.history[0] ? new Date(row.history[0].at).toLocaleDateString("en-IE", { day: "numeric", month: "short" }) : "Never"}</td>
        <td className="ops-actions"><button type="button" className="text-button" disabled={busy} onClick={() => void check([row.id])}>Check</button><button type="button" className="text-button" onClick={() => void remove(row.id)}>Remove</button></td>
      </tr>; })}</tbody>
    </table></div>}
    {!rows.length && <p className="ops-empty">No tracked keywords for {clientName} yet.</p>}
  </div>;
}
