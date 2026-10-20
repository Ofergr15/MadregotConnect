-- 162: per-person story placement, push and end time (mockup stories-area v5, Ofer 2026-10-20).
--   placement  where the birthday shows: 'feed' (post only), 'circle' (circle only), 'both'.
--              NULL = both. Still narrow-only: nothing shows while the feature's feed_post is off.
--   send_push  false = no push to this person. NULL = the feature's send_push.
--   until_at   a manual end ("עד תאריך…"); NULL = publish + display_days.
-- Paste as one block in the Supabase SQL editor; safe to run twice.
ALTER TABLE story_instances ADD COLUMN IF NOT EXISTS placement TEXT CHECK (placement IN ('feed','circle','both'));
ALTER TABLE story_instances ADD COLUMN IF NOT EXISTS send_push BOOLEAN;
ALTER TABLE story_instances ADD COLUMN IF NOT EXISTS until_at TIMESTAMPTZ;
NOTIFY pgrst, 'reload schema';
