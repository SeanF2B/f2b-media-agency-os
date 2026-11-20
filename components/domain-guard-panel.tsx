"use client";

import { useEffect, useState } from "react";

type GuardDomain = { domain: string; checkedAt: string | null; finalHost: string; dnssec: string | null; locked: boolean | null; records: number; open: number; worst: string };
type GuardEvent = { id: string; domain: string; severity: string; title: string; detail: string; createdAt: string; acknowledgedAt: string | null; acknowledgedBy: string | null };
type Overview = { domains: GuardDomain[]; events: GuardEvent[]; missingPermissions: string[]; alertEmailSet: boolean; telegramSet: boolean };

async function call<T>(init?: { action: string; id?: string }): Promise<T> {
  const response = await fetch("/api/settings/domain-guard", { method: init ? "POST" : "GET", cache: "no-store", headers: init ? { "Content-Type": "application/json" } : undefined, body: init ? JSON.stringify(init) : undefined });
  const payload = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(payload.error || "Domain Guard is unavailable right now.");
  return payload;
}

const ago = (iso: string | null) => {
  if (!iso) return "not checked yet";
  const minutes = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  return minutes < 1 ? "just now" : minutes < 60 ? `${minutes} min ago` : minutes < 1440 ? `${Math.round(minutes / 60)} h ago` : `${Math.round(minutes / 1440)} d ago`;
};

/** Domain Guard: hijack / DNS-change / redirect / injected-code watch for every domain (agency admins). */
export function DomainGuardPanel() {
  const [data, setData] = useState<Overview | null>(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [showResolved, setShowResolved] = useState(false);

  useEffect(() => { call<Overview>().then(setData).catch((e: Error) => setError(e.message)); }, []);

  async function run(action: "check" | "acknowledge", id?: string) {
    setBusy(id || action); setError("");
    try { const result = await call<{ overview: Overview }>({ action, id }); setData(result.overview); }
    catch (e) { setError(e instanceof Error ? e.message : "Something went wrong."); }
    finally { setBusy(""); }
  }

  const open = (data?.events || []).filter((e) => !e.acknowledgedAt && e.severity !== "info");
  const critical = open.filter((e) => e.severity === "critical").length;
  const events = (data?.events || []).filter((e) => showResolved || (!e.acknowledgedAt && e.severity !== "info"));
  const status = !data ? "checking" : critical ? "critical" : open.length ? "warning" : "ok";

  return <section className="settings-panel dg-panel" aria-labelledby="dg-heading">
    <div className="settings-panel-heading"><div><p className="eyebrow">SECURITY</p><h2 id="dg-heading">Domain Guard</h2><p>Watches every domain around the clock for hijacks, DNS changes, redirects to other sites and injected code, and alerts you straight away.</p></div>
      <span className={`dg-status dg-${status}`}><i />{status === "checking" ? "Checking…" : status === "critical" ? `${critical} critical` : status === "warning" ? `${open.length} to review` : "All clear"}</span></div>

    {data && <div className="dg-channels">
      <span className={data.alertEmailSet ? "on" : "off"}><i />Email alerts {data.alertEmailSet ? "on" : "off: add an admin email in Settings"}</span>
      <span className={data.telegramSet ? "on" : "off"}><i />Telegram alerts {data.telegramSet ? "on" : "off"}{!data.telegramSet && <> · <a href="/?page=CRM&leads=outreach">connect the F2B bot in Outreach settings</a></>}</span>
      <button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={() => void run("check")}>{busy === "check" ? "Checking…" : "Check now"}</button>
    </div>}
    {data && data.missingPermissions.length > 0 && <p className="settings-inline-error" role="alert">The Cloudflare token can't read: {data.missingPermissions.join(", ")}. Add these read permissions to the token so every check runs.</p>}

    {data && <div className="dg-domains" role="list">
      {data.domains.length === 0 && <p className="settings-muted">The first checks run within a few minutes. Every domain is checked roughly every 25 minutes.</p>}
      {data.domains.map((d) => <div role="listitem" key={d.domain} className={`dg-domain dg-${d.worst}`}>
        <b><i />{d.domain}</b>
        <small>{d.finalHost && d.finalHost !== d.domain ? `Lands on ${d.finalHost}` : "Site loads"} · {d.records} DNS records · DNSSEC {d.dnssec || "unknown"}{d.locked === false ? " · UNLOCKED" : d.locked ? " · transfer-locked" : ""}</small>
        <small>Checked {ago(d.checkedAt)}{d.open ? ` · ${d.open} open` : ""}</small>
      </div>)}
    </div>}

    {data && <>
      <div className="dg-events-head"><h3>Alerts</h3><label className="dns-check"><input type="checkbox" checked={showResolved} onChange={(e: { target: { checked: boolean } }) => setShowResolved(e.target.checked)} /><span>Show resolved and info</span></label></div>
      {events.length === 0 && <p className="settings-muted">Nothing needs your attention.</p>}
      <ul className="dg-events">
        {events.map((e) => <li key={e.id} className={`dg-event dg-${e.severity}${e.acknowledgedAt ? " dg-done" : ""}`}>
          <div><b>{e.title}</b><small>{new Date(e.createdAt).toLocaleString()}{e.acknowledgedAt ? ` · ${e.acknowledgedBy === "auto-resolved" ? "fixed" : `marked known by ${e.acknowledgedBy}`}` : ""}</small>{e.detail && <pre>{e.detail}</pre>}</div>
          {!e.acknowledgedAt && e.severity !== "info" && <button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={() => void run("acknowledge", e.id)}>{busy === e.id ? "Saving…" : "It was us"}</button>}
        </li>)}
      </ul>
    </>}
    {error && <p className="settings-inline-error" role="alert">{error}</p>}
  </section>;
}
