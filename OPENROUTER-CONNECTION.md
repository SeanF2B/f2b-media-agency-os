# Agency OS AI provider connection

Agency OS has an owner/admin-only **Settings → API Keys** page for OpenRouter. It verifies a submitted key with OpenRouter, encrypts it with AES-GCM before saving it in D1, and returns only the final four characters and update time. The plaintext key is never returned by the settings API. AI request handlers and scheduled AI tasks resolve the saved provider key server-side.

## One-time server setup

- Apply `drizzle/0042_agency_api_keys.sql` to the production D1 database.
- Configure `AGENCY_CREDENTIALS_ENCRYPTION_KEY` as a server secret containing a base64-encoded 32-byte random key. This dedicated secret protects saved agency API keys. Never put it in the browser bundle, source control, or chat.
- Deploy a matching Agency OS source version after confirming the current live source and existing local changes.

After those steps, an owner/admin can open **Settings → API Keys**, enter the OpenRouter key, and select **Verify & connect**. Replacing a key verifies the new key before saving it, so a failed replacement leaves the existing connection in place. Removing the key stops new AI provider calls unless an existing server-side OpenAI fallback is configured.

## Models and scope

- Default text model: `x-ai/grok-4.7`.
- AI employee profiles can select Grok or Claude using their OpenRouter model IDs; scheduled runs use the assigned employee's selection.
- Default image model: `openai/gpt-5-image`.
- OpenRouter handles AI text and image requests. Google Ads, CRM, WordPress, analytics, email, and SMS keep their own service connections.

## Environment fallback

`OPENROUTER_API_KEY` remains supported for transition and local development. A key saved in **Settings → API Keys** takes precedence. `OPENROUTER_MODEL` and `OPENROUTER_IMAGE_MODEL` remain optional server settings.
