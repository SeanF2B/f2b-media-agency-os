# Operating World — integration registry & build notes

Operating World is a top-bar page (**World**, game-controller icon, always in the middle of the bar) that turns the existing CRM into a living miniature business. It is an interface layer only: every real action happens in the **existing** CRM screens and pop-ups, opened as full-screen in-game panels. The CRM stays the single source of truth.

Status: **live on main** — agency owner/admin only, per account (agency + each sub-account).

## Architecture

| Layer | Where | Notes |
|---|---|---|
| Deterministic game engine | `lib/operating-world/engine.ts` | Pure functions: rewards, levels, stages, shop rules, operational health, real-money summary, employee briefing + dialogue, industry → outfit, command parser. No DB, no AI. Tested in `tests/operating-world-engine.test.mjs`. |
| Game tables | `lib/operating-world/schema-sql.ts` | `ow_state`, `ow_ledger`, `ow_purchases`, `ow_action_log`. `CREATE TABLE IF NOT EXISTS` only; never touches CRM tables. |
| Server route | `app/api/operating-world/route.ts` | Admin auth (`authorizeAdmin`), scoped snapshot of real records, idempotent reward crediting, shop, modes, action log, AI command mapping, AI reply drafts. |
| Game view | `components/operating-world-view.tsx` + `.css` | SVG scene (no new dependencies), dialogue, task queue, HUD, drawers, panels. |
| Task-card integration | `components/agency-app.tsx` (`renderPanel`, `openNative`) | Panels render the same `CrmView`, `ConversationsView`, `SchedulingView`, `InvoicingView`, Books and Tasks components the normal pages use. Expense + receipt and New task open the app's own pop-ups. |

### Safety rules built in
- **Rewards are server-computed from real records** (e.g. `inv-paid:<id>`, `booking:<id>`), inserted with `INSERT OR IGNORE` on a primary key → a record can only ever pay out once, whether the work was done in the game or the normal CRM. Only work after the game was first opened counts. Daily cap of 25 per reward type.
- **Coins ≠ money.** Coins/XP live in `ow_ledger`. The "Real money" card shows only invoices marked paid (and outstanding totals), straight from `inv_invoices`.
- **Nothing is sent without approval.** AI reply drafts are editable; *Approve & send* goes through the existing Conversations email send (Resend, logged in Conversations) and then the existing CRM `moveOpportunity`. Failures are shown, never reported as success.
- **No invented activity.** A source that can't be read is "not connected", not zero. Dialogue is chosen deterministically from real counts.
- **Privacy:** invoices are the agency's billing of its clients, so they appear only in the agency account, never in a client sub-account.
- **Prompt injection:** customer text is passed to the AI as data; the AI can only pick from a fixed list of panels or return draft text.
- **D1 reads:** one load = ~10 indexed, capped queries; refreshes only on open, panel close, window focus, or after the app saves. No polling.

## Integration registry

Legend: ✅ in the game · 🔗 opens the existing screen inside the game · ⏳ not yet (reason)

| CRM module | Existing API / component | In Operating World | Rewards / events | Notes & blockers |
|---|---|---|---|---|
| Contacts | `/api/crm` · `CrmView` (Contacts tab) | 🔗 Quick action, command "contacts/customers" | — | |
| Leads / Pipelines / Opportunities | `/api/crm` · `CrmView` (Pipeline) | ✅ Customers in the scene = real new leads; impatient after 24 working hours; click → lead card. 🔗 Pipeline panel | Lead moved on from first stage (+20), job won (+100) | Quotations live as pipeline stages (e.g. "Proposal sent"); there's no separate quote module. |
| Conversations (SMS, WhatsApp, email) | `/api/conversations` · `ConversationsView` | ✅ Receptionist alerts on unread. 🔗 panel. ✅ AI drafts sent via existing email send | Staff reply in a thread (+20, once per thread per day) | Leads without email: Call/Copy only. |
| Scheduling / appointments / meetings | `/api/scheduling` · `SchedulingView` | ✅ Calendar assistant: quiet tomorrow, appointments to mark. ✅ Upcoming list. 🔗 panel (book, reschedule, cancel, staff, notes, reminders, Google/iCal — all existing) | Booking created (+30) | Booking uses the existing `book` action, which re-checks availability server-side (no double bookings). An in-dialogue 3-slot picker is Phase 2. |
| Invoicing / payments | `/api/invoicing` · `InvoicingView` | ✅ Accountant: drafts ready, overdue, payment received. 🔗 panel. ✅ Real-money card | Invoice sent (+50), payment confirmed (+40 / 60 XP) | Agency account only (privacy). Sub-accounts have no invoicing to *their* customers yet — **gap**. No payment-link provider (Stripe) is connected — **blocker** for "payment links". |
| Books / expenses / receipts | Workspace `financeRecords` / `client.taxBooks` · Books screen + finance pop-up | ✅ "Expenses missing receipts". 🔗 Books panel; *Record a receipt* opens the existing expense pop-up | Expense with receipt attached (+50) | **AI receipt extraction (supplier/date/VAT/line items) not built yet** — needs an AI vision call + review step on the existing pop-up; duplicate-receipt detection likewise. Camera capture works through the existing file input on mobile. |
| Tasks | Workspace `tasks` · `TasksView` | ✅ Project manager: overdue / due today. 🔗 Tasks panel; *Add a task* opens existing pop-up | Task marked Done (+20) | |
| AI Assistant (per service) | `/api/assistant` | ⏳ | — | Game command bar is separate: deterministic parser first, AI only maps to a panel. Linking to the service assistants is Phase 2. |
| CRM Automations | `/api/crm-automations` | ⏳ (Autopilot mode text points here) | — | Agency-level only by house rule. Autopilot in the game executes nothing on its own yet; it defaults to paused. |
| Forms / submissions | `/api/form-submissions`, `site-forms` | ⏳ | — | Form leads already appear as pipeline leads, so they show up as customers. |
| Marketing / social / reviews / reputation | Google Business via Windsor (read-only), Meta/Google Ads | ⏳ Marketing assistant is present but silent | — | **Blocker:** no review feed or GBP write access connected; Mia stays quiet rather than inventing reviews. |
| Projects / documents / photo uploads | Workspace `projects`, `files`, `/api/client-files`, Media Library | ⏳ | — | "Upload completed project photos" needs a project-photo target; Phase 2 via task attachments/Media Library. |
| Websites | `SitesView`, site builder | ⏳ | — | |
| Reporting / Dashboard | `Overview`, client reports | ⏳ | — | Health score is operational only and kept separate from financial figures. |
| Team management / staff access | Team page, `/api/staff-access` | ⏳ | — | Operating World is admin-only for now; sub-account staff access is Phase 2. |
| Business settings / branding | Settings → Branding, client branding | ✅ Logo, colours and name pulled automatically; manual corrections in game settings (game-only) | — | Website scraping for branding exists (`/api/onboarding-scrape`); wiring it to the game profile is Phase 2. |

