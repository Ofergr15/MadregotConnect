/**
 * Task 204 — a race-live scenario for the dev seed: a marathon IN PROGRESS at the anchor
 * instant, so the live board, the viewer, the map opt-in and the milestone ledger all have
 * something to show on a dev project without a real race.
 *
 * #263 (seed extras) seeds a finished race and an upcoming one; this adds the third state,
 * "running right now", which is the one race day actually looks like. Pure and deterministic:
 * fixed ids, no network, no clock (the caller passes `anchorIso`). It takes runner ids rather
 * than importing the seed club, so it does not depend on #233/#263 — scripts/seed-dev.mts
 * passes the seeded runners once those land.
 *
 * Shapes follow supabase/migrations/055_events.sql and 196_race_live.sql. Runner mix:
 *   - most are on course, splits up to the last timing point they passed, a position each;
 *   - one has finished (finish split, finish milestone, LiveTrack 'ended');
 *   - one opted out of the live board (live_opt_out: no position, ever);
 *   - one has not crossed the start yet (no splits, no position, LiveTrack 'ready');
 *   - one LiveTrack link is in error, so the board falls back to splits for them.
 * Source is 'replay' with push OFF — a silent rehearsal, never a real push.
 */
import { POINTS, RACE_M, type PointKey } from '@/lib/race-live/core';

type Row = Record<string, unknown>;

export interface RaceLiveSeedInput {
  /** Fixed UUID for the event (seedId('event:race:live') in the seed script). */
  eventId: string;
  /** "Now" for the scenario — the race started 2 h 10 min before it. */
  anchorIso: string;
  /** Club runners entered in the race (at least 6 for every state to appear). */
  runnerIds: string[];
  /** Members who opted in to see the live map. */
  mapViewerIds?: string[];
}

export interface RaceLiveSeed {
  events: Row[];
  race_live_config: Row[];
  race_entries: Row[];
  race_splits: Row[];
  race_milestones: Row[];
  race_positions: Row[];
  race_map_viewers: Row[];
}

/** Parents before children. */
export const RACE_LIVE_SEED_TABLES = ['events', 'race_live_config', 'race_entries', 'race_splits', 'race_milestones', 'race_positions', 'race_map_viewers'] as const;

/** Upsert conflict target per table (the primary keys in 196). */
export const RACE_LIVE_SEED_CONFLICT: Record<(typeof RACE_LIVE_SEED_TABLES)[number], string> = {
  events: 'id',
  race_live_config: 'event_id',
  race_entries: 'event_id,athlete_id',
  race_splits: 'event_id,athlete_id,point',
  race_milestones: 'event_id,athlete_id,milestone',
  race_positions: 'event_id,athlete_id',
  race_map_viewers: 'event_id,athlete_id',
};

export const RACE_ELAPSED_AT_ANCHOR_SEC = 2 * 3600 + 10 * 60;

// A straight-ish line along Valencia's marathon finish area — public geography, no member data.
const COURSE_START = { lat: 39.4555, lon: -0.3527 };
const COURSE_BEARING = { dLat: 0.0000062, dLon: 0.0000071 }; // per metre, roughly NE

const iso = (ms: number) => new Date(ms).toISOString();
const israelDate = (ms: number) => new Date(ms + 2 * 3600_000).toISOString().slice(0, 10);
const hhmm = (ms: number) => new Date(ms + 1 * 3600_000).toISOString().slice(11, 16); // Valencia = UTC+1 in December

