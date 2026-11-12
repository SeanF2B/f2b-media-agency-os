# F2B Media Agency OS — independent hosting

This app is prepared for deployment to an F2B-owned Cloudflare account. The current ChatGPT Sites address remains live until the independent copy has been deployed and its private access has been verified.

## One-time account setup

1. Create or sign in to a Cloudflare account owned by F2B Media.
2. Install Cloudflare Wrangler login from this computer with `wrangler login` and approve it in the browser.
3. In **Workers & Pages**, create a D1 database named `f2b-media-agency-os`.
4. Apply every SQL migration in `drizzle/` to the database in numeric order, including `0026_google_search_console_connection.sql` for direct Search Console sign-in, `0031_seo_backlink_outreach.sql` for client-scoped backlink follow-ups, and `0032_seo_competitor_keyword_research.sql` for saved competitor keyword-gap reports. Client files use D1 on the no-subscription setup and are limited to 1 MB each.
5. Build the project, then run `node scripts/configure-cloudflare-deploy.mjs <D1 database ID> [R2 bucket name]` with the ID returned by Cloudflare. `f2b-marketing-studio-assets` is the private R2 bucket for uploaded marketing builder images; the Worker binds it as `BUCKET` and serves only uploaded images referenced by published pages.
6. Deploy the built Worker with `wrangler deploy --config dist/server/wrangler.json`.
7. In **Workers & Pages → f2b-media-agency-os → Access**, enable protection for **all traffic**. Allow only Sean's email at first, and choose one-time PIN or another verified sign-in method.
8. To have staff profiles manage this allow list automatically and apply the owner-approved public marketing paths, configure the Cloudflare Access API: set `F2B_CF_ACCESS_APP_ID` and `F2B_CF_ACCESS_POLICY_ID` to the workspace Access app and its exact-email allow policy IDs. Create a custom account-scoped API token for this Cloudflare account with **Access: Apps and Policies Read** and **Access: Apps and Policies Edit**, then store it as the Worker secret `CLOUDFLARE_ACCESS_API_TOKEN`. Keep the token secret; do not place it in `wrangler.json` or source control. After deploying these settings, saving a staff profile adds that saved email to the existing allow rule. The owner/admin-only Integrations action can also create and verify only `/f/*`, `/api/marketing-public*`, `/sitemap.xml`, `/robots.txt`, and the signature-verified `/api/gohighlevel/webhook` path apps; it verifies the root private allow policy and never edits it. The app preserves other rules and verifies its changes.
8. Open the resulting `workers.dev` URL and confirm the sign-in screen and workspace load before using it for agency records.

## GoHighLevel connections

The client workroom now uses one agency-level OAuth installation. It lists installed HighLevel sub-accounts, links each location to one F2B client, and makes that client mapping available to every assistant mode. Agency refresh tokens and client access tokens are encrypted in D1 with `GOOGLE_ADS_TOKEN_ENCRYPTION_KEY`.

### One-time HighLevel Marketplace app setup

