# Decisions pending — owner

## Hidden pace still derivable from distance + time (2026-11-23)

When a runner hides pace (`feed_items.payload.hiddenFields` includes `'pace'`), the feed blanks `averagePace`, the per-km bands, lap/step bands and the plan badge — but it still ships `distance` plus `duration`/`movingDuration`, and pace is just one divided by the other, so anyone reading the card (or the JSON) can recover the average pace the runner asked to hide. Tonight's change only adds `paceHidden: true` on the projected feed item so clients know not to compute or display pace; time is NOT hidden, because hiding it also removes a stat runners like to show ("ran 1:32") and changes the card for every pace-hidden run. The choice for Ofer: (a) keep as is — `paceHidden` is a client courtesy, pace stays arithmetically recoverable; (b) also hide time when pace is hidden (closes the leak, distance alone remains); or (c) round time coarsely (e.g. to 5 minutes) when pace is hidden, which blurs pace to roughly ±15 s/km on a 10 K. Recommendation: (b), with the share sheet explaining that hiding pace hides time too.

## RESOLVED (2026-11-23): hiding pace also hides record times from teammates

Ofer: yes. Implemented in PR #86 (stats prs/prHistory, records/run, activities/analysis). Still open above: whether hiding pace also hides a run's total time.

## Profile PRs for Ofer (2026-11-23)

`/api/athletes/prs` for athlete 4e7d7c0f… returns 5K 18:12, 10K 36:49, HM 1:19:57, FM 2:48:45 (read-only check against prod). No overrides or exclusions exist for him. Sources: 5K = laps 14–34 of the 2026-09-23 "Morning Run" (12.9 km fartlek of 90/60/30/15 s on-float; its own 1 Hz stream agrees, 1092 s); 10K = whole run 2022-11-02 (10.007 km, 2211 s); HM = whole run 2026-02-27 (21.154 km, 4810 s, scaled). The computation does what it is specified to do — if any of these is not a time Ofer accepts as a PR, the options are: exclude that run per bucket (`athlete_pr_exclusions`, already supported), state the time by hand (`athlete_pr_overrides`), or change the rule so a segment PR can't come out of a structured interval session (e.g. skip runs with `executed_workout` that has repeat steps). Separately, the run-page best efforts were timed on the raw stream clock including pauses — fixed in the best-effort PR.

## Perf server wins that need a migration or a decision (2026-11-23)

From the b21-perf lane's `ios/docs/PERF-SERVER-WINS.md`. S1 (own group on athletes/me) and S2 (`/api/activities?shape=list`) are code-only, in PR #72.

- **S6, indexes (migration, paste by hand):** check them with `EXPLAIN ANALYZE` first, then `CREATE INDEX IF NOT EXISTS`. Candidates: `athlete_activities (athlete_id, start_time DESC)`, `feed_items (created_at DESC)` together with the feed's visibility filter, `notifications (athlete_id, created_at DESC)` plus a partial unread index, `workout_feedback (athlete_id, activity_id)`, `activity_streams (activity_id)`. Several may already exist, so the plan has to be checked before anyone pastes anything. Plain `CREATE INDEX` locks writes; use `CONCURRENTLY`, which can't run inside a transaction.
- **S7, volume history as SQL (migration, a new RPC):** a `date_trunc('week', start_time)` GROUP BY would return 52 rows instead of paging a year of activities. It has to bucket with the Monday activity-week anchor and the same run-type filter as `filterQualifyingRuns`, or it reintroduces the "numbers don't reconcile" bug. Needs a parity test against `fetchWeeklyVolume`.
- **S4, `Cache-Control: private, max-age=30` on `/api/features/me` and `/api/dashboard/weekly` (code, but a decision):** it delays a flag flip or a plan publish by up to 30 s on that device, and the swr-persist rules assume fresh GETs. Ofer to choose.
- **S3, details vs. stream both carrying the geometry:** needs a measurement of both payloads on a real run before changing either shape.
- **S5, inbox `answered` flag:** code-only. Left for a separate PR because it touches the inbox projection's shape.
