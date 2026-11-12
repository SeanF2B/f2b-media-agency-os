"use client";

import { useEffect, useMemo, useState, type FormEvent } from "react";

type ConnectionState = { connected: boolean; source: "secret" | "stored" | null; fingerprint: string; secureStorageReady: boolean; canStoreToken?: boolean };
type Zone = { id: string; name: string; status: string; paused: boolean; nameServers: string[] };
type DnsRecord = { id: string; type: string; name: string; content: string; ttl: number; proxied: boolean; proxiable: boolean; priority: number | null; comment: string };
type Draft = { type: string; name: string; content: string; ttl: number; proxied: boolean; priority: number; comment: string };

const RECORD_TYPES = ["A", "AAAA", "CNAME", "TXT", "MX", "NS"];
const TTL_OPTIONS: Array<[number, string]> = [[1, "Auto"], [60, "1 min"], [300, "5 min"], [3600, "1 hour"], [86400, "1 day"]];
const emptyDraft = (): Draft => ({ type: "A", name: "", content: "", ttl: 1, proxied: false, priority: 10, comment: "" });
const canProxy = (type: string) => type === "A" || type === "AAAA" || type === "CNAME";

async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const response = await fetch(path, { method: init?.method || "GET", cache: "no-store", headers: init?.body ? { "Content-Type": "application/json" } : undefined, body: init?.body ? JSON.stringify(init.body) : undefined });
  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || "Something went wrong. Try again.");
  return payload;
}

