# Proposal Studio (Operations → Reports → Proposals)

AI proposal generator + live slide editor, built on the existing OS — no separate app.

**Flow:** New proposal → pick a CRM prospect, existing client, or new business + website → *Extract from website*
(cached onboarding extraction for text/services/colours, logo, photos from the home page, live desktop + phone
screenshots via mShots stored in R2) → import audits/reports/notes (client report archive, workspace audit runs,
client notes, CRM contact notes + activity, onboarding website audits) and upload PDFs/text/images (text read
automatically) → discovery notes, requirements, goal, audience, AI instructions (✨ AI Suggest on every field) →
pick services from the catalogue (per-proposal prices, add-on toggle) → *Generate* (AI copy, strict JSON schema,
merged onto a deterministic deck so a failed AI call still yields a full proposal) → live editor.

**Editor:** click any slide text to edit in place; click any image to swap (site photos, screenshots, uploads, URL);
reorder/hide/delete/add slides; inspector with ✨ per field and "Rewrite this slide with AI"; accent colour;
autosave; Full screen; Download PDF (A4 landscape print); Share link → `/f/proposal/<token>` (public via the
existing `/f/*` Access bypass, view count, client **Approve** button → status Approved).

**Code:** `lib/proposals/catalogue.ts` (service catalogue, overrides in `proposal_settings`), `deck.ts` (slide
model, AI schema), `render.ts` (pure HTML renderer: device mockups, search UI, cycle, timeline, dashboards,
pricing, animations, print CSS — runs in the browser and Worker), `server.ts` (D1 `proposals` table, R2 assets
under `proposals/<owner>/<id>/`, AI calls via the configured provider), `app/api/proposals`, `app/f/proposal/[token]`,
`components/proposal-studio-view.tsx`. Migration `drizzle/0052_proposals.sql` (tables are also created lazily).

D1: list reads one indexed query (≤100 rows, no deck column); opening reads one row by id.
