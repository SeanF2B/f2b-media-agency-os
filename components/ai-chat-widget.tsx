"use client";
// Floating AI assistant: a big animated bot bubble in the corner of every page. It knows which page you're on,
// greets new users, pops up notifications (approvals, new leads, unread messages), runs page tours, and turns
// typed or spoken requests into pre-filled forms (nothing is saved without your OK).
import { useEffect, useRef, useState, type ReactNode } from "react";
import { Mic, MicOff, Send, X, Compass, Sparkles, LifeBuoy } from "lucide-react";

export type AiCommand = { action: string; reply: string; fields: Record<string, string> };
type Suggestion = { title: string; clientId: string; priority: string; service: string; why: string; source?: string };
type Msg = { from: "bot" | "me"; text: string; actions?: Array<{ label: string; run: () => void }>; rows?: Array<{ label: string; value: string; tone?: string }> };
// AI employees: each answers from its own service's live data for the selected client.
const EMPLOYEES: Array<{ id: string; name: string; icon: string; hint: string }> = [
  { id: "", name: "AI Assistant", icon: "✨", hint: "Add leads, tasks, expenses and get around the app" },
  { id: "google_ads", name: "Google Ads", icon: "📣", hint: "Spend, clicks, CPC, conversions and campaigns" },
  { id: "seo", name: "SEO & Google Business", icon: "🔎", hint: "Rankings, traffic, Business Profile, AI visibility" },
  { id: "bookkeeper", name: "Bookkeeper", icon: "📒", hint: "Income, expenses and profit" },
  { id: "creatives", name: "Creatives", icon: "🎨", hint: "Ad, social and photo ideas for the brand" },
  { id: "copywriter", name: "Copywriter (Claude)", icon: "✍️", hint: "Ads, posts, emails and web copy" },
  { id: "agency", name: "Agency overview", icon: "🏢", hint: "Every client, tasks and pipeline" },
  { id: "developer", name: "Developer", icon: "🛠️", hint: "Sites, tracking and connections" },
  { id: "lead_gen", name: "Lead gen", icon: "🎯", hint: "Leads, sources and pipeline" },
];
type TourStep = { selector: string; title: string; text: string };

