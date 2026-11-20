"use client";

import { useEffect, useState } from "react";

type Me = { email: string | null; impersonatedBy: string | null; owner: boolean };
type LoginOption = { email: string; name: string; role: string; avatar?: string; clientLogo?: string; clientName?: string };

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

/** Profile menu: owner-only "Log in as" (type to search, staff photo, client logo or agency icon) plus Sign out. */
export function ProfileMenuAuthItems({ options }: { options: LoginOption[] }) {
  const [me, setMe] = useState<Me | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => { void loadMe().then(setMe); }, []);
  const self = (me?.impersonatedBy || me?.email || "").toLowerCase();
  const q = query.trim().toLowerCase();
  const list = options.filter((o) => o.email && o.email.toLowerCase() !== self && (!q || `${o.name} ${o.role} ${o.clientName || ""} ${o.email}`.toLowerCase().includes(q)));
  const go = async (email: string) => { setBusy(email); setError(""); try { await signInAs(email); } catch (e) { setError(e instanceof Error ? e.message : "Could not sign in as that user."); setBusy(""); } };
  return <>
    {me?.owner && <>
      <div className="profile-menu-separator" />
      <div className="lia">
        <style>{LIA_CSS}</style>
        <label className="profile-menu-label" htmlFor="login-as-search">Log in as</label>
        <input id="login-as-search" type="search" autoComplete="off" placeholder="Type a name…" value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && list[0]) void go(list[0].email); }} />
        <ul role="listbox" aria-label="Users">
          {list.slice(0, 30).map((o) => <li key={o.email}><button type="button" role="option" aria-selected={false} disabled={Boolean(busy)} onClick={() => void go(o.email)}>
            <span className="lia-av">{o.avatar && /^(data:image\/|https:\/\/)/.test(o.avatar) ? <img src={o.avatar} alt="" /> : <b>{initialsOf(o.name)}</b>}<i className="lia-badge" title={o.clientName || "Agency"}><img src={o.clientLogo || AGENCY_ICON} alt="" /></i></span>
            <span className="lia-txt"><b>{o.name}</b><small>{o.role}{o.clientName ? ` · ${o.clientName}` : " · Agency"}</small></span>
            {busy === o.email && <span className="lia-busy">…</span>}
          </button></li>)}
          {!list.length && <li className="lia-empty">No one matches “{query}”.</li>}
        </ul>
        {error && <small className="form-error" role="status">{error}</small>}
      </div>
    </>}
    {me?.impersonatedBy && <button role="menuitem" onClick={() => void backToMine()}>Back to my account</button>}
    <div className="profile-menu-separator" />
    <a role="menuitem" className="profile-menu-signout" href="/logout">Sign out</a>
  </>;
}

const AGENCY_ICON = "/f2b-media-mark.png";
const initialsOf = (name: string) => name.split("|")[0].trim().split(/\s+/).map((w) => w[0] || "").join("").slice(0, 2).toUpperCase() || "?";
const LIA_CSS = `
.lia input{width:100%;margin:4px 0 6px;padding:8px 10px;border-radius:10px;border:1px solid rgba(127,127,127,.3);background:transparent;color:inherit;font:inherit;font-size:13px}
.lia input:focus,.lia input:hover{border-color:var(--brand-secondary,var(--brand-primary,#287cac));outline:none}
.lia ul{list-style:none;margin:0;padding:0;max-height:260px;overflow-y:auto;display:flex;flex-direction:column;gap:2px}
.lia li button{width:100%;display:flex;align-items:center;gap:10px;padding:6px 8px;border:0;border-radius:10px;background:transparent;color:inherit;font:inherit;text-align:left;cursor:pointer;transition:background .15s,transform .15s}
.lia li button:hover{background:rgba(127,127,127,.12);transform:translateY(-1px)}
.lia-av{position:relative;width:32px;height:32px;flex:none}.lia-av>img,.lia-av>b{width:32px;height:32px;border-radius:50%;object-fit:cover;display:grid;place-items:center;background:rgba(127,127,127,.2);font-size:12px}
.lia-badge{position:absolute;right:-4px;bottom:-3px;width:16px;height:16px;border-radius:5px;background:#fff;box-shadow:0 0 0 2px rgba(0,0,0,.15);overflow:hidden;display:grid;place-items:center}.lia-badge img{width:14px;height:14px;object-fit:contain}
.lia-txt{flex:1;min-width:0}.lia-txt b{display:block;font-size:13px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.lia-txt small{font-size:11.5px;opacity:.7}
.lia-empty{font-size:12.5px;opacity:.7;padding:6px 8px}.lia-busy{font-weight:800}
`;

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
