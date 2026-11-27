# Profile stats rollups (task 101)

Status: implemented behind `PROFILE_STAT_ROLLUPS=1`, **default off**. Needs migrations 270 and
271 pasted, in that order. Stacked on task 100 (#100's PR adds 270).

## Problem

`GET /api/athletes/[id]/stats` pages **every** activity of the athlete (`fetchAllRows`, 1000 rows
per round trip) and folds the all-time, year and month totals from them on every profile open.
For a long-history athlete that is several round trips before the first number.

CLAUDE.md rules out the obvious shortcut: display numbers must not come from
`weekly_km_snapshots` — its week anchor changed mid-history and old rows were never re-keyed.

## Design

```
athlete_activities  --(trigger, 270)-->  athletes.activities_changed_at
        |                                         |
        |  cron/sync: refresh_stale_athlete_stat_rollups()  (one RPC, ≤50 athletes/tick)
        v                                         |
athlete_stat_rollups (athlete_id, period)  <------+  valid iff computed_at >= activities_changed_at
   period = 'all' | 'YYYY' | 'YYYY-MM'
```

- **Source of truth stays `athlete_activities`.** The rollup is recomputed from it, per athlete,
  whole (delete + insert) — no incremental arithmetic to drift.
- **Same rule as the JS.** Qualifying runs = `filterQualifyingRuns` (distance > 0, duration > 0,
  type empty or in `PR_RUN_TYPES`, passed in from TS so the list cannot drift). Year/month from the
  wall-clock date (`AT TIME ZONE 'UTC'`, CLAUDE.md "UTC-shaped"). Rounding stays in TS
  (`rollupsToTotals`), and a test pins the result to `buildAllTimeTotals` / `buildYearTotals` /
  `buildMonthTotals` on the same fixture.
- **Exact freshness, every instance.** The reader uses a rollup only when it was computed at or
  after the athlete's `activities_changed_at`. A run synced, edited, merged or deleted by any of
  the ~35 writer paths moves the stamp (trigger), so the profile falls back to the fold until the
  next sync tick refreshes it. Stale is never shown.
- **On sync**, not on read: `cron/sync` calls `refreshStaleRollups` after the weekly snapshot.
  Off → returns null without a query.
- Service-role only (RLS on, no grants to anon/authenticated).

## What this does and does not save yet

Flag on, fresh rollup: the three totals come from one small read, in the same parallel batch as
the activities read. **The activities read itself still happens** — PRs, record history, the
10-week table, last-7 and recent runs all fold from the raw runs. So this PR is the foundation, not
the full win.

Next steps, in order of payoff (each its own PR):
1. Narrow the activities read when the flag is on to what the rest needs: the 10-week table,
   last-7 and recent runs need ~12 weeks, not all history.
2. Persist PR bests per bucket on the same refresh (`athlete_pr_rollups`), so the record cards
   stop needing full history. The hard part is `computeRecordHistory` (every improvement over
   time) and PR overrides/exclusions — they must be applied after, in TS, as today.

## Rollout

1. Paste 270, then 271 (SQL editor).
2. Set `PROFILE_STAT_ROLLUPS=1` on a preview; open a few profiles, compare the totals with the
   flag off (they must be identical — the reader returns null and the fold runs if anything is off).
3. Production: set the env var. Backfill happens on its own: 271 stamps every athlete, so all of
   them start "stale" and are refreshed 50 per sync tick (the club is ~1 tick).
4. Rollback: unset the env var. The table and triggers can stay.
