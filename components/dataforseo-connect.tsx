"use client";

import { useEffect, useState, type FormEvent } from "react";

export const DATAFORSEO_CONNECTED_EVENT = "f2b:dataforseo-connected";
type Status = { connected: boolean; login?: string; balance?: number | null; saved?: boolean; message?: string; error?: string };

/**
 * Inline DataForSEO connection used across Operations → SEO (keywords, Maps ranks, rank tracking, backlinks).
 * Shows nothing but a small "Connected" line once the login works; otherwise a one-step login form.
 */
export function DataForSeoConnect({ onConnected, compact = false }: { onConnected?: () => void; compact?: boolean }) {
  const [status, setStatus] = useState<Status | null>(null);
  const [login, setLogin] = useState("");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/integrations/dataforseo", { cache: "no-store" })
      .then(async (response) => (response.status === 403 || response.status === 401) ? { connected: true } as Status : await response.json() as Status)
      .then((payload) => { if (!cancelled) { setStatus(payload); if (payload.login) setLogin(payload.login); } })
      .catch(() => { if (!cancelled) setStatus({ connected: false, message: "Could not check the DataForSEO connection." }); });
    const refresh = () => setStatus((current) => current ? { ...current, connected: true } : current);
    window.addEventListener(DATAFORSEO_CONNECTED_EVENT, refresh);
    return () => { cancelled = true; window.removeEventListener(DATAFORSEO_CONNECTED_EVENT, refresh); };
  }, []);

  async function connect(event: FormEvent) {
    event.preventDefault();
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/integrations/dataforseo", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ login, password }) });
      const payload = await response.json() as Status;
      if (!response.ok || !payload.connected) throw new Error(payload.error || "Could not connect DataForSEO.");
      setStatus(payload); setPassword("");
      window.dispatchEvent(new CustomEvent(DATAFORSEO_CONNECTED_EVENT));
      onConnected?.();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not connect DataForSEO."); }
    finally { setSaving(false); }
  }

  if (!status) return null;
  if (status.connected) {
    if (compact || !status.login) return null;
    return <p className="dfs-connect-ok" role="status"><span className="dfs-connect-dot" /> DataForSEO connected{status.balance != null ? ` · balance $${status.balance.toFixed(2)}` : ""}</p>;
  }
  return <form className="dfs-connect" onSubmit={(event) => void connect(event)}>
    <div className="dfs-connect-head"><b>Connect DataForSEO</b><span>{status.saved ? status.message : "Powers keyword research, Maps rankings, rank tracking, backlinks and community leads. Enter it once and it works everywhere."}</span></div>
    <label><span>API login</span><input type="text" autoComplete="username" value={login} onChange={(event) => setLogin(event.target.value)} placeholder="you@company.com" required /></label>
    <label><span>API password</span><input type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} placeholder="From DataForSEO → API Access" required /></label>
    <button type="submit" className="primary-button" disabled={saving || !login.trim() || !password.trim()}>{saving ? "Checking login…" : "Test & connect"}</button>
    <small>Find these at <a href="https://app.dataforseo.com/api-access" target="_blank" rel="noopener noreferrer">app.dataforseo.com → API Access</a>. Checking the login is free; it's stored encrypted.</small>
    {error && <p className="dfs-connect-error" role="alert">{error}</p>}
  </form>;
}
