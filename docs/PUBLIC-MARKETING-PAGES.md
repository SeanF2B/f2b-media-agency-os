# Published Marketing Studio pages: public route setup

Published Marketing Studio pages and forms are intended for anonymous website visitors. The private Agency OS must remain behind its existing Cloudflare Access login.

## Required Access routes

In Cloudflare Zero Trust, add path-specific Access applications with a `Bypass` policy for `Everyone` for these exact application paths on the Agency OS hostname:

- `/f/*` — public published page views, funnel steps, and form submissions.
- `/api/marketing-public*` — public page images and post-submission pages.
- `/sitemap.xml` and `/robots.txt` — public search-crawler files.
- `/api/gohighlevel/webhook` — externally delivered HighLevel events; the Worker still verifies each Ed25519 signature.

Cloudflare evaluates the more specific path application for these routes. Keep the existing root application and its staff-only policy for every other path. Do not make `/api/*`, `/api/marketing-studio/*`, or the whole hostname public.

The bypassed endpoints are public and are not Access-authenticated or logged by Access. The public form handler has its own input validation and submission rate limits, and the webhook verifies the provider signature. Do not reuse these public exceptions for private editor or CRM APIs.

The owner-approved, owner/admin-only **Apply approved public paths** action on Integrations can create these five exact path applications. It first verifies the existing root CRM app and exact-email allow policy, stops if an existing path conflicts, creates only missing path apps, and reads back each public policy. It leaves the root app and its policy untouched. The action requires Worker secret `CLOUDFLARE_ACCESS_API_TOKEN` with account-scoped Access: Apps and Policies Read and Edit. Without that secret, no policy change is possible.

## Verify before sending traffic

1. Open a known published page at `/f/<published-slug>` in a private browser window. It should display without an Access login.
2. Submit a test form using non-sensitive test details. Confirm the completion page loads and the submission appears in the CRM.
3. If the page uses an uploaded image, confirm its `/api/marketing-public?...` image request loads.
4. Open the Agency OS root and `/api/marketing-studio` in that same private window. Both must still require the existing Access login.

After applying the approved routes, verify them using the steps above. Access-specific path applications take precedence over the root app; keep the root app private for every other route.
