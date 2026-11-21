"use client";

import { useState, type FormEvent } from "react";

/** Launchpad: connect Revolut Business for invoice Pay now links, right here (no page jump). Same API as Books → Invoicing → Settings. */
export function RevolutConnect({ onConnected }: { onConnected?: () => void }) {
  const [key, setKey] = useState("");
  const [mode, setMode] = useState<"live" | "sandbox">("live");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(false);

  async function connect(event: FormEvent) {
    event.preventDefault();
    setSaving(true); setError("");
    try {
      const response = await fetch("/api/invoicing", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "save-payments", revolutKey: key.trim(), revolutMode: mode }) });
      const payload = await response.json().catch(() => ({})) as { payments?: { revolut?: { connected?: boolean } }; error?: string };
      if (!response.ok || !payload.payments?.revolut?.connected) throw new Error(payload.error || "Revolut couldn't be connected.");
      setKey(""); setDone(true); onConnected?.();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Revolut couldn't be connected."); }
    finally { setSaving(false); }
  }

  if (done) return <p className="dfs-connect-ok" role="status"><span className="dfs-connect-dot" /> Revolut connected. Every invoice now has a Pay now button.</p>;
  return <form id="lp-revolut" className="dfs-connect" onSubmit={(event) => void connect(event)}>
    <div className="dfs-connect-head"><b>Connect Revolut Business</b><span>Adds a Pay now button to invoices: Apple Pay, Google Pay, pay by bank (fee capped at €5) and card. Paid invoices update by themselves.</span></div>
    <label><span>Merchant API secret key</span><input type="password" autoComplete="off" value={key} onChange={(event) => setKey(event.target.value)} placeholder="sk_…" required /></label>
    <label><span>Mode</span><select value={mode} onChange={(event) => setMode(event.target.value as "live" | "sandbox")}><option value="live">Live</option><option value="sandbox">Sandbox (testing)</option></select></label>
    <button type="submit" className="primary-button" disabled={saving || !key.trim()}>{saving ? "Checking key…" : "Test & connect"}</button>
    <small>In the Revolut Business app: turn on online payments (Merchant), then APIs → Merchant API → copy the secret key. It's stored encrypted.</small>
    {error && <p className="dfs-connect-error" role="alert">{error}</p>}
  </form>;
}
