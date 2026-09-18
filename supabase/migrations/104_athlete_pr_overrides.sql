-- A personal record the ATHLETE states, for when the watch's version is wrong.
--
-- Every PR in the app is derived: /api/athletes/prs and /api/athletes/[id]/stats
-- both walk the whole run history and take the fastest qualifying effort per
-- bucket (lib/prs/pr-buckets.ts). That is the right default — it needs no data
-- entry and it cannot go stale — but it can only ever know what the watch
-- recorded, and two reports say so plainly: "my records here aren't correct"
-- (a798197f) and "the personal records — you can't update them, there are old or
-- example results" (affd459d).
--
-- Both are the same gap. A derived best is wrong whenever the truth isn't in the
-- data:
--   • the race was run before the athlete joined the club, or on a phone app that
--     was never connected, so there is no row to find;
--   • the official chip time differs from the watch, which is the number a runner
--     actually owns ("my 10K is 41:58" is the certificate, not the GPS);
--   • the watch recorded a wrong distance — a tunnel, a treadmill, a lost lock —
--     and produced a best nobody ran.
-- The third case is why `hidden` exists: for a bogus derived PR the athlete has
-- no truer time to type, so the only correct edit is to take it down.
--
-- ── DELIBERATELY DISPLAY-ONLY ────────────────────────────────────────────────
-- The badge award engine (059_badges.sql, `pr_bucket`) keeps reading the DERIVED
-- bests and never this table. A badge is a claim the club makes about something
-- it saw happen; wiring self-reported times into it would let anyone award
-- themselves "first marathon" by typing a number. Overrides change what an
-- athlete's own profile says, which is theirs to state, and nothing else.
--
-- One row per (athlete, bucket) — a bucket has exactly one truth — and the
-- bucket key is TEXT rather than an enum so adding a bucket in pr-buckets.ts
-- stays a code change.

CREATE TABLE IF NOT EXISTS athlete_pr_overrides (
  athlete_id  UUID NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  -- PR_BUCKETS[].key in lib/prs/pr-buckets.ts: '5k' | '10k' | 'hm' | 'fm'.
  bucket_key  TEXT NOT NULL,
  -- The stated time. NULL only together with hidden = true.
  seconds     INTEGER,
  -- When it was run. Optional: an athlete who remembers the time but not the day
  -- should still be able to correct the number.
  achieved_on DATE,
  -- Where it came from, in their words — "מרתון תל אביב, זמן צ'יפ".
  note        TEXT,
  -- Take the derived best down without replacing it: the watch invented it.
  hidden      BOOLEAN NOT NULL DEFAULT FALSE,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (athlete_id, bucket_key),
  -- A row that neither states a time nor hides one says nothing at all.
  CONSTRAINT athlete_pr_overrides_states_something
    CHECK (hidden OR seconds IS NOT NULL),
  -- A crude floor and ceiling only. The real plausibility check is per bucket and
  -- lives in the API (a 10-minute marathon and a 10-minute 5K are not the same
  -- kind of wrong), where PR_BUCKETS is in hand; adding a shorter bucket must not
  -- require editing a constraint that was hand-pasted months earlier.
  CONSTRAINT athlete_pr_overrides_seconds_sane
    CHECK (seconds IS NULL OR (seconds > 0 AND seconds <= 86400))
);

COMMENT ON TABLE athlete_pr_overrides IS
  'Athlete-stated personal records that replace (or hide) the derived best for one bucket. Display only — the badge engine still reads the derived bests.';
