-- 184: Events v2 — cover/logo, draft → scheduled → published lifecycle, a pending
-- version for edits to a live event, ordered content blocks, a questionnaire, and
-- pace groups with coach-approved assignments.
--
-- NOT APPLIED. Paste manually in the Supabase SQL editor when approved.
-- Idempotent (IF NOT EXISTS / ON CONFLICT). Every route that reads these falls back
-- when they are missing: no `status` column = every event is published, no
-- `event_blocks` table = no blocks.
--
-- `type` from the Events v2 spec is the existing `events.kind` (same 7 categories the
-- PWA calendar already uses) — not a second column.
--
-- Existing rows default to 'published' so nothing disappears from the calendar.

ALTER TABLE events ADD COLUMN IF NOT EXISTS cover_image_url TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS logo_url TEXT;
ALTER TABLE events ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'published';
DO $$ BEGIN
  ALTER TABLE events ADD CONSTRAINT events_status_check
    CHECK (status IN ('draft', 'scheduled', 'published'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- When status = 'scheduled': members see it from this moment (evaluated on read, no cron).
ALTER TABLE events ADD COLUMN IF NOT EXISTS publish_at TIMESTAMPTZ;
-- Bumped each time a pending version goes live.
ALTER TABLE events ADD COLUMN IF NOT EXISTS version INT NOT NULL DEFAULT 1;
-- Edits to a PUBLISHED event land here ({ fields: {...}, blocks: [...] }) and go live on
-- POST /api/events/[id]/publish. Staff-only; never serialised to members.
ALTER TABLE events ADD COLUMN IF NOT EXISTS pending JSONB;

CREATE INDEX IF NOT EXISTS idx_events_status ON events(status);

-- ─── event_blocks ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS event_blocks (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN (
    'countdown_distance_goal', 'club_runners', 'route', 'schedule', 'taper_plan',
    'travel_lodging', 'free_text', 'images', 'link', 'questionnaire', 'results', 'gallery'
  )),
  position INT NOT NULL DEFAULT 0,
  enabled BOOLEAN NOT NULL DEFAULT true,
  config JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_event_blocks_event ON event_blocks(event_id, position);

-- ─── event_answers (questionnaire) ──────────────────────────────────────────
CREATE TABLE IF NOT EXISTS event_answers (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  athlete_id UUID NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  answers JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, athlete_id)
);

-- ─── pace groups ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS event_pace_groups (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  label TEXT NOT NULL,                 -- e.g. "2:59"
  target_pace_sec_per_km INT NOT NULL CHECK (target_pace_sec_per_km BETWEEN 120 and 900),
  position INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_event_pace_groups_event ON event_pace_groups(event_id, position);

-- One assignment per athlete per event (event_id is denormalised for that UNIQUE).
-- athletes is referenced only once here, so no embed ambiguity.
CREATE TABLE IF NOT EXISTS event_group_assignments (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  group_id UUID NOT NULL REFERENCES event_pace_groups(id) ON DELETE CASCADE,
  athlete_id UUID NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  source TEXT NOT NULL DEFAULT 'auto' CHECK (source IN ('auto', 'coach')),
  approved BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (event_id, athlete_id)
);

-- Same convention as 055: service role only, no policies.
ALTER TABLE event_blocks ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_answers ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_pace_groups ENABLE ROW LEVEL SECURITY;
ALTER TABLE event_group_assignments ENABLE ROW LEVEL SECURITY;

-- ─── Storage: cover + logo images (public read, written only by the staff route) ──
INSERT INTO storage.buckets (id, name, public)
VALUES ('event-images', 'event-images', true)
ON CONFLICT (id) DO NOTHING;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'objects' AND policyname = 'Public read access for event images') THEN
    CREATE POLICY "Public read access for event images"
      ON storage.objects FOR SELECT USING (bucket_id = 'event-images');
  END IF;
END $$;
