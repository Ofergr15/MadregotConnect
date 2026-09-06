-- Diagnostic context on an app-feedback report (/dashboard/review).
--
-- WHY: the review screen is the club's only "this is broken" channel, and the
-- reports arriving through it were a bare sentence — "the calendar doesn't
-- open". Triaging that meant guessing the screen, the app version and the
-- device, none of which the reporter can be expected to know. The screen now
-- collects them automatically and shows the athlete exactly what it is
-- attaching, so this column is the place they land.
--
-- JSONB and not columns: the shape is a diagnostic snapshot, it will grow (a
-- build id, a network type), and nothing queries it — the triage sheet reads
-- the whole object and prints it. Adding a key must never need a migration.
--
-- Purely additive. The POST route degrades on 42703 and inserts without the
-- key, so the app keeps working until this file is applied by hand.
ALTER TABLE feedback ADD COLUMN IF NOT EXISTS context JSONB;

COMMENT ON COLUMN feedback.context IS
  'Auto-collected diagnostics for this report: page, app version, device/OS, viewport, locale. Shown to the reporter before sending; see src/lib/review-context.ts.';
