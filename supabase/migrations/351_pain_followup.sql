-- 351: staff follow-up on a pain report (task 187).
--
-- A pain report's own status (open/resolved/withdrawn, 191) is the RUNNER's story. This is
-- the staff side: did somebody call them (open → contacted → closed), and private notes.
-- Written by POST /api/pain-reports/{id}/followup — only the report's routed recipients
-- (painRecipientIds: the pain_report routing rows + scope), never the runner.
-- Every status change or note is one row in pain_report_followups, which is also the audit.
--
-- Staff-only health notes: RLS on, no policies, never in a member response.
-- No FK to athletes on author_id (schemaEmbedAmbiguity.test.ts). Paste by hand. Idempotent.

ALTER TABLE pain_reports ADD COLUMN IF NOT EXISTS followup_status TEXT NOT NULL DEFAULT 'open';
DO $$ BEGIN
  ALTER TABLE pain_reports ADD CONSTRAINT pain_reports_followup_status_check
    CHECK (followup_status IN ('open', 'contacted', 'closed'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE pain_reports ADD COLUMN IF NOT EXISTS followup_updated_at TIMESTAMPTZ;
ALTER TABLE pain_reports ADD COLUMN IF NOT EXISTS followup_updated_by UUID;

CREATE TABLE IF NOT EXISTS pain_report_followups (
  id          UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  report_id   UUID NOT NULL REFERENCES pain_reports(id) ON DELETE CASCADE,
  author_id   UUID,
  status_from TEXT,
  status_to   TEXT CHECK (status_to IS NULL OR status_to IN ('open', 'contacted', 'closed')),
  note        TEXT CHECK (note IS NULL OR char_length(note) <= 1000),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS pain_report_followups_report_idx ON pain_report_followups (report_id, created_at);
CREATE INDEX IF NOT EXISTS pain_reports_followup_open_idx ON pain_reports (followup_status) WHERE followup_status <> 'closed';

ALTER TABLE pain_report_followups ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE pain_report_followups FROM anon, authenticated;
GRANT ALL ON TABLE pain_report_followups TO service_role;
