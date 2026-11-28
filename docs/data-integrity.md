# Data integrity checks (read-only)

`scripts/integrity-check.mts` reports rows that should not exist. It **only reads** —
every query is a `select`, and the checks in `src/lib/integrity/checks.ts` are pure
functions over rows already fetched. Fixing anything it finds is a separate,
deliberate step (usually a hand-pasted SQL statement, reviewed first).

```bash
nvm use                                   # Node 22
npx tsx ./scripts/integrity-check.mts     # summary + first 20 rows per check
npx tsx ./scripts/integrity-check.mts --json > /tmp/integrity.json
```

Needs `.env.local` with the service key (same as the other `scripts/*.mts`). Findings
carry ids only — no names or emails — so the output can be pasted into an issue.

| Check | Table(s) | Means | Usual cause / next step |
|---|---|---|---|
| `orphan` | `athlete_activities`, `shoes`, `feed_comments`, `feed_likes` | `athlete_id` is null or names no athlete | An athlete merged/deleted outside `merge_athlete_rows` (097). Look up the id in `athletes` history before deleting anything. |
| `orphan` | `weekly_plans`, `feed_items` | `athlete_id` names no athlete (null is fine: a group plan / club post) | Same as above. |
| `duplicate-twin` | `athlete_activities` | a Garmin row and a Strava row the sync's own matcher (`findStoredMatch`) calls the same run | The run is counted twice in weekly km, badges, shoes. The sync upgrades in place (CLAUDE.md "Garmin's copy wins"); a surviving pair predates that or came from a backfill. |
| `impossible-date` | `weekly_plans` | `week_start_date` not a real date, not a **Sunday**, before 2020 or > 1 year ahead; or a workout `dayOfWeek` outside 0..6 | A plan written with the activity-week (Monday) anchor, or a parser output that skipped validation. |
| `impossible-activity` | `athlete_activities` | `start_time` missing/unparsable/in the future, negative distance or duration, or faster than 12 m/s | A provider payload mapped wrong. Remember `start_time` is wall-clock-shaped (CLAUDE.md), so up to a day of "future" is tolerated. |

**Suspicious speed** (a separate section, not a finding): runs with an average speed
above 7 m/s and at most 12 m/s, listed with id, athlete id, date, distance and speed
only (no names). Almost always a ride logged as a run, which distorts PRs — check each
by hand. Above 12 m/s is the `impossible-activity` check above, unchanged.

A table the database doesn't have yet (unpasted migration) is skipped with a line on
stderr, not treated as a failure.

The twin check deliberately reuses the importer's matcher instead of a looser rule: a
start-time-plus-distance rule would flag interval reps recorded as separate
activities (the 6 × 2 km case in `src/lib/activity-dedup.ts`).