## Gameplay

- **Art:** Clash-of-Clans-style isometric island in the account's brand colours and logo. Each department is a tappable building (Headquarters → upgrades, Reception → leads, Accounts → invoices/books, Calendar tower → scheduling, Workshop → tasks, Sales → pipeline, Billboard → marketing). Characters are adult, human figures in role-based clothing with one neutral stylised tone (no skin tones). Departments live inside Headquarters: tap HQ or any staff member to open *Inside HQ*, a room per department with its status and buttons into the real CRM screens.
- **The Tax Man (villain):** any expense left 7 days without a receipt triggers a raid — he marches in and steals up to 15 coins per expense (once each, never below zero). Attaching the receipt still earns +50.
- **Lead farm:** every open lead is a crop that grows with its pipeline stage, wilts when neglected and ripens when the job is won. New leads queue outside reception, longest wait first, getting impatient → bored → fed up.
- **Town life:** AI agents walk around while running tasks and snooze (z z z) while scheduled; staff with work in progress walk between buildings; leads further down the pipeline visit Sales or the Calendar tower. The Tax Man knocks when this month's expenses are missing receipts. Long grass grows while work piles up.

- **Employees** (one AI, six personalities): Rosie (reception), Sam (sales), Ada (accounts), Pete (projects), Mia (marketing), Cal (calendar). The most urgent one walks over with a line built from real counts and 2–4 options (open a screen, show the most urgent item, let AI prepare, remind me later).
- **Character** reflects the industry (hard hat + hammer for roofing/construction, cap + drill for electricians, scrubs for dentists, apron + scissors for hairdressers…), in the account's brand colours. Industry is guessed from the business name and can be corrected.
- **Collecting coins:** rewards appear as coin stacks over the employee who handled the work. Tap a stack (or *Collect all*) to bank coins and XP, with coin sounds and a fly-to-wallet animation. On each visit a *Welcome back* walkthrough explains, employee by employee, exactly which real work earned the coins, then collects them.
- **Rewards:** lead responded 20 · follow-up/task done 20 · appointment booked 30 · appointment completed 20 · receipt recorded 50 · expense recorded 10 · ad spend logged in Books 10 · invoice drafted 10 · invoice sent 50 · payment confirmed 40 · job won 100 · contact added 5 · note logged 5.
- **Upgrades (coins):** Headquarters (6 tiers, each adds a floor, gated at levels 5/10/15/20/30/50), Reception (desk → lounge → concierge), Grounds (flowers → trees → fountain), Workshop (shed → workshop → warehouse), Fleet (van → truck → second van), Signage (premium → rooftop neon), Staff café, Outfit. Each tier visibly changes the scene.
- **In-game booking:** on a lead card, *Book an appointment* shows real free slots from Scheduling; confirming uses the existing `book` action (availability re-checked, optional customer confirmation).
- **Progression:** XP → levels (L2 = 100 XP, L5 = 1,000, L10 = 4,500). Stages: Startup → Established (L5) → Expanding (L10) → Growing (L15) → Market leader (L20) → Empire (L30) → Legend (L50). Levels unlock Headquarters tiers, which you then build with coins. Upgrades are never removed.
- **Health:** working-day aware (weekends don't count as waiting). Neglect desaturates the scene and piles up paperwork; finishing work brings it back.
- **Modes:** Manual (recommend), Copilot (prepare for approval — default), Autopilot (paused by default; only rules switched on in Automations). Every in-game action and AI draft is in the action history.
- **Accessibility:** everything is clickable without walking, keyboard focus on customers, reduced-motion toggle (and respects the OS setting), sounds on by default with a mute button (browsers may hold the first sound until the first tap), solid-white pop-ups.
- **Demo scenario:** a clearly labelled demo (five driveway leads, a draft invoice, a receipt, a project task) runs entirely in the browser, touches no data, and walks through to a level-5 HQ upgrade.

## Phase 2 (proposed order)
1. AI receipt extraction + duplicate detection on the existing expense pop-up.
3. Sub-account staff access (CRM roles) and sub-account invoicing to their own customers.
4. Project photo uploads + AI project description.
5. Marketing assistant once a review/GBP feed is connected.
6. Autopilot rules (acknowledge enquiries, reminders, daily briefing) built on CRM Automations.
