# Marketing Studio backup and recovery

This runbook covers the production D1 database and private R2 bucket used by Marketing Studio. Backups contain personal and customer data. Store them only on an encrypted drive with access limited to the agency owner and authorized administrators. Do not commit backups to the repository or attach them to support requests.

## Current resources

- D1: `f2b-media-agency-os` (`4a73e2b0-ad98-492d-be09-317e04f00073`)
- R2: `f2b-marketing-studio-assets` (private; public bucket access is disabled)
- Production Worker: `f2b-media-agency-os`

## D1 recovery points

Cloudflare D1 Time Travel is enabled for the production database. A read-only `wrangler d1 time-travel info f2b-media-agency-os --json` check on 2026-10-27 returned a current bookmark. Time Travel restores the database in place, so first export a separate copy and confirm the affected time and data scope. The available recovery window depends on the Cloudflare plan; check it in Cloudflare before relying on a specific date. See [Cloudflare D1 Time Travel](https://developers.cloudflare.com/d1/reference/time-travel/).

## Make a manual D1 export

Run from the CRM repository using the authorized Wrangler account. Choose a protected local backup folder first; do not use the repository folder. Wrangler warns that a full remote D1 export may temporarily make the database unavailable to serve queries, so schedule it during a quiet window.

```powershell
$backupDir = Join-Path $env:LOCALAPPDATA 'F2B\AgencyOSBackups'
New-Item -ItemType Directory -Force -Path $backupDir | Out-Null
$stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
$outputFile = Join-Path $backupDir "f2b-media-agency-os-$stamp.sql"
pnpm exec wrangler d1 export f2b-media-agency-os --remote --output $outputFile
if ($LASTEXITCODE -ne 0) { throw 'D1 export failed; keep the existing backup set.' }
Get-Item -LiteralPath $outputFile | Select-Object FullName, Length, LastWriteTime
```

Verify the file exists and is non-empty. Encrypt or place it on an encrypted device before it leaves the workstation. Keep dated copies in a separate protected location and remove them according to the agency's approved retention policy. D1 export/import commands are documented by [Cloudflare](https://developers.cloudflare.com/d1/best-practices/import-export-data/). This run's command check used `--no-data` only; no production application rows were exported.

## Back up private R2 objects

Wrangler's installed R2 object commands support individual objects; they do not provide a bucket-wide object download. For a bucket snapshot, use an S3-compatible client such as `rclone` with an R2 **Object Read only** token scoped only to `f2b-marketing-studio-assets`. Keep the Access Key ID and Secret Access Key out of source control and command history. Cloudflare documents the [R2 token permissions](https://developers.cloudflare.com/r2/api/tokens/) and [S3-compatible API](https://developers.cloudflare.com/r2/api/s3/api/).

No R2 backup token or bucket-wide snapshot job is currently configured. Until one is configured, an owner can download individual objects from the Cloudflare R2 dashboard, but this is not a complete bucket backup. Do not enable public bucket access to simplify backups.

## Recovery procedure

1. Stop scheduled customer-facing workflows before any recovery operation. Do not send or re-send messages during recovery.
2. Preserve the current D1 export and R2 snapshot, then identify the exact loss window and records affected.
3. Restore the SQL export into a separate, empty staging D1 database first. Create a uniquely named staging database with `pnpm exec wrangler d1 create f2b-agencyos-restore-YYYYMMDD-HHMMSS`, then import with `pnpm exec wrangler d1 execute f2b-agencyos-restore-YYYYMMDD-HHMMSS --remote --file <path-to-export.sql>`. Apply the checked-in migrations in order only if the export does not already contain the schema. Never import a production export over the live database as a test.
4. Restore R2 objects into a separate private staging bucket using the same scoped R2 client. Check key counts, file sizes, and representative checksums against the backup manifest before switching bindings.
5. Run `pnpm run db:verify:remote` against the intended staging schema and run the CRM regression and Marketing Studio end-to-end checks.
6. Production restoration is destructive. Obtain explicit owner approval, export the current production database again, agree the restore timestamp and scope, and follow Cloudflare's in-place restore warnings before executing a restore against production.
7. After a production recovery, verify CRM sign-in, client data, published project records, private file downloads, automation run history, and scheduled jobs. Confirm outbound messaging remains paused until reviewed.

## Operational status

- D1 Time Travel: available; current bookmark was read successfully on 2026-10-27.
- Manual D1 export: documented; no export of customer rows was made for this change.
- R2 bucket-wide snapshot: not configured; requires an owner-created, bucket-scoped R2 read-only token and a protected backup destination.
- Restore drill: not yet run. Do it in a separate staging database and bucket before relying on the procedure for disaster recovery.
