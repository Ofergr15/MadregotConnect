-- Keep the per-sample trace Garmin already sends us, so "did they run the session"
-- stops depending on whether the watch happened to mark the right laps.
--
-- WHY: every athlete's plan day is a *structure* — "2 km easy, 20 km at 4:25, then
-- 8 x 15s hard" was a real published Sunday — and the app grades it with the run's
-- overall average. On that Sunday two athletes ran the 20 km block at 4:23, inside
-- the 4:25 target, and were told 4:33 vs 4:25: the warm-up and the walk-recovery
-- strides are in the average. 80 of the last 167 published plan days have more than
-- one step and 74 set two or more different pace targets, so this is roughly half of
-- all the feedback the club gets.
--
-- Laps cannot fix it. They are whatever the watch marked: 49 of 659 runs in the last
-- six weeks have any laps stored at all (they are fetched only when a human opens the
-- run), most of those are 1 km auto-laps, and a 15-second stride simply does not
-- exist as a lap unless the athlete pressed the button. The per-sample trace does
-- fix it — the plan's blocks are ranges of the distance axis, and a rep is a run of
-- samples above a pace threshold.
--
-- WHY IT IS FREE: `GET /activity-service/activity/{id}/details` is already called
-- once per activity on every sync (lib/garmin/client.ts getActivityGpsPoints) and
-- everything except the map polyline is thrown away. `metricDescriptors` +
-- `activityDetailMetrics` in that same response is the trace. No new Garmin call,
-- no new rate-limit exposure — only a wider `maxChartSize`, because 2000 samples
-- over 90 minutes is one sample every 2.7 s and smears a 15-second rep.
--
-- WHY A SEPARATE TABLE: a 1 Hz trace of a two-hour run is thousands of samples.
-- athlete_activities is the app's hottest table — the feed, leaderboards, badges and
-- challenges all read it, several with `select('*')` — and none of them want this.
-- One row per activity, read only by the code that grades a run.

CREATE TABLE IF NOT EXISTS activity_streams (
  activity_id        UUID PRIMARY KEY REFERENCES athlete_activities(id) ON DELETE CASCADE,
  garmin_activity_id BIGINT,
  source             TEXT NOT NULL DEFAULT 'garmin',
  sample_count       INTEGER NOT NULL DEFAULT 0,
  interval_sec       NUMERIC(6,2),
  metrics            TEXT[] NOT NULL DEFAULT '{}',
  series             JSONB NOT NULL,
  laps               JSONB,
  unit_correction    TEXT,
  fetched_at         TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE activity_streams IS
  'Per-sample trace for one activity, from Garmin''s activity details response. The evidence layer for planned-vs-executed; never read by the feed.';

-- Columnar, not an array of objects: `{"t":[0,1,2],"d":[0,3,6]}` with one array per
-- metric, integers only. Same information as [{t,d},…] at about a third of the size,
-- and near-identical values next to each other compress far better in TOAST.
COMMENT ON COLUMN activity_streams.series IS
  'Columnar arrays, index-aligned: t (seconds from start), d (cumulative metres), v (speed cm/s), hr (bpm), cad (steps/min), elev (metres). Speed is cm/s and not pace because a walk-break sample would be an infinite pace.';

-- The honest answer to "can this trace resolve the reps?". A downsampled response
-- still grades a 20 km block correctly while being useless for 15-second strides,
-- and a caller must be able to tell those apart before claiming a rep was missed.
COMMENT ON COLUMN activity_streams.interval_sec IS
  'Median seconds between samples. ~1 from a watch; larger means Garmin downsampled the response and short reps are not resolvable from it.';

COMMENT ON COLUMN activity_streams.metrics IS
  'Which series keys are present. A metric missing from the response is absent rather than an array of nulls, so check here before reading.';

-- The full lapDTOs, unnarrowed. athlete_activities.laps keeps its existing
-- {distance,duration,averagePace} shape for the code that already reads it; this is
-- the same laps with the fields that were being dropped, above all `intensityType` —
-- Garmin's own per-lap ACTIVE/REST/WARMUP/INTERVAL marker, which is the difference
-- between knowing a 200 m lap was a rep and guessing it from its pace.
COMMENT ON COLUMN activity_streams.laps IS
  'Garmin lapDTOs as returned, including intensityType, lapIndex, cadence and HR. athlete_activities.laps is the narrowed legacy copy of the same data.';

COMMENT ON COLUMN activity_streams.unit_correction IS
  'Set when the distance axis had to be rescaled by a factor of 1000 — the unofficial API silently changing sumDistance from metres to kilometres would otherwise corrupt every pace derived from it.';

-- Service-role only, the same shape activity_plan_matches uses (migration 054).
--
-- This is not boilerplate: Supabase grants `anon` and `authenticated` on every new
-- public-schema table, so a table with RLS left off is readable by anyone holding the
-- publishable anon key — which ships in the client bundle. The contents are a
-- second-by-second account of where an athlete's effort went: pace, heart rate and
-- cadence at ~1 Hz for two hours. Coarser than the GPS trace, but a far longer series,
-- and nothing about it is club-visible by any product decision.
--
-- Every reader in the app goes through `createServerClient()` (service role, bypasses
-- RLS) — stream-store.ts and stream-backfill.ts, called from the sync route and the
-- segments route. So this policy denies nothing the app does today. If a client ever
-- needs the trace, it goes through a route that authorises the caller, not through a
-- policy widened here.
ALTER TABLE activity_streams ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Service role manages activity streams" ON activity_streams;
CREATE POLICY "Service role manages activity streams"
  ON activity_streams FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- The join key when working from Garmin's side (a backfill walking activity ids, or
-- reconciling a delivery) rather than from our own row id.
CREATE INDEX IF NOT EXISTS activity_streams_garmin_idx
  ON activity_streams (garmin_activity_id);

-- Retention handle. These rows are large and only the recent ones are ever graded;
-- pruning is "delete where fetched_at < now() - interval 'N days'", which wants an
-- index on exactly this.
CREATE INDEX IF NOT EXISTS activity_streams_fetched_idx
  ON activity_streams (fetched_at);
