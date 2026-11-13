"use client";

// Trial "liquid glass" look. On by default; the floating switch turns it off/on for this browser.
import { useEffect, useState } from "react";

export function LiquidGlass() {
  const [on, setOn] = useState(true);
  useEffect(() => {
    let saved: string | null = null;
    try { saved = window.localStorage.getItem("f2b-liquid-glass"); } catch { /* storage blocked */ }
    setOn(saved !== "off");
  }, []);
  useEffect(() => {
    document.documentElement.classList.toggle("f2b-glass", on);
    try { window.localStorage.setItem("f2b-liquid-glass", on ? "on" : "off"); } catch { /* storage blocked */ }
  }, [on]);
  return <button type="button" className="f2b-glass-toggle" onClick={() => setOn((value) => !value)} aria-pressed={on} title="Toggle the liquid glass look">
    <span aria-hidden="true" className="f2b-glass-toggle-dot" />{on ? "Glass on" : "Glass off"}
  </button>;
}
