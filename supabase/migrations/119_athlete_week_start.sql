-- 119 — athletes.week_start_day: which day a member's OWN week begins on.
--
-- WHY THIS EXISTS:
--
--   Reported by Sahar (feedback 75cb7ec7): "the training week is shown as Monday
--   to Sunday — can it be Monday to Saturday?" The app's activity week is anchored
--   on Monday because that is the week a Garmin reports, and the two numbers have
--   to agree: a runner once reported a 180 km week their watch had already told
--   them about while the app said 174.5 for the same rows, and a weekly total
--   nobody can reconcile against their own device gets treated as broken.
--
--   But the club is Israeli and the week here starts on Sunday. Both readings of
--   "my week" are legitimate, and they are legitimate for DIFFERENT people, so
--   this is a per-member display preference rather than a setting somebody has to
--   be right about on everyone's behalf.
--
-- WHAT IT DOES NOT TOUCH:
--
--   The LEADERBOARD and the pack war stay hard-coded to Monday–Sunday — Ofer's
--   call, and the only one that works: a table that ranks 25 people has to measure
--   all of them over the same seven days, or the ordering is meaningless. So this
--   column moves the numbers on a member's own profile and nothing that compares
--   them to anybody else.
--
--   It also does not touch the PLAN week. `weekly_plans.week_start_date` is a
--   Sunday the coach publishes against (see lib/utils.ts getPlanWeekStart) and it
--   belongs to the club, not to a reader.
--
-- WHY smallint AND NOT text:
--
--   It is a `Date.getDay()` value, which is what every consumer needs it as —
--   0 = Sunday, 1 = Monday. Storing 'sunday'/'monday' would mean a lookup table in
--   code for a number the language already defines. The CHECK keeps it to the two
--   days that were actually asked for; a Wednesday week is not a feature, it is a
--   way to make one member's totals unexplainable.
--
-- DEFAULT 1 (Monday) because that is what every existing member is already
-- looking at, and a migration that silently re-cuts 25 people's weekly km is a
-- worse bug than the one being fixed.

ALTER TABLE athletes
  ADD COLUMN IF NOT EXISTS week_start_day smallint NOT NULL DEFAULT 1;

ALTER TABLE athletes
  DROP CONSTRAINT IF EXISTS athletes_week_start_day_check;

ALTER TABLE athletes
  ADD CONSTRAINT athletes_week_start_day_check
  CHECK (week_start_day IN (0, 1));

COMMENT ON COLUMN athletes.week_start_day IS
  'Date.getDay() value the member''s own week starts on: 0=Sunday, 1=Monday (default, matches Garmin). Display preference for personal stats only — the leaderboard and pack war are always Monday-anchored.';
