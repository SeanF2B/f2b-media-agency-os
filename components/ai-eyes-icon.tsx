import type { ReactNode } from "react";

/** The animated blue AI "eyes" icon used in place of the robot emoji everywhere. */
export function AiEyesIcon() {
  return <span className="ai-eyes-icon" aria-hidden="true"><span className="ai-eyes-antenna" /><span className="ai-eyes-face"><i /><i /></span></span>;
}

/** Renders an icon value, swapping the robot emoji for the animated AI icon. */
export function AiIcon({ v }: { v?: ReactNode }) {
  return <>{v === "🤖" ? <AiEyesIcon /> : v}</>;
}
