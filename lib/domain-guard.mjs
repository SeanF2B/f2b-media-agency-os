// Domain Guard: pure logic (no I/O) for watching every domain in the Cloudflare account for
// hijacks, unexpected DNS changes, redirects to other sites, injected scripts and weak settings.
// The I/O side (Cloudflare API, D1, Telegram, email) lives in lib/domain-guard-server.ts.

/** Stable identity of a DNS record, ignoring Cloudflare's ids/timestamps. */
export function recordKey(record) {
  const type = String(record?.type || "").toUpperCase();
  const name = String(record?.name || "").toLowerCase().replace(/\.$/, "");
  const content = String(record?.content || "").trim().replace(/\.$/, "");
  const priority = record?.priority === undefined || record?.priority === null ? "" : String(record.priority);
  return `${type}|${name}|${content}|${priority}|${record?.proxied ? 1 : 0}`;
}

/** Records added / removed between two snapshots (arrays of recordKey strings or records). */
export function diffRecords(previous, next) {
  const toKeys = (list) => new Set((list || []).map((entry) => (typeof entry === "string" ? entry : recordKey(entry))));
  const before = toKeys(previous), after = toKeys(next);
  return { added: [...after].filter((key) => !before.has(key)).sort(), removed: [...before].filter((key) => !after.has(key)).sort() };
}

/** "A|www.x.ie|1.2.3.4|...|1" → "A www.x.ie → 1.2.3.4 (proxied)" for alerts. */
export function describeRecord(key) {
  const [type, name, content, priority, proxied] = String(key).split("|");
  const shown = content.length > 90 ? `${content.slice(0, 87)}…` : content;
  return `${type} ${name} → ${shown}${priority ? ` (priority ${priority})` : ""}${proxied === "1" ? " (proxied)" : ""}`;
}

const HIGH_RISK_TYPES = new Set(["A", "AAAA", "CNAME", "NS", "MX", "DS", "CAA", "HTTPS", "SVCB", "SRV"]);
export const isHighRiskRecord = (key) => HIGH_RISK_TYPES.has(String(key).split("|")[0]);

