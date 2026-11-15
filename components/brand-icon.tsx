"use client";
import { useState, type ReactNode } from "react";

// Official product logos live in public/brand/ (added as supplied files, never redrawn).
// Until a file is present the plain fallback icon is shown.
export const BRAND_FILES: Record<string, string> = {
  "google-ads": "google-ads.svg", gads: "google-ads.svg", "meta-ads": "meta.svg", meta: "meta.svg",
  "search-console": "google-search-console.svg", gsc: "google-search-console.svg", ga4: "google-analytics.svg",
  "business-profile": "google-business-profile.svg", gbp: "google-business-profile.svg", wordpress: "wordpress.svg", site: "wordpress.svg",
  dataforseo: "dataforseo.svg", gohighlevel: "gohighlevel.svg", "google-calendar": "google-calendar.svg", "google-drive": "google-drive.svg",
  "gmail-bookkeeping": "gmail.svg", "email-sending": "resend.svg", twilio: "twilio.svg", pagespeed: "pagespeed.svg",
};
export function BrandIcon({ id, fallback, size = 20, className = "" }: { id: string; fallback: ReactNode; size?: number; className?: string }) {
  const file = BRAND_FILES[id];
  const [failed, setFailed] = useState(false);
  if (!file || failed) return <>{fallback}</>;
  return <img className={`brand-icon ${className}`} src={`/brand/${file}`} alt="" width={size} height={size} style={{ width: size, height: size, objectFit: "contain" }} onError={() => setFailed(true)} />;
}
