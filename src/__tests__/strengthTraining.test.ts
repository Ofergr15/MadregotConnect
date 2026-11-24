import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { isGarminStrength, isRunActivity, isStravaStrength, RUNS_ONLY_OR, STRENGTH_TYPE } from '@/lib/activities/kinds';
import { activeSets, exerciseCount, hrFromDetails, narrowExerciseSets, strengthRow, STRENGTH_OPTIONAL_COLUMNS, STRENGTH_SETS_PER_SYNC } from '@/lib/activities/strength';
import { applyStrength, summarise } from '@/lib/activities/strength-feed';
import { strengthVerdicts } from '@/lib/activities/strength-adherence';
import { filterQualifyingRuns } from '@/lib/prs/pr-buckets';
import { isRunType } from '@/lib/academy/load';
import { RUN_TYPES } from '@/lib/club-numbers/compute';
import { readHiddenFields } from '@/lib/feed/project';
import { FEATURES } from '@/lib/features/flags';

// review-2026-11-20/strength/plan.md — synthetic data only.

const strength = strengthRow({
  athleteId: 'a1', source: 'garmin', garminActivityId: 901, name: 'Strength', startTimeLocal: '2026-11-16T07:10:00',
  durationSec: 2880, averageHr: 118.4, maxHr: 152, calories: 310,
  sets: [{ category: 'SQUAT', name: null, reps: 10, weightKg: 40, durationSec: 40 }],
});

describe('strength rows change no km', () => {
  it('is written as 0 m, no pace, typed strength_training', () => {
    expect(strength).toMatchObject({ activity_type: STRENGTH_TYPE, distance: 0, average_pace: null, average_hr: 118, has_polyline: false });
  });

  it('every shared run filter drops it, every run passes', () => {
    const run = { activity_type: 'running', distance: 10_000, duration: 3000, start_time: '2026-11-16T06:00:00' };
    const legacy = { activity_type: null, distance: 8000, duration: 2500, start_time: '2026-11-15T06:00:00' };
    const s = { activity_type: STRENGTH_TYPE, distance: 0, duration: 2880, start_time: '2026-11-16T07:10:00' };
    expect(isRunActivity(s)).toBe(false);
    expect(isRunActivity(run) && isRunActivity(legacy)).toBe(true);           // NULL type stays a run
    expect(isRunType(STRENGTH_TYPE)).toBe(false);
    expect(RUN_TYPES.has(STRENGTH_TYPE)).toBe(false);
    expect(filterQualifyingRuns([run, legacy, s] as never).length).toBe(2);
    const km = [run, legacy, s].filter(isRunActivity).reduce((a, r) => a + r.distance, 0) / 1000;
    const count = [run, legacy, s].filter(isRunActivity).length;
    expect(km).toBe(18);
    expect(count).toBe(2);
  });

  it('the PostgREST filter keeps NULL-typed legacy rows (not neq)', () => {
    expect(RUNS_ONLY_OR).toBe('activity_type.is.null,activity_type.neq.strength_training');
  });

  // Every read the sweep found counting runs, matching a plan or naming "the latest run" now
  // filters. If one of these loses the filter, a strength session silently becomes a run.
  const SWEPT: Array<[string, number]> = [
    ['src/app/api/academy/members/route.ts', 1], ['src/app/api/academy/stats/route.ts', 1], ['src/lib/weekly-snapshots.ts', 1],
    ['src/app/api/academy/me/route.ts', 1], ['src/app/api/academy/dispatch/route.ts', 1], ['src/app/api/plans/[planId]/matches/route.ts', 1],
    ['src/lib/plans/match-athlete-activities.ts', 1], ['src/lib/races/match-athlete-races.ts', 1], ['src/app/api/search/route.ts', 1],
    ['src/lib/data-sources/server.ts', 2], ['src/app/api/run-chat/[chatId]/ai/route.ts', 4], ['src/app/api/pack-stories/route.ts', 1],
    ['src/lib/quality-session/server.ts', 1], ['src/lib/badges/award-engine.ts', 1], ['src/app/api/athletes/heatmap/route.ts', 1],
    ['src/app/api/groups/leaderboard/route.ts', 1], ['src/lib/plan-execution/satellite.ts', 1], ['src/app/api/activities/analysis/route.ts', 1],
    ['src/app/api/activities/details/route.ts', 1], ['src/app/api/academy/feedback/route.ts', 1],
    ['src/app/api/admin/trainee-data-coverage/route.ts', 2], ['src/lib/runs/together-cron.ts', 1], ['src/app/api/academy/tests/watch/route.ts', 1],
  ];
  it.each(SWEPT)('%s keeps its runs-only filter', (file, n) => {
    const src = readFileSync(join(process.cwd(), file), 'utf8');
    expect(src.split('.or(RUNS_ONLY_OR)').length - 1).toBeGreaterThanOrEqual(n);
  });
});

