-- 220: content_reports.author_verified + the indexes the report route's abuse limits read (QA 25.11 #5).
--
-- author_verified: true when the server read the author off our own row (feed item, comment); false when
-- it is only the reporting client's claim (Stream chat / academy thread messages, Drive photos); NULL when
-- no author is known. Before this is pasted the route still works: it drops the column and stores only a
-- server-checked author.
--
-- No new REFERENCES (CLAUDE.md: a second FK to athletes makes unhinted embeds ambiguous).
-- Idempotent; safe to paste twice.

ALTER TABLE content_reports ADD COLUMN IF NOT EXISTS author_verified boolean;

-- Dedupe on (reporter, target) and the per-reporter hourly cap.
CREATE INDEX IF NOT EXISTS content_reports_reporter_idx ON content_reports (reporter_athlete_id, created_at DESC);
CREATE INDEX IF NOT EXISTS content_reports_reporter_target_idx ON content_reports (reporter_athlete_id, target_type, target_id);
