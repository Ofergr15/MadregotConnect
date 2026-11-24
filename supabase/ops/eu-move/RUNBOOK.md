# EU move runbook — Tokyo → Frankfurt

Source plan: `review-2026-11-20/eu-move-plan.md` (native-ios tree).
Source project **TOKYO** `njzldypndkicpsmdtyll` (ap-northeast-1) → target **EU**
`zrrklhonqtzycayjdbor` (eu-central-1, already exists). Vercel functions `hnd1` → `fra1`.

> Nothing in this folder has been run. Every command that touches a database or a
> Supabase project needs Ofer's explicit go-ahead at the step it appears in, and is
> typed with placeholders (`$TOKYO_DB_URL`, `$EU_DB_URL`, `$TOKYO_SERVICE_KEY`, `$EU_SERVICE_KEY`)
> that Ofer fills in his own shell. Never paste them into chat or a file.

Placeholders:

| Var | What | Where from |
|---|---|---|
| `$TOKYO_DB_URL` | `postgresql://postgres.njzldypndkicpsmdtyll:<pw>@<pooler-host>:5432/postgres` — **session** pooler (5432) or direct, never the 6543 transaction pooler (pg_dump needs a session) | Tokyo → Connect |
| `$EU_DB_URL` | same for EU | EU → Connect |
| `$TOKYO_URL` / `$EU_URL` | `https://<ref>.supabase.co` | |
| `$TOKYO_SERVICE_KEY` / `$EU_SERVICE_KEY` | service-role keys (storage copy only) | Settings → API |

Tooling: `pg_dump`/`psql` **17.x** (Supabase runs PG 15/17; a client older than the
server refuses to dump). `jq`, `curl`, `python3` for the storage script.

---

## T-7 days — preparation (no downtime)

1. **Schema parity.** Apply every migration in `supabase/migrations/` to EU in order, up to
   the newest on `origin/main` (at time of writing **219_read_nudges.sql**; the plan said 218 —
   recount on the day: `ls supabase/migrations | tail -1`). Also anything in `supabase/ops/`
   that was run by hand on Tokyo (`RUN-ONCE-*.sql`, `2026-11-22-enable-native-features.sql` —
   those are **data** seeds; skip them on EU, the data dump brings the rows).
   Check: catalog diff, as done for dev:
   ```bash
   for DB in TOKYO EU; do
     url_var="${DB}_DB_URL"
     pg_dump "${!url_var}" --schema-only --no-owner --no-privileges \
       --schema=public --schema=storage --schema=extensions \
       | grep -v '^--' | sed '/^$/d' > /tmp/eu-move-schema-$DB.sql
   done
   diff /tmp/eu-move-schema-TOKYO.sql /tmp/eu-move-schema-EU.sql
   ```
   Expected: no diff in `public`. Any diff is fixed by a migration, never by hand-editing EU.
2. **Extensions.** Migrations only create `pgcrypto` and `uuid-ossp` (schema `extensions`).
   Compare `select extname, extversion from pg_extension order by 1;` on both. No
   `pg_cron`, `pg_net`, webhooks or Edge Functions are referenced by the repo — confirm in
   the Tokyo dashboard (Database → Webhooks, Integrations → Cron, Edge Functions) that this
   is still true; anything found there is recreated on EU by hand before the night.
3. **Roles.** The app uses only built-in Supabase roles (`anon`, `authenticated`,
   `service_role`, `postgres`). Do **not** dump/restore roles (`pg_dumpall --roles-only`)
   into a Supabase project — those roles already exist and are managed by Supabase; a role
   restore fails or, worse, changes their attributes. Check for custom roles:
   `select rolname from pg_roles where rolname not like 'pg\_%' and rolname not in ('anon','authenticated','service_role','postgres','authenticator','dashboard_user','pgbouncer','supabase_admin','supabase_auth_admin','supabase_storage_admin','supabase_read_only_user','supabase_realtime_admin','supabase_replication_admin','supabase_functions_admin','pgsodium_keyholder','pgsodium_keyiduser','pgsodium_keymaker','supabase_etl_admin','supabase_privileged_role');`
   Expected: none.
4. **Storage buckets.** Migrations create 11 buckets: `avatars badge-icons event-images
   face-crops feed-media notification-images perk-images program-plans reference-faces
   run-chat store-products`. Compare `select id, public, file_size_limit, allowed_mime_types
   from storage.buckets order by id;` on both (also in `rowcounts.sql`). Then bulk pre-copy
   the objects (bytes take the time; the night only copies the delta):
   ```bash
   ./copy-storage.sh --dry-run          # lists what would move, per bucket
   I_HAVE_APPROVAL=yes ./copy-storage.sh # copies; skips objects already present on EU
   ```