export function normaliseHost(value) {
  try { return new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`).hostname.toLowerCase().replace(/\.$/, ""); } catch { return ""; }
}

/** True when host is the domain itself or any subdomain of it. */
export function belongsTo(host, domain) {
  const h = normaliseHost(host), d = normaliseHost(domain);
  return Boolean(h && d && (h === d || h.endsWith(`.${d}`)));
}

/** External hosts a page loads scripts / iframes / forms from, or meta-refreshes to. Sorted, unique. */
export function externalHosts(html, domain) {
  const hosts = new Set();
  const text = String(html || "").slice(0, 600_000);
  const patterns = [
    /<script\b[^>]*\bsrc\s*=\s*["']?([^"'\s>]+)/gi,
    /<iframe\b[^>]*\bsrc\s*=\s*["']?([^"'\s>]+)/gi,
    /<form\b[^>]*\baction\s*=\s*["']?([^"'\s>]+)/gi,
    /<meta\b[^>]*http-equiv\s*=\s*["']?refresh["']?[^>]*content\s*=\s*["'][^"']*url\s*=\s*([^"'\s>]+)/gi,
  ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const raw = match[1].replace(/&amp;/g, "&");
      if (!/^(https?:)?\/\//i.test(raw)) continue; // relative = same site
      const host = normaliseHost(raw.startsWith("//") ? `https:${raw}` : raw);
      if (host && !belongsTo(host, domain)) hosts.add(host);
    }
  }
  return [...hosts].sort();
}

/** Text tell-tales of common site hacks (pharma / casino spam, defacement, crypto drainers). */
export function hackSignals(html) {
  const text = String(html || "").slice(0, 600_000).toLowerCase();
  const signals = [];
  const checks = [
    [/hacked by|defaced by|owned by .{0,20}hacker/, "Defacement text on the page"],
    [/\b(viagra|cialis|levitra)\b/, "Pharma spam keywords"],
    [/\b(online casino|slot gacor|judi online|situs slot)\b/, "Casino / gambling spam keywords"],
    [/coinhive|cryptonight|coin-hive|\bminero\b/, "Crypto-mining script"],
    [/eval\(\s*atob\(|eval\(\s*unescape\(|document\.write\(\s*unescape\(/, "Obfuscated script (eval/unescape)"],
    [/(seed phrase|wallet connect).{0,80}(claim|airdrop)/, "Wallet-drainer wording"],
  ];
  for (const [pattern, label] of checks) if (pattern.test(text)) signals.push(label);
  return signals;
}

/**
 * Compares a fresh observation of one domain with its stored baseline and returns findings.
 * observation: { domain, zone:{status,paused,nameServers[]}, records:[keys]|null, settings:{always_use_https,min_tls_version,ssl}|null,
 *   dnssec:string|null, registrar:{locked,autoRenew,expiresAt}|null, site:{ok,error,finalUrl,status,hops,external[],signals[]}|null }
 * baseline: same shape from the last run, or null on the first run (no change alerts, just posture).
 */
export function evaluate(observation, baseline, now = new Date()) {
  const findings = [];
  const d = observation.domain;
  const add = (severity, key, title, detail = "") => findings.push({ severity, key: `${d}:${key}`, title, detail });

  // Zone / nameservers (domain moved away from Cloudflare = classic hijack).
  if (observation.zone) {
    if (observation.zone.paused) add("critical", "zone-paused", `${d}: Cloudflare protection is PAUSED`, "The zone is paused, so traffic bypasses Cloudflare.");
    else if (observation.zone.status && observation.zone.status !== "active") add("critical", `zone-${observation.zone.status}`, `${d}: domain is no longer active on Cloudflare (${observation.zone.status})`, "Nameservers may have been changed at the registrar.");
    const ns = [...(observation.zone.nameServers || [])].sort().join(",");
    const oldNs = [...(baseline?.zone?.nameServers || [])].sort().join(",");
    if (baseline && oldNs && ns && ns !== oldNs) add("critical", `ns:${ns}`, `${d}: nameservers changed`, `Was ${oldNs}\nNow ${ns}`);
  }

  // DNS record changes.
  if (observation.records && baseline?.records) {
    const { added, removed } = diffRecords(baseline.records, observation.records);
    if (added.length || removed.length) {
      const risky = [...added, ...removed].some(isHighRiskRecord);
      const lines = [...added.map((k) => `+ ${describeRecord(k)}`), ...removed.map((k) => `− ${describeRecord(k)}`)];
      add(risky ? "critical" : "warning", `dns:${hashString(lines.join("\n"))}`, `${d}: DNS records changed (${added.length} added, ${removed.length} removed)`, `${lines.slice(0, 12).join("\n")}${lines.length > 12 ? `\n…and ${lines.length - 12} more` : ""}\nIf you or the OS didn't make this change, act now.`);
    }
  }

  // Registrar (only for domains registered through Cloudflare).
  if (observation.registrar) {
    if (observation.registrar.locked === false) add("critical", "unlocked", `${d}: registrar transfer lock is OFF`, "The domain could be transferred away. Re-lock it unless you're moving it on purpose.");
    const expires = observation.registrar.expiresAt ? new Date(observation.registrar.expiresAt) : null;
    if (expires && !Number.isNaN(expires.getTime())) {
      const days = Math.floor((expires.getTime() - now.getTime()) / 86_400_000);
      if (days <= 30 && !observation.registrar.autoRenew) add(days <= 7 ? "critical" : "warning", `expiry-${days <= 7 ? 7 : 30}`, `${d}: domain expires in ${Math.max(days, 0)} days and auto-renew is off`, "An expired domain can be registered by anyone.");
    }
  }

  // Website: where does it actually go, and did anything foreign appear on it?
  const site = observation.site, oldSite = baseline?.site;
  if (site) {
    if (!site.ok) {
      if ((observation.failCount || 0) >= 2) add("critical", "down", `${d}: website not loading`, site.error || `HTTP ${site.status || "error"}`);
    } else {
      const finalHost = normaliseHost(site.finalUrl);
      const oldHost = normaliseHost(oldSite?.finalUrl || "");
      if (oldHost && finalHost && finalHost !== oldHost) add("critical", `redirect:${finalHost}`, `${d}: website now redirects somewhere new`, `Was ending at ${oldHost}\nNow ends at ${finalHost}\nPath: ${(site.hops || []).join(" → ")}`);
      else if (!oldHost && finalHost && !belongsTo(finalHost, d)) add("info", `redirect-baseline:${finalHost}`, `${d}: website redirects to ${finalHost}`, "Recorded as the expected destination. You'll be alerted if it changes.");
      if (oldSite?.external) {
        const fresh = (site.external || []).filter((host) => !oldSite.external.includes(host));
        if (fresh.length) add("critical", `scripts:${fresh.join(",")}`, `${d}: new outside code on the homepage`, `New script/iframe/form sources: ${fresh.join(", ")}\nIf nobody added these on purpose, the site may have been injected.`);
      }
      for (const signal of site.signals || []) add("critical", `signal:${signal}`, `${d}: possible hack detected`, signal);
    }
  }

  // Security posture (non-urgent, repeated weekly at most).
  const s = observation.settings;
  if (s) {
    if (s.always_use_https === "off") add("warning", "posture-https", `${d}: "Always use HTTPS" is off`, "Visitors can land on an insecure http:// page.");
    if (s.min_tls_version && Number(s.min_tls_version) < 1.2) add("warning", "posture-tls", `${d}: old TLS ${s.min_tls_version} allowed`, "Minimum TLS should be 1.2.");
    if (s.ssl === "off" || s.ssl === "flexible") add("warning", "posture-ssl", `${d}: SSL mode is "${s.ssl}"`, "Traffic between Cloudflare and the site isn't fully encrypted.");
  }
  if (observation.dnssec && observation.dnssec !== "active") add("warning", `posture-dnssec-${observation.dnssec}`, `${d}: DNSSEC is ${observation.dnssec}`, observation.dnssec === "pending" ? "Add the DS record at the domain's registrar to finish DNSSEC (stops DNS spoofing)." : "DNSSEC protects against DNS spoofing.");

  return findings;
}

