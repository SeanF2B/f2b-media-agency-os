# Onboarding engine: public funnel + internal wizard

One engine powers both the internal **Operations → Onboarding** wizard and the public customer funnel at **`/f/start`**.
They share sessions, the business-profile cache, the website/document extractor, the AI field helper, the audit
pipeline, CRM records and Stripe checkout. Nothing is duplicated.

## Where things live

| Piece | File |
|---|---|
| Pure logic (routes, questions, profile merge, AI prompts + claim guard, CRM matching, limits, audit findings, offer mapping, pricing, Stripe signature/outcomes, signed links, upload validation, PDF/zip text) | `lib/onboarding/engine.mjs` (+ `.d.mts`) |
| Tables (runtime-created, same SQL as `drizzle/0051_onboarding_engine.sql`) | `lib/onboarding/schema-sql.mjs` |
| Server: sessions, settings, encrypted Stripe keys, limits, Turnstile, uploads, AI helper, CRM sync, audits, Stripe, client creation | `lib/onboarding/server.ts` |
| Website + document extraction (also used by the internal "Fill from website") | `lib/onboarding/extract.ts` |
| Public page (self-contained HTML, nonce CSP, embeddable) | `lib/onboarding/page.ts` → `app/f/start/route.ts`, `app/f/start/[token]/route.ts` |
| Public API | `app/api/marketing-public/onboarding/route.ts`, `…/onboarding/upload/route.ts` |
| Stripe webhook | `app/api/marketing-public/stripe/route.ts` |
| Admin API (settings, pricing, Stripe keys, links, stats, internal AI helper) | `app/api/onboarding/route.ts` |
| Admin UI | `components/onboarding-admin.tsx` (Operations → Onboarding → Online onboarding) |
| Internal AI helper UI (suggest, improve, shorter, more professional, alternatives as chips, regenerate) | `components/ai-field-assist.tsx` |
| Tests | `tests/onboarding-engine.test.mjs` |

All public routes sit under the already-approved Access bypass paths (`/f/*`, `/api/marketing-public*`). No new Access rule is needed.

## Entry routes

`grow` (I'm ready to grow), `audit` (Audit my business), `guidance` (I need some guidance). Each one is just a different
step order over one question bank (`QUESTIONS` / `ROUTE_STEPS`). Every route ends at personalised recommendations, campaign
previews, checkout or a booked call. Offer actions (`Build my marketing plan`, `Show me an improved website`, `Preview my
Google Ads`, `Fix these issues`, `Book a strategy call`) resume the same session at the right step. Nothing is re-asked.

## Business information

Website URL, uploaded files (PDF/brochures, logos, brand guidelines, photos, `.zip`/`.html` site files) or a CRM contact
(personalised link). Extracted facts are cached per domain in `onboarding_business_profiles`, each with its source and a
confirmed flag. Typed answers become confirmed. Extracted ones show "From your website · Looks right ✓" until confirmed.
Uploads are checked by real file signature (not the file name); zips are listed from the central directory before
unpacking (max 500 files / 60 MB); SVGs with scripts are refused. Files are stored privately in R2 at
`onboarding/<owner>/<session>/` and are never served publicly.

## AI

One helper (`aiAssist`) for both sides. Factual fields (phone, email, address, IDs, URLs) never call AI. Every reply goes
through `guardClaims`, which removes guarantees, awards, accreditations, review counts, "years" and similar claims unless
they appear in the business's own answers, site or documents. Anonymous visitors can't generate ad/website previews until
they've left contact details (admin can allow it in Limits).

## Audit

Reuses the same checks as the CRM website audit/report: `runPublicTechnicalAudit`, `runPageSpeedInsights` (mobile) and
the DataForSEO Google Maps check, plus tags read from the site's own HTML (GA4, GTM, Google Ads AW-, Meta pixel, schema,
tap-to-call, forms). Five stages run one per request, so progress is genuine. A cron safety net finishes audits whose tab
closed. Every finding is labelled **Verified**, **AI recommendation** or **Unavailable** (Ads performance and Search Console
always show as unavailable until connected). The first `freeFindings` (default 3) are free; contact details unlock the rest.
Finished audits are reused for `auditCacheDays` (default 7).

## CRM

Only after contact details + consent: one contact (matched on email → phone → domain, blanks filled, nothing overwritten),
one opportunity per session (`source_submission_id = onboarding:<session>`, uniquely indexed) in the first open stage of
the first pipeline, and an activity note for each milestone. Opportunity notes carry the entry route, source, business info,
recommendations, opportunities, progress, approvals, booking and payment status. New automation triggers:
`onboarding_started`, `audit_completed`, `guidance_requested`, `checkout_completed`, `payment_failed`.
Personalised links (CRM contact prefill, cold email, referral, staff with higher limits) come from Online onboarding → Share.

## Limits (Online onboarding → Limits)

Defaults: 3 audits per visitor per day, 1 fresh audit per website per day, 40 AI calls per session, 80 per visitor,
10 new sessions per visitor, 20 uploads per session, global caps of 150 audits and 3,000 AI calls per day, staff × 10.
Counters live in `onboarding_usage` (atomic per bucket, pruned after 3 days). Turnstile protects anonymous starts
once `TURNSTILE_SITE_KEY` and `TURNSTILE_SECRET_KEY` are set on the Worker. Until then the other limits still apply.

## Payments (Online onboarding → Payments)

Stripe Checkout, **test mode by default**. Keys are stored encrypted (same AES-GCM storage as the AI keys). Going live
requires both the live secret key and live webhook secret, plus a confirmation. Prices are computed on the server from
Pricing settings: one-off setup fees, monthly management (bundle discount for 2+ services) and the optional dedicated
manager. Google/Meta ad spend is never charged; the checkout states it's billed directly by Google/Meta.

- Idempotency key per session + selection (no duplicate checkouts). Each webhook event id is applied once (`stripe_events`).
- Each paid Stripe invoice is mirrored once into OS invoicing, marked paid (`stripe_invoice_links`).
- On payment: a workspace client is created (marked `createdVia: "onboarding"`, protected from stale browser saves), with
  setup checklists in Tasks. The CRM opportunity moves to Won, and the customer is redirected to `/f/connect/<token>` to connect accounts.
- Failed payments and cancellations are logged on the CRM record and trigger automations.
- Manual invoicing is unchanged.

Webhook URL: `https://<agency-os-host>/api/marketing-public/stripe`. Events: `checkout.session.completed`,
`checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`,
`invoice.paid`, `invoice.payment_failed`, `customer.subscription.updated`, `customer.subscription.deleted`.

## Embedding on f2bmedia.com

```html
<iframe src="https://<agency-os-host>/f/start?embed=1" title="Get started with F2B Media" style="width:100%;min-height:720px;border:0" loading="lazy"></iframe>
```
Allowed parent sites are set in Settings → Embed sites (`frame-ancestors`). The page posts
`{ type: "f2b-onboarding-height", height }` to the parent for auto-height. Checkout opens in a new tab when embedded.

## Optional Worker secrets

`TURNSTILE_SITE_KEY`, `TURNSTILE_SECRET_KEY`, `ONBOARDING_LINK_SECRET` (falls back to the existing encryption keys).
