"use client";
// Floating AI assistant: a big animated bot bubble in the corner of every page. It knows which page you're on,
// greets new users, pops up notifications (approvals, new leads, unread messages), runs page tours, and turns
// typed or spoken requests into pre-filled forms (nothing is saved without your OK).
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Mic, MicOff, Send, X, Compass, Sparkles } from "lucide-react";

export type AiCommand = { action: string; reply: string; fields: Record<string, string> };
type Suggestion = { title: string; clientId: string; priority: string; service: string; why: string; source?: string };
type Msg = { from: "bot" | "me"; text: string; actions?: Array<{ label: string; run: () => void }> };
type TourStep = { selector: string; title: string; text: string };

const PAGE_LABEL: Record<string, string> = { Overview: "Dashboard", CRM: "Leads", Tasks: "Tasks", Operations: "Operations", Bookkeeping: "Bookkeeping", "Media Library": "Media", Clients: "Clients", Scheduling: "Scheduling", Integrations: "Launchpad", Team: "Team", Settings: "Settings", "Lead Factory": "Lead Factory" };
const PAGE_HELP: Record<string, string[]> = {
  Overview: ["What needs my attention today?", "Add a task to call a client tomorrow", "Open the Leads board"],
  CRM: ["Add a lead: Mary Walsh 087 555 1234, kitchen quote, €8,000", "Create a task to follow up new website leads", "Open Conversations"],
  Tasks: ["Task for Pat: update the Google Ads budget by Friday, high priority", "Remind me to send the monthly report on the 1st"],
  Operations: ["Create an SEO audit task for this client", "Draft this month’s Google Business posts", "Open the Launchpad"],
  Bookkeeping: ["Add expense: Canva €12.99 today, software", "Add income €450 from a client, website project", "Open invoicing"],
  "Media Library": ["Task to photograph the next finished job", "Open the Leads board"],
  Clients: ["Add a new client: Murphy Plumbing, 087 123 4567", "Create an onboarding task for the newest client"],
};
const TOURS: Record<string, TourStep[]> = {
  CRM: [
    { selector: ".tn-nav", title: "Your sections", text: "Everything lives up here: Dashboard, Leads, Tasks, Operations and Bookkeeping. Press A / D or the arrow keys to hop between them." },
    { selector: ".crm-tabs", title: "Leads tabs", text: "Pipeline is your deal board. Contacts holds everyone you’ve spoken to, Conversations has texts, WhatsApp and emails, and Clients and Lead Factory are here too." },
    { selector: ".crm-toolbar", title: "Filter & add", text: "Search, filter by client, and add a new opportunity or contact from here." },
    { selector: ".crm-kanban", title: "The pipeline", text: "Each column is a stage. Drag cards across as deals move forward. Drag a column’s header to reorder stages." },
    { selector: ".crm-kanban [class*='crm-card']:not([class*='crm-card-'])", title: "A lead card", text: "Each card shows the source, project, value and quick actions: call, text, email, WhatsApp, notes. The pencil (top right) edits it." },
    { selector: ".ai-chat-launcher", title: "I’m always here", text: "Ask me to add a lead, create a follow-up task or log an expense — by typing or talking. I’ll fill the form in for you." },
  ],
  Tasks: [
    { selector: ".tn-nav", title: "Your sections", text: "Tasks sits beside Leads and Operations. Press A / D to hop between sections." },
    { selector: ".workflow-review-tabs", title: "Views", text: "Table, Board and History. Tasks opens on whichever view you used last." },
    { selector: ".tt-table, .task-table", title: "Task table", text: "Change status, priority, owner and due date right in the row. Tick boxes for bulk actions." },
    { selector: ".ai-chat-launcher", title: "Ask me", text: "I suggest tasks from approvals, new leads and unread messages — tap a suggestion to add it." },
  ],
  Bookkeeping: [
    { selector: ".overview-finance-toolbar", title: "Period", text: "Pick the period. Every figure and export follows it." },
    { selector: ".finance-actions", title: "Add & export", text: "Add income or expenses, and export everything for your accountant." },
    { selector: ".finance-row", title: "Rows", text: "📎 attaches a receipt, ✎ edits. Recurring items show a ✓ once this period’s receipt is in." },
  ],
};

