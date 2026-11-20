# Domain Guard

Always-on hijack and tamper watch for every domain in the F2B Cloudflare account (agency + client domains).

**Where:** Settings → Domains & DNS (and Operations → Sites → Domains), agency admins only. Alert links open `/?page=Settings&settings=domains`.

## What it checks (every domain, roughly every 25 minutes)
| Check | Alert |
|---|---|
| Live nameservers (DNS-over-HTTPS) still the zone's Cloudflare nameservers | Critical: domain pointed away (registrar hijack) |
| Zone paused / no longer active | Critical |
| DNS records added / removed / changed | Critical for A, AAAA, CNAME, NS, MX, DS, CAA, SRV, HTTPS; warning for TXT |
| Homepage redirect chain ends somewhere new | Critical |
| New outside script / iframe / form-action / meta-refresh host on the homepage | Critical (possible injection) |
| Defacement, pharma/casino spam, crypto-miner, eval/unescape obfuscation | Critical |
| Site down / TLS error (2 checks in a row) | Critical |
| Registrar transfer lock off; expiry ≤ 30 days without auto-renew | Critical / warning |
| Always HTTPS off, TLS < 1.2, SSL off/flexible, DNSSEC not active (hourly) | Warning |

## Rule for every domain (current and future)
Any domain added to the Cloudflare account is picked up automatically within the hour (zone list refresh) and, on its first check, gets **Always HTTPS on, minimum TLS 1.2 and DNSSEC on** applied automatically (logged as an info event in the panel). Weak settings that reappear later are re-fixed the same way. SSL mode and registrar lock are alerted on but never changed automatically. Opt out with Worker var `DOMAIN_GUARD_AUTO_SECURE=off`.

## Alerts
- Telegram (existing F2B bot, send-only) for every critical and warning alert.
- High-priority email to `SECURITY_ALERT_EMAIL` (Worker var) or the admin email in Settings for every critical alert (and warnings when Telegram isn't connected). Logged in system emails.
- Unacknowledged critical alerts re-remind every 6 hours; warnings weekly. Conditions that clear resolve themselves.
- "It was us" in the panel marks a change as known (e.g. you added a DNS record on purpose).

## Technical
- `lib/domain-guard.mjs` (pure logic, tested in `tests/domain-guard.test.mjs`), `lib/domain-guard-server.ts` (I/O), `app/api/settings/domain-guard/route.ts`, `components/domain-guard-panel.tsx`.
- Runs inside the existing 5-minute cron, 2 domains per tick (≈8 subrequests), oldest-checked first. Settings/DNSSEC refreshed hourly; zone list + registrar cached 1 hour.
- D1 tables (created on demand): `domain_guard_state`, `domain_guard_events`, `domain_guard_meta`. All lookups by primary key / index.
- Uses the Domains & DNS Cloudflare token. Read permissions needed: Zone Read, DNS Read, Zone Settings Read; optional account Registrar Domains Read. Missing permissions are shown in the panel.

## Also hardened (20 Nov 2026)
- Response headers: HSTS 1 year + includeSubDomains, `frame-ancestors 'self'` CSP and X-Frame-Options on all non-public pages, `no-store` on private JSON API responses, `X-Permitted-Cross-Domain-Policies: none`. Public `/f/*` and `/api/marketing-public*` keep their own embeddable policies.
- getf2bmedia.com: Always HTTPS on, minimum TLS 1.2, DNSSEC enabled.
