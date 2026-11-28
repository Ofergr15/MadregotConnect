# Release checklist — web/server

One release a day, at 20:00 Israel time (`RELEASE_HOUR`, unset = 20). Nothing reaches
production without the owner's approval: he approves a commit in **/dashboard/whats-new**,
that pins the exact `main` SHA (`release_approvals`, migration 122), and
`.github/workflows/daily-release.yml` moves the `production` branch to that SHA — never to
whatever `main` has become since. Vercel deploys `production`. Then `prod-smoke.yml` runs.

Sources this checklist summarises: `src/lib/release-notes.ts`, `daily-release.yml`,
`prod-smoke.yml`, `scripts/smoke-prod.mjs`, `docs/runbook.md` ("A migration is missing"),
`src/lib/features/flags.ts`, CLAUDE.md ("Working in this repo").

Roles: **dev** = whoever merges to `main` (a session or a person). **Owner** = Ofer: approves,
pastes migrations, flips flags, rolls back.

---

## 1. Before 19:00 — what goes in (dev)

- [ ] Everything for tonight is merged to `main` and `main` is green in CI (`ci.yml`).
- [ ] `npm run check` passed on the merge commit (typecheck + tests + lint + build).
- [ ] Version bumped with `npm run version:bump` **after** rebasing on `origin/main`, never by hand
      (CLAUDE.md: parallel bumps made 2.41.232–239 ship twice).
- [ ] Each user-visible change has a note in `src/content/release-notes.json` (append-only,
      newest first, `kind: feature|fix`, `audience: 'staff'` for staff-only tools). A day of
      fixes is fine with no featured note.
- [ ] Both message files carry every new key (`messagesLocaleParity` fails otherwise).
- [ ] Nothing in the diff touches `ios/` (public repo; the native app ships on its own track).

## 2. Migrations (owner, before approving)

There is no migration runner. Nothing in CI or deploy applies `supabase/migrations/*.sql`.

- [ ] List what tonight adds: `git diff --name-only <live-sha>..<candidate-sha> -- supabase/migrations`
      (`<live-sha>` = `git rev-parse origin/production`).
- [ ] Read each file. It must be idempotent (`IF NOT EXISTS`, `ON CONFLICT DO NOTHING`,
      `CREATE OR REPLACE`). `CREATE INDEX CONCURRENTLY` goes one statement at a time, outside a transaction.
- [ ] A new `REFERENCES` to a table already referenced → every unhinted embed between the two
      breaks on paste (migration 125 took the feed down). `schemaEmbedAmbiguity.test.ts` must be green.
- [ ] **Order:** paste migrations the new code *needs* **before** approving. Routes are written
      to fall back when a column is missing, but a fallback is a degraded screen, not a feature.
      A migration that *drops* or renames something goes **after** the release that stopped reading it.
- [ ] Verify in the SQL editor: `select to_regclass('public.<table>')` /
      `select column_name from information_schema.columns where table_name = '<table>'`.
- [ ] Write the applied numbers where the team tracks them (the migrations memo), so nobody re-numbers.

## 3. Flags (owner)

Two kinds:

- **Feature enablements** (`feature_enablements`, migration 191; catalogue in
  `src/lib/features/flags.ts`). A new feature ships **off** (`defaultEnabled: false`) and is
  invisible until a row turns it on. Precedence: athlete > squad > academy > role > club > default.
- **Env switches** (Vercel → Settings → Environment Variables), e.g. APNs and outbound
  senders. A change needs a redeploy to take effect.

Checklist:

- [ ] New feature keys default **off**. Turning one on is a separate, deliberate step after the
      release is live — start with staff or one athlete, then a squad, then the club.
- [ ] No release relies on flipping a flag at the same moment (a flag flip is instant; a deploy is not).
- [ ] A flag that is being *removed* is first set to its final value in prod for a release, then
      the reader code goes, then the row.

## 4. What's New approval (owner, by 19:00)

- [ ] Open **/dashboard/whats-new**. It shows the candidate `main` commit and the notes not in
      any earlier release.
- [ ] Star (feature) the notes worth a card; reword if needed. Nothing is featured until starred.
      A note with a demo `media` is starred unless unstarred.
- [ ] Approve. That pins the SHA you were looking at; later merges to `main` wait for tomorrow.
- [ ] Need it out now? Set the repo variable `RELEASE_HOUR=now` (ships ~10 min after approval) or
      run **Daily release** manually (`workflow_dispatch`, ships immediately). Reset `RELEASE_HOUR` after.

## 5. 20:00 — the train (automatic)

`daily-release.yml` runs every 10 minutes. It ships only when: it is at or past `RELEASE_HOUR`,
production was not already deployed in today's window, `/api/release/approved` returns a SHA,
that SHA is not already live, and it is an ancestor of `main`. Otherwise it exits in seconds.

- [ ] The run log says `production → <sha>`. If it says "not on main — refusing", the approval
      pinned a commit that was rebased away: approve again.
- [ ] Vercel shows the Production deployment for that SHA as Ready.

## 6. After deploy — verify (owner or dev)

- [ ] **Prod smoke** (`prod-smoke.yml`) is green. It waits for the deploy, then runs
      `scripts/smoke-prod.mjs` — GETs only, as a dedicated test staff account. A red run means
      the release is broken.
- [ ] `GET https://www.madregot.app/api/version` returns the bumped version (a stale value =
      the old deploy is still serving).
- [ ] Open the app on a phone: feed loads, this week's plan loads, What's New sheet shows the
      starred notes once.
- [ ] First 30 min: Vercel logs filtered to `status >= 500`; look for `42703` / `PGRST205` /
      "more than one relationship" (a missing or ambiguous migration — runbook "A migration is missing").
- [ ] Next hourly sync (`cron/sync`) succeeds for Garmin and Strava (runbook "A cron fails").

## 7. Rollback (owner)

Pick the smallest step that stops the harm.

| Symptom | Do |
|---|---|
| One new feature misbehaves | Turn its enablement **off** (instant, no deploy). |
| A screen 500s on a missing column/table | Paste the missing migration (§2). Code stays. |
| The release itself is broken | Vercel → Deployments → the previous Production deployment → **Instant Rollback**. Seconds, no build. |
| Rollback must survive the next train | Move the branch too: `git push origin <previous-sha>:refs/heads/production --force` (the train only re-ships on a *new* approval, but a manual run or redeploy would redeploy the bad SHA otherwise). |
| A migration did damage | Do **not** hand-write a reverse `ALTER` that differs from the files. Write a new numbered migration that undoes it, paste it, commit it. Restore data from backups (`docs/backups.md`) only for data loss. |

After a rollback:

- [ ] `/api/version` shows the previous version.
- [ ] Re-run **Prod smoke** manually (`workflow_dispatch`).
- [ ] Fix forward on `main`; the next approval ships the fix through the normal train.
- [ ] Note what happened (date, SHA, symptom, step taken) in the release notes or the team channel.

## Never

- Push to `production` or `main` from a session. Sessions open PRs; the owner approves releases.
- Ship a migration and its first reader in the same release *without* pasting the migration first.
- Flip a flag on for the whole club in the same hour as the release that introduced it.
- Bump the version by hand.
