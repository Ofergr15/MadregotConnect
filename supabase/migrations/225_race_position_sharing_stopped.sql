-- Q26-5 (QA 2026-11-26): "stop sharing my location" has to hold.
-- DELETE /api/race-live/{eventId}/position removed the race_positions row, and the next
-- LiveTrack poll (pollLiveTrack) wrote it straight back. The stop is now stored on the
-- runner's own race_entries row; every race_positions writer checks it and liveBoard
-- hides the position while it is set. Cleared only by an explicit resume
-- (POST … { resume: true }).
ALTER TABLE race_entries ADD COLUMN IF NOT EXISTS sharing_stopped_at TIMESTAMPTZ;

-- Which device wrote the latest point, so the phone's rate/monotonic checks compare
-- against the phone's own previous write, not the watch's (false 429/403 otherwise).
ALTER TABLE race_positions ADD COLUMN IF NOT EXISTS source TEXT
  CHECK (source IS NULL OR source IN ('phone', 'livetrack'));