// Which waiting items matter on each page, so recommendations follow the page you're on.
const PAGE_FOCUS: Record<string, RegExp> = { CRM: /lead|follow|conversation|reply/i, Tasks: /approv|overdue|ai|task/i, Operations: /approv|ai|seo|ads|audit/i, Bookkeeping: /invoice|expense|income|receipt|payment/i };
const forPage = (list: Suggestion[], page: string) => { const focus = PAGE_FOCUS[page]; if (!focus) return list; const hits = list.filter((item) => focus.test(`${item.source || ""} ${item.title} ${item.why}`)); return hits.length ? hits : []; };

export function AiChatWidget({ page, pageName, clientId, avatar, enabled, onCommand, onNavigate, onSuggestion }: { page: string; pageName?: string; clientId?: string; avatar: ReactNode; enabled: boolean; onCommand: (command: AiCommand) => void; onNavigate: (page: string) => void; onSuggestion: (item: Suggestion) => void }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [listening, setListening] = useState(false);
  const [toast, setToast] = useState<{ text: string; action?: { label: string; run: () => void } } | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [tour, setTour] = useState<{ steps: TourStep[]; index: number } | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const recognitionRef = useRef<{ stop: () => void } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const label = pageName || PAGE_LABEL[page] || page;

  const say = (text: string, actions?: Msg["actions"]) => setMessages((current) => [...current, { from: "bot", text, actions }].slice(-40));

  // First visit: introduce myself and offer the Leads tour.
  useEffect(() => {
    if (!enabled) return;
    let seen = false; try { seen = window.localStorage.getItem("f2b-ai-intro") === "1"; } catch { seen = true; }
    if (seen) return;
    const timer = window.setTimeout(() => {
      try { window.localStorage.setItem("f2b-ai-intro", "1"); } catch { /* ignore */ }
      setToast({ text: "Hi, I’m your AI assistant 👋 I can add leads, tasks and expenses for you, and show you around. Want a quick tour of the CRM?", action: { label: "Show me", run: () => startTour("CRM") } });
    }, 2500);
    return () => window.clearTimeout(timer);
  }, [enabled]);

  // Notifications: what's waiting (approvals, new leads, unread messages). Checked on load and every 10 minutes.
  useEffect(() => {
    if (!enabled) return;
    let stop = false; let lastKey = "";
    const check = async () => {
      const response = await fetch(`/api/task-suggestions${clientId ? `?clientId=${encodeURIComponent(clientId)}` : ""}`, { cache: "no-store" }).catch(() => null);
      const json = response && response.ok ? await response.json().catch(() => null) as { suggestions?: Suggestion[] } | null : null;
      if (stop || !json) return;
      const list = json.suggestions || [];
      setSuggestions(list);
      const key = list.map((item) => item.title).join("|");
      let dismissed = ""; try { dismissed = window.sessionStorage.getItem("f2b-ai-toast") || ""; } catch { /* ignore */ }
      if (list.length && key !== lastKey && key !== dismissed) {
        lastKey = key;
        const counts = { lead: list.filter((item) => /lead|follow/i.test(`${item.source} ${item.title}`)).length, approval: list.filter((item) => /approv/i.test(`${item.source} ${item.title}`)).length, conversation: list.filter((item) => /conversation|reply/i.test(`${item.source} ${item.title}`)).length };
        const parts = [counts.approval && `${counts.approval} approval${counts.approval === 1 ? "" : "s"}`, counts.lead && `${counts.lead} lead${counts.lead === 1 ? "" : "s"} to follow up`, counts.conversation && `${counts.conversation} message${counts.conversation === 1 ? "" : "s"} to answer`].filter(Boolean);
        window.setTimeout(() => setToast((current) => current || { text: `You have ${parts.length ? parts.join(", ") : `${list.length} thing${list.length === 1 ? "" : "s"}`} waiting.`, action: { label: "See them", run: () => { try { window.sessionStorage.setItem("f2b-ai-toast", key); } catch { /* ignore */ } openWithSuggestions(list); } } }), 6000);
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), 10 * 60_000);
    return () => { stop = true; window.clearInterval(timer); };
  }, [enabled, clientId]);

  // When the page changes, the open chat says where we are.
  useEffect(() => { if (open) { say(`You’re on ${label}. ${TOURS[page] ? "Want a quick tour of this page?" : "What would you like to do here?"}`, TOURS[page] ? [{ label: `Tour ${label}`, run: () => startTour(page) }] : undefined); recommendHere(); } }, [page]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" }); }, [messages, open]);

  const openWithSuggestions = (list: Suggestion[]) => {
    setToast(null); setOpen(true);
    say(list.length ? "Here’s what I’d do next. Tap one to create the task:" : "Nothing waiting right now. 🎉", list.slice(0, 6).map((item) => ({ label: item.title, run: () => onSuggestion(item) })));
  };
  const openChat = () => {
    setToast(null); setOpen(true);
    if (!messages.length) say(`Hi! I’m your AI assistant. You’re on ${label} — I can add leads, tasks, expenses and clients, open any section, or give you a tour.`, [...(TOURS[page] ? [{ label: `Tour ${label}`, run: () => startTour(page) }] : [{ label: "Tour the CRM", run: () => startTour("CRM") }]), ...(suggestions.length ? [{ label: `Everything waiting (${suggestions.length})`, run: () => openWithSuggestions(suggestions) }] : [])]);
    recommendHere();
  };

  // Recommendations for the page you're on.
  function recommendHere() {
    const here = forPage(suggestions, page);
    if (here.length) say(`Recommended on ${label}:`, here.slice(0, 5).map((item) => ({ label: item.title, run: () => onSuggestion(item) })));
  }
  function startTour(target: string) {
    setToast(null);
    const steps = TOURS[target]; if (!steps) return;
    if (page !== target) onNavigate(target);
    setOpen(false);
    window.setTimeout(() => setTour({ steps, index: 0 }), page !== target ? 900 : 150);
  }
  // Highlight the current tour step (skipping anything not on screen).
  useEffect(() => {
    if (!tour) { setRect(null); return; }
    const step = tour.steps[tour.index];
    const el = step ? document.querySelector(step.selector) as HTMLElement | null : null;
    if (!el) { if (tour.index < tour.steps.length - 1) setTour({ ...tour, index: tour.index + 1 }); else setTour(null); return; }
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    const update = () => setRect(el.getBoundingClientRect());
    const timer = window.setTimeout(update, 350);
    window.addEventListener("resize", update); window.addEventListener("scroll", update, true);
    return () => { window.clearTimeout(timer); window.removeEventListener("resize", update); window.removeEventListener("scroll", update, true); };
  }, [tour]);

  const ask = async (text: string) => {
    const request = text.trim(); if (!request || busy) return;
    setMessages((current) => [...current, { from: "me" as const, text: request }].slice(-40)); setPrompt(""); setBusy(true);
    if (/^(tour|show me around|walk ?through|how does this (page|work))/i.test(request)) { setBusy(false); startTour(TOURS[page] ? page : "CRM"); return; }
    try {
      const response = await fetch("/api/ai-command", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: request, page, clientId }) });
      const json = await response.json().catch(() => ({})) as AiCommand & { error?: string };
      if (!response.ok) throw new Error(json.error || "I couldn’t do that.");
      say(json.reply || "Done — check the details.");
      if (json.action !== "answer") onCommand(json);
    } catch (reason) { say(reason instanceof Error ? reason.message : "I couldn’t do that."); }
    finally { setBusy(false); }
  };
  const talk = () => {
    const Speech = (window as unknown as { SpeechRecognition?: new () => any; webkitSpeechRecognition?: new () => any }).SpeechRecognition || (window as unknown as { webkitSpeechRecognition?: new () => any }).webkitSpeechRecognition;
    if (!Speech) { say("Voice isn’t supported in this browser — try Chrome or Edge."); return; }
    if (listening) { recognitionRef.current?.stop(); return; }
    const recognition = new Speech(); recognition.lang = "en-IE"; recognition.interimResults = true;
    let finalText = "";
    recognition.onresult = (event: any) => { let interim = ""; for (let i = event.resultIndex; i < event.results.length; i += 1) { if (event.results[i].isFinal) finalText += event.results[i][0].transcript; else interim += event.results[i][0].transcript; } setPrompt((finalText + interim).trim()); };
    recognition.onend = () => { setListening(false); recognitionRef.current = null; if (finalText.trim()) void ask(finalText); };
    recognition.onerror = () => setListening(false);
    recognitionRef.current = recognition; setListening(true); recognition.start();
  };

  if (!enabled) return null;
  const step = tour?.steps[tour.index];
  const chips = (PAGE_HELP[page] || PAGE_HELP.Overview).slice(0, 3);
  return <>
    {tour && step && rect && <div className="ai-tour" role="dialog" aria-label={step.title}>
      <div className="ai-tour-hole" style={{ top: rect.top - 6, left: rect.left - 6, width: rect.width + 12, height: rect.height + 12 }} />
      <div className="ai-tour-card" style={{ top: Math.min(window.innerHeight - 190, rect.bottom + 14 > window.innerHeight - 190 ? Math.max(12, rect.top - 190) : rect.bottom + 14), left: Math.max(12, Math.min(window.innerWidth - 352, rect.left)) }}>
        <small>Step {tour.index + 1} of {tour.steps.length}</small><b>{step.title}</b><p>{step.text}</p>
        <div className="ai-tour-actions"><button type="button" className="text-button" onClick={() => setTour(null)}>Skip tour</button>{tour.index > 0 && <button type="button" className="secondary-button" onClick={() => setTour({ ...tour, index: tour.index - 1 })}>Back</button>}<button type="button" className="primary-button" onClick={() => tour.index < tour.steps.length - 1 ? setTour({ ...tour, index: tour.index + 1 }) : (setTour(null), setToast({ text: "That’s the tour! Ask me anything, any time." }))}>{tour.index < tour.steps.length - 1 ? "Next" : "Finish"}</button></div>
      </div>
    </div>}
    {toast && !open && <div className="ai-chat-toast" role="status"><button type="button" className="ai-chat-toast-x" aria-label="Dismiss" onClick={() => setToast(null)}><X size={14} /></button><p>{toast.text}</p>{toast.action && <button type="button" className="primary-button" onClick={() => { const run = toast.action!.run; setToast(null); run(); }}>{toast.action.label}</button>}</div>}
    {open && <section className="ai-chat-panel" aria-label="AI assistant">
      <header><span className="ai-chat-head-bot">{avatar}</span><div><b>AI Assistant</b><small>On {label}</small></div>{TOURS[page] && <button type="button" className="ai-chat-icon" title={`Tour ${label}`} aria-label={`Tour ${label}`} onClick={() => startTour(page)}><Compass size={17} /></button>}<button type="button" className="ai-chat-icon" aria-label="Close" onClick={() => setOpen(false)}><X size={17} /></button></header>
      <div className="ai-chat-list" ref={listRef}>{messages.map((message, index) => <div key={index} className={`ai-chat-msg ${message.from}`}><p>{message.text}</p>{message.actions && message.actions.length > 0 && <div className="ai-chat-actions">{message.actions.map((action) => <button type="button" key={action.label} onClick={action.run}>{action.label}</button>)}</div>}</div>)}{busy && <div className="ai-chat-msg bot typing"><p><i /><i /><i /></p></div>}</div>
      <div className="ai-chat-chips">{chips.map((chip) => <button type="button" key={chip} onClick={() => void ask(chip)} disabled={busy}><Sparkles size={11} /> {chip}</button>)}</div>
      <form className="ai-chat-input" onSubmit={(event) => { event.preventDefault(); void ask(prompt); }}><input value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={listening ? "Listening…" : `Ask me anything about ${label}…`} aria-label="Message the AI assistant" /><button type="button" className={`ai-chat-icon${listening ? " on" : ""}`} onClick={talk} aria-label={listening ? "Stop" : "Talk"}>{listening ? <MicOff size={17} /> : <Mic size={17} />}</button><button type="submit" className="ai-chat-send" disabled={busy || !prompt.trim()} aria-label="Send"><Send size={16} /></button></form>
    </section>}
    <button type="button" className={`ai-chat-launcher${toast && !open ? " has-toast" : ""}${open ? " is-open" : ""}`} aria-label={open ? "Close AI assistant" : "Open AI assistant"} onClick={() => open ? setOpen(false) : openChat()}>{avatar}{suggestions.length > 0 && !open && <span className="ai-chat-badge">{suggestions.length > 9 ? "9+" : suggestions.length}</span>}</button>
  </>;
}
