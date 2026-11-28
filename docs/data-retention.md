# Data retention

What the daily retention pass (`/api/cron/retention`, 02:50 UTC, `vercel.json`) removes, and why
each window is what it is. Source of truth: `src/lib/retention/policy.ts`;
`src/__tests__/retention.test.ts` fails if this table and the code disagree.

**It is a dry run until someone turns it on.** By default the job only *counts* what each rule would
delete and logs one line (`[retention] dry-run: notifications=… push_deliveries=…`). It deletes only
when the Vercel env var `RETENTION_PURGE` is exactly `on`. Recommended: leave it dry for a week, read
the counts in the logs (or call the route with the cron bearer), then switch it on.

| table | measured on | window | also required to delete | kept regardless |
|---|---|---|---|---|
| `scheduled_notifications` | `updated_at` | 400 days | status `sent` or `cancelled`, not `recurring` | idempotency ledger rows (`url` like `#ledger:%`), drafts, scheduled, recurring |
| `push_deliveries` | `sent_at` | 90 days | — | — |
| `client_events` | `created_at` | 90 days | — | — |
| `email_log` | `created_at` | 365 days | status not `bounced` / `complained` | bounces and complaints |
| `race_positions` | `at` | 2 days | — | — |
| `login_codes` | `expires_at` | 7 days | — | — |
| `login_handoffs` | `expires_at` | 7 days | — | — |

## Why these windows

- **Notifications, 400 days.** The inbox reads the newest 150 sent rows; anything deduplicated per
  year (birthdays) must still see last year's row, hence a bit over a year. Ledger rows are *how* a
  reminder knows it already went out (RSVP, post-workout prompts); deleting one could re-send, so
  they are never purged.
- **Push deliveries, 90 days.** The push-health screen drills into one notification's deliveries.
  Three months after a send, that detail is no longer actionable.
- **Client events, 90 days.** The bug detector reads 7 days and the people screen 30. Three months
  is a margin for investigations.
- **Email log, 1 year.** Delivery history for support. Bounces and complaints are kept as the record
  of an address that must not be mailed again.
- **Race positions, 2 days.** Race-live already deletes positions and LiveTrack links 24 h after
  `poll_to`, but only for races whose config is still `active`. This is the backstop: location
  data never outlives two days, whatever happened to the race config.
- **Login codes and handoffs, 7 days after expiry.** One-time secrets; a week of history for support.

## What is not purged (on purpose)

- **Group chat (`run_meetup_messages`).** No chat retention was approved (see `cron/tick`:
  "No automatic chat purge"). `purgeExpiredChats` exists and stays unscheduled.
- **Activities, plans, feed items, attendance, PRs.** That is the club's history, not logs.
- **`onboarding_events`, `academy_candidate_events`.** Funnel analytics, small, owner-read.
- **`cron_runs`** (open PR #236): not on main yet. When it lands, add a rule (suggested 30 days).
- `cron_tick_locks` already cleans itself (2 days, in `cron/tick`).

## Changing a window

Edit `RETENTION_RULES`, then this table. The test pins both. A shorter window takes effect on the
next run. There is no undo, so run it dry first.
