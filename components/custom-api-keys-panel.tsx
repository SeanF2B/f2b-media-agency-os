"use client";

import { useEffect, useState, type FormEvent } from "react";

type SavedKey = { id: string; label: string; note: string; fingerprint: string; updatedAt: string };
type Payload = { keys?: SavedKey[]; secureStorageReady?: boolean; error?: string };

export function CustomApiKeysPanel() {
  const [keys, setKeys] = useState<SavedKey[]>([]);
  const [ready, setReady] = useState(true);
  const [loading, setLoading] = useState(true);
  const [label, setLabel] = useState("");
  const [note, setNote] = useState("");
  const [apiKey, setApiKey] = useState("");
  const [editingId, setEditingId] = useState("");
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);

  function apply(payload: Payload) { setKeys(payload.keys || []); if (payload.secureStorageReady !== undefined) setReady(payload.secureStorageReady); }

  useEffect(() => {
    (async () => {
      try {
        const response = await fetch("/api/settings/custom-api-keys", { cache: "no-store" });
        const payload = await response.json() as Payload;
        if (!response.ok) throw new Error(payload.error || "Could not load saved API keys.");
        apply(payload);
      } catch (error) { setMessage(error instanceof Error ? error.message : "Could not load saved API keys."); setIsError(true); }
      finally { setLoading(false); }
    })();
  }, []);

  function reset() { setLabel(""); setNote(""); setApiKey(""); setEditingId(""); }

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true); setMessage(""); setIsError(false);
    try {
      const response = await fetch("/api/settings/custom-api-keys", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: editingId || undefined, label, note, apiKey }) });
      const payload = await response.json() as Payload;
      if (!response.ok) throw new Error(payload.error || "Could not save the key.");
      apply(payload); setMessage(editingId ? `${label} updated.` : `${label} saved.`); reset();
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save the key."); setIsError(true); }
    finally { setSaving(false); }
  }

  async function remove(key: SavedKey) {
    if (!window.confirm(`Remove “${key.label}” from Agency OS? Anything using this key will stop working.`)) return;
    setMessage(""); setIsError(false);
    try {
      const response = await fetch(`/api/settings/custom-api-keys?id=${encodeURIComponent(key.id)}`, { method: "DELETE" });
      const payload = await response.json() as Payload;
      if (!response.ok) throw new Error(payload.error || "Could not remove the key.");
      apply(payload); setMessage(`${key.label} removed.`);
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not remove the key."); setIsError(true); }
  }

  return <section className="settings-panel dns-panel" aria-labelledby="custom-keys-heading">
    <div className="settings-panel-heading"><div><p className="eyebrow">CONNECTIONS</p><h2 id="custom-keys-heading">Other API keys</h2><p>Save keys for any other service you use. They are encrypted before storage and only the last four characters are ever shown.</p></div><span className={`settings-connection-badge ${keys.length ? "connected" : "disconnected"}`}><i />{loading ? "Checking…" : `${keys.length} saved`}</span></div>

    {keys.length > 0 && <ul className="custom-key-list">{keys.map((key) => <li key={key.id}>
      <span className="api-key-lock" aria-hidden="true">🔑</span>
      <span className="custom-key-text"><b>{key.label}</b><small>Ending in {key.fingerprint}{key.note ? ` · ${key.note}` : ""}</small></span>
      <button type="button" className="secondary-button" onClick={() => { setEditingId(key.id); setLabel(key.label); setNote(key.note); setApiKey(""); setMessage(""); }}>Replace</button>
      <button type="button" className="secondary-button dns-danger" onClick={() => void remove(key)}>Remove</button>
    </li>)}</ul>}

    <form className="api-key-form" onSubmit={(event) => void save(event)}>
      <div className="dns-record-form custom-key-form">
        <label className="dns-field"><span>Name</span><input value={label} onChange={(event) => setLabel(event.target.value)} placeholder="e.g. Resend, DataForSEO" maxLength={60} required /></label>
        <label className="dns-field dns-field-wide"><span>{editingId ? "New API key" : "API key"}</span><input type="password" autoComplete="new-password" spellCheck={false} value={apiKey} onChange={(event) => setApiKey(event.target.value)} required /></label>
        <label className="dns-field dns-field-wide"><span>Note (optional)</span><input value={note} onChange={(event) => setNote(event.target.value)} maxLength={200} placeholder="What it is used for" /></label>
        <div className="dns-form-actions"><button type="submit" className="primary-button" disabled={saving || !label.trim() || !apiKey.trim() || !ready}>{saving ? "Saving…" : editingId ? "Update key" : "＋ Add API key"}</button>{editingId && <button type="button" className="secondary-button" onClick={reset}>Cancel</button>}</div>
      </div>
      {!ready && <p className="settings-inline-error" role="alert">Secure storage needs a one-time server setup before keys can be saved.</p>}
      <p className="settings-muted">Saving a key stores it safely. A feature only uses it once it has been connected to that service.</p>
    </form>
    {message && <p className={isError ? "settings-inline-error" : "settings-inline-success"} role={isError ? "alert" : "status"}>{message}</p>}
  </section>;
}