export function buildRaceLiveScenario(input: RaceLiveSeedInput): RaceLiveSeed {
  const { eventId, runnerIds } = input;
  if (runnerIds.length < 6) throw new Error('race-live seed needs at least 6 runners');
  const anchor = Date.parse(input.anchorIso);
  if (!Number.isFinite(anchor)) throw new Error('anchorIso must be an ISO timestamp');
  const startMs = anchor - RACE_ELAPSED_AT_ANCHOR_SEC * 1000;

  const events: Row[] = [{
    id: eventId, kind: 'race', name: 'Seed Live Marathon', date: israelDate(startMs), start_time: hhmm(startMs),
    location: 'Valencia (seed)', lat: COURSE_START.lat, lng: COURSE_START.lon, distances: ['42.2K'], race_class: 'marathon',
  }];

  const race_live_config: Row[] = [{
    event_id: eventId, source: 'replay', active: true, push_enabled: false,
    poll_from: iso(startMs - 30 * 60_000),
    // The race-live settings require poll_to ≥ start + 6:30 (#262).
    poll_to: iso(startMs + 6.5 * 3600_000),
    poll_every_sec: 60, last_polled_at: iso(anchor - 40_000), last_error: null, fail_count: 0,
    replay_started_at: iso(startMs), replay_speed: 1,
  }];

  const race_entries: Row[] = [];
  const race_splits: Row[] = [];
  const race_milestones: Row[] = [];
  const race_positions: Row[] = [];

  const FINISHED = 0;
  const OPTED_OUT = 1;
  const NOT_STARTED = 2;
  const LIVETRACK_ERROR = 3;

  runnerIds.forEach((athleteId, i) => {
    // 3:40/km for the fastest, +6 s/km per runner — the finished one runs 2:34.
    const paceSec = i === FINISHED ? 219 : 220 + i * 6;
    const goalSec = Math.round((RACE_M / 1000) * (paceSec - 3));
    const state = i === FINISHED ? 'ended' : i === NOT_STARTED ? 'ready' : i === LIVETRACK_ERROR ? 'error:not_found' : 'active';
    race_entries.push({
      event_id: eventId, athlete_id: athleteId, bib: String(30_000 + i), goal_sec: goalSec,
      live_opt_out: i === OPTED_OUT,
      livetrack_url: `https://livetrack.example.test/session/seed-${i}`,
      livetrack_state: state, livetrack_polled_at: iso(anchor - 60_000),
    });
    if (i === NOT_STARTED) return;

    // The finisher started on the gun; everyone else crossed the mat up to 3 min later.
    const startDelaySec = i === FINISHED ? 0 : 20 * i;
    const elapsedSec = i === FINISHED ? Math.round((RACE_M / 1000) * paceSec) : RACE_ELAPSED_AT_ANCHOR_SEC - startDelaySec;
    const coveredM = Math.min(RACE_M, Math.round((elapsedSec / paceSec) * 1000));
    const runnerStart = startMs + startDelaySec * 1000;

    for (const p of POINTS) {
      if (p.m > coveredM) break;
      const at = Math.round((p.m / 1000) * paceSec);
      race_splits.push({
        event_id: eventId, athlete_id: athleteId, point: p.key as PointKey, elapsed_sec: at, source: 'replay',
        recorded_at: iso(runnerStart + at * 1000),
      });
      if (p.key === 'start' || p.key === 'half' || p.key === 'finish') {
        // sent=false: a silent rehearsal marks the milestone done without a push.
        race_milestones.push({ event_id: eventId, athlete_id: athleteId, milestone: p.key, sent: false, claimed_at: iso(runnerStart + at * 1000) });
      }
    }

    if (i === OPTED_OUT || i === LIVETRACK_ERROR || i === FINISHED) return;
    race_positions.push({
      event_id: eventId, athlete_id: athleteId,
      lat: +(COURSE_START.lat + COURSE_BEARING.dLat * (coveredM % 4000)).toFixed(6),
      lon: +(COURSE_START.lon + COURSE_BEARING.dLon * (coveredM % 4000)).toFixed(6),
      distance_m: coveredM, elapsed_sec: elapsedSec, at: iso(anchor - 15_000),
    });
  });

  const race_map_viewers: Row[] = (input.mapViewerIds ?? []).map((athleteId) => ({ event_id: eventId, athlete_id: athleteId, created_at: iso(startMs - 3600_000) }));

  return { events, race_live_config, race_entries, race_splits, race_milestones, race_positions, race_map_viewers };
}
