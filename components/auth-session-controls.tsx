"use client";

import { useEffect, useState } from "react";

type Me = { email: string | null; impersonatedBy: string | null; owner: boolean };
type LoginOption = { email: string; label: string };

let meCache: Promise<Me | null> | null = null;
function loadMe() {
  if (!meCache) meCache = fetch("/api/auth/me", { cache: "no-store", credentials: "same-origin" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
  return meCache;
}

async function signInAs(email: string) {
  const res = await fetch("/api/auth/impersonate", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ email }) });
  const out = await res.json().catch(() => ({})) as { error?: string };
  if (!res.ok) throw new Error(out.error || "Could not sign in as that user.");
  window.location.assign("/");
}
async function backToMine() {
  await fetch("/api/auth/return", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: "{}" }).catch(() => undefined);
  window.location.assign("/");
}

/** Profile menu: owner-only "Log in as" (real sign-in as that person) plus Sign out. */
export function ProfileMenuAuthItems({ options }: { options: LoginOption[] }) {
  const [me, setMe] = useState<Me | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => { void loadMe().then(setMe); }, []);
  const canImpersonate = Boolean(me?.owner);
  return <>
    {canImpersonate && <>
      <div className="profile-menu-separator" />
      <label className="profile-menu-label" htmlFor="login-as-select">Log in as</label>
      <select id="login-as-select" value="" disabled={busy} onChange={async (event) => { const email = event.target.value; if (!email) return; setBusy(true); setError(""); try { await signInAs(email); } catch (e) { setError(e instanceof Error ? e.message : "Could not sign in as that user."); setBusy(false); } }}>
        <option value="">{busy ? "Signing in…" : "Choose a user…"}</option>
        {options.filter((o) => o.email && o.email.toLowerCase() !== (me?.impersonatedBy || me?.email || "").toLowerCase()).map((o) => <option key={o.email} value={o.email}>{o.label}</option>)}
      </select>
      {error && <small className="form-error" role="status">{error}</small>}
    </>}
    {me?.impersonatedBy && <button role="menuitem" onClick={() => void backToMine()}>Back to my account</button>}
    <div className="profile-menu-separator" />
    <a role="menuitem" className="profile-menu-signout" href="/logout">Sign out</a>
  </>;
}

/** Thin bar across the top while the owner is signed in as someone else. */
export function ImpersonationBanner() {
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => { void loadMe().then(setMe); }, []);
  if (!me?.impersonatedBy) return null;
  return <div role="status" style={{ position: "fixed", left: "50%", bottom: 14, transform: "translateX(-50%)", zIndex: 10000, display: "flex", alignItems: "center", gap: 12, padding: "9px 10px 9px 16px", borderRadius: 999, background: "#1d2833", color: "#fff", boxShadow: "0 10px 30px rgba(0,0,0,.35)", fontSize: 13, maxWidth: "calc(100vw - 24px)" }}>
    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>Signed in as <b>{me.email}</b></span>
    <button type="button" onClick={() => void backToMine()} style={{ border: 0, borderRadius: 999, padding: "7px 13px", background: "#287cac", color: "#fff", fontWeight: 700, cursor: "pointer", whiteSpace: "nowrap" }}>Back to my account</button>
  </div>;
}
