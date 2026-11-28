-- 320: the gun time per race event (task 148), set with PUT /api/race-live/{eventId}/settings.
--
-- NOT APPLIED. Paste manually in the Supabase SQL editor. Idempotent.
-- events.start_time is a zoneless TIME; the race-live window needs an absolute instant
-- (the admin sets it from Israel for a race in Spain), so it lives on race_live_config.
-- The API enforces poll_to ≥ start + 6:30; the CHECK below is the same rule as a backstop
-- for hand edits. NULL start = not set yet (every existing row), which the CHECK allows.

ALTER TABLE race_live_config ADD COLUMN IF NOT EXISTS race_start_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'race_live_config_window_covers_race') THEN
    ALTER TABLE race_live_config ADD CONSTRAINT race_live_config_window_covers_race CHECK (
      race_start_at IS NULL OR poll_to IS NULL OR poll_to >= race_start_at + interval '6 hours 30 minutes'
    );
  END IF;
END $$;

NOTIFY pgrst, 'reload schema';