describe('ingestion', () => {
  it('recognises Garmin and Strava strength, nothing else', () => {
    expect(isGarminStrength('strength_training')).toBe(true);
    expect(isGarminStrength('running') || isGarminStrength('yoga') || isGarminStrength('hiit')).toBe(false);
    expect(isStravaStrength({ sport_type: 'WeightTraining' })).toBe(true);
    expect(isStravaStrength({ type: 'Run' }) || isStravaStrength({ type: 'Yoga' })).toBe(false);
  });

  it('narrows Garmin exerciseSets: REST kept as rest, best guess, grams → kg, UNKNOWN → null', () => {
    const all = narrowExerciseSets({ exerciseSets: [
      { setType: 'ACTIVE', startTime: '2026-11-16T05:10:00.0', repetitionCount: 10, weight: 40000, duration: 41.2, exercises: [{ category: 'SQUAT', name: 'BARBELL_BACK_SQUAT', probability: 98 }, { category: 'LUNGE', probability: 2 }] },
      { setType: 'REST', startTime: '2026-11-16T05:10:41.2', duration: 90 },
      { setType: 'ACTIVE', repetitionCount: 10, weight: 40000, exercises: [{ category: 'SQUAT', name: 'BARBELL_BACK_SQUAT', probability: 95 }] },
      { setType: 'ACTIVE', duration: 45, exercises: [{ category: 'PLANK', name: null, probability: 90 }] },
      { setType: 'ACTIVE', repetitionCount: 15, exercises: [{ category: 'UNKNOWN', name: 'UNKNOWN', probability: 0 }] },
    ] })!;
    expect(all).toHaveLength(5);
    expect(all[1]).toEqual({ kind: 'rest', startTime: '2026-11-16T05:10:41.2', category: null, name: null, reps: null, weightKg: null, durationSec: 90 });
    const sets = activeSets(all);
    expect(sets).toHaveLength(4);
    expect(sets[0]).toEqual({ kind: 'active', startTime: '2026-11-16T05:10:00.0', category: 'SQUAT', name: 'BARBELL_BACK_SQUAT', reps: 10, weightKg: 40, durationSec: 41 });
    expect(sets[2]).toEqual({ kind: 'active', startTime: null, category: 'PLANK', name: null, reps: null, weightKg: null, durationSec: 45 });
    expect(exerciseCount(all)).toBe(3);
    expect(summarise(all)).toEqual({ exercises: 3, sets: 4 });
    expect(sets[3].category).toBeNull();
    expect(exerciseCount(sets)).toBe(3);
    expect(narrowExerciseSets(null)).toBeNull();
  });

  it('rows from before rest sets existed (no kind) read as work', () => {
    expect(activeSets([{ category: 'SQUAT', name: null, reps: 5, weightKg: 60, durationSec: 30 }])).toHaveLength(1);
  });

  it('pulls a 5 s HR trace out of Garmin details, skipping empty samples', () => {
    const rows = Array.from({ length: 40 }, (_, i) => ({ metrics: [i, i % 7 === 0 ? null : 100 + i] }));
    const hr = hrFromDetails({ metricDescriptors: [{ key: 'sumElapsedDuration', metricsIndex: 0 }, { key: 'directHeartRate', metricsIndex: 1 }], activityDetailMetrics: rows })!;
    expect(hr.t[0]).toBe(1);
    expect(hr.t.every((t, i) => i === 0 || t - hr.t[i - 1] >= 5)).toBe(true);
    expect(hr.hr.every(b => b > 100)).toBe(true);
    expect(hrFromDetails({ metricDescriptors: [], activityDetailMetrics: [] })).toBeNull();
    expect(hrFromDetails(null)).toBeNull();
  });

  it('writes TE, Relative Effort and the HR trace; all droppable before migration 210', () => {
    const g = strengthRow({ athleteId: 'a', source: 'garmin', garminActivityId: 1, name: null, startTimeLocal: '2026-11-16T07:00:00', durationSec: 60, averageHr: null, maxHr: null, calories: null,
      trainingEffect: { aerobic: 2.1, anaerobic: 3.4, label: 'ANAEROBIC', load: 64 }, hr: { t: [0, 5], hr: [90, 95] } });
    expect(g.training_effect).toEqual({ aerobic: 2.1, anaerobic: 3.4, label: 'ANAEROBIC', load: 64 });
    expect(g.strength_hr).toEqual({ t: [0, 5], hr: [90, 95] });
    const s = strengthRow({ athleteId: 'a', source: 'strava', garminActivityId: -1, name: null, startTimeLocal: '2026-11-16T07:00:00', durationSec: 60, averageHr: 120, maxHr: null, calories: null, sufferScore: 41.6 });
    expect(s.suffer_score).toBe(42);
    for (const c of ['exercise_sets', 'strength_hr', 'suffer_score', 'training_effect']) expect(STRENGTH_OPTIONAL_COLUMNS).toContain(c);
  });

  it('fetches sets for a bounded number of sessions per sync', () => {
    expect(STRENGTH_SETS_PER_SYNC).toBe(5);
  });

  it('only ingests when the flag is on for the athlete', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/activities/strength-sync.ts'), 'utf8');
    expect(src.split("isFeatureEnabled('strength_training', athleteId, db)").length - 1).toBe(2);
    expect(FEATURES.strength_training.defaultEnabled).toBe(false);
  });

  it('runs before the "No runs" early exit in the Garmin sync', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/api/garmin/sync-activities/route.ts'), 'utf8');
    expect(src.indexOf('syncGarminStrength(')).toBeLessThan(src.indexOf('No runs. Types found'));
  });
});

