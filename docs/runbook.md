# Runbook

What to do when something breaks. Each entry: how you notice → how to confirm → what to do →
what NOT to do. Read-only checks first; anything that writes to production is marked **(owner)**.
Architecture context: `docs/architecture.md`. Uptime alerts: `docs/uptime-check.md` (PR #211).

---

## Garmin breaks

Garmin is an unofficial API (`garmin-connect` package, CLAUDE.md "Garmin integration"). It breaks
when Garmin changes their login or endpoints, and in between it rate-limits and 5xx's.

**You notice:** runs stop appearing for Garmin athletes; coach gets a push-failure batch alert;
`/api/health` shows `garmin_sync: stale` while `strava_sync` is fresh.

**Confirm (read-only):**
1. Is it everyone or one athlete? Compare `athletes.garmin_last_sync_at` across the club
   (SQL editor: `select name, garmin_last_sync_at from athletes where garmin_auth is not null order by 2`).
   One stale athlete = their link; everyone stale = Garmin or us.
2. Vercel → Logs → `/api/cron/sync`. The final `[cron/sync] done` line carries the `garmin`
   object: `error`, per-athlete results. Garmin errors are logged as name + HTTP status only.
3. Failure blame for workout pushes is decided in `src/lib/garmin/delivery-failure.ts`:
   `reconnect` (token gone / refused — only the athlete can fix) vs `ours` (rate limit, 5xx,
   timeout — retry later).

**Do:**
- **One athlete, `reconnect`:** they re-link Garmin from their profile (the app already tells them
  when the blame is `reconnect`). Nothing to do server-side.
- **Everyone, 429/5xx/timeouts:** wait. The next ticks retry on their own (*/5). Workout pushes:
  the coach retries from the plan screen a few minutes later.
- **Everyone, auth/SSO errors for valid accounts (login flow changed):** check the
  `garmin-connect` package's GitHub issues for the same error; upgrading it is a code change in a
  branch → preview → test with one account → PR. Garmin SSO lives in
  `src/lib/garmin/auth-mfa.ts`.
- **A sync that must not run during a fix (owner):** pause every cron with
  `app_settings.cron_paused = 'on'` (`src/lib/cron-pause.ts`), set back to anything else after.

**Don't:** clear `garmin_auth` to "reset" an athlete — that forces them to re-enter their
password and loses nothing you can't get by waiting. Don't raise the sync frequency to catch up.

---

## Strava rate-limits

Strava allows **100 requests / 15 min and 1,000 / day for the whole app**, shared by the webhook
syncs, enrichment (2–3 calls per new run), the poll rotation (`STRAVA_POLL_BUDGET = 2` athletes a
tick, `src/lib/strava/poll-rotation.ts`), the two backfill passes and members' own login syncs.

**You notice:** Strava runs arrive late or without laps/route; logs show
`Strava API error: 429` (`StravaApiError.status === 429`, `src/lib/strava/client.ts`) or
`[laps backfill] rate-limited by Strava; stopping this pass`.

**Confirm:** Strava → My API Application shows the current usage against both limits. In the
`[cron/sync] done` log, `stravaLaps.rateLimited` / `stravaRoutes` tell you whether the backfills
were the spenders.

**Do:**
- Nothing, usually. A 429 stops the backfill pass immediately and writes nothing
  (`src/lib/strava/backfill-laps.ts`), the 15-minute window resets on its own, and the daily one
  at 00:00 UTC.
- If the webhook is dead, every Strava run waits for the poll rotation. Check the subscription:
  `GET /api/strava/webhook` handshake, and re-register via `/api/admin/strava/webhook-subscribe`
  **(owner)**. With a healthy webhook the polls find nothing, which is the point.
- Sustained daily limit hits: ask Strava for a higher limit (the app form), or lower the bonus
  passes' budgets in code (PR).

**Don't:** add retries on 429. Retrying spends the same shared budget the next real run needs.

---

## A cron fails

**You notice:** `/api/health` `cron_tick: stale`; reminders or scheduled pushes didn't go out;
GitHub Actions emails a failed run.

**Confirm (read-only):**
1. Vercel → Settings → Cron Jobs: is the job enabled? Vercel → Logs filtered on the cron path:
   401 = `CRON_SECRET` mismatch, 504 = hit `maxDuration`, 500 = an exception (the log has it).
2. Paused on purpose? `select value from app_settings where key = 'cron_paused'` — `'on'` means
   every cron answers 200 and does nothing (left on after a maintenance window is the classic).
3. `cron/tick` keeps one row per tick: `select tick_at, duration_ms, fired_count from cron_tick_locks
   order by tick_at desc limit 20`. `duration_ms` NULL = a tick that died before the end
   (timeout or crash) — and it re-attempts its partial sends on the next ticks, so check for
   duplicate pushes.
4. `cron/sync`: the hourly GitHub Actions run (`.github/workflows/`) and the Vercel */5 run hit
   the same route; a Vercel-cron sync outside 05:00–23:00 Israel (`FIRST_HOUR`/`LAST_HOUR`) returns `skipped` by design.

**Do:**
- 401: `CRON_SECRET` in Vercel and in the GitHub Actions secret must match **(owner)**.
- 504 on `cron/sync`: it has one 300 s deadline; a long Garmin pass already gets a budget. Look at
  which stage ate the time in the `done` log before changing anything.
- To re-run once by hand **(owner)**: `curl -X POST -H "Authorization: Bearer $CRON_SECRET"
  https://www.madregot.app/api/cron/<job>`. `tick` is guarded by `cron_tick_locks`, so a manual run
  overlapping a scheduled one is refused, not doubled.

**Don't:** delete `cron_tick_locks` rows to "unstick" a tick — the lock is what stops two ticks
sending the same push.

---

## A migration is missing

There is no migration runner: every `supabase/migrations/NNN_*.sql` is pasted by hand in the
Supabase SQL editor (CLAUDE.md "Adding a DB column").

**You notice:** a route 500s or a feature silently stays empty after a deploy; logs show Postgres
`42703` (undefined column), `42P01` / PostgREST `PGRST205` (missing table), `PGRST202` / `42883`
(missing function), or "more than one relationship was found" (an ambiguous embed after a new
foreign key — see CLAUDE.md, migration 125).

**Confirm:** in the SQL editor —
`select column_name from information_schema.columns where table_name = '<table>'`, or
`select to_regclass('public.<table>')`, or `select proname from pg_proc where proname = '<fn>'`.
The helpers that classify these errors are `src/lib/supabase/schema-drift.ts`
(`isMissingColumn`, `isMissingTable`).

**Do (owner):**
1. Find the migration that adds it (`grep -l <column> supabase/migrations/*.sql`).
2. Read it. Migrations here are written idempotent (`IF NOT EXISTS`, `ON CONFLICT DO NOTHING`,
   `CREATE OR REPLACE`) — confirm before pasting. `CREATE INDEX CONCURRENTLY` must be run one
   statement at a time (not in a transaction).
3. Paste it in the SQL editor. Re-check with the query above.
4. Ambiguous-embed errors: the fix is in code (hint the embed, `groups!group_id(name)`), not in
   the database. `schemaEmbedAmbiguity.test.ts` guards this.

**Don't:** hand-write an ad-hoc `ALTER TABLE` that differs from the migration file — the next
person pasting the file gets a different schema than prod.

---

## Email bounces

Email goes through Resend (`src/lib/email/*`). Resend accepting a send is not delivery: the
webhook (`src/app/api/webhooks/resend/route.ts`) promotes `email_log` rows
`sent → delivered / bounced / complained`.

**You notice:** a member says they never got the welcome / code email; the registrations screen
shows "bounced"; Resend dashboard shows a bounce spike.

**Confirm (read-only):**
1. `select template, status, error_code, created_at from email_log where '<address>' = any(recipients) order by created_at desc limit 5`
   (migration 096; `recipients` is `text[]`).
2. Resend → Emails → that message: hard bounce (address doesn't exist / typo) vs soft (mailbox
   full, greylisted) vs complaint (marked as spam).
3. Spike across many recipients = our side: `RESEND_FROM_EMAIL` domain lost verification (Resend
   → Domains: SPF/DKIM green?) or the domain's DNS delegation changed (`dig NS madregot.app`
   before reading any code).

**Do:**
- Hard bounce on one member: the address is wrong — fix it on their athlete row with them
  **(owner/staff)**, then resend from the screen that sent it.
- Complaint: don't resend to that address. The suppression logic skips complained/bounced
  recipients on bulk sends.
- Domain verification broke: fix DNS records in the registrar **(owner)**; nothing to change in
  code. Login codes have a fallback path (staff can let a member in) while it is down.

**Don't:** point `EMAIL_TRANSPORT` at anything but `resend` in production, or set
`MC_OUTBOUND=all` on a preview to "test" — previews must never mail real members
(`src/lib/outbound-policy.ts`).