export function DomainsDnsView() {
  const [connection, setConnection] = useState<ConnectionState | null>(null);
  const [token, setToken] = useState("");
  const [zones, setZones] = useState<Zone[]>([]);
  const [zoneId, setZoneId] = useState("");
  const [records, setRecords] = useState<DnsRecord[]>([]);
  const [filter, setFilter] = useState("");
  const [newDomain, setNewDomain] = useState("");
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [editingId, setEditingId] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [isError, setIsError] = useState(false);

  const zone = zones.find((entry) => entry.id === zoneId) || null;
  const visibleRecords = useMemo(() => {
    const term = filter.trim().toLowerCase();
    return term ? records.filter((record) => `${record.type} ${record.name} ${record.content}`.toLowerCase().includes(term)) : records;
  }, [records, filter]);

  function say(text: string, error = false) { setMessage(text); setIsError(error); }

  async function loadZones() {
    setBusy("zones");
    try {
      const payload = await api<{ zones: Zone[] }>("/api/settings/cloudflare-dns?zones=1");
      setZones(payload.zones);
      setZoneId((current) => (payload.zones.some((entry) => entry.id === current) ? current : payload.zones[0]?.id || ""));
    } catch (error) { say(error instanceof Error ? error.message : "Could not load domains.", true); }
    finally { setBusy(""); }
  }

  async function loadRecords(id: string) {
    if (!id) { setRecords([]); return; }
    setBusy("records");
    try {
      const payload = await api<{ records: DnsRecord[] }>(`/api/settings/cloudflare-dns?zone=${encodeURIComponent(id)}`);
      setRecords(payload.records);
    } catch (error) { setRecords([]); say(error instanceof Error ? error.message : "Could not load DNS records.", true); }
    finally { setBusy(""); }
  }

  useEffect(() => {
    (async () => {
      try {
        const state = await api<ConnectionState>("/api/settings/cloudflare-dns");
        setConnection(state);
        if (state.connected) await loadZones();
      } catch (error) { say(error instanceof Error ? error.message : "Could not load domain settings.", true); setConnection({ connected: false, source: null, fingerprint: "", secureStorageReady: false }); }
    })();
  }, []);

  useEffect(() => { setEditingId(""); setShowForm(false); setFilter(""); void loadRecords(zoneId); }, [zoneId]);

  async function saveToken(event: FormEvent) {
    event.preventDefault();
    setBusy("token"); say("");
    try {
      const state = await api<ConnectionState>("/api/settings/cloudflare-dns", { method: "POST", body: { action: "save-token", token } });
      setConnection(state); setToken(""); say("Cloudflare connected."); await loadZones();
    } catch (error) { say(error instanceof Error ? error.message : "Could not save the token.", true); }
    finally { setBusy(""); }
  }

  async function removeToken() {
    if (!window.confirm("Disconnect Cloudflare from Agency OS? Your domains and DNS records in Cloudflare are not changed.")) return;
    setBusy("token");
    try {
      const state = await api<ConnectionState>("/api/settings/cloudflare-dns", { method: "POST", body: { action: "remove-token" } });
      setConnection(state); if (!state.connected) { setZones([]); setZoneId(""); setRecords([]); } say("Cloudflare token removed from Agency OS.");
    } catch (error) { say(error instanceof Error ? error.message : "Could not remove the token.", true); }
    finally { setBusy(""); }
  }

  async function addDomain(event: FormEvent) {
    event.preventDefault();
    setBusy("add-zone"); say("");
    try {
      const payload = await api<{ zone: Zone }>("/api/settings/cloudflare-dns", { method: "POST", body: { action: "add-zone", name: newDomain } });
      setNewDomain(""); setZones((current) => [...current, payload.zone].sort((a, b) => a.name.localeCompare(b.name))); setZoneId(payload.zone.id);
      say(`${payload.zone.name} added. Point its nameservers to: ${payload.zone.nameServers.join(" and ") || "the nameservers shown in Cloudflare"}.`);
    } catch (error) { say(error instanceof Error ? error.message : "Could not add the domain.", true); }
    finally { setBusy(""); }
  }

  function startAdd() { setDraft(emptyDraft()); setEditingId(""); setShowForm(true); }
  function startEdit(record: DnsRecord) {
    setDraft({ type: record.type, name: record.name, content: record.content, ttl: record.ttl, proxied: record.proxied, priority: record.priority ?? 10, comment: record.comment });
    setEditingId(record.id); setShowForm(true);
  }

  async function submitRecord(event: FormEvent) {
    event.preventDefault();
    setBusy("record"); say("");
    try {
      await api("/api/settings/cloudflare-dns", { method: "POST", body: { action: editingId ? "update-record" : "create-record", zone: zoneId, recordId: editingId || undefined, record: draft } });
      say(editingId ? "DNS record updated." : "DNS record added.");
      setShowForm(false); setEditingId(""); await loadRecords(zoneId);
    } catch (error) { say(error instanceof Error ? error.message : "Could not save the record.", true); }
    finally { setBusy(""); }
  }

  async function removeRecord(record: DnsRecord) {
    if (!window.confirm(`Delete this ${record.type} record for ${record.name}? This takes effect immediately and cannot be undone.`)) return;
    setBusy("record"); say("");
    try {
      await api("/api/settings/cloudflare-dns", { method: "POST", body: { action: "delete-record", zone: zoneId, recordId: record.id } });
      say("DNS record deleted."); await loadRecords(zoneId);
    } catch (error) { say(error instanceof Error ? error.message : "Could not delete the record.", true); }
    finally { setBusy(""); }
  }

  const connected = Boolean(connection?.connected);

  return <section className="settings-panel dns-panel" aria-labelledby="dns-heading">
    <div className="settings-panel-heading"><div><p className="eyebrow">CLOUDFLARE</p><h2 id="dns-heading">Domains &amp; DNS</h2><p>Add domains to Cloudflare and manage their DNS records without leaving Agency OS.</p></div>
      <span className={`settings-connection-badge ${connected ? "connected" : "disconnected"}`}><i />{!connection ? "Checking…" : connected ? "Cloudflare connected" : "Not connected"}</span></div>

    {connection && !connected && <form className="api-key-form" onSubmit={(event) => void saveToken(event)}>
      <label htmlFor="cf-dns-token">Cloudflare API token</label>
      <div className="api-key-entry"><input id="cf-dns-token" type="password" autoComplete="new-password" spellCheck={false} placeholder="Paste your Cloudflare API token" value={token} onChange={(event) => setToken(event.target.value)} minLength={30} maxLength={80} required /><button type="submit" className="primary-button" disabled={busy === "token" || !token.trim() || connection.secureStorageReady === false}>{busy === "token" ? "Verifying…" : "Connect Cloudflare"}</button></div>
      <p className="settings-muted">Create a token at dash.cloudflare.com/profile/api-tokens with <b>Zone · Zone · Read</b>, <b>Zone · Zone · Edit</b> and <b>Zone · DNS · Edit</b> for all zones. Agency OS verifies it, encrypts it before storage and never shows it again.</p>
      {connection.secureStorageReady === false && <p className="settings-inline-error" role="alert">Secure storage needs a one-time server setup before a token can be saved here. You can instead add the token as the Worker secret CLOUDFLARE_DNS_API_TOKEN.</p>}
    </form>}

    {connected && <>
      <div className="api-key-saved"><span className="api-key-lock" aria-hidden="true">🔒</span><span><b>{connection?.source === "secret" ? "Token set on the server" : "Token saved"}</b><small>Ending in {connection?.fingerprint}</small></span>{connection?.source === "stored" && <button type="button" className="secondary-button" disabled={busy === "token"} onClick={() => void removeToken()}>Disconnect</button>}</div>

      <div className="dns-toolbar">
        <label className="dns-field"><span>Domain</span><select value={zoneId} onChange={(event) => setZoneId(event.target.value)} disabled={busy === "zones" || zones.length === 0}>{zones.length === 0 && <option value="">{busy === "zones" ? "Loading…" : "No domains yet"}</option>}{zones.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}{entry.status !== "active" ? ` (${entry.status})` : ""}</option>)}</select></label>
        <form className="dns-add-domain" onSubmit={(event) => void addDomain(event)}><label className="dns-field"><span>Add a domain</span><input value={newDomain} onChange={(event) => setNewDomain(event.target.value)} placeholder="example.com" spellCheck={false} /></label><button type="submit" className="secondary-button" disabled={busy === "add-zone" || !newDomain.trim()}>{busy === "add-zone" ? "Adding…" : "Add domain"}</button></form>
      </div>

      {zone && <>
        <p className="settings-muted dns-zone-meta">Status: <b>{zone.status}</b>{zone.nameServers.length > 0 && <> · Nameservers: {zone.nameServers.join(", ")}</>}</p>
        <div className="dns-records-head"><h3>DNS records</h3><div className="dns-records-actions"><input className="dns-search" placeholder="Search records" value={filter} onChange={(event) => setFilter(event.target.value)} aria-label="Search DNS records" /><button type="button" className="primary-button" onClick={startAdd}>＋ Add record</button></div></div>

        {showForm && <form className="dns-record-form" onSubmit={(event) => void submitRecord(event)}>
          <label className="dns-field"><span>Type</span><select value={draft.type} disabled={Boolean(editingId)} onChange={(event) => setDraft({ ...draft, type: event.target.value, proxied: canProxy(event.target.value) ? draft.proxied : false })}>{RECORD_TYPES.map((type) => <option key={type}>{type}</option>)}</select></label>
          <label className="dns-field"><span>Name</span><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="@ or www" required spellCheck={false} /></label>
          <label className="dns-field dns-field-wide"><span>{draft.type === "A" ? "IPv4 address" : draft.type === "AAAA" ? "IPv6 address" : draft.type === "CNAME" ? "Target" : draft.type === "MX" ? "Mail server" : draft.type === "NS" ? "Nameserver" : "Content"}</span><input value={draft.content} onChange={(event) => setDraft({ ...draft, content: event.target.value })} required spellCheck={false} /></label>
          {draft.type === "MX" && <label className="dns-field"><span>Priority</span><input type="number" min={0} max={65535} value={draft.priority} onChange={(event) => setDraft({ ...draft, priority: Number(event.target.value) })} /></label>}
          <label className="dns-field"><span>TTL</span><select value={draft.ttl} onChange={(event) => setDraft({ ...draft, ttl: Number(event.target.value) })}>{TTL_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
          {canProxy(draft.type) && <label className="dns-check"><input type="checkbox" checked={draft.proxied} onChange={(event) => setDraft({ ...draft, proxied: event.target.checked })} /><span>Proxied through Cloudflare</span></label>}
          <label className="dns-field dns-field-wide"><span>Note (optional)</span><input value={draft.comment} maxLength={100} onChange={(event) => setDraft({ ...draft, comment: event.target.value })} /></label>
          <div className="dns-form-actions"><button type="submit" className="primary-button" disabled={busy === "record"}>{busy === "record" ? "Saving…" : editingId ? "Save changes" : "Add record"}</button><button type="button" className="secondary-button" onClick={() => { setShowForm(false); setEditingId(""); }}>Cancel</button></div>
        </form>}

        <div className="dns-table-wrap" role="region" aria-label="DNS records" tabIndex={0}>
          <table className="dns-table"><thead><tr><th>Type</th><th>Name</th><th>Content</th><th>TTL</th><th>Proxy</th><th /></tr></thead>
            <tbody>
              {busy === "records" && records.length === 0 && <tr><td colSpan={6} className="settings-muted">Loading records…</td></tr>}
              {busy !== "records" && visibleRecords.length === 0 && <tr><td colSpan={6} className="settings-muted">{records.length === 0 ? "No DNS records yet." : "No records match your search."}</td></tr>}
              {visibleRecords.map((record) => <tr key={record.id}>
                <td><span className="dns-type">{record.type}</span></td><td className="dns-break">{record.name}</td><td className="dns-break">{record.type === "MX" && record.priority !== null ? `${record.priority} · ` : ""}{record.content}</td>
                <td>{record.ttl === 1 ? "Auto" : `${record.ttl}s`}</td><td>{record.proxiable ? (record.proxied ? "🟠 On" : "Off") : "—"}</td>
                <td className="dns-row-actions"><button type="button" className="secondary-button" onClick={() => startEdit(record)}>Edit</button><button type="button" className="secondary-button dns-danger" onClick={() => void removeRecord(record)}>Delete</button></td>
              </tr>)}
            </tbody></table>
        </div>
      </>}
    </>}

    {message && <p className={isError ? "settings-inline-error" : "settings-inline-success"} role={isError ? "alert" : "status"}>{message}</p>}
  </section>;
}
