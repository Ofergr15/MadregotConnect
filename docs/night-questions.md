# Night questions

Open owner questions from the unattended night runs. Each has the safe default the PR shipped.

## Task 93 — cron observability (migration 251, GET /api/admin/cron-runs)

- **Migration 251 is a file only — paste it when you want run rows.** Until then every cron behaves exactly as before and the admin endpoint answers 503.
- **How long to keep run rows?** Default: 30 days, pruned per cron after each run. race-live and tick run often, so this is the biggest table cost; shorter (7 days) is fine if you prefer.
- **Should a staff member's manual call of a cron (no CRON_SECRET) be recorded too?** Default: no — only calls that pass the cron's own CRON_SECRET check write a row, so probing the URL can't fill the table.
