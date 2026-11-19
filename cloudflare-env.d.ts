declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    BROWSER?: { quickAction: (action: "screenshot", options: Record<string, unknown>) => Promise<Response> };
    F2B_ACCESS_TEAM_DOMAIN?: string;
    F2B_ACCESS_AUD?: string;
    F2B_CF_ACCOUNT_ID?: string;
    F2B_CF_ACCESS_APP_ID?: string;
    F2B_CF_ACCESS_POLICY_ID?: string;
    CLOUDFLARE_ACCESS_API_TOKEN?: string;
    CLOUDFLARE_DNS_API_TOKEN?: string;
    AGENCY_CREDENTIALS_ENCRYPTION_KEY?: string;
    OPENROUTER_API_KEY?: string;
    OPENROUTER_MODEL?: string;
    OPENROUTER_IMAGE_MODEL?: string;
    OPENAI_API_KEY?: string;
    OPENAI_MODEL?: string;
    RESEND_API_KEY?: string;
    TASK_NOTIFICATION_FROM?: string;
    TASK_APP_URL?: string;
    WINDSOR_API_KEY?: string;
    GOOGLE_PAGESPEED_API_KEY?: string;
    DATAFORSEO_API_LOGIN?: string;
    DATAFORSEO_API_PASSWORD?: string;
    GOOGLE_ADS_CLIENT_ID?: string;
    GOOGLE_ADS_CLIENT_SECRET?: string;
    GOOGLE_ADS_LOGIN_CUSTOMER_ID?: string;
    GOOGLE_ADS_TOKEN_ENCRYPTION_KEY?: string;
    META_APP_ID?: string;
    META_APP_SECRET?: string;
    META_TOKEN_ENCRYPTION_KEY?: string;
    META_MARKETING_API_VERSION?: string;
    /** WhatsApp Embedded Signup (Facebook Login for Business configuration ID) for the in-OS "Continue with Facebook" pop-up. */
    WHATSAPP_ES_CONFIG_ID?: string;
    /** Optional: Twilio partner solution ID passed to Embedded Signup. */
    WHATSAPP_ES_SOLUTION_ID?: string;
    WORDPRESS_MCP_TOKEN_ENCRYPTION_KEY?: string;
    GHL_CLIENT_ID?: string;
    GHL_CLIENT_SECRET?: string;
    GHL_APP_ID?: string;
    GHL_INSTALL_URL?: string;
    GHL_REDIRECT_URI?: string;
    /** Outreach: must be exactly "true" before any domain can be bought. */
    OUTREACH_PURCHASES_ENABLED?: string;
    /** Outreach: existing F2B Telegram bot (send-only reuse). */
    TELEGRAM_BOT_TOKEN?: string;
    TELEGRAM_CHAT_ID?: string;
    F2B_TELEGRAM_BOT_TOKEN?: string;
    F2B_TELEGRAM_CHAT_ID?: string;
    /** Outreach: OAuth apps for free seed inboxes (placement tests). */
    OUTREACH_SEED_GOOGLE_CLIENT_ID?: string;
    OUTREACH_SEED_GOOGLE_CLIENT_SECRET?: string;
    OUTREACH_SEED_MS_CLIENT_ID?: string;
    OUTREACH_SEED_MS_CLIENT_SECRET?: string;
    OUTREACH_APP_URL?: string;
  }
}
