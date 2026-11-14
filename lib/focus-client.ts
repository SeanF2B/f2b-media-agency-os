"use client";
import { useEffect, useRef } from "react";

// Agency-view "focus client": pick a client once in the top bar and every section filters to it.
const KEY = "f2b-focus-client";
const EVENT = "f2b-focus-client";
export const readFocusClient = () => { try { return window.localStorage.getItem(KEY) || ""; } catch { return ""; } };
export function setFocusClient(id: string) {
  try { if (id) window.localStorage.setItem(KEY, id); else window.localStorage.removeItem(KEY); } catch { /* storage unavailable */ }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: id }));
}
/** Calls `apply` with the current focus client on mount and whenever it changes. Skipped inside a client sub-account. */
export function useFocusClient(apply: (id: string) => void, enabled = true) {
  const ref = useRef(apply); ref.current = apply;
  useEffect(() => {
    if (!enabled) return;
    const current = readFocusClient(); if (current) ref.current(current);
    const on = (event: Event) => ref.current(String((event as CustomEvent).detail || ""));
    window.addEventListener(EVENT, on);
    return () => window.removeEventListener(EVENT, on);
  }, [enabled]);
}
