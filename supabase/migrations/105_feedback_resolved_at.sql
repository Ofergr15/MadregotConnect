-- 105 — when a report was closed, stamped by the database.
--
-- Reports get closed by hand-pasted `UPDATE feedback SET status = 'done'` SQL far
-- more often than through the app, so anything the APPLICATION has to remember to
-- write is a thing that will be missing on most rows. A trigger is the only place
-- this can live and still be true.
--
-- What it buys: "resolved" was already knowable from `status`, but "resolved
-- RECENTLY" was not — and without that distinction, the pass that tells reporters
-- their report was closed (src/lib/feedback-notify.ts) could only choose between
-- never running and pushing a congratulation for every report ever closed, all in
-- one tick.
--
-- Run in the Supabase SQL editor, as one block.

ALTER TABLE feedback ADD COLUMN IF NOT EXISTS resolved_at timestamptz;

-- Everything already closed is backfilled to its own creation time, which is a
-- date in the past — deliberately, because the point of the backfill is that the
-- ~55 reports closed before this migration fall OUTSIDE the notifier's window and
-- nobody gets told about a bug they reported in July. `created_at` rather than a
-- literal so the ordering stays sane if this column is ever read as history; it
-- is an approximation of a moment nobody recorded, not a measurement.
UPDATE feedback SET resolved_at = created_at WHERE status = 'done' AND resolved_at IS NULL;

CREATE OR REPLACE FUNCTION feedback_stamp_resolved_at() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'done' THEN
      NEW.resolved_at := COALESCE(NEW.resolved_at, now());
    END IF;
    RETURN NEW;
  END IF;

  IF NEW.status = 'done' AND OLD.status IS DISTINCT FROM 'done' THEN
    -- COALESCE, so an explicit value in the UPDATE still wins — a repair script
    -- setting a known real date should not be overwritten with now().
    NEW.resolved_at := COALESCE(NEW.resolved_at, now());
  ELSIF NEW.status IS DISTINCT FROM 'done' THEN
    -- Reopened: the row is not resolved, so it must not carry a resolution time.
    -- Closing it again re-stamps, and the per-report ledger row is what stops the
    -- reporter being told twice.
    NEW.resolved_at := NULL;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS feedback_resolved_at ON feedback;
CREATE TRIGGER feedback_resolved_at
  BEFORE INSERT OR UPDATE ON feedback
  FOR EACH ROW EXECUTE FUNCTION feedback_stamp_resolved_at();
