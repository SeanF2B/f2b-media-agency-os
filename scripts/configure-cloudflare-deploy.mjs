import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const [databaseId, marketingBucketName] = process.argv.slice(2);
if (!databaseId || !/^[a-f0-9-]{32,36}$/i.test(databaseId)) {
  throw new Error(
    "Usage: node scripts/configure-cloudflare-deploy.mjs <D1 database ID> [R2 bucket name]",
  );
}
const configPath = path.join(root, "dist", "server", "wrangler.json");
const config = JSON.parse(await readFile(configPath, "utf8"));
const d1 = config.d1_databases?.find((binding) => binding.binding === "DB");
if (!d1) throw new Error("The built app is missing its D1 binding.");
const ghlInstallUrl = process.env.GHL_INSTALL_URL || config.vars?.GHL_INSTALL_URL;
if (ghlInstallUrl) {
  const ghlInstall = new URL(ghlInstallUrl);
  if (ghlInstall.hostname !== "marketplace.gohighlevel.com" || ghlInstall.pathname !== "/v2/oauth/chooselocation") {
    throw new Error("GHL_INSTALL_URL must be the Marketplace OAuth chooser link (/v2/oauth/chooselocation), not the app details page.");
  }
}

config.name = "f2b-media-agency-os";
config.workers_dev = true;
config.triggers = { ...(config.triggers || {}), crons: ["*/5 * * * *"] };
d1.database_name = "f2b-media-agency-os";
d1.database_id = databaseId;
d1.migrations_dir = "../../drizzle";
config.r2_buckets = marketingBucketName ? [{ binding: "BUCKET", bucket_name: marketingBucketName }] : [];
config.vars = {
  ...config.vars,
  F2B_AUTH_PROVIDER: "cloudflare-access",
  F2B_ACCESS_TEAM_DOMAIN: "https://divine-disk-b2f3.cloudflareaccess.com",
  F2B_ACCESS_AUD: "ef56205dfaec87c3a259526da8fe5997a4c4b8ed21bb16974a957b42c9be0f47",
  F2B_CF_ACCOUNT_ID: process.env.F2B_CF_ACCOUNT_ID || config.vars?.F2B_CF_ACCOUNT_ID || "4edb037f53f9156f239506bbf8f9959c",
  F2B_CF_ACCESS_APP_ID: process.env.F2B_CF_ACCESS_APP_ID || config.vars?.F2B_CF_ACCESS_APP_ID || "32e01b82-34cd-467b-b60d-2dd2fcbb3b4c",
  F2B_CF_ACCESS_POLICY_ID: process.env.F2B_CF_ACCESS_POLICY_ID || config.vars?.F2B_CF_ACCESS_POLICY_ID || "d6d1bc9a-8dbf-4af7-85f3-dad8bd0fccb9",
  TASK_NOTIFICATION_FROM: "notifications@updates.f2bmedia.com",
  GHL_APP_ID: process.env.GHL_APP_ID || config.vars?.GHL_APP_ID || "6add2cb0da6630d0a9a5db90",
  GHL_INSTALL_URL: ghlInstallUrl,
  GHL_REDIRECT_URI: process.env.GHL_REDIRECT_URI || config.vars?.GHL_REDIRECT_URI || "https://f2b-media-agency-os.f2b-media.workers.dev/api/oauth/callback",
};

await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
process.stdout.write("Cloudflare deployment config is ready.\n");
