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
// Google's own product icons (their favicons are all the same "G").
const PRODUCT_ICONS: Record<string, string> = {
  "google-calendar": "https://www.gstatic.com/images/branding/product/2x/calendar_2020q4_48dp.png",
  "google-drive": "https://www.gstatic.com/images/branding/product/2x/drive_2020q4_48dp.png",
  "gmail-bookkeeping": "https://www.gstatic.com/images/branding/product/2x/gmail_2020q4_48dp.png",
  ga4: "https://www.gstatic.com/analytics-suite/header/suite/v2/ic_analytics.svg",
  "google-ads": "https://www.gstatic.com/images/branding/product/2x/google_ads_48dp.png", gads: "https://www.gstatic.com/images/branding/product/2x/google_ads_48dp.png",
  "search-console": "https://www.gstatic.com/images/branding/product/2x/search_console_48dp.png", gsc: "https://www.gstatic.com/images/branding/product/2x/search_console_48dp.png",
  "business-profile": "https://www.gstatic.com/images/branding/product/2x/google_my_business_48dp.png", gbp: "https://www.gstatic.com/images/branding/product/2x/google_my_business_48dp.png",
};
export function BrandIcon({ id, fallback, size = 20, className = "" }: { id: string; fallback: ReactNode; size?: number; className?: string }) {
  const sources = [BRAND_FILES[id] ? `/brand/${BRAND_FILES[id]}` : "", PRODUCT_ICONS[id] || "", BRAND_DOMAINS[id] ? `https://www.google.com/s2/favicons?domain=${encodeURIComponent(BRAND_DOMAINS[id])}&sz=64` : ""].filter(Boolean);
  const [index, setIndex] = useState(0);
  if (index >= sources.length) return <>{fallback}</>;
  return <img key={sources[index]} className={`brand-icon ${className}`} src={sources[index]} referrerPolicy="no-referrer" loading="lazy" onError={() => setIndex(index + 1)} alt="" width={size} height={size} style={{ width: size, height: size, objectFit: "contain" }} />;
}
