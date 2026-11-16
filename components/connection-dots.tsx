"use client";

import { useState } from "react";
import { appAlert, appPrompt } from "./app-dialog";
import { BrandIcon } from "./brand-icon";
import { Check, Link2, Mail } from "lucide-react";

export type OpsClient = {
  id: string; name: string; status?: string; logo?: string; color?: string; email?: string;
  services?: Array<{ name: string }>;
  googleAdsAccountId?: string; metaAdsAccountId?: string; googleSearchConsoleAccountId?: string; googleAnalyticsAccountId?: string;
  googleBusinessProfileAccountId?: string; googleBusinessProfileLocationId?: string; wordpressSiteUrl?: string; website?: string;
};

// Every connection a client can have, shown as an icon with a green (connected) or red (missing) dot.
const CONNECTIONS: Array<{ key: string; label: string; page: string; ok: (client: OpsClient, hasSite: boolean) => boolean; icon: React.ReactNode }> = [
  { key: "gads", label: "Google Ads", page: "Google Ads", ok: (c) => Boolean(c.googleAdsAccountId), icon: <svg viewBox="0 0 24 24"><path fill="currentColor" d="M9.4 3.6a3 3 0 0 1 4.1 1.1l6.6 11.4a3 3 0 1 1-5.2 3l-6.6-11.4a3 3 0 0 1 1.1-4.1ZM5 15.5a3 3 0 1 1 0 6 3 3 0 0 1 0-6Z" /></svg> },
  { key: "meta", label: "Meta Ads", page: "Meta Ads", ok: (c) => Boolean(c.metaAdsAccountId), icon: <svg viewBox="0 0 24 24"><path fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" d="M3 15c0-4 2-8 4.5-8C11 7 13 17 16.5 17 19 17 21 14.5 21 12s-1.5-5-3.5-5C14 7 12 17 7.5 17 5 17 3 16 3 15Z" /></svg> },
  { key: "gsc", label: "Search Console", page: "SEO", ok: (c) => Boolean(c.googleSearchConsoleAccountId), icon: <svg viewBox="0 0 24 24"><circle cx="10.5" cy="10.5" r="6" fill="none" stroke="currentColor" strokeWidth="2.4" /><path stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" d="m15 15 5 5" /></svg> },
  { key: "ga4", label: "Google Analytics", page: "SEO", ok: (c) => Boolean(c.googleAnalyticsAccountId), icon: <svg viewBox="0 0 24 24"><rect x="4" y="12" width="4" height="8" rx="2" fill="currentColor" /><rect x="10" y="8" width="4" height="12" rx="2" fill="currentColor" /><rect x="16" y="3" width="4" height="17" rx="2" fill="currentColor" /></svg> },
  { key: "gbp", label: "Business Profile", page: "SEO", ok: (c) => Boolean(c.googleBusinessProfileLocationId || c.googleBusinessProfileAccountId), icon: <svg viewBox="0 0 24 24"><path fill="currentColor" d="M4 4h16l1.5 5a3 3 0 0 1-5 2.2 3 3 0 0 1-5 0 3 3 0 0 1-5 0A3 3 0 0 1 2.5 9L4 4Zm1 9.5V20h14v-6.5a5 5 0 0 1-3.5-.6 5 5 0 0 1-3.5 1 5 5 0 0 1-3.5-1 5 5 0 0 1-3.5.6Z" /></svg> },
  { key: "site", label: "Website", page: "Sites", ok: (c, hasSite) => hasSite || Boolean(c.wordpressSiteUrl), icon: <svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" strokeWidth="2" /><path fill="none" stroke="currentColor" strokeWidth="2" d="M3 12h18M12 3c3 3.5 3 14.5 0 18M12 3c-3 3.5-3 14.5 0 18" /></svg> },
];
export function ConnectionDots({ client, hasSite, onOpen }: { client: OpsClient; hasSite: boolean; onOpen: (page: string) => void }) {
  const done = CONNECTIONS.filter((item) => item.ok(client, hasSite)).length;
  const pct = Math.round(done / CONNECTIONS.length * 100);
  return <span className="ops-conn"><span className={`ops-conn-pct ${pct >= 80 ? "good" : pct >= 50 ? "mid" : "low"}`} style={{ ["--pct" as string]: `${pct}%` }} title={`${done} of ${CONNECTIONS.length} connected`}><b>{pct}%</b></span>{CONNECTIONS.map((item) => { const ok = item.ok(client, hasSite); return <button key={item.key} type="button" className={ok ? "ok" : "missing"} title={`${item.label}: ${ok ? "connected" : "not connected"}`} aria-label={`${item.label} ${ok ? "connected" : "not connected"}`} onClick={() => onOpen(ok ? item.page : "Integrations")}><BrandIcon id={item.key} size={16} fallback={item.icon} /><i /></button>; })}{done < CONNECTIONS.length && <QuickConnectLink client={client} missing={CONNECTIONS.filter((item) => !item.ok(client, hasSite)).map((item) => item.label)} />}</span>;
}
// Quick link a client can open to connect their own accounts (their Launchpad), copied or emailed in one click.
function QuickConnectLink({ client, missing }: { client: OpsClient; missing: string[] }) {
  const [copied, setCopied] = useState(false);
  const [link, setLink] = useState("");
  // A signed, login-free link to the client's own connect page (no Agency OS / Cloudflare sign-in needed).
  const getLink = async () => { if (link) return link; const response = await fetch(`/api/client-connect-link?clientId=${encodeURIComponent(client.id)}`, { cache: "no-store" }); const json = await response.json().catch(() => ({})) as { url?: string; error?: string }; if (!response.ok || !json.url) throw new Error(json.error || "Couldn’t make the link."); setLink(json.url); return json.url; };
  const copy = async () => { let url = ""; try { url = await getLink(); await navigator.clipboard.writeText(url); setCopied(true); window.setTimeout(() => setCopied(false), 1600); } catch (reason) { if (url) await appPrompt("Copy this link:", url); else await appAlert(reason instanceof Error ? reason.message : "Couldn’t make the link."); } };
  const email = async () => { try { const url = await getLink(); window.location.href = mailFor(url); } catch (reason) { await appAlert(reason instanceof Error ? reason.message : "Couldn’t make the link."); } };
  const mailFor = (url: string) => `mailto:${encodeURIComponent((client as OpsClient & { email?: string }).email || "")}?subject=${encodeURIComponent(`Connect your accounts · ${client.name}`)}&body=${encodeURIComponent(`Hi,\n\nCould you connect these so we can manage everything in one place: ${missing.join(", ")}.\n\nOpen this link and follow the steps (no login needed):\n${url}\n\nThanks!`)}`;
  return <span className="ops-quick-link"><button type="button" title={copied ? "Link copied" : "Copy a connect link for this client"} aria-label={`Copy connect link for ${client.name}`} onClick={() => void copy()}>{copied ? <Check size={14} /> : <Link2 size={14} />}</button><button type="button" onClick={() => void email()} title="Email the connect link to the client" aria-label={`Email connect link to ${client.name}`}><Mail size={14} /></button></span>;
}
