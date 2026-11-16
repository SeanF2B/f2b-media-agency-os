"use client";
import { useCallback, useEffect, useState } from "react";

// One shared "Sample data" switch for every page (Dashboard, Scheduling, …), kept in sync live.
const KEY = "f2b-dash-sample";
const EVENT = "f2b-sample-data";
const read = () => { try { return localStorage.getItem(KEY) === "1"; } catch { return false; } };

export function useSampleData(): [boolean, (on: boolean) => void] {
  const [on, setOn] = useState(read);
  useEffect(() => {
    const sync = () => setOn(read());
    window.addEventListener(EVENT, sync); window.addEventListener("storage", sync);
    return () => { window.removeEventListener(EVENT, sync); window.removeEventListener("storage", sync); };
  }, []);
  const set = useCallback((next: boolean) => {
    try { localStorage.setItem(KEY, next ? "1" : "0"); } catch { /* storage unavailable */ }
    setOn(next); window.dispatchEvent(new Event(EVENT));
  }, []);
  return [on, set];
}
