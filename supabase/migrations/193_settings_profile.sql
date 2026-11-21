-- 193 — settings & profile (rev 3, Ofer's decisions 2026-11-21).
-- Paste by hand in the Supabase SQL editor. Idempotent. Every reader falls back
-- when this is not applied yet.
--
-- 1. athletes.default_hidden_fields — the stats a runner hides by default (Q1).
--    New runs' feed items start with payload.hiddenFields = this list, so the share
--    sheet pre-fills from it. Masking is unchanged (maskHiddenStats, project.ts).
--    Calories hidden by default, existing members included.
-- 2. The run→feed trigger (047) copies it into the new item's payload.
-- 3. account_deletion_requests — "delete my account" is a request to admin (Q5).
-- 4. anonymise_athlete(uuid) — what an admin runs to carry a request out: the
--    person goes, their rows in coach/club stats stay, anonymised.
-- 5. Routing seed for the new management kind `account_delete_request` (admin only).

-- 1 ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE athletes
  ADD COLUMN IF NOT EXISTS default_hidden_fields text[] NOT NULL DEFAULT ARRAY['calories']::text[];

ALTER TABLE athletes DROP CONSTRAINT IF EXISTS athletes_default_hidden_fields_check;
ALTER TABLE athletes ADD CONSTRAINT athletes_default_hidden_fields_check
  CHECK (default_hidden_fields <@ ARRAY['calories','heart_rate','pace','power']::text[]);

-- 2 ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION feed_item_for_activity() RETURNS TRIGGER AS $$
DECLARE
  ath_group UUID;
  hidden text[];
BEGIN
  SELECT group_id, default_hidden_fields INTO ath_group, hidden FROM athletes WHERE id = NEW.athlete_id;

  INSERT INTO feed_items (type, author_athlete_id, activity_id, occurred_at, group_id, payload)
  VALUES (
    'activity', NEW.athlete_id, NEW.id, NEW.start_time, ath_group,
    CASE WHEN hidden IS NULL OR cardinality(hidden) = 0 THEN NULL
         ELSE jsonb_build_object('hiddenFields', to_jsonb(hidden)) END
  )
  ON CONFLICT DO NOTHING;

  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- 3 ─────────────────────────────────────────────────────────────────────────────
-- One FK to athletes only (a second would make every unhinted embed ambiguous —
-- see CLAUDE.md "125 took the feed down"). handled_by is a bare uuid on purpose.
CREATE TABLE IF NOT EXISTS account_deletion_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  athlete_id uuid NOT NULL REFERENCES athletes(id) ON DELETE CASCADE,
  reason text,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  handled_at timestamptz,
  handled_by uuid
);
CREATE UNIQUE INDEX IF NOT EXISTS account_deletion_requests_one_pending
  ON account_deletion_requests (athlete_id) WHERE status = 'pending';
ALTER TABLE account_deletion_requests ENABLE ROW LEVEL SECURITY;  -- service role only

-- 4 ─────────────────────────────────────────────────────────────────────────────
-- Keeps: athlete_activities distance/duration/pace/HR (coach reports, club totals,
-- leaderboard history) under an anonymous name. Removes: name, contact, avatar,
-- provider tokens, devices, GPS traces, feed presence. Optional columns are touched
-- only if they exist (migrations here land out of order).
CREATE OR REPLACE FUNCTION anonymise_athlete(target uuid, admin_id uuid DEFAULT NULL) RETURNS void AS $$
DECLARE
  col text;
BEGIN
  UPDATE athletes SET name = 'חבר/ה לשעבר', avatar_url = NULL WHERE id = target;
  UPDATE athletes SET email = 'deleted+' || target::text || '@invalid' WHERE id = target;

  FOREACH col IN ARRAY ARRAY['phone','birth_date','garmin_auth','strava_auth','notification_prefs','height_cm','weight_kg'] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'athletes' AND column_name = col) THEN
      EXECUTE format('UPDATE athletes SET %I = NULL WHERE id = $1', col) USING target;
    END IF;
  END LOOP;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'athletes' AND column_name = 'discoverable') THEN
    UPDATE athletes SET discoverable = false WHERE id = target;
  END IF;

  -- Where they ran is the most personal thing stored; the numbers stay.
  FOREACH col IN ARRAY ARRAY['gps_points','route_preview','route_preview_hd'] LOOP
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'athlete_activities' AND column_name = col) THEN
      EXECUTE format('UPDATE athlete_activities SET %I = NULL WHERE athlete_id = $1', col) USING target;
    END IF;
  END LOOP;

  UPDATE feed_items SET deleted_at = now() WHERE author_athlete_id = target AND deleted_at IS NULL;
  DELETE FROM push_subscriptions WHERE athlete_id = target;

  UPDATE account_deletion_requests
     SET status = 'done', handled_at = now(), handled_by = admin_id
   WHERE athlete_id = target AND status = 'pending';
END;
$$ LANGUAGE plpgsql;

-- PostgREST exposes every public function as POST /rest/v1/rpc/<name>, and Supabase's
-- default privileges grant EXECUTE to anon + authenticated. Left as-is, anyone with
-- the public anon key could call this on any member id (verified in the dry-run:
-- has_function_privilege('anon', …) = true). Only the SQL editor / service role runs it.
REVOKE ALL ON FUNCTION anonymise_athlete(uuid, uuid) FROM PUBLIC;
DO $$ BEGIN
  REVOKE ALL ON FUNCTION anonymise_athlete(uuid, uuid) FROM anon, authenticated;
  GRANT EXECUTE ON FUNCTION anonymise_athlete(uuid, uuid) TO service_role;
EXCEPTION WHEN undefined_object THEN NULL; END $$;

-- 5 ─────────────────────────────────────────────────────────────────────────────
INSERT INTO notification_routing (kind, role, enabled) VALUES
  ('account_delete_request', 'admin', true),
  ('account_delete_request', 'coach', false),
  ('account_delete_request', 'academy_coach', false)
ON CONFLICT (kind, role) DO NOTHING;
