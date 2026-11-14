# Outreach — native cold-email engine (build notes, credentials, changelog)

**Placement:** Leads → tabs `Clients · Contacts · Pipeline · Conversations · Outreach · Lead Factory`.
Inside Outreach, four compact secondary tabs: `Overview · Campaigns · Inbox · Infrastructure`. Settings live in side panels.

**Independence:** no Instantly, Inframail, Smartlead or any other campaign platform. We own the campaign engine,
scheduling, sequences, ramp-up, health scoring, inbox, AI and CRM integration. External services supply only raw
infrastructure: domains + DNS (Cloudflare), mailboxes (Microsoft 365 / Google Workspace), AI tokens (OpenRouter),
alerts (Telegram Bot API).

## Shared CRM records (no duplicate CRM)
| Outreach concept | Stored in | De-duplication |
|---|---|---|
| Prospect / company | `crm_contacts` (company = `crm_contacts.company`) | owner + lower(email) + client scope; blanks filled, typed data never overwritten |
| Email thread + messages | `conv_threads` / `conv_messages` with `channel = 'email'` (shows in Conversations) | existing UNIQUE(owner, our_number, contact, channel) |
| Deal on positive reply | `crm_opportunities`, `source = 'Outreach'`, `source_submission_id = 'outreach:<contact_id>'` | existing unique index → one deal per contact; won/lost never reopened |
| Reply label, confidence, AI draft | `outreach_replies` (overlay keyed by `conv_messages.id`) | unique host message id per mailbox |
| Sequence membership | `outreach_enrollments` | partial unique index: one active sequence per contact across all campaigns; 90-day re-contact cooldown on import |

## Infrastructure (native)
| Need | How | Notes |
|---|---|---|
| Send | Microsoft Graph `sendMail` (MIME) / Gmail API `messages.send` (raw) over HTTPS from the Worker; SMTP on 465/587 via Workers TCP sockets for other hosts | Workers can't use port 25; 465/587 are allowed |
| Receive replies | Graph delta queries / Gmail history polling every 5 min from the existing cron | No IMAP servers to run |
| Create mailboxes | Graph (create user + assign Exchange licence) / Admin SDK Directory API (service account + domain-wide delegation) | Seats are bought in the provider's admin centre; the OS creates and assigns them |
| Domains | Cloudflare Registrar API (beta): search → price/availability → register | Billable to the default payment profile; explicit approval each time |
| DNS | Cloudflare DNS API via the existing Domains & DNS token, planned by `dns-plan.mjs` | Protected domains untouched; history + rollback |
| Warm-up | Native gradual ramp-up (`ramp.mjs`): 5/day +3/day to target, new domains held at 15/day for 14 days, amber halves, red stops | No engagement networks or fake conversations |
| Lead checks | Syntax, disposable, role, personal-mailbox, MX via DNS-over-HTTPS | Mailbox-level verification needs port 25, so it's optional/pay-per-use only |
| AI | Existing OpenRouter config | Email text fenced as untrusted |
| Alerts | Telegram Bot API, positive replies only, deduped via `outreach_replies.notified_at` | Approve/Edit buttons via a secret-token webhook path |

## Safety rules enforced in code
- Health score from measured signals only; grey when thin; pause on bounce > 3 %, complaints > 0.3 %, missing SPF/DKIM, connection errors, provider restrictions.
- Every step send has an idempotency key (`enrollment:step`); replies are never auto-retried.
- Unfilled personalisation variables block the send.
- One-click unsubscribe headers (RFC 8058) on every campaign email; unsubscribes, bounces and complaints go to the global suppression list.
- One send per mailbox per tick, minimum gap per mailbox, one email per company domain per tick, send windows in recipient or campaign time zone.
- Follow-ups thread (In-Reply-To/References) from the same mailbox.
- AI replies need approval by default; "meeting booked" only from calendar data.

## Credentials needed
| Item | Where | Status |
|---|---|---|
| `AGENCY_CREDENTIALS_ENCRYPTION_KEY` | Worker secret | exists |
| Microsoft Entra app (tenant id, client id, secret) with `User.ReadWrite.All`, `Mail.Send`, `Mail.Read`, scoped to outreach mailboxes by an application access policy | Outreach → Infrastructure → Connections | needed if Microsoft is chosen |
| Google service account JSON with domain-wide delegation (`admin.directory.user`, `admin.directory.domain`, `gmail.send`, `gmail.readonly`) | same | needed if Google is chosen |
| Cloudflare token with **Registrar: Edit** + Zone/DNS Edit; default registrant contact + payment method in Cloudflare | Domains & DNS | Registrar permission needed |
| Telegram bot token (from @BotFather) + chat id | Outreach settings | needed |

## Changelog
- **2026-11-14 · v3 working module** (branch `outreach/native`, CI green on `f0e712e`: strict typecheck, production build, 55 unit tests, 11-step end-to-end).
  - UI inside Leads: tabs Clients · Contacts · Pipeline · Conversations · Outreach · Lead Factory. Outreach has Overview, Campaigns (5-step builder, autosave, AI copy + lint, launch blockers), Inbox (positive first, AI drafts for approval), Infrastructure (mailboxes with flames/health/bulk toolbar, domains with repair/history/rollback, provisioning timeline, free seed placement tests, settings + Playbook drawers). Lead Factory moved out of Operations; the old "Cold Outreach" page redirects to Outreach. Admin, agency scope only.
  - Server: `/api/outreach` (state + actions), seed OAuth callback, one-click unsubscribe; scheduled engine on the 5-minute cron (send, replies, provisioning, health, auth, placement, alerts).
  - End-to-end test (`tests/e2e/outreach-one-mailbox.test.mjs`) runs the real actions + engine against SQLite with every migration and mocked Microsoft Graph / DNS / OpenRouter / Telegram: connect tenant → connect one mailbox (domain protected) → warm-up blocked until DMARC passes → launch blocked without lawful basis and when DKIM breaks → import shares CRM contacts, skips suppressed/duplicates → sends personalised mail once each with one-click unsubscribe → positive reply creates one opportunity + one Telegram alert, OOO waits a week, strangers ignored → unsubscribe permanent → Overview shows real counts and AI cost; no purchase, mailbox-creation or DNS-write calls.
  - Bugs the e2e run caught and fixed: the runtime schema split a statement on a `;` inside an SQL comment (`outreach_steps` would not have been created); one failing reply dropped the rest of the batch after the inbox cursor moved (now per message, cursor only advances when none failed); a Telegram error could abort reply handling.
- **2026-11-14 · v2 native foundation** (branch `outreach/phase-1-foundation`). Removed the Instantly adapter. Schema rewritten around shared CRM records (15 additive tables, verified in SQLite incl. the cross-campaign duplicate block). New engine modules: `ramp`, `scheduler`, `mime`, `personalise`, `leads`, `crm-link`; kept `health-score`, `dns-plan`, `reply-classifier`, `http`. 31 tests (`tests/outreach-core.test.mjs`, `tests/outreach-engine.test.mjs`). No UI or existing code changed yet.
- **2026-11-14 · v1** Instantly-based foundation (superseded).
