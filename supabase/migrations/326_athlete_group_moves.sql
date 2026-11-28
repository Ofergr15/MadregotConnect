-- Task 152: move a runner between packs in ONE transaction, with an audit row.
--
-- Until now a coach's move (PUT /api/athletes) was three separate writes: athletes.group_id,
-- then — after the response, best effort — the athlete_pack_history row. A failure between
-- them left a member in the new pack with no history, so their past runs were re-scored
-- against the new pack's paces. move_athlete_group() does all of it or none of it:
--   * locks the athlete row (two coaches moving the same runner can't interleave),
--   * updates group_id and clears a pending Saturday change (the coach's move is final),
--   * writes the history rows exactly as lib/groups/pack-history.ts recordPackChange does
--     (the previous pack from 2000-01-01 on a first move, then the new one from p_from_date),
--   * writes the audit row (athlete_group_moves).
-- The watch check and the push stay in the app, after the commit (lib/groups/pack-move.ts).
--
-- No FK to groups on purpose (see 145: a table keyed to both athletes and groups becomes a
-- second athletes↔groups embed path). One FK to athletes only, for the same reason.
-- Idempotent. Service role only.
--
-- Run this in the Supabase SQL Editor.

CREATE TABLE IF NOT EXISTS athlete_group_moves (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id UUID NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  from_group_id UUID,
  to_group_id UUID,
  from_date DATE NOT NULL,
  moved_by_athlete_id UUID,                  -- no FK: see above
  moved_by_email TEXT,
  reason TEXT,
  cancelled_pending_group_id UUID,           -- the member's own Saturday change this move replaced
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_athlete_group_moves_athlete ON athlete_group_moves (athlete_id, created_at DESC);
ALTER TABLE athlete_group_moves ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE athlete_group_moves FROM anon, authenticated;
GRANT ALL ON TABLE athlete_group_moves TO service_role;

CREATE OR REPLACE FUNCTION move_athlete_group(
  p_athlete_id UUID,
  p_to_group_id UUID,
  p_coach_id UUID,
  p_from_date DATE,
  p_by_athlete_id UUID,
  p_by_email TEXT,
  p_reason TEXT
) RETURNS JSONB
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_from UUID;
  v_pending UUID;
  v_history INT;
  v_move UUID;
BEGIN
  SELECT group_id, pending_group_id INTO v_from, v_pending
    FROM athletes WHERE id = p_athlete_id AND coach_id = p_coach_id
    FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('status', 'not_found');
  END IF;
  IF v_from IS NOT DISTINCT FROM p_to_group_id THEN
    RETURN jsonb_build_object('status', 'unchanged', 'from_group_id', v_from);
  END IF;

  UPDATE athletes
     SET group_id = p_to_group_id, pending_group_id = NULL, pending_group_from = NULL
   WHERE id = p_athlete_id;

  SELECT count(*) INTO v_history FROM athlete_pack_history WHERE athlete_id = p_athlete_id;
  IF v_history = 0 AND v_from IS NOT NULL THEN
    INSERT INTO athlete_pack_history (athlete_id, group_id, from_date, changed_by)
    VALUES (p_athlete_id, v_from, DATE '2000-01-01', 'seed');
  END IF;
  INSERT INTO athlete_pack_history (athlete_id, group_id, from_date, changed_by)
  VALUES (p_athlete_id, p_to_group_id, p_from_date, 'coach');

  INSERT INTO athlete_group_moves (athlete_id, from_group_id, to_group_id, from_date, moved_by_athlete_id, moved_by_email, reason, cancelled_pending_group_id)
  VALUES (p_athlete_id, v_from, p_to_group_id, p_from_date, p_by_athlete_id, p_by_email, p_reason, v_pending)
  RETURNING id INTO v_move;

  RETURN jsonb_build_object('status', 'moved', 'from_group_id', v_from, 'to_group_id', p_to_group_id,
                            'cancelled_pending_group_id', v_pending, 'move_id', v_move);
END;
$$;

REVOKE ALL ON FUNCTION move_athlete_group(UUID, UUID, UUID, DATE, UUID, TEXT, TEXT) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION move_athlete_group(UUID, UUID, UUID, DATE, UUID, TEXT, TEXT) TO service_role;