describe('privacy', () => {
  it('weights is a hidden-field key', () => {
    expect([...readHiddenFields({ hiddenFields: ['weights', 'pace'] })].sort()).toEqual(['pace', 'weights']);
  });

  const item = (type: string) => ({
    id: 'f1', type: 'activity',
    activity: { id: 'act1', athleteId: 'a1', activityType: type, distance: 0, averagePace: 300, routePreview: [{ lat: 1, lng: 1 }], hasRoute: true, paceBands: [], lapBands: [], stepBands: [], planVerdict: null },
  }) as never;

  it('a viewer without the flag never gets a strength card; runs pass untouched', () => {
    const out = applyStrength([item(STRENGTH_TYPE), item('running')], false, new Map());
    expect(out).toHaveLength(1);
    expect((out[0] as { activity: { activityType: string } }).activity.activityType).toBe('running');
  });

  it('the card carries counts, never weights, no route, no pace', () => {
    const sets = [{ category: 'SQUAT', name: null, reps: 10, weightKg: 40, durationSec: 40 }, { category: 'SQUAT', name: null, reps: 8, weightKg: 45, durationSec: 38 }];
    const [card] = applyStrength([item(STRENGTH_TYPE)], true, new Map([["act1", sets]])) as unknown as Array<{ activity: Record<string, unknown> }>;
    expect(card.activity.strength).toEqual({ exercises: 1, sets: 2 });
    expect(card.activity.routePreview).toBeNull();
    expect(card.activity.averagePace).toBeNull();
    expect(JSON.stringify(card)).not.toContain('weightKg');
    expect(summarise(null)).toBeNull();
  });

  it('TE / Relative Effort ride on the card but follow a hidden heart rate', () => {
    const extras = new Map([['act1', { te: 3.4, sufferScore: null }]]);
    const withHr = { ...(item(STRENGTH_TYPE) as object), activity: { ...(item(STRENGTH_TYPE) as { activity: object }).activity, averageHr: 120 } } as never;
    const [shown] = applyStrength([withHr], true, new Map(), extras) as unknown as Array<{ activity: { strength: unknown } }>;
    expect(shown.activity.strength).toEqual({ exercises: 0, sets: 0, aerobicTe: 3.4, relativeEffort: null });
    const [hidden] = applyStrength([item(STRENGTH_TYPE)], true, new Map(), extras) as unknown as Array<{ activity: { strength: unknown } }>;
    expect(hidden.activity.strength).toBeNull();
  });

  it('FEED_SELECT never names exercise_sets (an unpasted migration must not take the feed down)', () => {
    const src = readFileSync(join(process.cwd(), 'src/lib/feed/project.ts'), 'utf8');
    expect(src.slice(src.indexOf('export const FEED_SELECT'))).not.toContain('exercise_sets');
  });

  it('the set-by-set route is self-or-staff and gated', () => {
    const src = readFileSync(join(process.cwd(), 'src/app/api/activities/strength/route.ts'), 'utf8');
    expect(src).toContain('resolveVerifiedCaller');
    expect(src).toContain('mayActFor(caller, row.athlete_id)');
    expect(src).toContain("isFeatureEnabled('strength_training'");
    expect(src).not.toContain('x-user-email');
  });
});

describe('adherence: planned day or the day after', () => {
  const s = (date: string, id: string, d = 2400) => ({ date, durationSec: d, activityId: id });
  it('same day and next day count; two days later does not', () => {
    expect(strengthVerdicts(['2026-11-16'], [s('2026-11-16', 'x')])[0]).toMatchObject({ done: true, durationSec: 2400 });
    expect(strengthVerdicts(['2026-11-16'], [s('2026-11-17', 'x')])[0].done).toBe(true);
    expect(strengthVerdicts(['2026-11-16'], [s('2026-11-18', 'x')])[0].done).toBe(false);
    expect(strengthVerdicts(['2026-11-16'], [s('2026-11-15', 'x')])[0].done).toBe(false);
  });
  it('one session closes one planned day', () => {
    const v = strengthVerdicts(['2026-11-16', '2026-11-17'], [s('2026-11-17', 'x')]);
    expect(v.filter(x => x.done)).toHaveLength(1);
  });
  it('crosses a month boundary', () => {
    expect(strengthVerdicts(['2026-11-30'], [s('2026-12-01', 'x')])[0].done).toBe(true);
  });
});

describe('migration 210', () => {
  it('is idempotent', () => {
    const dir = join(process.cwd(), 'supabase/migrations');
    const f = readdirSync(dir).find(n => n.startsWith('210_'))!;
    expect(statSync(join(dir, f)).isFile()).toBe(true);
    const sql = readFileSync(join(dir, f), 'utf8');
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS exercise_sets jsonb/);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS strength_hr jsonb/);
    expect(sql).toMatch(/ADD COLUMN IF NOT EXISTS suffer_score integer/);
    expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS/);
  });
});
