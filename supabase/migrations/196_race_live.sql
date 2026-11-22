-- 196: Race live tracking (Valencia 2026-12-06 first) — bibs per runner, splits from the
-- organizer's timing (or staff entry / replay), one push per milestone per runner.
--
-- NOT APPLIED. Paste manually in the Supabase SQL editor. Idempotent.
-- athlete_id is deliberately NOT a foreign key: a table referencing both events and athletes
-- is a second embed path between them and breaks every unhinted embed (CLAUDE.md, 125).
-- Rows for a deleted athlete are harmless (the board joins athletes and skips misses).
-- Service role only, no policies (same convention as 055 / 184).

CREATE TABLE IF NOT EXISTS race_live_config (
  event_id UUID PRIMARY KEY REFERENCES events(id) ON DELETE CASCADE,
  -- Where splits come from. 'manual' always works; 'feed' needs feed_url; 'replay' is a dry run.
  source TEXT NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'feed', 'replay')),
  -- e.g. https://…/runner?bib={bib}  ({bib} is substituted; one GET per club runner)
  feed_url TEXT,
  active BOOLEAN NOT NULL DEFAULT false,
  -- Pushes are only sent when true. A replay with this off is a silent rehearsal.
  push_enabled BOOLEAN NOT NULL DEFAULT false,
  poll_from TIMESTAMPTZ,
  poll_to TIMESTAMPTZ,
  poll_every_sec INT NOT NULL DEFAULT 60 CHECK (poll_every_sec BETWEEN 30 AND 600),
  last_polled_at TIMESTAMPTZ,
  last_error TEXT,
  fail_count INT NOT NULL DEFAULT 0,
  -- Replay: race time 0 maps to this instant; speed 10 = a 3 h race replays in 18 min.
  replay_started_at TIMESTAMPTZ,
  replay_speed INT NOT NULL DEFAULT 10,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS race_entries (
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  athlete_id UUID NOT NULL,
  bib TEXT,
  goal_sec INT CHECK (goal_sec IS NULL OR goal_sec BETWEEN 3600 AND 28800),
  -- The runner's own choice: not shown on the live board, never announced.
  live_opt_out BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, athlete_id)
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_race_entries_bib ON race_entries(event_id, bib) WHERE bib IS NOT NULL;

CREATE TABLE IF NOT EXISTS race_splits (
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  athlete_id UUID NOT NULL,
  point TEXT NOT NULL CHECK (point IN ('start','5k','10k','15k','20k','half','25k','30k','35k','40k','finish')),
  elapsed_sec INT NOT NULL CHECK (elapsed_sec >= 0),
  source TEXT NOT NULL CHECK (source IN ('manual', 'feed', 'livetrack', 'replay')),
  recorded_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, athlete_id, point)
);

-- The dedup ledger: INSERT … ON CONFLICT DO NOTHING is the claim, so two overlapping polls
-- can't both announce the same finish. `sent=false` = marked done silently (skipped past).
CREATE TABLE IF NOT EXISTS race_milestones (
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  athlete_id UUID NOT NULL,
  milestone TEXT NOT NULL CHECK (milestone IN ('start', 'half', 'finish')),
  sent BOOLEAN NOT NULL DEFAULT true,
  claimed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, athlete_id, milestone)
);

-- Garmin LiveTrack link per runner (set by the runner, the evening before is fine). Server-side
-- only: never serialised to anyone but its owner. Nulled 24 h after poll_to (raceLiveTick purge).
ALTER TABLE race_entries ADD COLUMN IF NOT EXISTS livetrack_url TEXT;
ALTER TABLE race_entries ADD COLUMN IF NOT EXISTS livetrack_state TEXT;          -- ready | active | ended | error:<code>
ALTER TABLE race_entries ADD COLUMN IF NOT EXISTS livetrack_polled_at TIMESTAMPTZ;

-- Latest watch position per runner (one row, no trail). Shown only to members who opted in to
-- the map (race_map_viewers) and never for an opted-out runner. Deleted with the links.
CREATE TABLE IF NOT EXISTS race_positions (
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  athlete_id UUID NOT NULL,
  lat DOUBLE PRECISION NOT NULL,
  lon DOUBLE PRECISION NOT NULL,
  distance_m INT NOT NULL,
  elapsed_sec INT NOT NULL,
  at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (event_id, athlete_id)
);

-- Members who chose to see runners' live map positions.
CREATE TABLE IF NOT EXISTS race_map_viewers (
  event_id UUID NOT NULL REFERENCES events(id) ON DELETE CASCADE,
  athlete_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, athlete_id)
);

ALTER TABLE race_live_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE race_positions ENABLE ROW LEVEL SECURITY;
ALTER TABLE race_map_viewers ENABLE ROW LEVEL SECURITY;
ALTER TABLE race_entries ENABLE ROW LEVEL SECURITY;
ALTER TABLE race_splits ENABLE ROW LEVEL SECURITY;
ALTER TABLE race_milestones ENABLE ROW LEVEL SECURITY;
