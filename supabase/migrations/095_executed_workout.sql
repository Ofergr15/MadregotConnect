-- Keep the workout the WATCH ran, so a lap's step number means something.
--
-- WHY: Garmin stamps every lap of a structured run with `wktStepIndex` — the step of
-- the workout the device was executing — and migration 094's laps now carry it. On its
-- own that number is useless: it is an index into a step list, and without the list a
-- "3" is not a warm-up or a rep or a walk. `GET /activity/{id}/workouts` returns
-- exactly that list, and nothing stores it.
--
-- With both halves, "did they run the session" stops being inferred. The app's other
-- two engines SEARCH for the plan inside the run — `gradePlanBlocks` slides each block
-- along the distance axis looking for the window that best fits its target band, and
-- `findPlannedEfforts` looks for laps the right length to be the reps. Good guesses,
-- but guesses: a timed block's length has to be estimated through the pace the athlete
-- was *supposed* to run (measured on one athlete's 120-minute block: 4:36 estimated
-- versus 4:42 from the watch), and a stride run 40 s/km off target comes out the wrong
-- length and vanishes from the rep count entirely. The watch needs no window and no
-- threshold: the 20 km block is step 1 whether it drifted early or late, and eight
-- strides are eight laps stamped step 2 at whatever pace they came out.
--
-- WHY NOT READ OUR OWN PLAN INSTEAD: because the index does not point there. It points
-- into the list Garmin numbered, which differs from the plan we parsed in two ways that
-- both produce a confident wrong answer:
--   * A REPEAT is a flat marker step ("go back to step 2, eight times"), not a
--     container. It occupies an index of its own and never runs. Collapse the repeats
--     the way our parsed plan does and every step after the first set is numbered one
--     too low — one athlete's Tuesday ladder has three markers mid-list.
--   * Athletes run workouts we did not write. One athlete's Sunday came off a workout
--     of her own — a single open 22 km step where the club plan has a 2 km warm-up and
--     a 20 km block. Every index still landed in range, and the verdict read
--     "warm-up: 22 km". Against her own step list she reads 22 km at 4:48 against the
--     4:35-4:45 she wrote in the step's note: on target, where the search said slower.
--
-- WHY ON athlete_activities AND NOT activity_streams: the feed's plan badge reads this
-- (lib/feed/plan-verdicts.ts) on the club's landing page, and it already selects laps
-- off this row. A narrowed workout is a handful of steps — the same order as the laps
-- beside it, and about a thousandth of a per-sample trace, which is why that one lives
-- in its own table and this does not.

ALTER TABLE athlete_activities
  ADD COLUMN IF NOT EXISTS executed_workout JSONB;

-- Narrowed, not Garmin's payload: `{name, createdAt, steps: [{stepIndex, intensity,
-- durationType, distanceM?, durationSec?, paceMin?, paceMax?, notes?, repeatFrom?,
-- iterations?}]}` — see lib/garmin/executed-workout.ts, which is the only thing that
-- should ever write or read this shape.
--
-- `notes` is kept verbatim and is load-bearing, not a comment. Only 1 of 8 of the
-- club's workouts carries a machine-readable pace target; in the rest the coach writes
-- it as prose in the step's note, in the same bracket notation as the plan —
-- "4:25 (4:35) ((4:45))" is groups 1/2/3, and "5:00-5:30" is one band for everyone.
-- Strip the notes and most steps become ungradeable.
COMMENT ON COLUMN athlete_activities.executed_workout IS
  'The structured workout this run was executed from, as the DEVICE had it, narrowed by lib/garmin/executed-workout.ts. NULL for a plain run. Steps are numbered as Garmin numbered them — including repeat markers — because that is what a lap''s wktStepIndex indexes.';

-- The backfill's cursor and the only query anyone runs against this: "the runs a watch
-- drove, newest first". Partial, because most runs are plain and will never match.
CREATE INDEX IF NOT EXISTS athlete_activities_executed_workout_idx
  ON athlete_activities (start_time DESC)
  WHERE executed_workout IS NOT NULL;
