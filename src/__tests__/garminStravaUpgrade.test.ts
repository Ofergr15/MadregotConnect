import { describe, it, expect, vi, beforeEach } from 'vitest';
import { needsStravaEnrich } from '@/lib/strava/enrich';

/**
 * What the Garmin sync does when Strava already imported the same run.
 *
 * It used to skip. The dedup is source-blind and symmetric, so whichever provider
 * synced first won permanently — and when Strava won, the run kept the copy with no
 * `wktStepIndex` on its laps, no `executed_workout` and no 1 Hz trace: the copy that
 * none of the four adherence engines can read properly. That cost a real verdict.
 * One athlete's Tuesday double scored 74 with all six 2 km blocks marked `slower`
 * while his own laps put five of the six exactly on target, because a 45-point lap
 * trace makes `bestWindow` land on lap boundaries and swallow a recovery jog; the
 * teammate who ran the same session off Garmin scored 100.
 *
 * So Garmin's copy now UPGRADES the Strava row in place. The row id survives, which
 * is the whole reason it is an update and not a delete-and-reinsert: kudos, comments,
 * feedback, plan matches and `activity_streams` all reference it.
 *
 * Every case here is a way that repair could quietly turn into damage — writing over
 * something the athlete typed, erasing a value Strava had and Garmin doesn't,
 * announcing a week-old run, or inflating `synced` so the club's totals move for a
 * run that was already counted.
 */

type Listed = {
  activityId: number;
  activityName: string;
  activityType: string;
  startTimeLocal: string;
  distance: number;
  duration: number;
  lapCount?: number;
  workoutId?: number | null;
  calories?: number | null;
  averageHR?: number | null;
  maxHR?: number | null;
  elevationGain?: number | null;
};

const listRow = (id: number, over: Partial<Listed> = {}): Listed => ({
  activityId: id,
  activityName: `Garmin name ${id}`,
  activityType: 'running',
  startTimeLocal: '2026-09-08T06:00:00',
  distance: 22550,
  duration: 6000,
  lapCount: 3,
  workoutId: 1690847299,
  // Garmin's LIST row has no calories — this is the field that must not be written
  // over the value Strava's detail endpoint supplied.
  calories: null,
  averageHR: 152,
  maxHR: 171,
  elevationGain: 88,
  ...over,
});

/** The stamped laps that are the entire point of preferring Garmin's copy. */
const LAP_DTOS = [
  { lapIndex: 1, distance: 2000, duration: 600, wktStepIndex: 0, intensityType: 'WARMUP', averageHR: 130 },
  { lapIndex: 2, distance: 20000, duration: 5100, wktStepIndex: 1, intensityType: 'INTERVAL', averageHR: 160 },
  { lapIndex: 3, distance: 550, duration: 300, wktStepIndex: 2, intensityType: 'COOLDOWN', averageHR: 140 },
];

const WORKOUT_DTO = [{
  workoutName: 'Tuesday double 1/2',
  timeCreated: '2026-09-07T18:00:00',
  steps: [
    { stepIndex: 0, intensity: 'WARMUP', durationType: 'DISTANCE', durationValue: 2000 },
    { stepIndex: 1, intensity: 'ACTIVE', durationType: 'DISTANCE', durationValue: 20000, notes: '4:25' },
  ],
}];

let listed: Listed[];
let gpsPoints: Array<{ lat: number; lng: number }>;
/** Garmin calls made per activity id, so a case can assert what was NOT fetched. */
let fetched: string[];

vi.mock('@/lib/garmin/client', () => ({
  GarminClient: class {
    async getActivities() { return listed; }
    async getActivityFull(id: number) {
      fetched.push(`full:${id}`);
      return { summaryDTO: { averageRunCadence: 178, lapCount: 3 }, locationName: 'Tel Aviv' };
    }
    async getActivityTrace(id: number) {
      fetched.push(`trace:${id}`);
      return { gpsPoints, stream: { sampleCount: 1743, series: { t: [0, 1], d: [0, 3] } } };
    }
    async getActivitySplits(id: number) {
      fetched.push(`splits:${id}`);
      return LAP_DTOS;
    }
    async getActivityWorkout(id: number) {
      fetched.push(`workout:${id}`);
      return WORKOUT_DTO;
    }
  },
}));

/**
 * The dedup verdict, as the route sees it. The matcher itself is pure and has its
 * own test (`activityDedup.test.ts`); what matters here is what the route does with
 * each ANSWER, so cases set the answer directly, keyed by Garmin activity id.
 */
