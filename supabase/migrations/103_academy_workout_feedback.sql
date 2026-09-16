-- The academy's weekly feedback, in one shape instead of eight WhatsApp styles.
--
-- Today a mentor reviews a trainee's week, opens the plan, opens the execution, and
-- types free text into a WhatsApp group. Three things follow from that, and this
-- table exists to end all three:
--   · the feedback is only as good as whichever mentor wrote it, so quality is a
--     property of the person rather than of the academy;
--   · nothing about it can be counted — "he opens too fast" is a feeling somebody
--     once typed, not a fact about a trainee over six months;
--   · it costs mentor-minutes per workout, and mentor-minutes are what limit how
--     many trainees the academy can carry per mentor.
--
-- So the mentor's ANSWERS are stored structured (`execution`/`effort`/`action`,
-- closed vocabularies defined in lib/academy/feedback.ts) and the Hebrew the trainee
-- read is stored beside them, already rendered.
--
-- Both, deliberately. The structured fields are what make the history countable; the
-- rendered text is what was actually SENT, and a message a trainee received must not
-- silently re-word itself later because the club changed its phrasing.

CREATE TABLE IF NOT EXISTS academy_workout_feedback (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  athlete_id UUID NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  -- The athlete-local calendar day of the workout being reviewed — the same key the
  -- adherence engine and /api/academy/segments resolve a plan by.
  workout_date DATE NOT NULL,
  -- Which of the day's runs was graded. Nullable so feedback can still be written on
  -- a day whose activity was later deleted or re-synced under a new row.
  activity_id UUID REFERENCES athlete_activities(id) ON DELETE SET NULL,
  -- The mentor. An athletes row holding a staff role, same as athletes.academy_coach_id.
  author_id UUID REFERENCES athletes(id) ON DELETE SET NULL,

  -- ── The mentor's answers ──
  -- What happened. Multi-valued because a run can open too fast AND fade.
  execution TEXT[] NOT NULL DEFAULT '{}',
  -- How hard it felt. Nullable: it is the trainee's to report, not the mentor's to guess.
  effort TEXT,
  -- What changes because of this. The mentor's actual decision, and required by the form.
  action TEXT,
  -- [{ index, text }] — a comment on ONE planned step. `index` is the planned step
  -- (repeat-expanded), NOT the watch's lap number: the warmup and the recoveries take
  -- laps of their own, so lap 8 and "rep 4" are different things and only one of them
  -- is what the mentor and the trainee mean.
  lap_comments JSONB NOT NULL DEFAULT '[]'::jsonb,
  -- The one free-text field, capped in the app (NOTE_MAX). Capped so it cannot quietly
  -- grow back into the WhatsApp paragraph this table replaced.
  note TEXT NOT NULL DEFAULT '',

  -- ── What was sent, and what it was judged on ──
  rendered TEXT NOT NULL DEFAULT '',
  -- 'pace' | 'hr' | 'mixed' | 'none' — the metric the workout was GRADED on, which is
  -- whatever the coach wrote the plan in. Stored because the same trainee's history
  -- mixes both, and a deviation in sec/km cannot be compared to one in bpm.
  metric TEXT,
  -- When the trainee got it. Nullable because the column has to allow a draft, but the
  -- form has no separate publish step: a mentor who filled it has finished the review,
  -- and a draft the trainee never receives is the WhatsApp silence this replaces. So
  -- today every row is written with sent_at set.
  sent_at TIMESTAMPTZ,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- One review per graded run. `activity_id` is in the key rather than just the date
-- because a trainee can run twice in a day (morning key session, evening easy), and
-- both are reviewable.
CREATE UNIQUE INDEX IF NOT EXISTS idx_academy_feedback_run
  ON academy_workout_feedback(athlete_id, workout_date, activity_id);

-- The mentor's queue reads by athlete and date; the manager's oversight reads the most
-- recent across everyone.
CREATE INDEX IF NOT EXISTS idx_academy_feedback_athlete
  ON academy_workout_feedback(athlete_id, workout_date DESC);
CREATE INDEX IF NOT EXISTS idx_academy_feedback_recent
  ON academy_workout_feedback(sent_at DESC NULLS LAST);
-- "Which mentors are behind this week" — the one number that says whether the loop is
-- actually running.
CREATE INDEX IF NOT EXISTS idx_academy_feedback_author
  ON academy_workout_feedback(author_id, workout_date DESC);

-- ───────────────── The heart-rate anchor ─────────────────
--
-- A plan written "דופק 150" grades itself: the number is already beats. A plan written
-- "75-80%" cannot be graded at all without knowing 75% OF WHAT, and nothing in this
-- schema has ever held that number — which is why HR targets have been parsed, printed
-- on the clipboard, and never once graded.
--
-- Max HR rather than threshold HR because it is the anchor the club's plans are written
-- against today. NULL means we do not know it, and the segment verdict then says
-- 'no_anchor' out loud instead of inventing a band (see lib/academy/segments.ts).
ALTER TABLE athletes ADD COLUMN IF NOT EXISTS max_hr_bpm INT;

ALTER TABLE athletes DROP CONSTRAINT IF EXISTS athletes_max_hr_bpm_range;
ALTER TABLE athletes ADD CONSTRAINT athletes_max_hr_bpm_range
  CHECK (max_hr_bpm IS NULL OR max_hr_bpm BETWEEN 120 AND 230);

COMMENT ON COLUMN athletes.max_hr_bpm IS
  'Max heart rate in bpm — the anchor a percentage-based HR target is resolved against. NULL = unknown, and %-based HR steps stay ungraded rather than being graded against a guess.';