1. In [HighLevel Marketplace](https://marketplace.gohighlevel.com/), create a **private** app. Choose target user **Sub-account**, allow agency installation, and enable agency bulk installation. Install/approve all current locations; enable installation for future locations if the app's distribution settings offer it.
2. In **Advanced Settings → Auth**, add this exact redirect URL: `https://f2b-media-agency-os.f2b-media.workers.dev/api/oauth/callback`.
3. Grant only these scopes:
   `locations.readonly locations/customFields.readonly funnels/funnel.readonly funnels/page.readonly workflows.readonly workflows.write workflows.publish workflows.logs adPublishing.readonly adPublishing.write`
4. Save the Marketplace app's Client ID, Client Secret, App ID, and generated installation URL. Keep the Client Secret private.
5. In Cloudflare Dashboard → **Workers & Pages → f2b-media-agency-os → Settings → Variables and Secrets**, add these Worker secrets/variables:
   - Secret `GHL_CLIENT_ID`
   - Secret `GHL_CLIENT_SECRET`
   - Variable `GHL_APP_ID`
   - Variable `GHL_INSTALL_URL` (the generated app installation URL)
   - Variable `GHL_REDIRECT_URI` (`https://f2b-media-agency-os.f2b-media.workers.dev/api/oauth/callback`)
   Keep the existing `GOOGLE_ADS_TOKEN_ENCRYPTION_KEY` secret configured.
6. Deploy the Worker, open a client workroom, select **Connect GoHighLevel agency**, install the app, then link that client to its matching installed sub-account. Repeat the mapping step per client, not the API-key step.

The AI can search/read workflow definitions, validate and update full definitions, and preserve the workflow's previous published/draft state. HighLevel currently limits its workflow API to selected locations; a `WORKFLOW_API_NOT_ENABLED_FOR_LOCATION` response means HighLevel has not enabled it for that location. The Google Ads agent can read and create/update HighLevel Google Ads conversion actions. That endpoint supports `UPLOAD_CLICKS`; it does not install or verify website tags or prove that a lead was received by Google Ads.

Marketing Studio can queue client-scoped ContactCreate, ContactUpdate, ContactTagUpdate, AppointmentCreate, OpportunityStatusUpdate, OpportunityStageUpdate, and inbound InboundMessage automation triggers from the signed endpoint `https://f2b-media-agency-os.f2b-media.workers.dev/api/gohighlevel/webhook`. Subscribe to those events in the Marketplace app and use that URL as the delivery endpoint after the route is reachable. Customer-reply workflows accept only inbound messages and store message metadata, never message body or attachments. A custom contact-date workflow uses `locations/customFields.readonly` to load DATE and DATE_TIME fields, then schedules one background run for each future field date; date changes replace the queued run, and deleting the contact cancels it. A contact-status workflow watches a selected contact custom field: ContactCreate establishes the current value as its baseline, and later ContactUpdate events enqueue only when that field changes. This is a configurable custom-field trigger because HighLevel's ContactUpdate payload does not expose a dedicated contact lifecycle-status property or before/after pair. Appointment workflows can run immediately on creation or schedule a task/team email for a selected lead time (up to seven days before start); the five-minute Worker schedule can deliver shortly after the selected minute. Opportunity changes can branch on the saved status and pipeline-stage IDs. The current production Cloudflare Access policy protects the endpoint; an owner must approve a narrow path exception before it can receive external events or serve public marketing pages. The endpoint still checks HighLevel's Ed25519 signature and rejects unsigned requests. Contact events alone do not count as customer messaging consent. For tag-added/tag-removed workflows, the first ContactTagUpdate after deployment establishes the contact's baseline; later changes trigger matching tags.

HighLevel's published API scope catalog exposes funnel and page **read** endpoints only, with no page-builder content-edit endpoint. So the assistant can map the saved campaign URL to a GHL funnel/page and inspect public page content, but cannot edit landing-page content through the supported API. No OAuth scope can grant that missing endpoint; this part requires HighLevel to publish a page-builder API or a separately approved browser automation approach.

## Free-plan guardrails

Use Cloudflare's Free Workers plan and Free Zero Trust plan. Do not upgrade a plan or add paid add-ons without Sean's approval. Usage over a free quota may stop requests or require a plan change; it should not be upgraded automatically. The current workspace has only the owner profile, with no clients, projects, tasks, timesheets, notes, or files to transfer.

## Access and data

The app recognizes the verified email supplied by Cloudflare Access. Existing workspace permissions still come from the staff profile's role. Once Access sync is configured, add each staff member only in the Team profile; the app updates Cloudflare automatically. Protect the Worker itself, not only the `workers.dev` hostname, so an alternate Worker URL cannot bypass sign-in. Client records and private client files stay in D1. Files are limited to 1 MB each on the no-subscription setup. The credential vault remains encrypted in the browser before it is stored.

## Custom domain

The first launch uses Cloudflare's `workers.dev` address and does not require a domain purchase or DNS change. A branded subdomain can be connected later if F2B chooses to move DNS management to Cloudflare.
