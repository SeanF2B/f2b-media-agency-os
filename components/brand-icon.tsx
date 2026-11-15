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
// Each product's own published icon (its site favicon), used when no supplied file is in public/brand/.
export const BRAND_DOMAINS: Record<string, string> = {
  "google-ads": "ads.google.com", gads: "ads.google.com", "meta-ads": "www.meta.com", meta: "www.meta.com",
  "search-console": "search.google.com", gsc: "search.google.com", ga4: "analytics.google.com",
  "business-profile": "business.google.com", gbp: "business.google.com", wordpress: "wordpress.org", site: "wordpress.org",
  dataforseo: "dataforseo.com", gohighlevel: "www.gohighlevel.com", "google-calendar": "calendar.google.com", "google-drive": "drive.google.com",
  "gmail-bookkeeping": "mail.google.com", "email-sending": "resend.com", twilio: "www.twilio.com", pagespeed: "pagespeed.web.dev",
  stripe: "stripe.com", openrouter: "openrouter.ai", cloudflare: "www.cloudflare.com", outscraper: "outscraper.com",
};
export function BrandIcon({ id, fallback, size = 20, className = "" }: { id: string; fallback: ReactNode; size?: number; className?: string }) {
  const file = BRAND_FILES[id];
  const domain = BRAND_DOMAINS[id];
  const [stage, setStage] = useState<0 | 1 | 2>(file ? 0 : domain ? 1 : 2);
  if (stage === 2) return <>{fallback}</>;
  const src = stage === 0 ? `/brand/${file}` : `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain || "")}&sz=64`;
  return <img className={`brand-icon ${className}`} src={src} referrerPolicy="no-referrer" loading="lazy" onError={() => setStage(stage === 0 && domain ? 1 : 2)} alt="" width={size} height={size} style={{ width: size, height: size, objectFit: "contain" }} />;
}
