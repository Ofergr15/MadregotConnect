# GET /api/academy/segments: read-only mode (DESIGN ONLY, not wired, needs a scope decision)

## Today (production 9307dfc8, pinned by `segmentsGetWriteCharacterization.test.ts`)
Call chain: `GET` → `resolveVerifiedCaller` → `mayActFor` → plan read (`weekly_plans`) → `laneWorkouts`
→ run read (`athlete_activities` incl. `laps`, `executed_workout`) → **3) Ensure laps** (route.ts ~270-306)
→ engines (`gradePlanBlocks`, `findPlannedEfforts`, `gradeWatchSteps`, `assessWorkout`, `buildVerdict`).

| Stored state of the run | Garmin calls | DB writes |
|---|---|---|
| A stamped laps + step list cached | none | none |
| B no laps, plain run | `getActivitySplits` | `athlete_activities.update({ laps })` |
| C no laps, workout run (`garmin_workout_id`) | splits + `getActivityWorkout` | `update({ laps })`, `update({ executed_workout })` |
| D stamped laps, step list missing | `getActivityWorkout` | `update({ executed_workout })` |
| any, under view-as | as above | **none** |
| `?bands=1` alone | none (no run read) | none |
| athlete has no `garmin_auth` | none | none |
| Garmin throws | attempted | none; 200 |

No request parameter turns this off: `?readOnly=1`, `?dryRun=1` still call Garmin and write (case J).
The writes are a cache fill (self-repair, CLAUDE.md "four engines"), not a user action.

## Proposal (not built)
`?cache=none` (name to be agreed): skip block 3 entirely: no Garmin call, no write. Grade only what is stored;
when the step list is missing the existing engines already fall back (watch-step path returns null → blocks/efforts).
Response adds `"cacheFill": "skipped" | "filled" | "not_needed" | "failed"` so a caller can tell an un-repaired
verdict from a complete one. Default behaviour unchanged.
Who would use it: audits, previews and any reader that must be side-effect free. It changes what a verdict can
say for state B/C/D runs (less evidence), so it is a semantics change and needs owner scope before wiring.