5. **Auth settings checklist** (EU dashboard → Authentication; copy from Tokyo side by side):
   - [ ] URL Configuration: **Site URL** `https://www.madregot.app`; **Redirect URLs** — copy
         the whole list from Tokyo (expect at least `https://www.madregot.app/**`,
         `https://madregot.app/**`, the Vercel preview pattern, `madregot://**` for native,
         `http://localhost:3000/**`).
   - [ ] Providers: **Apple** (Services ID, Team ID, Key ID, .p8 — Apple needs the EU
         callback `https://zrrklhonqtzycayjdbor.supabase.co/auth/v1/callback` added to the
         Services ID's return URLs in developer.apple.com), **Google** (client id/secret; add
         the EU callback to the OAuth client's authorised redirect URIs in Google Cloud),
         **Email** (enabled, confirm-email setting identical). Strava and Garmin are our own
         OAuth, not Supabase providers — nothing to do in Auth, but see step 8.
   - [ ] Email: **custom SMTP** (Resend) host/port/user/sender exactly as Tokyo; templates
         (Confirm, Magic link, Recovery, Invite, Email change) pasted from Tokyo; rate limits.
   - [ ] Sessions / JWT expiry, refresh-token rotation and reuse interval identical.
   - [ ] **JWT secret — decide here (decision J).** Every existing access + refresh token
         was signed/issued by Tokyo. Refresh tokens live in `auth.refresh_tokens`, which the
         data dump *does* bring over; access tokens are verified by the JWT secret.
         - If EU's project-settings page still allows setting a **custom legacy JWT secret**
           (Settings → JWT Keys → Legacy JWT secret), set it to Tokyo's: existing access
           tokens keep validating and the restored refresh tokens keep refreshing — nobody is
           signed out. Side effect: the anon/service keys are re-minted; use EU's new ones.
         - If EU uses the new asymmetric **JWT signing keys** and the legacy secret cannot be
           imported, everyone is signed out once (web + native). Then: club announcement the
           day before ("ביום ראשון תתבקשו להתחבר מחדש").
         *Not exact in this runbook:* which of the two Supabase allows on this project today
         can only be read off the EU dashboard — check it at T-7 and record the outcome here.
   - [ ] Web sessions also depend on the localStorage key: supabase-js keys it
         `sb-<project-ref>-auth-token`, so a new URL alone signs the web out *unless*
         `NEXT_PUBLIC_SUPABASE_AUTH_STORAGE_KEY` is set (see `src/lib/supabase/client.ts`).
         If decision J = keep sessions, set `NEXT_PUBLIC_SUPABASE_AUTH_STORAGE_KEY=sb-njzldypndkicpsmdtyll-auth-token`
         in the step-4 env switch so the stored session is found.
6. **Native app.** The native app (b22 tip) does **not** hold a Supabase URL or key: auth
   refresh goes through `POST /api/native/auth/refresh` and plan PDFs through
   `/api/native/storage/...`, which follow the server's env. So the native app moves with the
   Vercel env switch, no build needed. b24 additionally carries `REMOTE_SUPABASE_CONFIG`
   (reads `GET /api/config`) for any future direct use. The plan's premise "Tokyo URL is
   burned into build 22" was true of an earlier build (commit d21603299) — **check that the
   App Store build has no `*.supabase.co` host in it** before relying on this:
   `unzip -p Madregot.ipa 'Payload/*.app/Info.plist' | plutil -p - | grep -i supabase` → empty.
7. **Dress rehearsal.** Run the "night" steps 2–3 for real against EU, point a Vercel
   **Preview** deployment at EU (preview-scoped env vars only), walk the smoke list, then
   empty EU's data (Ofer runs, EU only — double-check the URL is EU):
   `psql "$EU_DB_URL" -c "select 'truncate table ' || string_agg(format('%I.%I', schemaname, tablename), ', ') || ' cascade;' from pg_tables where schemaname = 'public'" -At | psql "$EU_DB_URL"`
   then `truncate auth.users cascade;` and delete the rehearsal's storage objects
   (`copy-storage.sh` objects stay — they are the pre-copy). Record the dump+restore wall time
   — it sets the window below.
8. **Third-party callbacks that name the host** (not the DB): Strava webhook subscription
   and Garmin/Strava OAuth redirects point at `www.madregot.app`, not Supabase — unchanged.
   GitHub Actions secrets `SUPABASE_URL` / `SUPABASE_ANON_KEY` (prod-smoke.yml) **do** name
   the project: update them in step 6 of the night.
9. **Prepare the region PR** (do not merge): `vercel.json` `"regions": ["hnd1"]` →
   `["fra1"]`. Production deploys the `production` branch via the release train
   (`daily-release.yml`), so on the night it is deployed by hand (step 5).

---

## The night (Israel 23:00; window 60 min; rehearsal time replaces the estimates)

No runs and no `cron/sync` (it runs 02–21 UTC) at 23:00 IL = 21:00 UTC in winter. Note
`cron/sync` is `*/5 2-21` so its **last** firing is 21:55 UTC — the window starts after
crons are off, not because of the hour.

| T | Step |
|---|---|
| 22:50 | 0. Go/no-go: EU schema diff empty, storage pre-copy done, auth checklist ticked, decision J recorded, rehearsal passed. |
| 23:00 | 1. Maintenance + crons off |
| 23:05 | 2. Dump Tokyo → restore EU |
| 23:25 | 3. Verify row counts |
| 23:30 | 4–5. Vercel env switch + fra1 deploy |
| 23:40 | 6. Smoke |
| 23:55 | **Decision point R** — go forward or roll back |
| 00:00 | 7. Maintenance off, crons on |

### 1. Maintenance flag on, crons off (T+0, ~5 min)
1. Settings → maintenance (או `PUT /api/maintenance` from the admin UI): `maintenance_mode = on`,
   allowlist = Ofer + Claude test account. The flag lives in `app_settings` **in the DB**, so
   it travels in the dump — EU comes up in maintenance too, which is what we want.
   Maintenance gates the UI only; API routes and webhooks still write. Writes that land on
   Tokyo after the dump starts are lost on EU — step 3b measures them.
2. Vercel → Project → Settings → **Cron Jobs → Disable**. This stops all 10 crons in
   `vercel.json` immediately without a deploy. (Rotating `CRON_SECRET` as the plan says also
   works but only takes effect on the next deployment — use it as the belt-and-braces with
   the step-5 deploy, and update the GitHub secret `CRON_SECRET` to match.)
3. GitHub Actions (there is **no** hourly sync workflow on main any more — `cron/sync` is the
   Vercel `*/5` cron). Disable the scheduled workflows that matter:
   ```bash
   gh workflow disable daily-release.yml   # 02:00 UTC release train would move `production` mid-move
   gh workflow disable race-live.yml       # only fires 6 Dec; disable anyway
   ```
4. Wait until no function is running: Vercel → Logs, filter `/api/cron` and `/api/webhooks`, 2 min quiet.

### 2. Dump Tokyo, restore EU (~20 min; rehearsal time is authoritative)
Schema already exists on EU (prep 1), so this is a **data-only** move of `public`, `auth`
and the storage metadata we don't copy via the API.
```bash
TS=$(date -u +%Y%m%dT%H%MZ)
# Tokyo: read-only snapshot. Exclusions are tables Supabase itself owns and seeds on EU.
pg_dump "$TOKYO_DB_URL" --data-only --no-owner --no-privileges \
  --schema=public --schema=auth \
  --exclude-table=auth.schema_migrations \
  --exclude-table=auth.audit_log_entries \
  --exclude-table-data=auth.flow_state \
  -Fc -f "tokyo-data-$TS.dump"
pg_restore --list "tokyo-data-$TS.dump" | wc -l        # sanity: non-zero

# EU: must be empty of app data (rehearsal truncated it). Restore with triggers off so
# FK order and our own audit/notification triggers don't fire on historical rows.
pg_restore --dbname="$EU_DB_URL" --data-only --no-owner --no-privileges \
  --disable-triggers --single-transaction --exit-on-error \
  "tokyo-data-$TS.dump"
```
Caveats:
- `--disable-triggers` needs the `postgres` role to own the tables or be superuser. If it
  is refused on EU, restore instead with a plain SQL dump (`-Fp`) preceded by
  `SET session_replication_role = replica;` — the method Supabase's own migration guide uses.
- `auth` schema: only data, never schema — Supabase's GoTrue owns `auth` DDL and EU's
  version must match its own. Tables that matter: `auth.users`, `auth.identities`,
  `auth.refresh_tokens`, `auth.sessions`, `auth.mfa_*`, `auth.one_time_tokens`.
  `audit_log_entries` is excluded (large, not needed; Tokyo keeps it for 2 weeks).
- `storage` schema is **not** in the dump: `storage.buckets` is created by migrations, and
  `storage.objects` rows are created by `copy-storage.sh` uploading the bytes (rows without
  bytes would be broken images). Run the delta copy now:
  `I_HAVE_APPROVAL=yes ./copy-storage.sh`
- Sequences: data-only dumps include `setval` for owned sequences — verify one:
  `select last_value from public.<any serial seq>;` equal on both.
- `extensions`/`vault`/`realtime` schemas are not moved; nothing in the repo uses them.

### 3. Verify (~5 min)
```bash
psql "$TOKYO_DB_URL" -X -q -A -t -f rowcounts.sql > counts-tokyo.txt
psql "$EU_DB_URL"    -X -q -A -t -f rowcounts.sql > counts-eu.txt
diff counts-tokyo.txt counts-eu.txt && echo IDENTICAL
```
3a. Expected diff: **none**, except `storage.objects` lines may differ by objects uploaded
    after the copy listing (re-run the copy until identical).
3b. Write-loss check: run `rowcounts.sql` on Tokyo once more *after* step 4; any change vs
    `counts-tokyo.txt` is a write that landed on Tokyo during the window. Small, known tables
    (`client_events`, `client_logs`) are acceptable; activity/feed rows are re-pulled by the
    next sync; anything else → copy those rows by id before maintenance off.

### 4. Vercel env switch (Production scope only) (~5 min)
Settings → Environment Variables, **Production**:
- `NEXT_PUBLIC_SUPABASE_URL` = `https://zrrklhonqtzycayjdbor.supabase.co`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY` = EU anon key
- `SUPABASE_SERVICE_ROLE_KEY` = EU service-role key
- (decision J = keep sessions) `NEXT_PUBLIC_SUPABASE_AUTH_STORAGE_KEY` = `sb-njzldypndkicpsmdtyll-auth-token`
- `CRON_SECRET` = new value (and the same in GitHub → Secrets → `CRON_SECRET`)
- Keep the old values in a note **in 1Password**, not in this repo — they are the rollback.

`NEXT_PUBLIC_*` are inlined at build time, so the env change only lands with a new build.

### 5. Deploy with region fra1 (~5 min)
Merge the prepared region PR to `main`, then deploy production from it in one build
(the release train is disabled, so by hand):
```bash
git fetch origin && git checkout -B production origin/main && git push origin production
```
(or Vercel → Deployments → Redeploy the production deployment *without* build cache after
the merge). Check: Deployment → Functions → Region = `fra1`; `curl -s https://www.madregot.app/api/config | jq .supabaseUrl`
prints the EU URL.

### 6. Smoke (~15 min, allowlisted account through maintenance)
- [ ] Web sign-in (email code) and Apple sign-in; existing session survived (decision J) or prompts once.
- [ ] Native (TestFlight + App Store build): opens signed in / signs in; token refresh works
      (leave the app in the background past the 1 h access-token expiry, reopen).
- [ ] Feed loads with images (storage), a run detail opens with map.
- [ ] Dashboard weekly + academy screen.
- [ ] One Garmin sync for the test athlete: `curl -X POST -H "Authorization: Bearer $NEW_CRON_SECRET" https://www.madregot.app/api/cron/sync` (or the per-athlete sync button); new activity row appears **in EU**.
- [ ] Push one workout to a watch (test athlete).
- [ ] Upload an avatar → object appears in EU `avatars` bucket.
- [ ] Vercel function logs: no `ECONNREFUSED`/`JWT`/`relation does not exist` errors.
- [ ] Latency: `/api/feed` p50 well under Tokyo-era numbers (server and DB both fra1).
- [ ] GitHub secrets `SUPABASE_URL`/`SUPABASE_ANON_KEY` updated; run `prod-smoke.yml` by hand.

### Decision point R (T+55 min)
**Roll back if any of:** sign-in broken for more than the expected one-time re-login; any
row-count diff outside 3a/3b; Garmin sync or workout push fails against EU; error rate in
logs clearly above baseline. Otherwise go forward. If the window is running past
01:00 IL, roll back and reschedule — don't debug at 2 am with the club waking at 5.

### 7. Go live
1. Maintenance **off** (on EU now — it is the live DB).
2. Vercel → Cron Jobs → **Enable**. `gh workflow enable daily-release.yml race-live.yml`.
3. Tokyo: stays up **read-only for 2 weeks** — revoke writes so a stale client can't fork the data:
   `alter database postgres set default_transaction_read_only = on;` (Ofer runs; reversible
   with `= off`), then pause the project after 2 weeks.
4. Announce done.

---

## Rollback (one deploy, nothing deleted)

Before step 7 (decision point R): Vercel Production env back to the Tokyo values from
1Password, revert the region PR (`regions: ["hnd1"]`), redeploy `production`. Tokyo was never
written to by the migration, so it is exactly as it was at 23:00 plus any 3b writes. Then
maintenance off on Tokyo, crons enable, workflows enable. EU is left as is (truncate later).

After step 7 (rolling back days later): EU has new writes Tokyo doesn't. It is then a
**reverse move** (this runbook with TOKYO and EU swapped, Tokyo first set
`default_transaction_read_only = off` and truncated), not a flip — decide R carefully.

## Files here
- `rowcounts.sql` — read-only exact counts, diff-shaped.
- `copy-storage.sh` — bucket object copy Tokyo → EU via the Storage API (dry-run default).
- `pause-crons.sh` — the GitHub side of step 1.3 / 7.2 (`disable|enable`). Vercel crons are a dashboard toggle.