/** Tiny stable hash for dedupe keys (FNV-1a). */
export function hashString(value) {
  let hash = 0x811c9dc5;
  for (const char of String(value)) { hash ^= char.codePointAt(0); hash = Math.imul(hash, 0x01000193) >>> 0; }
  return hash.toString(36);
}

/** How long before the same finding may alert again (ms). Critical: re-remind every 6h while unacknowledged. */
export function repeatAfter(severity) {
  return severity === "critical" ? 6 * 3_600_000 : severity === "warning" ? 7 * 86_400_000 : Infinity;
}

const esc = (value) => String(value ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

/** Telegram HTML message for a batch of findings. */
export function formatTelegram(findings, appUrl = "") {
  const critical = findings.filter((f) => f.severity === "critical");
  const head = critical.length ? `🚨🚨 <b>SECURITY ALERT</b> — ${critical.length} critical` : "⚠️ <b>Domain Guard</b>";
  const body = findings.slice(0, 8).map((f) => `${f.severity === "critical" ? "🔴" : f.severity === "warning" ? "🟠" : "🔵"} <b>${esc(f.title)}</b>${f.detail ? `\n<blockquote>${esc(f.detail.slice(0, 700))}</blockquote>` : ""}`).join("\n\n");
  const more = findings.length > 8 ? `\n\n…and ${findings.length - 8} more in the OS.` : "";
  return { text: `${head}\n\n${body}${more}`, buttons: appUrl ? [{ text: "Open Domain Guard", url: `${appUrl.replace(/\/$/, "")}/?page=Settings&settings=domains` }] : [] };
}

/** Plain-text + HTML email for the same batch. */
export function formatEmail(findings) {
  const critical = findings.some((f) => f.severity === "critical");
  const subject = `${critical ? "🚨 SECURITY ALERT" : "Domain Guard"}: ${findings[0]?.title || "domain check"}${findings.length > 1 ? ` (+${findings.length - 1} more)` : ""}`.slice(0, 180);
  const text = findings.map((f) => `[${f.severity.toUpperCase()}] ${f.title}\n${f.detail}`).join("\n\n");
  const html = `<div style="font-family:Arial,sans-serif;max-width:620px">${critical ? '<p style="background:#b91c1c;color:#fff;padding:12px 14px;border-radius:8px;font-weight:bold">Critical security alert — check this now</p>' : ""}${findings.map((f) => `<div style="border-left:4px solid ${f.severity === "critical" ? "#b91c1c" : f.severity === "warning" ? "#d97706" : "#2563eb"};padding:6px 12px;margin:12px 0"><b>${esc(f.title)}</b><pre style="white-space:pre-wrap;font-family:inherit;margin:6px 0 0;color:#333">${esc(f.detail)}</pre></div>`).join("")}<p style="color:#666;font-size:12px">Sent by Domain Guard in F2B Agency OS.</p></div>`;
  return { subject, text, html };
}