let duplicates: Map<number, { id: string; source: string | null }>;
vi.mock('@/lib/activity-dedup', async (importOriginal) => ({
  // Only the LOOKUP is faked. `twinVerdict` and `upgradePatch` are the rules under
  // test here, so they run for real.
  ...(await importOriginal<typeof import('@/lib/activity-dedup')>()),
  findCrossSourceDuplicate: (
    _s: unknown,
    _a: string,
    startTimeLocal: string,
    distance: number,
  ) => Promise.resolve(
    duplicates.get(
      listed.find(l => l.startTimeLocal === startTimeLocal && l.distance === distance)?.activityId ?? -1,
    ) ?? null,
  ),
}));

const notifyTeammates = vi.fn();
const notifyAthlete = vi.fn();
const notifyFeedback = vi.fn();
vi.mock('@/lib/push', () => ({
  notifyAthlete: (...a: unknown[]) => notifyAthlete(...a),
  notifyTeammatesOfActivity: (...a: unknown[]) => notifyTeammates(...a),
}));
vi.mock('@/lib/post-workout', () => ({
  notifyMainWorkoutFeedback: (...a: unknown[]) => notifyFeedback(...a),
}));

const rematch = vi.fn(() => Promise.resolve({ matched: 0, plans: 0 }));
vi.mock('@/lib/plans/match-athlete-activities', () => ({
  matchAthleteActivities: (_s: unknown, id: string) => rematch(),
}));
vi.mock('@/lib/badges/award-engine', () => ({ checkAndAwardBadges: vi.fn(() => Promise.resolve({ awarded: [] })) }));
vi.mock('@/lib/challenges/engine', () => ({ checkAndAwardChallenges: vi.fn(() => Promise.resolve({})) }));
vi.mock('@/lib/shoes', () => ({ checkShoeAlert: vi.fn(() => Promise.resolve(null)) }));
vi.mock('@/lib/auth/self-or-staff', () => ({
  requireCallerForAthlete: vi.fn(() => Promise.resolve({ denied: null })),
  resolveVerifiedCaller: vi.fn(() => Promise.resolve({ user: null })),
}));

const savedStreams: Array<Record<string, unknown>> = [];
vi.mock('@/lib/garmin/stream-store', () => ({
  saveActivityStream: (_s: unknown, args: Record<string, unknown>) => {
    savedStreams.push(args);
    return Promise.resolve(true);
  },
  activitiesWithStreams: vi.fn(() => Promise.resolve(new Set())),
}));

/** Every write the route made, in order. */
let updates: Array<{ id: string; patch: Record<string, any> }>;
let upserts: Record<string, any>[][];
/** Set by a case to make the first `update` fail as a missing column would. */
let missingColumn: string | null;

function fakeSupabase() {
  const chain = (table: string) => {
    const state: { op: string; payload: any; id: string | null } = { op: 'select', payload: null, id: null };
    const self: Record<string, any> = {};
    const result = () => {
      if (table === 'athletes') {
        return {
          data: [{ id: 'athlete-1', name: 'Asaf', garmin_auth: { email: 'x' }, active_shoe_id: 'shoe-now' }],
          error: null,
        };
      }
      if (state.op === 'update') {
        if (missingColumn && Object.hasOwn(state.payload, missingColumn)) {
          return { data: null, error: { code: '42703', message: `column "${missingColumn}" does not exist` } };
        }
        updates.push({ id: state.id!, patch: state.payload });
        return { data: null, error: null };
      }
      if (state.op === 'upsert') {
        upserts.push(state.payload);
        return {
          data: state.payload.map((r: any) => ({ id: `row-${r.garmin_activity_id}`, garmin_activity_id: r.garmin_activity_id })),
          error: null,
        };
      }
      // `select('garmin_activity_id')` — the athlete's already-stored ids.
      return { data: [], error: null };
    };
    for (const method of ['select', 'not', 'order', 'limit', 'gte', 'lte', 'is', 'returns']) {
      self[method] = () => self;
    }
    self.eq = (col: string, value: string) => {
      if (col === 'id') state.id = value;
      return self;
    };
    self.update = (payload: any) => { state.op = 'update'; state.payload = payload; return self; };
    self.upsert = (payload: any) => { state.op = 'upsert'; state.payload = payload; return self; };
    self.then = (resolve: (v: unknown) => unknown) => Promise.resolve(result()).then(resolve);
    return self;
  };
  return { from: (table: string) => chain(table) };
}

vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => fakeSupabase() }));

const sync = async () => {
  const { runSyncRequest } = await import('@/app/api/garmin/sync-activities/route');
  const res = await runSyncRequest(
    new Request('https://madregot.app/api/garmin/sync-activities', {
      method: 'POST',
      body: JSON.stringify({ athleteId: 'athlete-1' }),
    }),
  );
  return res.json();
};

