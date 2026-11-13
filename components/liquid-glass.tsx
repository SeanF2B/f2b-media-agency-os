"use client";

// The liquid glass look is now permanent (no toggle). Pop-ups stay solid; see f2b-icons-glass.css.
import { useEffect } from "react";

export function LiquidGlass() {
  useEffect(() => {
    document.documentElement.classList.add("f2b-glass");
    try { window.localStorage.removeItem("f2b-liquid-glass"); } catch { /* storage blocked */ }
  }, []);
  return null;
}
