# Direct Meta Ads connection

The Meta Ads workspace keeps Windsor as its existing reporting path. When an agency owner connects Meta directly, the same account mapping and reporting screens use the Meta Marketing API instead. Windsor remains read-only. Direct changes are limited to campaign pause/resume and daily budget, plus ad-set/ad pause/resume; each change waits for explicit approval and a live read-back.

## Meta app setup

1. Create or use a Meta developer app that has the Marketing API product and Facebook Login enabled.
2. Add this exact OAuth callback to the app’s valid redirect URIs:
   `https://f2b-media-agency-os.f2b-media.workers.dev/api/meta-ads/callback`
3. Request `ads_read` and `ads_management`. Meta may require business verification and app review / Advanced Access before the app can read or manage agency client accounts. If `ads_management` is not granted, reporting remains available but all write controls stay disabled.
4. Use the Marketing API version currently enabled for the app. Set it as a Worker variable named `META_MARKETING_API_VERSION` in the form `vNN.0`.

## Cloudflare Worker settings

Add these to **Workers & Pages → f2b-media-agency-os → Settings → Variables and Secrets**:

| Name | Type | Value |
| --- | --- | --- |
| `META_APP_ID` | Variable | Meta developer app ID |
| `META_APP_SECRET` | Secret | Meta developer app secret |
| `META_TOKEN_ENCRYPTION_KEY` | Secret | A dedicated, base64url-encoded random 32-byte key |
| `META_MARKETING_API_VERSION` | Variable | Current version enabled for the app, such as `vNN.0` |

After deployment, use **Meta Ads → Connect directly with Meta**, approve the requested `ads_read` and `ads_management` access, then choose the connected account and map it to a client. Long-lived user tokens still expire; reconnect when the app reports an expired authorization. Tokens are encrypted in D1 and never returned to the browser.

## What is verified

The code uses OAuth state cookies, server-side token exchange, encrypted token storage, app-secret proof on API reads, account listing, and account / campaign / ad set / ad insights. Campaign, ad-set, and ad status changes re-read the current item before applying and verify the saved status with a second live read. Campaign budget edits are also read-back checked. The read path is bounded to 10,000 rows per request window and labels results as Meta-reported. A working production Meta connection is not verified until Meta app credentials are configured, app review permits the needed accounts, and an account is mapped and successfully read.
