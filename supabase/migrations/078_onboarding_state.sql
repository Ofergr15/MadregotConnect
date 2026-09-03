-- ═══════════════════════════════════════════════════════════════════════════
-- 078 — Onboarding state: who is still "new"
--
-- Every one of the 28 athletes is on the platform but none of them has actually
-- been walked through the app, so all of them are new — including the admin who
-- asked for this. Two nullable timestamps carry that, and because a nullable
-- column added to an existing table is NULL on every existing row, this
-- migration marks the whole club as new WITHOUT a backfill UPDATE. There is
-- nothing to run afterwards.
--
--   onboarding_tour_seen_at IS NULL  → the first-run tour has never been shown
--   onboarding_completed_at IS NULL  → this person is still "new"
--
-- Timestamps rather than booleans because "when" is the question that gets asked
-- later (how long does setup actually take? did the tour help?) and a boolean
-- can't answer it. NULL is the unambiguous "not yet" in both.
--
-- Deliberately NOT reusing `onboarding_status`. That column tracks the SIGNUP
-- pipeline (pending → google_authed → garmin_authed → active) and nothing in the
-- app ever promotes a row to 'active' — only 2 of 28 rows are there. It answers
-- "how far did this person get through the join form", which is a different
-- question from "has this person been shown the app and filled in their
-- profile". Overloading it would break the join flow's own reads.
--
-- The completion PERCENTAGE is not stored. It is derived at read time from
-- columns that already exist (garmin_auth/strava_auth, avatar_url, phone,
-- birth_date, gender, shirt_size, shoe_size) — see src/lib/onboarding/
-- setup-tasks.ts. A stored percentage would go stale the moment any of those
-- changes, and there is no cheap trigger that keeps it honest.
-- ═══════════════════════════════════════════════════════════════════════════

ALTER TABLE athletes
  ADD COLUMN IF NOT EXISTS onboarding_tour_seen_at  timestamptz,
  ADD COLUMN IF NOT EXISTS onboarding_completed_at  timestamptz;

COMMENT ON COLUMN athletes.onboarding_tour_seen_at IS
  'When the first-run guided tour was shown (or skipped). NULL = never shown, so the tour runs on next open. Set by POST /api/onboarding.';

COMMENT ON COLUMN athletes.onboarding_completed_at IS
  'When the athlete acknowledged finishing profile setup. NULL = still a new user: the setup-progress card renders on the profile screen. Set by POST /api/onboarding once every task is done and the athlete taps through the celebration.';

-- Partial index on the "still new" predicate. 28 rows today doesn't need it, but
-- this is the column the admin views will filter and group by from here on ("who
-- hasn't onboarded yet"), and it costs nothing at this size.
CREATE INDEX IF NOT EXISTS idx_athletes_onboarding_pending
  ON athletes (onboarding_completed_at)
  WHERE onboarding_completed_at IS NULL;

-- ═══════════════════════════════════════════════════════════════════════════
-- RESET — to put the whole club (or one person) back to "new" on demand.
-- Not run by this migration; kept here so it lives next to the columns it
-- resets rather than in a chat message.
--
--   -- everybody, including staff:
--   UPDATE athletes SET onboarding_tour_seen_at = NULL, onboarding_completed_at = NULL;
--
--   -- one person, to re-test the flow:
--   UPDATE athletes SET onboarding_tour_seen_at = NULL, onboarding_completed_at = NULL
--    WHERE email = 'grosfeldofer@gmail.com';
--
-- Resetting these two columns replays the tour and brings the setup card back.
-- It does NOT clear the underlying profile fields, so the card returns at
-- whatever percentage the athlete has actually reached — which is the point:
-- the reset is about the guidance, not about deleting anyone's data.
-- ═══════════════════════════════════════════════════════════════════════════
