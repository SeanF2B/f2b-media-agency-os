# CRM Restore Point: ANCHOR

Use the word **ANCHOR** to refer to the full CRM source checkpoint saved on 7 November 2026.

- Git tag: `crm-safe-2026-11-07`
- Checkpoint commit: see `git show crm-safe-2026-11-07`
- Scope: current tracked CRM source, configuration, migrations, and authored tests at the checkpoint.
- Local build output, generated Cloudflare dry-run bundles, and scratch folders are not part of the source checkpoint.

If Sean asks to "restore ANCHOR", first preserve any work created after this checkpoint, then restore the CRM source to this tag. Do not discard later work without making a recoverable copy.
