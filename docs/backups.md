# Backups: exporting key tables and the restore drill

Docs only. Nothing here runs automatically, and nothing here writes to production. Every command
reads from production (`pg_dump`, `\copy ... TO`) or writes to a **scratch** project you created
for the drill. Run them yourself, in your own shell, with the URLs in env vars — never paste a
connection string or service key into a chat, a commit or a PR.

See also `supabase/ops/eu-move/RUNBOOK.md`, which used the same tooling for the Tokyo → EU move
and has the connection-string details (session pooler on 5432, never the 6543 transaction pooler;
`pg_dump`/`psql` 17.x).

## What Supabase already gives you

- **Daily automatic backups** on the paid plans (Project → Database → Backups), kept 7 days on Pro.
  Free-tier projects have none — check the plan before relying on this.
- **Point-in-time recovery** is a paid add-on. If it is not enabled, the newest restorable state is
  last night's backup.
- **Storage objects (photos, avatars, plans) are NOT in the database backup.** They need their own
  copy — `supabase/ops/eu-move/copy-storage.sh` lists and copies buckets via the Storage API.

A restore from the dashboard replaces the **whole** project. For "a coach deleted a group's plan
by mistake" you want a table-level export from below, not a full restore.

## Env vars (your shell only)

| Var | Value |
|---|---|
| `$PROD_DB_URL` | prod session-pooler URL — Project → Connect → Session pooler. Use a read-only role if you have one (below) |
| `$DRILL_DB_URL` | a scratch Supabase project (free tier is fine), **never** prod |

### A read-only role for exports (one-time, optional)

Exporting as `postgres` works but can write. A read-only role makes an accidental `DELETE` in the
wrong terminal impossible. Paste in the SQL editor once:

```sql
-- idempotent
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'backup_reader') THEN
    CREATE ROLE backup_reader LOGIN PASSWORD '<choose one, keep it in your password manager>';
  END IF;
END $$;
GRANT USAGE ON SCHEMA public TO backup_reader;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO backup_reader;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO backup_reader;
ALTER ROLE backup_reader SET default_transaction_read_only = on;
```

## Key tables

Ordered by "how bad is it to lose this". Tier 1 cannot be rebuilt from anywhere else.

| Tier | Tables | Why |
|---|---|---|
| 1 — irreplaceable | `athletes`, `groups`, `program_weeks`, `weekly_plan_versions`, `workout_attendance`, `events`, `event_registrations`, `race_results`, `athlete_pr_overrides`, `athlete_races`, `academy_*`, `store_orders`, `store_order_items`, `podium_orders`, `podium_order_items`, `feedback`, `workout_feedback`, `pain_reports`, `app_settings`, `feature_enablements`, `role_tab_permissions`, `role_mobile_tab_permissions` | entered by people; no provider has a copy |
| 2 — social | `feed_items`, `feed_comments`, `feed_likes`, `activity_kudos`, `club_updates`, `run_chats`, `workout_feedback_messages`, `pain_report_messages`, `athlete_follows`, `athlete_badges` | rebuilt only partly (feed items regenerate from activities, comments do not) |
| 3 — re-syncable | `athlete_activities`, `activity_streams`, `activity_loads`, `weekly_km_snapshots`, `athlete_wellness` | Garmin/Strava still have them, but a re-sync is slow, rate-limited, and Garmin history depth is capped (see CLAUDE.md "Garmin history"); export anyway |
| skip | `cron_tick_locks`, `client_events`, `push_deliveries`, `login_codes`, `login_handoffs`, `plan_edit_locks` | operational, short-lived, or credentials |

**`athletes` holds encrypted provider credentials** (`garmin_auth`, `strava_auth`) and push tokens
live in `push_subscriptions` / `device_tokens`. A full dump is therefore as sensitive as the
production database itself: keep it on an encrypted disk, never in the repo, never in a shared
drive, delete it after the drill. The credentials are only usable with `ENCRYPTION_KEY`, which is
in Vercel and must never be stored next to a dump.

## 1. Full logical dump (read-only)

```bash
STAMP=$(date -u +%Y%m%dT%H%MZ)
pg_dump "$PROD_DB_URL" --schema=public --no-owner --no-privileges \
  --format=custom --file="madregot-$STAMP.dump"
pg_restore --list "madregot-$STAMP.dump" | grep -c 'TABLE DATA'   # sanity: one line per table
```

`--format=custom` is compressed and lets you restore a single table later
(`pg_restore --table=...`). `--schema=public` leaves out Supabase's own `auth`/`storage` schemas,
which a dashboard restore handles and a scratch project already has.

## 2. One table, as CSV (read-only)

For a quick look or a spreadsheet:

```bash
psql "$PROD_DB_URL" -X -c "\copy (SELECT * FROM program_weeks ORDER BY week_start_date) TO 'program_weeks.csv' CSV HEADER"
```

`\copy` runs client-side, so the file lands on your machine and the server needs no file access.

## 3. Row counts to compare against

```bash
psql "$PROD_DB_URL" -X -q -A -t -f supabase/ops/eu-move/rowcounts.sql > counts-prod.txt
```

## Restore drill (quarterly, into a scratch project)

The point is to prove the dump restores, not to restore production. Takes ~30 min.

1. **Create a scratch project** (free tier). Copy its session-pooler URL to `$DRILL_DB_URL`.
   Double-check: `echo "$DRILL_DB_URL" | grep -v <prod-project-ref>` must print the URL.
2. **Schema.** Either apply `supabase/schema.sql` + the migrations in order, or let the dump carry
   the schema (simpler): skip to step 3.
3. **Restore:**
   ```bash
   pg_restore --dbname="$DRILL_DB_URL" --no-owner --no-privileges --clean --if-exists \
     "madregot-$STAMP.dump"
   ```
   Warnings about Supabase roles (`anon`, `authenticated`) missing grants are expected; errors
   about a missing table are not.
4. **Compare counts:**
   ```bash
   psql "$DRILL_DB_URL" -X -q -A -t -f supabase/ops/eu-move/rowcounts.sql > counts-drill.txt
   diff counts-prod.txt counts-drill.txt && echo "drill OK"
   ```
   Small differences in fast-moving tables (`client_events`, `cron_tick_locks`) are rows written
   between the dump and the count; tier-1 tables must match exactly.
5. **Spot-check by hand:** the newest `program_weeks` row, one athlete's last 5 activities, the
   latest `store_orders`.
6. **Delete the scratch project and the dump file.** Write the date and the result in the table
   below.

### Restoring one table into production (only with a reason, only by the owner)

A real incident, e.g. a bulk delete. Restore into the drill project first, find the rows, and
re-insert only those with an explicit `INSERT ... ON CONFLICT DO NOTHING` you have read twice.
Never `pg_restore --clean` against production: it drops the table first.

## Drill log

| Date | Dump size | Tables | Counts match | Who | Notes |
|---|---|---|---|---|---|
| | | | | | |
