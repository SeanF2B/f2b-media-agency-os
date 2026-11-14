# Outreach module — build notes, credentials and changelog

Navigation: one **Outreach** entry (agency admin only) with four tabs — Overview · Campaigns · Inbox · Infrastructure. Everything else lives in contextual settings panels.

## Architecture

| Layer | Choice | Why |
|---|---|---|
| Sending, warm-up, Unibox, analytics, placement tests | **Instantly API v2** behind `lib/outreach/providers/instantly.mjs` | Spec forbids building SMTP servers; Instantly covers sending, rotation, bounce protection and reply sync. Adapter shape is provider-neutral so it can be swapped. |
| Domain purchase | **Cloudflare Registrar API (beta)** | At-cost pricing, same account as DNS, availability + price check before purchase. Billable to the account's default payment profile — always behind an explicit approval. |
| DNS | **Cloudflare DNS API** via the existing Domains & DNS token | Already connected. All changes planned by `lib/outreach/dns-plan.mjs`, logged in `outreach_dns_changes` with the previous value for rollback. |
| Mailboxes | Google Workspace or Inframail (decision pending) | Inframail's documented API covers creating/listing/deleting email accounts only. |
| Jobs | Existing 5-minute cron + `outreach_jobs` / `outreach_job_steps` (idempotent, resumable) | Queues are now on the Workers Free plan and can be added if cron throughput isn't enough. |
| AI | Existing OpenRouter configuration (`lib/ai-provider.ts`) | Reply classification + copywriting; incoming email is fenced as untrusted data. |
| Notifications | Telegram Bot API (bot to be confirmed — none exists in this repo) | Positive replies only; deduped via `outreach_replies.notified_at`. |
| Meetings booked | Existing Google Calendar integration | Never set from email text. |

## Safety rules enforced in code
- Protected (primary business) domains: no DNS actions planned at all.
- Only apex MX/SPF, `<selector>._domainkey` and `_dmarc` are considered; records the platform didn't create are never overwritten — they become conflicts. SPF is merged, never replaced.
- DMARC tightens one step at a time, only with ≥14 days / ≥100 messages of aggregate reports and no unaligned legitimate senders.
- Health score uses measured signals only; missing data is shown as unavailable; too little data → grey with no number; bounce > 3%, complaints > 0.3%, SPF/DKIM missing, connection error or provider restriction → pause.
- Replies below 75% confidence go to the review queue. Sending a reply is never auto-retried.
- Provider errors never include API keys.

## Credentials needed
| Secret / setting | Where | Status |
|---|---|---|
| `AGENCY_CREDENTIALS_ENCRYPTION_KEY` | Worker secret | Exists (used for OpenRouter keys) |
| Instantly API key (scope `all:all`) | Outreach → Infrastructure → Connections (encrypted in D1) | Needed |
| Cloudflare token with **Registrar: Edit** + Zone/DNS Edit | Domains & DNS token | Existing token has Zone/DNS only — Registrar permission needed for purchases |
| Default registrant contact + payment method | Cloudflare dashboard → Registrar | Needed before the first API purchase |
| Telegram bot token + chat ID | Outreach settings | Needed |
| Inframail API key (if chosen) | Outreach → Infrastructure → Connections | Optional |

## Database
`drizzle/0048_outreach.sql` — additive tables, all owner-scoped and indexed: `outreach_connections`, `outreach_domains`, `outreach_mailboxes`, `outreach_dns_changes`, `outreach_jobs`, `outreach_job_steps`, `outreach_suppressions`, `outreach_replies`, `outreach_audit`.

## Changelog
- **2026-11-14 — Phase 1 foundation (branch `outreach/phase-1-foundation`).** Schema migration; provider HTTP client with retry/backoff; Instantly v2 adapter (accounts, warm-up, pause/resume, limits, campaigns, analytics, received emails, reply); transparent health score; safe DNS planner (MX/SPF/DKIM/DMARC, conflicts, rollback data, DMARC progression); reply classifier (rules + fenced AI prompt + validation + review queue). 24 tests in `tests/outreach-core.test.mjs`. No UI or existing code changed yet.
