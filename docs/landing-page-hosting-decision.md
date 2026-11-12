# Paid landing page hosting decision

## Decision

Use one shared Cloudflare Worker as the landing-page origin, with Cloudflare for SaaS custom hostnames for each client’s `go.clientdomain.ie` hostname. Store an explicit hostname-to-client mapping in the Agency OS database and serve only a published, approved page belonging to that client. Keep the existing client WordPress site as the editing source where the site supports the required page format; do not install a separate WordPress site for every landing page.

This is the closest fit for the requested client-owned subdomains and the existing Cloudflare Worker deployment. It avoids multiplying WordPress hosting and maintenance, while retaining per-client hostname routing. The local application now supports owner-scoped hostname verification and routes a verified hostname's root to its published project. The Cloudflare for SaaS zone, fallback route, client CNAMEs, and production verification still need to be configured before any hostname can receive public traffic.

## Options considered

| Option | Fit | Trade-off |
| --- | --- | --- |
| One shared Worker + Cloudflare for SaaS | Recommended | Uses one hosting origin and supports each client’s custom hostname. Requires a configured fallback origin, hostname routing, customer DNS/validation records, and Cloudflare for SaaS setup. |
| A separate WordPress installation per client or landing page | Not selected | Elementor works in each site’s own environment, but adds hosting, updates, backups, security, and account management for every installation. |
| WordPress Multisite | Not selected for the first version | Centralizes WordPress, but adds network/plugin/domain-mapping complexity and still needs a compatible hosting plan. Elementor and client isolation have not been verified for the connected sites. |
| Treat `go.clientdomain.ie` as an alias of the existing WordPress site | Not selected | Domain aliases can redirect to a primary domain or serve the main site; they do not by themselves route to an isolated landing page. |

## Prerequisites before implementation can go live

1. Choose an agency-owned Cloudflare zone to serve as the SaaS zone. Confirm the zone and its DNS/traffic do not contain other services that a Worker route could intercept.
2. Configure a fallback hostname and set the Agency OS Worker as its origin. Cloudflare documents a Worker route (commonly `*/*`) to capture custom-hostname requests; if this route is used, add explicit exclusions for any agency-owned hostnames that must bypass the Worker.
3. Enable Cloudflare for SaaS for that zone and configure its customer CNAME target. Current Cloudflare instructions require payment information for non-Enterprise accounts; this setup has not been started, and no billing details or paid add-on have been entered.
4. Use the built-in custom-domain panel to create a tenant-scoped hostname-to-published-page mapping and verify its TXT record. The Worker only rewrites the root request for an exact verified hostname whose target project still has published content; unknown or unverified hosts are not routed.
5. Add a narrowly scoped Cloudflare API token and the SaaS zone ID as Worker secrets/variables. The current deployment has no DNS-management token or SaaS-zone configuration, so no client records can be created from the app yet.
6. For each client, display the exact CNAME and ownership/certificate validation records returned by Cloudflare. Only create client DNS records when the agency has an authorized token for that client’s DNS zone.
7. Verify DNS, certificate status, HTTPS, client routing, page ownership, attribution query strings, and conversion tags before allowing a paid campaign to use the URL. This code has not been deployed or tested through Cloudflare for SaaS yet.

Cloudflare currently lists 100 custom hostnames included for Free, Pro, and Business plans, with additional hostnames at $0.10 each. Check live usage and pricing before enabling or adding hostnames; do not initiate paid setup or create hostnames from this app until the owner approves it.

Cloudflare's current setup guide confirms that custom hostnames CNAME to the SaaS target, while a Worker-as-fallback setup routes inbound custom-hostname traffic through a Worker route. Enabling Cloudflare for SaaS on non-Enterprise plans asks for payment information. References: [Worker as fallback origin](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/start/advanced-settings/worker-as-origin/), [enable Cloudflare for SaaS](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/start/enable/), and [plans and included hostnames](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/plans/).

## Worker-routing constraint verified against current Cloudflare documentation

The wildcard `*/*` Worker route receives requests for the SaaS zone's own hostnames as well as customer custom hostnames. When that route matches, Cloudflare bypasses each custom hostname's `custom_origin_server`; per-client WordPress routing therefore has to be explicitly implemented in the Worker, or the zone must use more selective routes and DNS/proxy assumptions. A broad route must not be added to the existing Agency OS zone without accounting for every current hostname. Cloudflare recommends a dedicated SaaS zone or explicit route exclusions when agency-owned hosts must bypass the dispatcher. See [Workers as your fallback origin](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/start/advanced-settings/worker-as-origin/) and [hostname routing](https://developers.cloudflare.com/cloudflare-for-platforms/workers-for-platforms/configuration/hostname-routing/).

## WordPress and Elementor constraint

The two connected WordPress.com sites observed so far are Simple sites with `.wordpress.com` primary addresses, no custom domains, and limited plugin-tool support; both are marked not launched/coming soon. Their exact WordPress.com subscription tier has not been verified. They cannot be used as client-owned root domains for a `go.` subdomain. WordPress.com’s current support documentation says a custom primary domain requires a paid plan. The app now withholds a `go.` DNS check for those hosted addresses and links to the required domain setup steps.

Elementor template duplication is not assumed to work through the current WordPress.com connection. Before enabling it, inspect a plugin-enabled, client-authorized WordPress site and verify that a selected Elementor template can be duplicated, populated, saved as an unpublished draft, opened in Elementor, and read back without publishing. Until that test passes, the app must describe its WordPress draft path as Gutenberg-based and editable in Elementor only when the connected installation actually supports that workflow.

### Current connection check (2026-10-27)

- WordPress.com account access currently lists two `simple` sites: `aldohandyman.wordpress.com` and `seanb81c29a06f4ex.wordpress.com`. Both are unlaunched/coming soon, have no custom domain, and report limited MCP site-tool support.
- The Agency OS production `wordpress_connections` table contains no client-specific application-password connections. Five client profiles have a WordPress website URL, but the shared WordPress.com account does not expose a matching client site.
- The separate WPWriter connection currently has no sites.
- The WordPress.com content authoring tool supports Gutenberg page creation, reusable block patterns, and draft/read-back workflows. The current connected tool list does not offer an Elementor template duplication/import operation.
- Elementor's developer docs describe page data as private post metadata and a template JSON export/import workflow. The current connection does not provide a verified way to read, duplicate, populate, or read back that Elementor data.

Result: keep Elementor template automation disabled. Sites currently creates Gutenberg drafts, labels requested layouts as design guidance, and shows a note that the Elementor editor link is not verified. Resume the compatibility test only after a real client site with Elementor enabled is connected through a client-authorized WordPress login and a supported read/write method for its template data is established. Do not use the WordPress.com Simple account's upgrade link or configure paid hosting as a workaround without Sean's approval.

## Official references

- [Cloudflare for SaaS configuration](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/start/getting-started/)
- [Cloudflare for SaaS plans](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/plans/)
- [Cloudflare custom hostname creation](https://developers.cloudflare.com/cloudflare-for-platforms/cloudflare-for-saas/domain-support/create-custom-hostnames/)
- [WordPress.com: connect an existing domain](https://wordpress.com/support/domains/connect-existing-domain/)
- [WordPress.com: set a primary domain](https://wordpress.com/support/domains/set-a-primary-address/)
