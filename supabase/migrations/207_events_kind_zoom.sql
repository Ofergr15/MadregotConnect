-- 207: events.kind gains 'zoom' — the academy's monthly professional Zoom (academy doc p.2–3).
-- Paste in the Supabase SQL editor. Idempotent: drops the kind CHECK by whatever name it has and
-- re-adds it with the full list (src/lib/events.ts EVENT_KINDS). Nothing reads 'zoom' until this runs;
-- before it, creating a zoom event fails the CHECK (a 500 the route reports), nothing else changes.
DO $$
DECLARE c text;
BEGIN
  FOR c IN
    SELECT con.conname FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    WHERE rel.relname = 'events' AND con.contype = 'c' AND pg_get_constraintdef(con.oid) ILIKE '%kind%'
  LOOP
    EXECUTE format('ALTER TABLE events DROP CONSTRAINT %I', c);
  END LOOP;
END $$;

ALTER TABLE events ADD CONSTRAINT events_kind_check
  CHECK (kind IN ('race', 'camp', 'lecture', 'social', 'photo_shoot', 'sponsor', 'workout', 'zoom'));
