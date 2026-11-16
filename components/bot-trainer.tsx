"use client";
// Train a client's AI bot (the one that answers their WhatsApp / SMS): what it knows, how it talks, and a live test chat.
import { useEffect, useRef, useState } from "react";

type Bot = { enabled: boolean; name: string; about: string; services: string; prices: string; hours: string; area: string; team: string; faqs: string; tone: string; rules: string; bookingLink: string; handoff: string };
type Line = { from: "customer" | "bot"; text: string };

async function post<T>(body: unknown): Promise<T> {
  const res = await fetch("/api/conversations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const json = await res.json().catch(() => ({})) as T & { error?: string };
  if (!res.ok) throw new Error(json.error || "Something went wrong.");
  return json;
}

const TONES = ["Friendly and professional", "Warm and chatty", "Short and to the point", "Fun and casual", "Formal"];
const FIELDS: Array<[keyof Bot, string, string, number]> = [
  ["about", "About the business", "Who you are, what makes you different, how long you've been going…", 3],
  ["services", "Services", "One per line, e.g.\nFine line tattoos\nCover-ups\nPiercings", 4],
  ["prices", "Prices", "e.g. Small tattoos from €80 · Shop minimum €60 · Deposit €50 to book", 3],
  ["hours", "Opening hours", "e.g. Tue–Sat 11:00–18:30, closed Sun & Mon", 2],
  ["area", "Area / address", "e.g. 7-8 Winthrop St, Cork · Serving Cork city and county", 2],
  ["team", "Team", "e.g. Gin (fine line), Slim (blackwork), Elena (colour)", 2],
  ["faqs", "FAQs", "Q: Do you do walk-ins?\nA: Yes, Saturdays from 12 if there's space.\n\nQ: Aftercare?\nA: …", 6],
  ["rules", "Rules for the bot", "e.g. Never quote for hands/neck. Always ask for a reference photo. Under-18s need ID.", 3],
];

export function BotTrainer({ clientId, clientName, onClose }: { clientId: string; clientName: string; onClose: () => void }) {
  const [bot, setBot] = useState<Bot | null>(null);
  const [saved, setSaved] = useState(false);
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [chat, setChat] = useState<Line[]>([]);
  const [msg, setMsg] = useState("");
  const [thinking, setThinking] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => { let live = true; post<{ bot: Bot; saved: boolean }>({ action: "bot-get", clientId }).then((r) => { if (live) { setBot(r.bot); setSaved(r.saved); } }).catch((e) => setStatus(e.message)); return () => { live = false; }; }, [clientId]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: "end" }); }, [chat.length, thinking]);
  const set = (patch: Partial<Bot>) => setBot((b) => b ? { ...b, ...patch } : b);

  // Fill the blanks from what's on the client's own website (services, area, team).
  const fromWebsite = async () => {
    setBusy(true); setStatus("Reading the website…");
    try {
      const res = await fetch(`/api/scheduling?clientId=${encodeURIComponent(clientId)}&view=site`);
      const v = await res.json().catch(() => ({})) as { services?: string[]; locations?: string[]; team?: string[] };
      const got: Partial<Bot> = {};
      if (v.services?.length && !bot?.services.trim()) got.services = v.services.join("\n");
      if (v.locations?.length && !bot?.area.trim()) got.area = v.locations.join(", ");
      if (v.team?.length && !bot?.team.trim()) got.team = v.team.join(", ");
      set(got);
      setStatus(Object.keys(got).length ? `Filled ${Object.keys(got).length} section${Object.keys(got).length === 1 ? "" : "s"} from the website. Check and edit them.` : "Nothing new found on the website (or those sections are already filled).");
    } catch { setStatus("Couldn't read the website."); }
    finally { setBusy(false); }
  };
  const save = async () => { if (!bot) return; setBusy(true); try { await post({ action: "bot-save", clientId, bot }); setSaved(true); setStatus("Saved. The bot uses this from the next message."); } catch (e) { setStatus(e instanceof Error ? e.message : "Couldn't save."); } finally { setBusy(false); } };
  const test = async () => {
    const text = msg.trim(); if (!text || !bot) return;
    const next = [...chat, { from: "customer" as const, text }]; setChat(next); setMsg(""); setThinking(true);
    try { const r = await post<{ reply: string; handoff: boolean }>({ action: "bot-test", clientId, clientName, bot, history: next }); setChat([...next, { from: "bot", text: r.reply + (r.handoff ? "  (hands over to the team)" : "") }]); setSaved(true); }
    catch (e) { setChat([...next, { from: "bot", text: `⚠️ ${e instanceof Error ? e.message : "No reply."}` }]); }
    finally { setThinking(false); }
  };

  return <div className="bt-backdrop" role="presentation" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
    <div className="bt" role="dialog" aria-modal="true" aria-label={`Train ${clientName}'s AI bot`}>
      <header className="bt-head"><div><p className="eyebrow">🤖 AI BOT · {clientName.toUpperCase()}</p><h2>Train the AI bot</h2><p>What it knows and how it talks when it answers {clientName}'s WhatsApp and texts.</p></div><button type="button" className="bt-x" aria-label="Close" onClick={onClose}>×</button></header>
      {!bot ? <p className="bt-loading">{status || "Loading…"}</p> : <div className="bt-body">
        <div className="bt-form">
          <div className="bt-row">
            <label className={`task-ai-toggle ${bot.enabled ? "is-on" : ""}`}><input type="checkbox" role="switch" checked={bot.enabled} onChange={(e) => set({ enabled: e.target.checked })} /><span className="task-ai-toggle-track" aria-hidden="true"><span className="task-ai-toggle-thumb" /></span><b>{bot.enabled ? "Bot answers customers" : "Bot is off for this client"}</b></label>
            <button type="button" className="secondary-button" disabled={busy} onClick={() => void fromWebsite()}>🌐 Fill from website</button>
          </div>
          <div className="bt-grid2">
            <label>Bot name<input value={bot.name} maxLength={60} placeholder={`${clientName} assistant`} onChange={(e) => set({ name: e.target.value })} /></label>
            <label>Tone of voice<select value={TONES.includes(bot.tone) ? bot.tone : "custom"} onChange={(e) => set({ tone: e.target.value === "custom" ? "" : e.target.value })}>{TONES.map((t) => <option key={t}>{t}</option>)}<option value="custom">Custom…</option></select>{!TONES.includes(bot.tone) && <input value={bot.tone} maxLength={200} placeholder="Describe the tone" onChange={(e) => set({ tone: e.target.value })} />}</label>
          </div>
          {FIELDS.map(([key, label, hint, rows]) => <label key={key}>{label}<textarea rows={rows} value={String(bot[key])} placeholder={hint} onChange={(e) => set({ [key]: e.target.value } as Partial<Bot>)} /></label>)}
          <div className="bt-grid2">
            <label>Booking link<input value={bot.bookingLink} maxLength={400} placeholder="https://… (your Scheduling booking page)" onChange={(e) => set({ bookingLink: e.target.value })} /></label>
            <label>Hand-over message<input value={bot.handoff} maxLength={300} placeholder="No problem, one of the team will reply shortly." onChange={(e) => set({ handoff: e.target.value })} /></label>
          </div>
        </div>
        <aside className="bt-test">
          <b>Test it</b><small>Chat as a customer. It answers exactly like the live bot.</small>
          <div className="bt-chat">{!chat.length && <p className="bt-empty">Try: “How much for a small tattoo?” or “Are you open Saturday?”</p>}{chat.map((l, i) => <div key={i} className={`bt-msg ${l.from}`}>{l.text}</div>)}{thinking && <div className="bt-msg bot typing">…</div>}<div ref={endRef} /></div>
          <form onSubmit={(e) => { e.preventDefault(); void test(); }}><input value={msg} onChange={(e) => setMsg(e.target.value)} placeholder="Type a customer message…" /><button type="submit" className="primary-button" disabled={thinking || !msg.trim()}>Send</button></form>
          {chat.length > 0 && <button type="button" className="text-button" onClick={() => setChat([])}>Clear test chat</button>}
        </aside>
      </div>}
      <footer className="bt-foot"><span className="bt-status" role="status">{status || (saved ? "Trained ✓" : "Not trained yet")}</span><span style={{ flex: 1 }} /><button type="button" className="secondary-button" onClick={onClose}>Close</button><button type="button" className="primary-button" disabled={busy || !bot} onClick={() => void save()}>Save training</button></footer>
    </div>
  </div>;
}
