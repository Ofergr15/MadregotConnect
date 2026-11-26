-- 223: one report per (reporter, target), enforced by the database (QA 2026-11-26 #7).
-- The route's dedupe was read-then-insert, so 50 concurrent POSTs made 50 rows and 50 staff
-- pushes. The route now upserts ON CONFLICT DO NOTHING on this index and pushes only when a
-- row was created.
--
-- Existing duplicates would block the index: keep the earliest report per (reporter, target)
-- and drop the later copies (same reporter, same target, same content by construction).
DELETE FROM content_reports c
USING content_reports k
WHERE c.reporter_athlete_id = k.reporter_athlete_id
  AND c.target_type = k.target_type
  AND c.target_id = k.target_id
  AND (k.created_at, k.id::text) < (c.created_at, c.id::text);

CREATE UNIQUE INDEX IF NOT EXISTS uq_content_reports_reporter_target
  ON content_reports (reporter_athlete_id, target_type, target_id);
