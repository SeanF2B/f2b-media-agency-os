# CRM Automations — setup notes

Native workflow automations for the Agency OS CRM (sidebar → **Workspace → Automations**). Nothing here connects to or copies from GoHighLevel. The existing GoHighLevel-based **Marketing → Marketing Automations** page is untouched and separate.

## What's in this change

| Part | Files |
| --- | --- |
| Database | `drizzle/0043_crm_automations.sql` (also embedded in `lib/crm-automations/schema-sql.ts` and created on first use, so the app works even before the migration is applied) |
| Model + tree helpers | `lib/crm-automations/model.ts` |
| Runner | `lib/crm-automations/engine.ts`, called from the existing 5-minute cron in `worker/index.ts` |
| API | `app/api/crm-automations/route.ts` (owners/admins only, same rule as `/api/crm`) |
| UI | `components/crm-automations-view.tsx` (list), `components/crm-automation-builder.tsx` (canvas), `components/crm-automations.css` |
| Tests | `tests/crm-automations.test.mjs` — run with `node --test tests/crm-automations.test.mjs` |

Changes outside the feature were kept to the minimum needed to show it: one nav entry, one page line and the breadcrumb label in `components/agency-app.tsx`, the access rule in `lib/sidebar-access.ts`, and the cron call in `worker/index.ts`.

## One-time setup

1. **Apply the migration** (optional — the tables are also created automatically on first use):
   `npx wrangler d1 execute f2b-media-agency-os --remote --file drizzle/0043_crm_automations.sql`
2. **Email**: "Send email" and "Notify me" use the existing Worker secrets `RESEND_API_KEY` and `TASK_NOTIFICATION_FROM`. Contacts receive mail from the `TASK_NOTIFICATION_FROM` address, so make sure that domain is verified in Resend. Without these, automations can still be built and test-run, but an automation with an email step can't be switched on.
3. No new packages. The canvas is built in-house (pan, zoom, pinch, dot grid, fit to screen) with the already-installed `lucide-react`, so the lockfile and Workers Builds are unaffected.

## How it runs

- **Triggers** are detected on the 5-minute cron, so a step can start up to ~5 minutes after the event:
  - *New lead from website form* — new CRM contacts whose source is `Website form · <form name>` (created by the existing form handler).
  - *Pipeline stage changed* — deals whose stage differs from the last stage seen. The first time a stage automation is switched on, the current stage of every deal is recorded once as the starting point.
  - *Task completed* — tasks marked Done. Runs for the contact that created the task (automation tasks) or the client's CRM contact.
  - *Tag added* — instantly queued when an automation (or the API `addTag` action) adds a tag.
  - *Date/time* — once or daily/weekly/monthly in Irish time, for everyone in the account or only contacts with a chosen tag (up to 500 per firing).
- **Scope**: each automation belongs to one client (or the agency). It only sees that client's contacts and deals; agency automations see records with no client.
- **Waits** are stored as a resume time and picked up by the cron.

## Safety

- New automations start **off**. Switching on checks every step is filled in.
- Switching on an automation that **sends emails** needs an admin and a confirmation dialog listing the subjects. Editing a live automation so that it newly sends emails switches it off until it's confirmed again.
- **Emergency stop** (per client, and for the agency): pauses everything for that account and stops anyone part-way through.
- **Test run**: pick a contact; every step is simulated (including If/Else decisions and merge fields) and nothing is sent or changed. Test runs appear in history marked "Test".
- **Run history**: last 50 runs per automation with each step, its time, and any error.
- **Idempotent**: events have unique keys; a run is unique per automation + event; a contact can't be in the same automation twice at once (unique index); each step runs at most once per run; emails use a Resend Idempotency-Key per run + step; tasks, deals and alerts use deterministic ids. Failed steps retry up to 3 times (5, 10 min), then the run is marked failed with the reason.
- An automation never re-triggers itself (loop guard).

## D1 read budget

- Idle tick (nothing switched on, nothing waiting): only empty index probes.
- Change detection reads only rows changed since a stored cursor (`crm_contacts` / `crm_opportunities` via `(owner_id, updated_at)` indexes; tasks from the single workspace document), and only for trigger types that are switched on.
- Every query is index-backed and has a LIMIT; writes are batched. Two indexes were added to existing tables for this: `crm_contacts(owner_id, client_id, updated_at)` and `crm_opportunities(owner_id, contact_id, updated_at)`.

## Known limits / follow-ups (need your OK — they touch files outside this feature)

1. **Instant triggers**: one-line `emitAutomationEvent(...)` calls in `/api/crm` (stage moves) and `/api/marketing-public` (form submissions) would make those triggers fire immediately instead of within 5 minutes.
2. **Tags in the CRM screens**: there was no contact tagging before; tags are currently added by automations (and the API). A tag editor on the contact card would make "Tag added" useful by hand.
3. **Client switcher**: `<CrmAutomationsView clientId={...} />` accepts the selected client from the switcher (`""`/`null` = agency). Until that is wired, the page shows its own "Account" picker.
4. **Alerts bell**: "Notify me" alerts show on the Automations page and by email; a top-bar bell would need a change to the shared header.
5. **SMS** is listed as "Coming soon" (Twilio later).
6. Emails are plain text with paragraphs; there is no unsubscribe link yet, so only use them for people who expect to hear from you.
