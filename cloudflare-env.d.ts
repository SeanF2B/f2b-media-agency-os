declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    F2B_ACCESS_TEAM_DOMAIN?: string;
    F2B_ACCESS_AUD?: string;
    F2B_CF_ACCOUNT_ID?: string;
    F2B_CF_ACCESS_APP_ID?: string;
    F2B_CF_ACCESS_POLICY_ID?: string;
    CLOUDFLARE_ACCESS_API_TOKEN?: string;
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
    WORDPRESS_MCP_TOKEN_ENCRYPTION_KEY?: string;
    GHL_CLIENT_ID?: string;
    GHL_CLIENT_SECRET?: string;
    GHL_APP_ID?: string;
    GHL_INSTALL_URL?: string;
    GHL_REDIRECT_URI?: string;
  }
}
