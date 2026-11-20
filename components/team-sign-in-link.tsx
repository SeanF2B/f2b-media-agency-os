"use client";

import { useEffect, useState } from "react";
import { Check, Copy, Link2, Mail, MessageSquareText } from "lucide-react";

// Team → Sign-in link: the exact link people are sent to log in, ready to copy or paste into a
// message. Inside a sub-account the link opens straight into that client's account.
export function TeamSignInLink({ scopeClientId = "", scopeClientName = "", onOpenSystemEmails }: { scopeClientId?: string; scopeClientName?: string; onOpenSystemEmails?: () => void }) {
  const [copied, setCopied] = useState("");
  const [slug, setSlug] = useState("");
  // The client switcher opens an account from ?client=<slug>; look the slug up once for this sub-account.
  useEffect(() => {
    setSlug("");
    if (!scopeClientId) return;
    void fetch("/api/client-accounts", { cache: "no-store" }).then((r) => r.json()).then((j: { accounts?: Array<{ clientId?: string; slug?: string }> }) => setSlug((j.accounts || []).find((a) => a.clientId === scopeClientId)?.slug || "")).catch(() => undefined);
  }, [scopeClientId]);
  const origin = typeof window === "undefined" ? "" : window.location.origin;
  const link = scopeClientId && slug ? `${origin}/?client=${encodeURIComponent(slug)}` : `${origin}/`;
  const message = `Hi,\n\nHere’s your link to the ${scopeClientName ? `${scopeClientName} account on the ` : ""}F2B Media workspace:\n${link}\n\nOpen it and sign in with your email and password. First time? Use the set-password link from your invite, or tap “Forgot password?” to get a new one.\n\nOn your phone you can add it to your home screen like an app.\n\nThanks!`;
  const copy = async (text: string, what: string) => {
    try { await navigator.clipboard.writeText(text); } catch { window.prompt("Copy this:", text); }
    setCopied(what); window.setTimeout(() => setCopied(""), 1600);
  };
  return <section className="team-signin">
    <div className="team-signin-text"><Link2 size={18} aria-hidden="true" /><div><b>Sign-in link{scopeClientName ? ` · ${scopeClientName}` : ""}</b><span>Send this to staff and clients so they can log in{scopeClientName ? " straight into this account" : ""}.</span></div></div>
    <code className="team-signin-link" title={link}>{link}</code>
    <div className="team-signin-actions">
      <button type="button" className="primary-button" onClick={() => void copy(link, "link")}>{copied === "link" ? <><Check size={15} /> Copied</> : <><Copy size={15} /> Copy link</>}</button>
      <button type="button" className="secondary-button" onClick={() => void copy(message, "message")}>{copied === "message" ? <><Check size={15} /> Copied</> : <><MessageSquareText size={15} /> Copy message</>}</button>
      {onOpenSystemEmails && <button type="button" className="secondary-button" onClick={onOpenSystemEmails} title="See every email the system has sent"><Mail size={15} /> System emails</button>}
    </div>
  </section>;
}
