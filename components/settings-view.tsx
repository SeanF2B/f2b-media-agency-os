"use client";

import { useEffect, useState, type FormEvent } from "react";

type ApiKeyState = { connected: boolean; fingerprint: string; updatedAt: string | null; secureStorageReady: boolean };

export function SettingsView() {
  const [state, setState] = useState<ApiKeyState | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const response = await fetch("/api/settings/api-keys", { cache: "no-store" });
      const payload = await response.json() as ApiKeyState & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not load API key settings.");
      setState(payload);
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not load API key settings.");
      setIsError(true);
    } finally { setLoading(false); }
  }

  useEffect(() => { void load(); }, []);

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true); setMessage(""); setIsError(false);
    try {
      const response = await fetch("/api/settings/api-keys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ provider: "openrouter", apiKey }) });
      const payload = await response.json() as ApiKeyState & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not save the OpenRouter key.");
      setState(payload); setApiKey(""); setMessage("OpenRouter connected. Agency OS will now use this key for AI tasks.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not save the OpenRouter key."); setIsError(true);
    } finally { setSaving(false); }
  }

  async function remove() {
    if (!window.confirm("Remove the OpenRouter key from Agency OS? New AI work will stop until another provider is connected.")) return;
    setRemoving(true); setMessage(""); setIsError(false);
    try {
      const response = await fetch("/api/settings/api-keys", { method: "DELETE" });
      const payload = await response.json() as ApiKeyState & { error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not remove the OpenRouter key.");
      setState(payload); setMessage("OpenRouter key removed from Agency OS.");
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Could not remove the OpenRouter key."); setIsError(true);
    } finally { setRemoving(false); }
  }

  return <main className="settings-view">
    <header className="settings-page-header"><div><p className="eyebrow">WORKSPACE SETTINGS</p><h1>Settings</h1><p>Manage the services Agency OS uses for AI work.</p></div></header>
    <section className="settings-panel" aria-labelledby="api-keys-heading">
      <div className="settings-panel-heading"><div><p className="eyebrow">CONNECTIONS</p><h2 id="api-keys-heading">API keys</h2><p>Connect an AI provider once, then choose Grok or Claude on each AI employee.</p></div><span className={`settings-connection-badge ${state?.connected ? "connected" : "disconnected"}`}><i />{loading ? "Checking…" : state?.connected ? "OpenRouter connected" : "Not connected"}</span></div>
      {loading && !state ? <p className="settings-muted" role="status">Loading secure connection status…</p> : <form className="api-key-form" onSubmit={(event) => void save(event)}>
        {state?.connected && <div className="api-key-saved"><span className="api-key-lock" aria-hidden="true">🔒</span><span><b>OpenRouter key saved</b><small>Ending in {state.fingerprint} · {state.updatedAt ? `Updated ${new Date(state.updatedAt).toLocaleString("en-IE", { dateStyle: "medium", timeStyle: "short" })}` : ""}</small></span><button type="button" className="secondary-button" disabled={removing} onClick={() => void remove()}>{removing ? "Removing…" : "Remove key"}</button></div>}
        <label htmlFor="openrouter-api-key">{state?.connected ? "Replace API key" : "OpenRouter API key"}</label>
        <div className="api-key-entry"><input id="openrouter-api-key" type="password" autoComplete="new-password" spellCheck={false} placeholder="sk-or-v1-…" value={apiKey} onChange={(event) => setApiKey(event.target.value)} minLength={40} maxLength={180} required /><button type="submit" className="primary-button" disabled={saving || !apiKey.trim() || state?.secureStorageReady === false}>{saving ? "Verifying and saving…" : state?.connected ? "Verify & replace" : "Verify & connect"}</button></div>
        <p className="settings-muted">Agency OS verifies the key with OpenRouter, encrypts it before storage and never displays it again. Only the last four characters are shown. Rotate any key you’ve pasted into a chat.</p>
        {state?.secureStorageReady === false && <p className="settings-inline-error" role="alert">Secure storage needs a one-time server setup before a key can be saved.</p>}
      </form>}
      {message && <p className={isError ? "settings-inline-error" : "settings-inline-success"} role={isError ? "alert" : "status"}>{message}</p>}
      <div className="settings-provider-note"><b>Models</b><span>OpenRouter provides Grok and Claude through one connection. AI employee model assignments remain in Team settings.</span></div>
    </section>
  </main>;
}
