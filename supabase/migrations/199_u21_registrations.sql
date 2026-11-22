-- 180: Madregot Personal Coach (U21) — registration + intake (initial slice).
-- NOT APPLIED. Paste by hand in the Supabase SQL editor.
--
-- One row per submit of the public /u21 form. Written only by POST /api/u21/register
-- (service role); read only by GET /api/u21/registrations (admin-gated). RLS is enabled
-- with NO policies, so the anon/authenticated keys can neither read nor write: the
-- service role bypasses RLS and is the only path in. Nothing here is linked to
-- athletes — a registration is not a member until a coach acts on it (not in this slice).
-- No payment fields: the track is a recorded choice only.

CREATE TABLE IF NOT EXISTS u21_registrations (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  track              text NOT NULL CHECK (track IN ('basic', 'advanced', 'pro')),
  first_name         text NOT NULL,
  last_name          text NOT NULL,
  email              text NOT NULL,
  phone              text NOT NULL,
  birth_date         date NOT NULL,
  age_band           text NOT NULL CHECK (age_band IN ('16-17', '18-21')),
  framework          text,
  -- Guardian: required by the route when the applicant is under 18, null otherwise.
  guardian_name      text,
  guardian_phone     text,
  guardian_consent   boolean NOT NULL DEFAULT false,
  -- DRAFT red-flag list (pending coach Roi + legal review). Any true → red_flag, shown to the
  -- admin as "needs attention" only. It changes nothing for the applicant: same pending_review.
  flag_chest_pain       boolean NOT NULL DEFAULT false,
  flag_fainting         boolean NOT NULL DEFAULT false,
  flag_bone_pain        boolean NOT NULL DEFAULT false,
  flag_acute_injury     boolean NOT NULL DEFAULT false,
  red_flag           boolean NOT NULL DEFAULT false,
  -- Full questionnaire answers (only known fields are stored).
  intake             jsonb NOT NULL DEFAULT '{}'::jsonb,
  status             text NOT NULL DEFAULT 'pending_review'
                       CHECK (status IN ('pending_review', 'reviewed', 'accepted', 'declined')),
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT u21_guardian_for_minors CHECK (
    age_band <> '16-17' OR (guardian_name IS NOT NULL AND guardian_phone IS NOT NULL AND guardian_consent)
  )
);

CREATE INDEX IF NOT EXISTS u21_registrations_created_idx ON u21_registrations (created_at DESC);
CREATE INDEX IF NOT EXISTS u21_registrations_status_idx ON u21_registrations (status);

ALTER TABLE u21_registrations ENABLE ROW LEVEL SECURITY;
-- Deliberately no policies: deny-all for anon/authenticated; service role only.

COMMENT ON TABLE u21_registrations IS
  'Madregot Personal Coach (U21) registrations from the public /u21 form. Service-role only (RLS on, no policies). See migration 199.';
