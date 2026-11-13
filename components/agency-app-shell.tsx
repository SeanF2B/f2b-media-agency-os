"use client";

import dynamic from "next/dynamic";
import { EmojiIcons } from "./emoji-icons";
import { LiquidGlass } from "./liquid-glass";

const AgencyApp = dynamic(() => import("./agency-app").then((module) => module.AgencyApp), {
  ssr: false,
  loading: () => <main className="app-loading-screen" role="status" aria-live="polite">Opening your workspace…</main>,
});

export function AgencyAppShell() {
  return <><AgencyApp /><EmojiIcons /><LiquidGlass /></>;
}