beforeEach(() => {
  listed = [listRow(555)];
  gpsPoints = [{ lat: 32.1, lng: 34.8 }, { lat: 32.2, lng: 34.9 }];
  fetched = [];
  duplicates = new Map();
  updates = [];
  upserts = [];
  savedStreams.length = 0;
  missingColumn = null;
  notifyTeammates.mockClear();
  notifyAthlete.mockClear();
  notifyFeedback.mockClear();
  rematch.mockClear();
});

describe('garmin sync — upgrading a Strava row', () => {
  const stravaRow = () => duplicates.set(555, { id: 'row-strava', source: 'strava' });

  it('writes the watch evidence onto the row Strava created, keeping its id', async () => {
    stravaRow();
    await sync();

    expect(upserts).toEqual([]); // no second copy of the run
    expect(updates).toHaveLength(1);
    const { id, patch } = updates[0];
    expect(id).toBe('row-strava');
    // The three things the Strava copy could never carry.
    expect(patch.laps.map((l: any) => l.wktStepIndex)).toEqual([0, 1, 2]);
    expect(patch.executed_workout.steps).toHaveLength(2);
    expect(savedStreams).toEqual([
      expect.objectContaining({ activityId: 'row-strava', garminActivityId: 555, source: 'garmin' }),
    ]);
    // And the identity of the row as Garmin's: a real positive activity id in
    // place of the negated Strava one, which is also what stops this run from
    // being upgraded again on the next sync.
    expect(patch.garmin_activity_id).toBe(555);
    expect(patch.garmin_workout_id).toBe('1690847299');
    expect(patch.source).toBe('garmin');
  });

  it('leaves Strava to keep recognising the run, so it never inserts a twin', async () => {
    stravaRow();
    await sync();
    // The Strava sync's existence check is keyed on this column. Clearing it would
    // make the run new to Strava again — the duplicate this whole path prevents.
    expect(updates[0].patch).not.toHaveProperty('strava_activity_id');
  });

  it('does not count as a sync, and tells nobody', async () => {
    stravaRow();
    const body = await sync();

    expect(body.synced).toBe(0);
    expect(body.results[0]).toMatchObject({ synced: 0, upgradedFromStrava: 1 });
    // The athlete already heard about this run when Strava synced it. A teammate
    // push, a feedback nudge or the "customize your post" sheet firing now would be
    // the app announcing a run from days ago.
    expect(notifyTeammates).not.toHaveBeenCalled();
    expect(notifyAthlete).not.toHaveBeenCalled();
    expect(notifyFeedback).not.toHaveBeenCalled();
  });

  it('re-attributes the run to its plan, which it could not be before', async () => {
    // `garmin_workout_id` is what ties a run to the workout it was run for, and a
    // Strava row never had one.
    stravaRow();
    await sync();
    expect(rematch).toHaveBeenCalledTimes(1);
  });

  it('never overwrites the name, because the athlete may have written it', async () => {
    // PATCH /api/feed/items/[id] lets an athlete rename their own run. Garmin's name
    // is usually the better one ("Tuesday double 1/2" against Strava's "Morning
    // Run"), and it still is not worth reverting somebody's own words.
    stravaRow();
    await sync();
    expect(updates[0].patch).not.toHaveProperty('activity_name');
  });

  it('never re-attributes the shoe, which would move a week-old run to today\'s pair', async () => {
    // `active_shoe_id` on the athlete row is the shoe they are wearing NOW; the
    // Strava sync already recorded the one they wore for this run.
    stravaRow();
    await sync();
    expect(updates[0].patch).not.toHaveProperty('shoe_id');
  });

  it('leaves a value Strava has and Garmin does not', async () => {
    // Garmin's list row reports no calories; Strava's detail endpoint does. An
    // upgrade is upgrade-only, so "not reported" must not be written as an erasure.
    stravaRow();
    await sync();
    expect(updates[0].patch).not.toHaveProperty('calories');
    // ...while everything Garmin DID report still lands.
    expect(updates[0].patch).toMatchObject({ average_hr: 152, avg_cadence: 178 });
  });

  it('leaves the route alone when Garmin returns no points', async () => {
    // An empty trace means the detail fetch failed, not that the run had no route.
    // Writing it would blank a map the feed card is drawing and re-fire migration
    // 047's trigger to null `route_preview` with it — the same trap enrich.ts
    // documents from the other direction.
    stravaRow();
    gpsPoints = [];
    await sync();
    expect(updates[0].patch).not.toHaveProperty('gps_points');
    expect(updates[0].patch).not.toHaveProperty('has_polyline');
  });

  it('still upgrades on a database missing the newest column', async () => {
    stravaRow();
    missingColumn = 'executed_workout';
    const body = await sync();

    // First attempt rejected, retried without the one column the error named —
    // and the laps, which are the other half of the evidence, still land.
    expect(updates).toHaveLength(1);
    expect(updates[0].patch).not.toHaveProperty('executed_workout');
    expect(updates[0].patch.laps).toHaveLength(3);
    expect(body.results[0].upgradedFromStrava).toBe(1);
  });

  it('leaves a row from any other source untouched', async () => {
    // Another Garmin row is already the richer copy; a manual entry is the
    // athlete's own and not ours to overwrite.
    for (const source of ['garmin', 'manual', null]) {
      updates = [];
      upserts = [];
      duplicates = new Map([[555, { id: 'row-other', source }]]);
      const body = await sync();
      expect(updates).toEqual([]);
      expect(upserts).toEqual([]);
      expect(body.results[0].upgradedFromStrava).toBeUndefined();
    }
  });

  it('caps how many it repairs in one sync, newest first', async () => {
    // A dual-connected athlete whose history all came through Strava has every run
    // in Garmin's list window eligible on the first sync after this ships, at 2-4
    // serial Garmin requests each against a 300 s ceiling. Each row is upgraded at
    // most once, so the backlog drains over the hourly crons; the cap only decides
    // how fast. Newest first so today's session is the one that gets fixed first.
    listed = Array.from({ length: 7 }, (_, i) =>
      listRow(600 + i, { startTimeLocal: `2026-09-0${i + 1}T06:00:00`, distance: 10000 + i }));
    for (const a of listed) duplicates.set(a.activityId, { id: `row-${a.activityId}`, source: 'strava' });

    const body = await sync();

    expect(body.results[0].upgradedFromStrava).toBe(5);
    expect(updates.map(u => u.id)).toEqual(['row-606', 'row-605', 'row-604', 'row-603', 'row-602']);
    // The two it left are untouched, not half-written — and cost no Garmin calls.
    expect(fetched.filter(f => f.startsWith('full:'))).toHaveLength(5);
  });

  it('still inserts and announces a run neither source has', async () => {
    // The dedup split must not have cost the normal path anything.
    const body = await sync();

    expect(updates).toEqual([]);
    expect(upserts[0]).toHaveLength(1);
    expect(upserts[0][0]).toMatchObject({ garmin_activity_id: 555, activity_name: 'Garmin name 555', shoe_id: 'shoe-now' });
    expect(body.synced).toBe(1);
    expect(body.results[0].upgradedFromStrava).toBeUndefined();
    expect(notifyTeammates).toHaveBeenCalledTimes(1);
    expect(notifyFeedback).toHaveBeenCalledTimes(1);
    expect(savedStreams).toHaveLength(1);
  });
});

