"use client";
import { useCallback, useEffect, useState } from "react";

// Demo AI approvals for the "Sample data" switch: chat replies the AI held back because they contain a
// scheduling link (house rule: the AI never sends a booking link on its own). Shared by the Dashboard's
// AI approvals list and the Conversations inbox, so approving or dismissing in one place clears both.
// Nothing is sent or saved on the server.

export type SampleHeld = { id: string; threadId: string; name: string; channel: "whatsapp" | "sms" | "instagram"; clientId: string; body: string; reason: string; ask: string; minsAgo: number };

const slug = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "book";

export function isTattooClient(clientName: string) { return /tattoo|ink|poppy|piercing/i.test(clientName); }

/** The held replies for this account. threadId matches the sample inbox thread it belongs to. */
export function sampleHeldReplies(clientId: string, clientName: string): SampleHeld[] {
  const base = `/f/book/${slug(clientName || "your-business")}`;
  const first = (clientName || "the studio").trim();
  if (isTattooClient(clientName)) return [
    { id: "sample-held-0", threadId: "sample-thread-0", name: "Aoife Brennan", channel: "whatsapp", clientId, ask: "When could I come in to chat about it?", minsAgo: 9,
      body: `Love those references Aoife! The next step is a free 30 min consultation with the artist. Pick a time that suits you here: ${base}-consultation`,
      reason: "Aoife asked when she could come in, so the AI wants to send the consultation booking link." },
    { id: "sample-held-1", threadId: "sample-thread-3", name: "Jade Murphy", channel: "instagram", clientId, ask: "Can I book a helix piercing this week?", minsAgo: 26,
      body: `Hi Jade! Yes, we've a few piercing slots this week. You can book your helix here and pay online: ${base}-piercings`,
      reason: "Jade asked to book a piercing, so the AI wants to send the piercing booking link." },
  ];
  return [
    { id: "sample-held-0", threadId: "sample-thread-0", name: "Mary Burke", channel: "whatsapp", clientId, ask: "When could someone come out to look at it?", minsAgo: 9,
      body: `Thanks Mary. You can pick a time for a free visit from ${first} here and we'll confirm straight away: ${base}-free-quote`,
      reason: "Mary asked when someone could come out, so the AI wants to send the booking link." },
  ];
}

const KEY = "f2b-sample-held-done";
const EVENT = "f2b-sample-held";
type Done = Record<string, { at: string; outcome: "sent" | "dismissed"; body?: string }>;
const read = (): Done => { try { return JSON.parse(localStorage.getItem(KEY) || "{}") as Done; } catch { return {}; } };
const key = (clientId: string, id: string) => `${clientId || "agency"}:${id}`;

/** Which sample approvals were handled (per account), kept in sync live across the Dashboard and Conversations. */
export function useSampleHeldDone() {
  const [done, setDone] = useState<Done>(read);
  useEffect(() => {
    const sync = () => setDone(read());
    window.addEventListener(EVENT, sync); window.addEventListener("storage", sync);
    return () => { window.removeEventListener(EVENT, sync); window.removeEventListener("storage", sync); };
  }, []);
  const mark = useCallback((clientId: string, id: string, outcome: "sent" | "dismissed", body?: string) => {
    const next = { ...read(), [key(clientId, id)]: { at: new Date().toISOString(), outcome, body } };
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* storage off */ }
    setDone(next); window.dispatchEvent(new Event(EVENT));
  }, []);
  const get = useCallback((clientId: string, id: string) => done[key(clientId, id)], [done]);
  return { get, mark };
}

/** Clears the handled sample approvals when Sample data is switched back on, so the demo starts fresh. */
export function resetSampleHeld() { try { localStorage.removeItem(KEY); } catch { /* storage off */ } window.dispatchEvent(new Event(EVENT)); }

// "Open chat" from the Dashboard: remember which thread to open, then the inbox picks it up.
const OPEN_KEY = "f2b-conv-open-thread";
export function requestOpenThread(threadId: string) { try { sessionStorage.setItem(OPEN_KEY, threadId); } catch { /* storage off */ } }
export function takeOpenThread(): string { try { const v = sessionStorage.getItem(OPEN_KEY) || ""; sessionStorage.removeItem(OPEN_KEY); return v; } catch { return ""; } }
