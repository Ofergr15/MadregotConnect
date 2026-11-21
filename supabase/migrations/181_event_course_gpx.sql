-- 181: a course map for an event (plan V11). The GPX file itself lives in storage; the event
-- carries only its https URL. NULL = no course map: the app falls back to the location, the
-- Waze link and the distances the event already has.
-- NOT APPLIED. Paste manually in the Supabase SQL editor when approved.
ALTER TABLE events ADD COLUMN IF NOT EXISTS course_gpx_url TEXT;