describe('needsStravaEnrich', () => {
  /**
   * The other half of the fix, and the one that fails silently: enrichment writes
   * `laps: <Strava laps>`, so on an upgraded row it would replace laps carrying
   * `wktStepIndex` with laps carrying none — undoing the upgrade on the next Strava
   * sync, with nothing in the response to say so.
   */
  it('refuses a row that has been upgraded to Garmin\'s copy', () => {
    expect(needsStravaEnrich({ source: 'garmin', laps: null, strava_gpx_url: null }, true)).toBe(false);
  });

  it('still enriches a Strava row that was never enriched', () => {
    expect(needsStravaEnrich({ source: 'strava', laps: null, strava_gpx_url: null }, true)).toBe(true);
    // Laps stored but no GPX yet — half-enriched by an older code path.
    expect(needsStravaEnrich({ source: 'strava', laps: [], strava_gpx_url: null }, true)).toBe(true);
  });

  it('leaves a fully enriched Strava row alone', () => {
    expect(needsStravaEnrich({ source: 'strava', laps: [], strava_gpx_url: 'https://x/y.gpx' }, true)).toBe(false);
  });

  it('treats a row with no source as Strava\'s', () => {
    // Only the Strava sync sets `strava_activity_id`, so a row that has one and no
    // source predates the column being populated — it is not an upgrade.
    expect(needsStravaEnrich({ source: null, laps: null }, true)).toBe(true);
  });

  it('cannot use the gpx column on a database that has not got it', () => {
    // Pre-migration-051: `strava_gpx_url` is unreadable, so it can play no part in
    // the answer. `laps` alone decides, or every row looks unenriched forever.
    expect(needsStravaEnrich({ source: 'strava', laps: [] }, false)).toBe(false);
    expect(needsStravaEnrich({ source: 'strava', laps: null }, false)).toBe(true);
  });
});
