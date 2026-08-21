-- Generic events/calendar model (roadmap Phase 3 — #4 Calendar, #8 Dedicated
-- Event Pages, #15 Event Registration). Genericizes the single-purpose `races`
-- table into a polymorphic `events` table covering every event kind the
-- checklist names: races, training camps, lectures, social events, photo
-- shoots, sponsor events, and special (non-recurring) workouts.
--
-- `races` is NOT dropped — it stays as historical/backup data. The existing
-- /dashboard/races page + /api/races route keep working unchanged; a
-- follow-up can repoint them at `events` (kind='race') once the new calendar
-- UI is live and trusted. This migration only adds new tables.
--
-- Run this in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),

  kind TEXT NOT NULL DEFAULT 'race'
    CHECK (kind IN ('race', 'camp', 'lecture', 'social', 'photo_shoot', 'sponsor', 'workout')),

  name TEXT NOT NULL,
  description TEXT,

  -- Single-day by default; end_date set only for multi-day camps.
  date DATE NOT NULL,
  end_date DATE,
  -- NULL start_time = "all day" (e.g. a camp with no single start moment).
  start_time TIME,

  location TEXT NOT NULL,
  lat DOUBLE PRECISION,
  lng DOUBLE PRECISION,
  -- Explicit override; when NULL the UI derives a Waze deep-link from lat/lng.
  waze_url TEXT,

  -- Race-specific, kept from the old `races` shape (split distances shown as
  -- chips + a coarse race-length class). NULL/empty for non-race kinds.
  distances TEXT[] NOT NULL DEFAULT '{}',
  race_class TEXT,
  website TEXT,

  -- Dedicated-event-page content (#8): ordered agenda items, a recommended
  -- gear checklist, and an FAQ accordion — all optional, all author-supplied.
  agenda JSONB,     -- [{ time: "09:00", title: "..." }]
  gear TEXT[],
  faqs JSONB,       -- [{ q: "...", a: "..." }]

  -- Capacity gate for registration (#15). NULL = unlimited, no waitlist.
  capacity INT,

  created_by UUID REFERENCES athletes(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_events_date ON events(date);
CREATE INDEX IF NOT EXISTS idx_events_kind_date ON events(kind, date);

-- ─── event_registrations ────────────────────────────────────────────────────
-- One row per athlete per event. `waitlisted` is a real status, not just a
-- derived "over capacity" read — so a spot opening up later has something
-- concrete to promote FROM, and the athlete's own registration screen can
-- show "you're on the waitlist" without recomputing capacity math client-side.

CREATE TABLE IF NOT EXISTS event_registrations (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  athlete_id UUID NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'registered'
    CHECK (status IN ('registered', 'waitlisted', 'cancelled')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, athlete_id)
);

CREATE INDEX IF NOT EXISTS idx_event_registrations_event
  ON event_registrations(event_id) WHERE status <> 'cancelled';
CREATE INDEX IF NOT EXISTS idx_event_registrations_athlete
  ON event_registrations(athlete_id) WHERE status <> 'cancelled';

-- ─── RLS ─────────────────────────────────────────────────────────────────────
-- Same convention as every other table in this app: all access goes through
-- API routes using the service role (bypasses RLS). Enabled with no policies
-- so the anon/public key can't read or write these directly.

ALTER TABLE events ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_registrations ENABLE ROW LEVEL SECURITY;

-- ─── Backfill: bring the existing 5 seeded races into the new model ────────
-- Non-destructive — `races` keeps its own rows untouched. Matched by name+date
-- so re-running this migration is idempotent (no duplicate events created).

INSERT INTO events (kind, name, date, location, lat, lng, distances, race_class, website)
SELECT 'race', r.name, r.date, r.location, r.lat, r.lng, r.distances, r.type, r.website
FROM races r
WHERE NOT EXISTS (
  SELECT 1 FROM events e WHERE e.kind = 'race' AND e.name = r.name AND e.date = r.date
);

-- ─── Nav ─────────────────────────────────────────────────────────────────────
-- New "calendar" tab, same audience as the existing "races" tab (races is a
-- subset of what calendar now shows).

INSERT INTO role_tab_permissions (role, tab, enabled) VALUES
  ('admin', 'calendar', true),
  ('coach', 'calendar', true),
  ('academy_coach', 'calendar', true),
  ('runner', 'calendar', true),
  ('core_runner', 'calendar', true),
  ('academy_user', 'calendar', true),
  ('viewer', 'calendar', false)
ON CONFLICT (role, tab) DO UPDATE SET enabled = EXCLUDED.enabled;

INSERT INTO role_mobile_tab_permissions (role, tab, enabled) VALUES
  ('admin', 'calendar', true),
  ('coach', 'calendar', true),
  ('academy_coach', 'calendar', true),
  ('runner', 'calendar', true),
  ('core_runner', 'calendar', true),
  ('academy_user', 'calendar', true)
ON CONFLICT (role, tab) DO UPDATE SET enabled = EXCLUDED.enabled;
