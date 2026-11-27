-- 230 — content_reports accepts group chat messages (night task 53).
-- Paste by hand in the Supabase SQL editor. Idempotent; safe to paste twice.
-- Needs 203 (content_reports). Until this is applied POST /api/group-chat/report
-- answers 503 (the insert fails the old CHECK); nothing else changes.

DO $$
BEGIN
  IF to_regclass('public.content_reports') IS NULL THEN
    RAISE NOTICE '230 skipped: content_reports does not exist (apply 203 first)';
    RETURN;
  END IF;
  ALTER TABLE content_reports DROP CONSTRAINT IF EXISTS content_reports_target_type_check;
  ALTER TABLE content_reports ADD CONSTRAINT content_reports_target_type_check
    CHECK (target_type IN ('feed_item','comment','run_chat_message','academy_message','photo','group_chat_message'));
END $$;
