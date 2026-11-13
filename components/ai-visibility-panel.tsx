"use client";

import { useEffect, useMemo, useState } from "react";

type Check = { run_id: string; created_at: string; platform: string; model: string; prompt: string; location: string; web_search: number; mentioned: number; position: number | null; cited: number; competitors: string[]; citations: string[]; excerpt: string; error: string | null };
const PLATFORM: Record<string, string> = { chatgpt: "ChatGPT", claude: "Claude" };

// Operations → AI visibility. Sampled answers from ChatGPT- and Claude-family models via the API.
export function AiVisibilityPanel({ clientId, clientName, area, services }: { clientId: string; clientName: string; area: string; services: string[] }) {
  const suggestions = useMemo(() => {
    const topics = services.filter((item) => !/ads|seo|crm|marketing|web design|sites|automation|audit|research|setup/i.test(item)).slice(0, 2);
    const base = topics.length ? topics : ["service"];
    return base.flatMap((topic) => [`Who is the best ${topic.toLowerCase()} company in ${area}?`, `Can you recommend a ${topic.toLowerCase()} near ${area}?`]).slice(0, 3).join("\n");
  }, [services, area]);
  const [prompts, setPrompts] = useState(suggestions);
  const [competitors, setCompetitors] = useState("");
  const [location, setLocation] = useState(area);
  const [webSearch, setWebSearch] = useState(true);
  const [checks, setChecks] = useState<Check[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const load = () => fetch(`/api/ai-visibility?clientId=${encodeURIComponent(clientId)}`, { cache: "no-store" }).then((response) => response.json()).then((json: { checks?: Check[] }) => setChecks(json.checks || [])).catch(() => undefined);
  useEffect(() => { void load(); }, [clientId]);
  const run = async () => {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/ai-visibility", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ clientId, prompts: prompts.split("\n").map((item) => item.trim()).filter(Boolean), competitors: competitors.split(",").map((item) => item.trim()).filter(Boolean), location, webSearch }) });
      const json = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(json.error || "Check failed.");
      await load();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Check failed."); }
    finally { setBusy(false); }
  };
  const ok = checks.filter((item) => !item.error);
  const rate = (list: Check[], key: "mentioned" | "cited") => list.length ? Math.round((list.filter((item) => item[key]).length / list.length) * 100) : null;
  const compCounts = new Map<string, number>(); ok.forEach((item) => item.competitors.forEach((name) => compCounts.set(name, (compCounts.get(name) || 0) + 1)));
  const clientMentions = ok.filter((item) => item.mentioned).length;
  const totalMentions = clientMentions + [...compCounts.values()].reduce((a, b) => a + b, 0);
  const runs = [...new Set(ok.map((item) => item.run_id))].slice(0, 8).map((id) => { const list = ok.filter((item) => item.run_id === id); return { id, at: list[0].created_at, rate: rate(list, "mentioned") }; }).reverse();
  const latestRun = checks[0]?.run_id;

  return <div className="aiv">
    <div className="aiv-form">
      <label className="aiv-wide"><span>Questions customers might ask (one per line, max 5)</span><textarea rows={3} value={prompts} onChange={(event) => setPrompts(event.target.value)} /></label>
      <label><span>Competitors to watch (comma-separated)</span><input value={competitors} onChange={(event) => setCompetitors(event.target.value)} placeholder="Name or website" /></label>
      <label><span>Location</span><input value={location} onChange={(event) => setLocation(event.target.value)} /></label>
      <label className="aiv-check"><input type="checkbox" checked={webSearch} onChange={(event) => setWebSearch(event.target.checked)} /> Let the AI search the web (closer to how people use it)</label>
      <button type="button" className="primary-button" disabled={busy || !prompts.trim()} onClick={() => void run()}>{busy ? "Asking ChatGPT and Claude…" : "Run visibility check"}</button>
    </div>
    {error && <p className="ops-error" role="alert">{error}</p>}
    <p className="muted aiv-note">Answers come from the ChatGPT and Claude APIs and vary each time — positions are the order of mentions inside one sampled answer, not a fixed ranking, and API answers can differ from the consumer apps.</p>
    {ok.length > 0 && <div className="ops-summary">
      <div><b>{rate(ok, "mentioned")}%</b><span>Sampled mention rate ({ok.length} answers)</span></div>
      <div><b>{rate(ok, "cited")}%</b><span>Answers citing {clientName}’s website</span></div>
      <div><b>{totalMentions ? Math.round((clientMentions / totalMentions) * 100) : 0}%</b><span>Share of mentions vs competitors</span></div>
      <div><b className="aiv-trend">{runs.map((item) => <i key={item.id} title={`${new Date(item.at).toLocaleDateString("en-IE")}: ${item.rate}%`} style={{ height: `${Math.max(6, item.rate || 0)}%` }} />)}</b><span>Mention rate per check</span></div>
    </div>}
    {checks.length > 0 && <div className="ops-table-wrap"><table className="ops-table">
      <thead><tr><th>Question</th><th>Platform</th><th>{clientName} mentioned</th><th>Order in answer</th><th>Competitors mentioned</th><th>Website cited</th><th>Date</th></tr></thead>
      <tbody>{checks.slice(0, 40).map((item, index) => <tr key={`${item.run_id}-${index}`} className={item.run_id === latestRun ? "" : "aiv-old"}>
        <td><details><summary>{item.prompt}</summary>{item.error ? <p className="ops-error">Couldn’t get an answer: {item.error}</p> : <><p className="aiv-excerpt">{item.excerpt}</p>{item.citations.length > 0 && <ul className="aiv-cites">{item.citations.slice(0, 8).map((url) => <li key={url}><a href={url} target="_blank" rel="noreferrer">{url}</a></li>)}</ul>}</>}<small className="muted">{item.model} · {item.location}{item.web_search ? " · web search on" : ""}</small></details></td>
        <td><span className={`aiv-platform ${item.platform}`}>{PLATFORM[item.platform] || item.platform}</span></td>
        <td>{item.error ? "—" : item.mentioned ? <span className="aiv-yes">Yes</span> : <span className="aiv-no">No</span>}</td>
        <td>{item.position ? `#${item.position}` : "—"}</td>
        <td>{item.competitors.join(", ") || "—"}</td>
        <td>{item.error ? "—" : item.cited ? "Yes" : "No"}</td>
        <td>{new Date(item.created_at).toLocaleDateString("en-IE", { day: "numeric", month: "short" })}</td>
      </tr>)}</tbody>
    </table></div>}
    {!checks.length && <p className="ops-empty">No checks yet for {clientName}. Run one to see whether ChatGPT and Claude recommend them.</p>}
  </div>;
}
