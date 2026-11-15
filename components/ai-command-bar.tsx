"use client";
// "Ask AI" bar shown at the top of each tab: type or speak a request, or tap a suggestion. The AI picks one
// action (new task, expense, lead, client, open a tab or a quick answer); the app opens the matching form
// pre-filled so you check it before anything is saved.
import { useEffect, useRef, useState } from "react";
import { Mic, MicOff, Sparkles } from "lucide-react";

export type AiCommand = { action: string; reply: string; fields: Record<string, string> };
type Chip = { label: string; prompt?: string; run?: () => void; hint?: string };

const EXAMPLES: Record<string, string[]> = {
  Overview: ["What needs my attention today?", "Add a task to call a client tomorrow", "Show me the leads board"],
  CRM: ["Add a lead: Mary Walsh 087 555 1234, kitchen quote, €8,000", "Create a task to follow up new website leads", "Open Conversations"],
  Tasks: ["Task for Pat: update the Google Ads budget by Friday, high priority", "Remind me to send the monthly report on the 1st"],
  Operations: ["Create an SEO audit task for this client", "Draft this month’s Google Business posts", "Open the Launchpad"],
  Bookkeeping: ["Add expense: Canva €12.99 today, software", "Add income €450 from a client, website project", "Open invoicing"],
  "Media Library": ["Task to photograph the new kitchen job next Tuesday", "Open the Leads board"],
};

export function AiCommandBar({ page, clientId, chips = [], onCommand }: { page: string; clientId?: string; chips?: Chip[]; onCommand: (command: AiCommand) => void }) {
  const [prompt, setPrompt] = useState("");
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState("");
  const [listening, setListening] = useState(false);
  const recognitionRef = useRef<{ stop: () => void } | null>(null);
  useEffect(() => () => recognitionRef.current?.stop(), []);
  const SpeechRecognition = typeof window !== "undefined" ? ((window as unknown as { SpeechRecognition?: new () => any; webkitSpeechRecognition?: new () => any }).SpeechRecognition || (window as unknown as { webkitSpeechRecognition?: new () => any }).webkitSpeechRecognition) : undefined;

  const ask = async (text: string) => {
    const request = text.trim();
    if (!request || busy) return;
    setBusy(true); setNote("");
    try {
      const response = await fetch("/api/ai-command", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt: request, page, clientId }) });
      const json = await response.json().catch(() => ({})) as AiCommand & { error?: string };
      if (!response.ok) throw new Error(json.error || "The AI couldn’t do that.");
      setNote(json.reply || "Done — check the details.");
      setPrompt("");
      onCommand(json);
    } catch (reason) { setNote(reason instanceof Error ? reason.message : "The AI couldn’t do that."); }
    finally { setBusy(false); }
  };

  const talk = () => {
    if (!SpeechRecognition) { setNote("Voice input isn’t supported in this browser. Try Chrome or Edge."); return; }
    if (listening) { recognitionRef.current?.stop(); return; }
    const recognition = new SpeechRecognition();
    recognition.lang = "en-IE"; recognition.interimResults = true; recognition.continuous = false;
    let finalText = "";
    recognition.onresult = (event: any) => { let interim = ""; for (let i = event.resultIndex; i < event.results.length; i += 1) { const part = event.results[i][0].transcript; if (event.results[i].isFinal) finalText += part; else interim += part; } setPrompt((finalText + interim).trim()); };
    recognition.onerror = () => { setListening(false); setNote("Didn’t catch that — try again or type it."); };
    recognition.onend = () => { setListening(false); recognitionRef.current = null; if (finalText.trim()) void ask(finalText); };
    recognitionRef.current = recognition; setListening(true); setNote("Listening…"); recognition.start();
  };

  const examples = (EXAMPLES[page] || []).map((text) => ({ label: text, prompt: text }));
  const allChips = [...chips, ...examples].slice(0, 6);
  return <section className="ai-cmd" aria-label="Ask AI">
    <form className="ai-cmd-bar" onSubmit={(event) => { event.preventDefault(); void ask(prompt); }}>
      <span className="ai-cmd-icon" aria-hidden="true"><Sparkles size={18} /></span>
      <input value={prompt} onChange={(event) => setPrompt(event.target.value)} placeholder={listening ? "Listening… speak your request" : `Ask AI to do anything here… e.g. “${(EXAMPLES[page] || ["Add a task to call a client tomorrow"])[0]}”`} aria-label="Ask AI" disabled={busy} />
      <button type="button" className={`ai-cmd-mic${listening ? " on" : ""}`} onClick={talk} title={listening ? "Stop listening" : "Talk to the AI"} aria-label={listening ? "Stop listening" : "Talk to the AI"}>{listening ? <MicOff size={17} /> : <Mic size={17} />}</button>
      <button type="submit" className="primary-button ai-cmd-go" disabled={busy || !prompt.trim()}>{busy ? "Thinking…" : "Ask AI"}</button>
    </form>
    {note && <p className="ai-cmd-note" role="status">{note}</p>}
    {allChips.length > 0 && <div className="ai-cmd-chips">{allChips.map((chip) => <button type="button" key={chip.label} className={chip.run ? "is-suggestion" : ""} title={chip.hint || chip.label} disabled={busy} onClick={() => chip.run ? chip.run() : void ask(chip.prompt || chip.label)}>{chip.run && <Sparkles size={12} aria-hidden="true" />}{chip.label}</button>)}</div>}
  </section>;
}
