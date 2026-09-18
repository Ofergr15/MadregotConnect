-- 107_run_meetups.sql
--
-- "שידוכי ריצות" — run matchmaking. Reported as 398963c7:
--   "option to say when and where you're going out for a workout and what the
--    planned pace is. Someone whose plan has a similar workout can send a
--    request to join."
--
-- Two tables, because the request is two things: an OFFER (one member says when,
-- where and how fast) and an ASK (another member asks to come along). Keeping the
-- ask as its own row is what makes the host's answer recordable — a boolean
-- "joined" column on the offer could not express "asked and not answered yet",
-- which is most of the lifetime of every one of these.
--
-- ── WHAT THIS IS NOT ────────────────────────────────────────────────────────
-- Not `events` (migration 072). Those are club events: staff-created, public
-- (GET /api/events needs no auth), one shared calendar. A meetup is a MEMBER's
-- own plan for tomorrow morning, it is created by whoever is going, and it
-- expires the moment it has happened. Putting these on the club calendar would
-- have meant either staff-gating them — which removes the entire point — or
-- opening event creation to every member, which changes what the calendar is.
--
-- Not the automatic half of the report either. "Someone whose plan has a similar
-- workout" would mean matching against parsed_workouts, and that parse is known
-- to drop whole pages of a PDF, so a matcher built on it would silently miss
-- people and read as the feature not working. The offer carries the planned pace
-- and distance instead, and the reader decides — the pace on the card is the
-- match. Worth revisiting once plan coverage is trustworthy.
--
-- Run this in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS run_meetups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  host_athlete_id UUID NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  -- Date and clock time kept apart, same shape as `events`: the club reads these
  -- as "Saturday at 6:30", and a timestamptz would invite a UTC conversion on a
  -- value nobody ever means in UTC.
  date DATE NOT NULL,
  start_time TEXT NOT NULL,
  location TEXT NOT NULL,
  -- Planned pace as the club writes it, "5:10" = min:sec per km. TEXT and not an
  -- interval or a number of seconds because it is a human intention, not a
  -- measurement: it is displayed back verbatim and never arithmetic'd.
  planned_pace TEXT,
  distance_km NUMERIC(5,2),
  notes TEXT,
  -- 'open' | 'cancelled'. No 'done' — a meetup in the past is over by its date,
  -- and a status that has to be swept by a cron to stay true is a status that
  -- will be wrong.
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (status IN ('open', 'cancelled'))
);

-- Every read is "the upcoming ones, soonest first".
CREATE INDEX IF NOT EXISTS idx_run_meetups_date
  ON run_meetups (date);

CREATE TABLE IF NOT EXISTS run_meetup_requests (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  meetup_id UUID NOT NULL REFERENCES run_meetups(id) ON DELETE CASCADE,
  athlete_id UUID NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  -- 'pending' | 'accepted' | 'declined'. The host answers; nothing expires it.
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  -- One ask per person per meetup, so a double tap cannot queue two requests the
  -- host then has to answer twice.
  UNIQUE (meetup_id, athlete_id),
  CHECK (status IN ('pending', 'accepted', 'declined'))
);

CREATE INDEX IF NOT EXISTS idx_run_meetup_requests_meetup
  ON run_meetup_requests (meetup_id);

ALTER TABLE run_meetups ENABLE ROW LEVEL SECURITY;
ALTER TABLE run_meetup_requests ENABLE ROW LEVEL SECURITY;

-- Same posture as the rest of the app: reached only through service-role API
-- routes that have already established who the caller is.
DROP POLICY IF EXISTS "Service role manages run meetups" ON run_meetups;
CREATE POLICY "Service role manages run meetups"
  ON run_meetups FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

DROP POLICY IF EXISTS "Service role manages run meetup requests" ON run_meetup_requests;
CREATE POLICY "Service role manages run meetup requests"
  ON run_meetup_requests FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');