const PAGE_LABEL: Record<string, string> = { Overview: "Dashboard", CRM: "Leads", Tasks: "Tasks", Operations: "Operations", Bookkeeping: "Bookkeeping", "Media Library": "Media", Clients: "Clients", Scheduling: "Scheduling", Integrations: "Launchpad", Team: "Team", Settings: "Settings", "Lead Factory": "Lead Factory" };
const PAGE_HELP: Record<string, string[]> = {
  Overview: ["What needs my attention today?", "Add a task to call a client tomorrow", "Open the Leads board"],
  CRM: ["Add a lead: Mary Walsh 087 555 1234, kitchen quote, €8,000", "Create a task to follow up new website leads", "Open Conversations"],
  Tasks: ["Task for Pat: update the Google Ads budget by Friday, high priority", "Remind me to send the monthly report on the 1st"],
  Operations: ["Create an SEO audit task for this client", "Draft this month’s Google Business posts", "Open the Launchpad"],
  Bookkeeping: ["Add expense: Canva €12.99 today, software", "Add income €450 from a client, website project", "Open invoicing"],
  "Media Library": ["Task to photograph the next finished job", "Open the Leads board"],
  "Lead Factory": ["Find roofers in Galway with under 20 reviews", "Create an ICP for plumbers in Dublin with no website", "Which saved list should I contact first?"],
  Conversations: ["Draft a reply to the latest quote request", "Which conversations are waiting on me?", "Open the Leads board"],
  Scheduling: ["Book a call with a client next Tuesday at 11", "What’s on this week?"],
  Invoicing: ["Create an invoice for €450 website work", "Which invoices are overdue?"],
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
// Only pages with a clear match get task recommendations; other pages get help for that page instead.
const forPage = (list: Suggestion[], page: string) => { const focus = PAGE_FOCUS[page]; if (!focus) return []; const hits = list.filter((item) => focus.test(`${item.source || ""} ${item.title} ${item.why}`)); return hits.length ? hits : []; };

export function AiChatWidget({ page, pageName, clientId, avatar, enabled, onCommand, onNavigate, onSuggestion, clients = [], onTicket }: { clients?: Array<{ id: string; name: string }>; onTicket?: () => void; page: string; pageName?: string; clientId?: string; avatar: ReactNode; enabled: boolean; onCommand: (command: AiCommand) => void; onNavigate: (page: string) => void; onSuggestion: (item: Suggestion) => void }) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [employee, setEmployee] = useState(() => { try { return localStorage.getItem("f2b-ai-employee") || ""; } catch { return ""; } });
  const [pickerOpen, setPickerOpen] = useState(false);
  const [listening, setListening] = useState(false);
  const [toast, setToast] = useState<{ text: string; action?: { label: string; run: () => void } } | null>(null);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [tour, setTour] = useState<{ steps: TourStep[]; index: number } | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const recognitionRef = useRef<{ stop: () => void } | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const label = pageName || PAGE_LABEL[page] || page;
  // Support ticket form (lands in the agency's Tasks for that client).
  const [ticket, setTicket] = useState<{ subject: string; details: string; priority: string; clientId: string } | null>(null);
  const [ticketBusy, setTicketBusy] = useState(false);
  const openTicket = () => { setToast(null); setOpen(true); setTicket({ subject: "", details: "", priority: "Normal", clientId: clientId || "" }); };
  const sendTicket = async () => {
    if (!ticket || ticket.subject.trim().length < 3) return;
    setTicketBusy(true);
    try {
      const response = await fetch("/api/support-ticket", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(ticket) });
      const json = await response.json().catch(() => ({})) as { number?: string; error?: string };
      if (!response.ok) throw new Error(json.error || "The ticket couldn’t be sent.");
      setTicket(null); say(`Ticket ${json.number} is in. It’s now a task for ${clients.find((c) => c.id === ticket.clientId)?.name || "the agency"} in Tasks.`, onTicket ? [{ label: "Open Tasks", run: onTicket }] : undefined);
    } catch (reason) { say(reason instanceof Error ? reason.message : "The ticket couldn’t be sent."); }
    finally { setTicketBusy(false); }
  };

  const say = (text: string, actions?: Msg["actions"], rows?: Msg["rows"]) => setMessages((current) => [...current, { from: "bot", text, actions, rows }].slice(-40));
  const current = EMPLOYEES.find((item) => item.id === employee) || EMPLOYEES[0];
  const chooseEmployee = async (id: string) => {
    setEmployee(id); setPickerOpen(false); try { localStorage.setItem("f2b-ai-employee", id); } catch { /* ignore */ }
    const info = EMPLOYEES.find((item) => item.id === id) || EMPLOYEES[0];
    if (!id) { say("Back to the general assistant — ask me to add a lead, task or expense, or open any section."); return; }
    setBusy(true);
    try {
      const response = await fetch("/api/ai-employee", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ employee: id, clientId }) });
      const json = await response.json().catch(() => ({})) as { rows?: Msg["rows"]; note?: string; client?: string; error?: string };
      if (!response.ok) throw new Error(json.error || "I couldn’t load that data.");
      const scope = json.client ? ` for ${json.client}` : " across the agency";
      say(json.rows?.length ? `${info.icon} ${info.name} here. This is what I can see${scope} (last 30 days). Ask me anything about it:` : `${info.icon} ${info.name} here. ${json.note || "No data is connected for this yet."}`, undefined, json.rows);
      if (json.rows?.length && json.note) say(`Not available yet: ${json.note}`);
    } catch (reason) { say(reason instanceof Error ? reason.message : "I couldn’t load that data."); }
    finally { setBusy(false); }
  };

  // First visit: introduce myself and offer the Leads tour.
  useEffect(() => {
    if (!enabled) return;
    let seen = false; try { seen = window.localStorage.getItem("f2b-ai-intro") === "1"; } catch { seen = true; }
    if (seen) return;
    const timer = window.setTimeout(() => {
      try { window.localStorage.setItem("f2b-ai-intro", "1"); } catch { /* ignore */ }
      setToast({ text: "Hey boss 👋 I’m your AI assistant. Quick tour?", action: { label: "Show me", run: () => startTour("CRM") } });
    }, 2500);
    return () => window.clearTimeout(timer);
  }, [enabled]);

  // Pop-ups only mention things that belong to the page you're on.
  const TOAST_FOCUS: Record<string, RegExp | null> = { Overview: /./, CRM: /lead|follow|conversation|reply/i, Conversations: /conversation|reply|message|lead|follow/i, Tasks: /approv|overdue|task|review/i, Bookkeeping: /invoice|expense|income|receipt|payment/i, Scheduling: /appointment|booking|book/i };
  const pageRef = useRef(page); pageRef.current = page;
  // A short, page-relevant offer of help (once per page per session).
  const PAGE_NUDGE: Record<string, string[]> = {
    Overview: ["need a hand with anything today?", "want a quick rundown of what needs you?", "shall I check what’s waiting on approvals?", "want me to add a task for later?"],
    CRM: ["need help adding a lead?", "want me to chase up your newest leads?", "shall I move a lead along the pipeline?", "want to tag a few contacts?"],
    Conversations: ["want me to draft a reply?", "need help answering a quote request?", "shall I book someone in from a chat?"],
    Tasks: ["need some help setting up a task?", "want me to plan this week’s tasks?", "shall I create a follow-up task for a client?", "want me to sort out what’s overdue?"],
    Bookkeeping: ["want me to log an expense?", "got a receipt to add?", "shall I add income from a client?", "want to see how this month’s looking?"],
    Scheduling: ["want to book an appointment in?", "shall I set up a new booking calendar?", "need to block out a day off?"],
    Operations: ["need a hand with a client’s marketing?", "want me to check how the ads are doing?", "shall I set up an SEO task?"],
    "Media Library": ["want to upload job photos?", "shall I sort photos by service?", "need an image made with AI?"],
    "Lead Factory": ["want me to find new businesses to contact?", "shall I set up a new ICP?", "want to check your saved lists?"],
  };
  useEffect(() => {
    setToast((current) => current && !/tour/i.test(current.text) ? null : current);
    const lines = PAGE_NUDGE[page];
    if (!enabled || !lines) return;
    // Different line each time, at most once every 3 minutes per page.
    let last = 0; try { last = Number(window.sessionStorage.getItem(`f2b-ai-nudge-${page}`) || 0); } catch { /* ignore */ }
    if (Date.now() - last < 3 * 60_000) return;
    const h = new Date().getHours();
    const hello = ["Hey boss 👋", h < 12 ? "Morning boss ☀️" : h < 18 ? "Afternoon boss 👋" : "Evening boss 🌙", "Hi boss 👋"][Math.floor(Math.random() * 3)];
    const line = lines[Math.floor(Math.random() * lines.length)];
    const timer = window.setTimeout(() => { try { window.sessionStorage.setItem(`f2b-ai-nudge-${page}`, String(Date.now())); } catch { /* ignore */ } setToast((current) => current || { text: `${hello} ${line}`, action: { label: "Yes please", run: () => openChat() } }); }, 3500);
    return () => window.clearTimeout(timer);
  }, [page, enabled]); // eslint-disable-line react-hooks/exhaustive-deps
  // Notifications: what's waiting (approvals, new leads, unread messages). Checked on load and every 10 minutes.
  useEffect(() => {
    if (!enabled) return;
    let stop = false; let lastKey = "";
    const check = async () => {
      const response = await fetch(`/api/task-suggestions${clientId ? `?clientId=${encodeURIComponent(clientId)}` : ""}`, { cache: "no-store" }).catch(() => null);
      const json = response && response.ok ? await response.json().catch(() => null) as { suggestions?: Suggestion[] } | null : null;
      if (stop || !json) return;
      const all = json.suggestions || [];
      setSuggestions(all);
      const focus = TOAST_FOCUS[pageRef.current] ?? null;
      const list = focus ? all.filter((item) => focus.test(`${item.source || ""} ${item.title} ${item.why}`)) : [];
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
  useEffect(() => { if (open) { setMessages([]); window.setTimeout(() => openChat(true), 0); } }, [page]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" }); }, [messages, open]);

  const openWithSuggestions = (list: Suggestion[]) => {
    setToast(null); setOpen(true);
    say(list.length ? "Here’s what I’d do next. Tap one to create the task:" : "Nothing waiting right now. 🎉", list.slice(0, 6).map((item) => ({ label: item.title, run: () => onSuggestion(item) })));
  };
  const openChat = (force = false) => {
    setToast(null); setOpen(true);
    if (messages.length && !force) return;
    // Short, page-aware hello with the next useful actions.
    const here = forPage(suggestions, page);
    const people = here.filter((item) => /lead|conversation|reply|follow/i.test(`${item.source || ""} ${item.title}`));
    const nameOf = (item: Suggestion) => item.title.replace(/^(follow up( with)?|reply to|call|contact)\s+/i, "").replace(/\s*[·:-].*$/, "").trim();
    const line: Record<string, string> = {
      Overview: suggestions.length ? `${suggestions.length} thing${suggestions.length === 1 ? "" : "s"} waiting today.` : "All quiet today.",
      CRM: people.length ? `${people.length} lead${people.length === 1 ? "" : "s"} could use a follow-up.` : "Pipeline’s up to date.",
      Conversations: people.length ? `${people.length} conversation${people.length === 1 ? "" : "s"} waiting on you.` : "Inbox is clear.",
      Tasks: here.length ? `${here.length} task idea${here.length === 1 ? "" : "s"} from approvals and messages.` : "Nothing urgent on tasks.",
      Bookkeeping: "Log an expense or a receipt?",
      Scheduling: "Want to book something in?",
      "Lead Factory": "Find new businesses to contact?",
    };
    const actions: NonNullable<Msg["actions"]> = [];
    for (const item of people.slice(0, 2)) { const who = nameOf(item); if (who) actions.push({ label: `📅 Book ${who} in`, run: () => { onNavigate("Scheduling"); setOpen(false); } }); }
    for (const item of here.filter((x) => !people.includes(x)).slice(0, 3 - actions.length)) actions.push({ label: item.title, run: () => onSuggestion(item) });
    if (!actions.length && page === "Overview" && suggestions.length) actions.push({ label: `See all ${suggestions.length}`, run: () => openWithSuggestions(suggestions) });
    if (!actions.length && PAGE_HELP[page]) actions.push(...PAGE_HELP[page].slice(0, 2).map((text) => ({ label: text, run: () => void ask(text) })));
    say(`Hey boss 👋 ${line[page] || `What can I do on ${label}?`}`, actions.slice(0, 3));
  };

  // Recommendations for the page you're on.
  function recommendHere() {
    const here = forPage(suggestions, page);
    if (here.length) { say(`Recommended on ${label}:`, here.slice(0, 5).map((item) => ({ label: item.title, run: () => onSuggestion(item) }))); return; }
    const help = PAGE_HELP[page];
    if (help) say(`On ${label} I can help with:`, help.map((text) => ({ label: text, run: () => void ask(text) })));
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
    if (/\b(support ticket|raise a ticket|open a ticket|log a ticket)\b/i.test(request)) { setBusy(false); openTicket(); setTicket((current) => current ? { ...current, subject: request.replace(/^.*?\b(ticket)\b[:\s-]*(for|about)?\s*/i, "").slice(0, 140) } : current); return; }
    if (employee) {
      try {
        const history = messages.slice(-8).map((m) => ({ from: m.from, text: m.text }));
        const response = await fetch("/api/ai-employee", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ employee, clientId, prompt: request, history }) });
        const json = await response.json().catch(() => ({})) as { reply?: string; error?: string };
        if (!response.ok) throw new Error(json.error || "I couldn’t answer that.");
        say(json.reply || "I don’t have an answer for that yet.");
      } catch (reason) { say(reason instanceof Error ? reason.message : "I couldn’t answer that."); }
      finally { setBusy(false); }
      return;
    }
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
  const EMPLOYEE_CHIPS: Record<string, string[]> = {
    google_ads: ["How are the ads doing this month?", "Which campaign should I cut or scale?", "Why is cost per conversion high?"],
    seo: ["How is the Google Business Profile performing?", "Which keywords are close to page 1?", "What should I do for SEO this week?"],
    bookkeeper: ["What did I spend most on this year?", "Am I making a profit this month?", "What should I set aside for tax?"],
    creatives: ["3 Facebook ad ideas for this month", "Photo ideas for the next job", "A Google Business post idea"],
    copywriter: ["Write 3 Google ad headlines", "Write a short Facebook post", "Rewrite the homepage intro"],
    agency: ["What needs my attention today?", "Which clients are falling behind?", "Summarise the pipeline"],
    developer: ["Which clients are missing tracking?", "What should I connect next?", "Any site issues to fix?"],
    lead_gen: ["Where are leads coming from?", "How many new leads this month?", "Which leads should I follow up?"],
  };
  const chips = (employee ? EMPLOYEE_CHIPS[employee] || [] : PAGE_HELP[page] || PAGE_HELP.Overview).slice(0, 3);
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
      <header><span className="ai-chat-head-bot">{avatar}</span><div className="ai-emp-wrap"><button type="button" className="ai-emp-trigger" aria-haspopup="listbox" aria-expanded={pickerOpen} onClick={() => setPickerOpen((v) => !v)} title="Choose an AI employee"><b>{current.icon} {current.name}</b><span aria-hidden="true">▾</span></button><small>On {label}</small>{pickerOpen && <div className="ai-emp-menu" role="listbox">{EMPLOYEES.map((item) => <button type="button" role="option" aria-selected={item.id === employee} key={item.id || "assistant"} className={item.id === employee ? "is-on" : ""} onClick={() => void chooseEmployee(item.id)}><span className="ai-emp-ico">{item.icon}</span><span><b>{item.name}</b><small>{item.hint}</small></span></button>)}</div>}</div><button type="button" className="ai-chat-icon" title="Raise a support ticket" aria-label="Raise a support ticket" onClick={openTicket}><LifeBuoy size={17} /></button>{TOURS[page] && <button type="button" className="ai-chat-icon" title={`Tour ${label}`} aria-label={`Tour ${label}`} onClick={() => startTour(page)}><Compass size={17} /></button>}<button type="button" className="ai-chat-icon" aria-label="Close" onClick={() => setOpen(false)}><X size={17} /></button></header>
      <div className="ai-chat-list" ref={listRef}>{messages.map((message, index) => <div key={index} className={`ai-chat-msg ${message.from}`}><p>{message.text}</p>{message.rows && message.rows.length > 0 && <div className="ai-emp-rows">{message.rows.map((row) => <div key={row.label} className={`ai-emp-row ${row.tone || ""}`}><span>{row.label}</span><b>{row.value}</b></div>)}</div>}{message.actions && message.actions.length > 0 && <div className="ai-chat-actions">{message.actions.map((action) => <button type="button" key={action.label} onClick={action.run}>{action.label}</button>)}</div>}</div>)}{busy && <div className="ai-chat-msg bot typing"><p><i /><i /><i /></p></div>}</div>
      {ticket && <form className="ai-chat-ticket" onSubmit={(event) => { event.preventDefault(); void sendTicket(); }}>
        <b><LifeBuoy size={15} /> New support ticket</b>
        {!clientId && <select value={ticket.clientId} onChange={(event) => setTicket({ ...ticket, clientId: event.target.value })} aria-label="Client"><option value="">Agency (no client)</option>{clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>}
        <input autoFocus value={ticket.subject} onChange={(event) => setTicket({ ...ticket, subject: event.target.value })} placeholder="Subject" maxLength={140} required />
        <textarea value={ticket.details} onChange={(event) => setTicket({ ...ticket, details: event.target.value })} placeholder="What do you need?" rows={3} maxLength={3000} />
        <div className="ai-chat-ticket-row"><select value={ticket.priority} onChange={(event) => setTicket({ ...ticket, priority: event.target.value })} aria-label="Priority"><option>Normal</option><option>High</option><option>Urgent</option></select><button type="button" className="text-button" onClick={() => setTicket(null)}>Cancel</button><button type="submit" className="primary-button" disabled={ticketBusy || ticket.subject.trim().length < 3}>{ticketBusy ? "Sending…" : "Send ticket"}</button></div>
      </form>}
      <div className="ai-chat-chips">{chips.map((chip) => <button type="button" key={chip} onClick={() => void ask(chip)} disabled={busy}><Sparkles size={11} /> {chip}</button>)}</div>
      <form className="ai-chat-input" onSubmit={(event) => { event.preventDefault(); void ask(prompt); }}><input value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={listening ? "Listening…" : `Ask me anything about ${label}…`} aria-label="Message the AI assistant" /><button type="button" className={`ai-chat-icon${listening ? " on" : ""}`} onClick={talk} aria-label={listening ? "Stop" : "Talk"}>{listening ? <MicOff size={17} /> : <Mic size={17} />}</button><button type="submit" className="ai-chat-send" disabled={busy || !prompt.trim()} aria-label="Send"><Send size={16} /></button></form>
    </section>}
    <button type="button" className={`ai-chat-launcher${toast && !open ? " has-toast" : ""}${open ? " is-open" : ""}`} aria-label={open ? "Close AI assistant" : "Open AI assistant"} onClick={() => open ? setOpen(false) : openChat()}>{avatar}<span className="ai-chat-online" aria-label="Online" /></button>
  </>;
}
