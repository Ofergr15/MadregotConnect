import { describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import type { ParsedWorkout } from '@/lib/ai/types';
import type { StoredLap } from '@/lib/garmin/laps';
import {
  detectReps, repPace, packRuns, runnersOf, isNew, sortRuns, shareTitle, parseAt, inRowWindow,
  type QsLap, type QsRun, type QsSession,
} from '@/lib/quality-session/model';

vi.mock('@/lib/supabase/server', () => ({ createServerClient: () => ({}) }));
const { qualityWorkout, planWorkoutLists, planTargets } = await import('@/lib/quality-session/server');
const { parseParts, mainSet, partLabel, targetFor } = await import('@/lib/quality-session/parts');

const read = (p: string) => readFileSync(fileURLToPath(new URL(`../${p}`, import.meta.url)), 'utf8');
const w = (o: Partial<ParsedWorkout>): ParsedWorkout => ({ dayOfWeek: 2, name: '', steps: [], ...o } as ParsedWorkout);
const lap = (distance: number, duration: number, o: Partial<StoredLap> = {}): StoredLap =>
  ({ distance, duration, averagePace: null, averageHR: null, maxHR: null, ...o });
const run = (o: Partial<QsRun> & { id: string }): QsRun => ({
  name: o.id, athleteId: o.id, pack: 1, dup: false, start: '06:00', end: '07:00',
  dist: 10000, dur: 3600, pace: 360, repPace: null, laps: [], ...o,
});

describe('qualityWorkout', () => {
  it('finds the morning intervals of the day', () => {
    expect(qualityWorkout([w({ name: 'אינטרוולים 6×1000' }), w({ dayOfWeek: 3, name: 'שחרור' })], 2))
      .toEqual({ name: 'אינטרוולים 6×1000', type: 'intervals' });
  });
  it('is null on an easy day, and never takes the evening or an optional extra', () => {
    expect(qualityWorkout([w({ name: 'שחרור' })], 2)).toBeNull();
    expect(qualityWorkout([w({ name: 'קל', partIndex: 1 }), w({ name: 'טמפו', partKind: 'evening', partIndex: 2 })], 2)).toBeNull();
    expect(qualityWorkout([w({ name: 'פרטלק', optional: true })], 2)).toBeNull();
    expect(qualityWorkout(null, 2)).toBeNull();
  });
  it('a split day is a quality day when any morning part is', () => {
    expect(qualityWorkout([w({ name: 'חימום', partKind: 'warmup', partIndex: 1 }), w({ name: 'MEDIO 3×4', partKind: 'main', partIndex: 2 })], 2)?.type).toBe('tempo');
  });
});

describe('detectReps', () => {
  it('trusts the watch marker only when the lap ran a workout step', () => {
    const laps = [
      lap(2000, 600, { wktStepIndex: 0, intensityType: 'WARMUP' }),
      lap(1000, 230, { wktStepIndex: 1, intensityType: 'INTERVAL' }),
      lap(400, 150, { wktStepIndex: 2, intensityType: 'RECOVERY' }),
      lap(1000, 228, { wktStepIndex: 1, intensityType: 'INTERVAL' }),
    ];
    expect(detectReps(laps).map(l => l[2])).toEqual(['easy', 'rep', 'rest', 'rep']);
  });
  it('without a workout: laps well faster than the median are reps, slow short ones rest', () => {
    const laps = [lap(1000, 300), lap(1000, 300), lap(1000, 230), lap(200, 90), lap(1000, 228), lap(1000, 300), lap(1000, 305)];
    expect(detectReps(laps).map(l => l[2])).toEqual(['easy', 'easy', 'rep', 'rest', 'rep', 'easy', 'easy']);
  });
  it('an even run has no reps', () => {
    expect(detectReps([lap(1000, 300), lap(1000, 296), lap(1000, 302)]).every(l => l[2] === 'easy')).toBe(true);
  });
  it('rep pace is the reps alone', () => {
    expect(repPace([[1000, 230, 'rep'], [400, 150, 'rest'], [1000, 220, 'rep'], [2000, 600, 'easy']])).toBe(225);
    expect(repPace([[2000, 600, 'easy']])).toBeNull();
  });
});

describe('the morning as of a moment', () => {
  const sess: QsSession = {
    date: '2026-09-29', label: '', workout: { name: '6×1000', type: 'intervals' }, plan: {},
    runs: [
      run({ id: 'a', end: '07:10' }),
      run({ id: 'b', end: '07:50' }),
      run({ id: 'c', end: '08:40' }),
      run({ id: 'd', end: '07:00', dup: true }),
      run({ id: 'e', end: '07:00', pack: 2 }),
      run({ id: 'f', start: '17:00', end: '18:00' }),
    ],
  };
  it('at 08:00 a run not finished yet is not there, nor duplicates, other packs, the evening', () => {
    expect(packRuns(sess, 1, 8 * 60).map(r => r.id)).toEqual(['a', 'b']);
  });
  it('"new" is finished after the 7:30 push', () => {
    expect(isNew(sess.runs[0])).toBe(false);
    expect(isNew(sess.runs[1])).toBe(true);
  });
  it('sorts by km, or by rep pace falling back to the run pace', () => {
    const rs = [run({ id: 'x', dist: 9000, repPace: 230 }), run({ id: 'y', dist: 12000, pace: 220 })];
    expect(sortRuns(rs, 'km').map(r => r.id)).toEqual(['y', 'x']);
    expect(sortRuns(rs, 'reps').map(r => r.id)).toEqual(['y', 'x']);
  });
  it('the card is titled as the pack', () => {
    expect(shareTitle(1, sess.workout)).toBe('דבוקה 1 · 6×1000');
    expect(shareTitle(0, null)).toBe('אימון האיכות');
  });
});

describe('time travel', () => {
  it('parses ?at= and nothing else', () => {
    expect(parseAt('2026-09-29T08:00')).toEqual({ date: '2026-09-29', minutes: 480 });
    expect(parseAt('2026-09-29T25:00')).toBeNull();
    expect(parseAt('off')).toBeNull();
  });
  it('the feed row is 07:00 up to 11:00', () => {
    expect([419, 420, 659, 660].map(inRowWindow)).toEqual([false, true, true, false]);
  });
});

describe('wiring', () => {
  it('the API is the super user\'s alone', () => {
    const api = read('app/api/quality-session/route.ts');
    expect(api).toMatch(/requireSession/);
    expect(api).toMatch(/isSuperUser\) return NextResponse\.json\(\{ error: 'Forbidden' \}, \{ status: 403 \}\)/);
  });
  it('the row sits at the top of the feed, above what\'s next', () => {
    const feed = read('app/(app)/feed/page.tsx');
    expect(feed).toMatch(/empty:mb-0">\s*<QualitySessionRow \/>/);
    expect(feed.indexOf('<QualitySessionRow />')).toBeLessThan(feed.indexOf('<NextSessionCard />'));
  });
  it('the 7:30 push is once a day by the ledger and reads the plan, not the team days', () => {
    const tick = read('app/api/cron/tick/route.ts');
    const stage = tick.slice(tick.indexOf('qualitySession:'), tick.indexOf('dispatchDueTestReminders(supabase'));
    expect(stage).toMatch(/already\(tag\)/);
    expect(stage).toMatch(/qualityPush\(supabase, today\)/);
    expect(stage).toMatch(/markFired\(tag/);
    expect(stage).not.toMatch(/teamDays/);
  });
  it('"send it to me" is the same push, to the caller alone, and outside the ledger', () => {
    const api = read('app/api/quality-session/route.ts');
    const post = api.slice(api.indexOf('export async function POST'));
    expect(post).toMatch(/!auth\.user\.isSuperUser \|\| !auth\.user\.athleteId\) return NextResponse\.json\(\{ error: 'Forbidden' \}, \{ status: 403 \}\)/);
    expect(post).toMatch(/qualityPush\(/);
    expect(post).toMatch(/athleteId: auth\.user\.athleteId,/);
    expect(post).toMatch(/notifyAthlete\(/);
    expect(post.match(/notifyAthlete\(/g)).toHaveLength(1);
    expect(post).not.toMatch(/markFired|already\(/);
  });
});

describe('the stored plan', () => {
  const w = (dayOfWeek: number) => ({ dayOfWeek, name: 'x' }) as unknown as ParsedWorkout;
  it('reads every pack of a per-pack plan, in pack order, and the older shapes', () => {
    expect(planWorkoutLists({ group2: { workouts: [w(2)] }, group1: { workouts: [w(1)] }, note: 'x' }))
      .toEqual([[w(1)], [w(2)]]);
    expect(planWorkoutLists({ workouts: [w(3)] })).toEqual([[w(3)]]);
    expect(planWorkoutLists([w(4)])).toEqual([[w(4)]]);
    expect(planWorkoutLists(null)).toEqual([]);
  });
});

// Four runners of Tuesday 29.9 (laps only, no names): the plan was a warm-up,
// 4 × 45″, 2 × 20″, a fartlek of fast and float kilometres, and 5 × 300 m.
const LAPS = JSON.parse(read('__tests__/fixtures/quality-session-0929-laps.json')) as Record<string, QsLap[]>;
const labels = (k: string) => parseParts(LAPS[k]).parts.map(partLabel);

describe('the parts of the workout', () => {
  it('reads the whole morning, the fartlek as one set of its fast kms', () => {
    expect(labels('full')).toEqual(['חימום 3.6 ק״מ', '4 × 45″', '2 × 20″', '10 × 1 ק״מ', '5 × 300 מ׳', 'שחרור 2.9 ק״מ']);
    const main = mainSet(parseParts(LAPS.full).parts)!;
    expect([main.unit, main.reps.length, main.floats.length]).toEqual(['fart', 10, 9]);
  });
  it('joins a fartlek broken by a cut-short float', () => {
    expect(labels('splitFartlek')).toEqual(['חימום 4.0 ק״מ', '4 × 45″', '2 × 20″', '9 × 1 ק״מ', '5 × 300 מ׳']);
  });
  it('a steady run in place of the fartlek is a run, and the 45″ become the main set', () => {
    const { parts } = parseParts(LAPS.noFartlek);
    expect(parts.map(partLabel)).toEqual(['חימום 3.5 ק״מ', '4 × 45″', '2 × 20″', 'ריצה 17.1 ק״מ']);
    expect(partLabel(mainSet(parts)!)).toBe('4 × 45″');
  });
  it('the main pace is the fast kms alone, not the floats', () => {
    const main = mainSet(parseParts(LAPS.pack3).parts)!;
    expect(main.p).toBeLessThan(230);
    expect(main.floats.every(f => f.p > main.p)).toBe(true);
  });
});

describe('one row per runner', () => {
  it('keeps the long run with laps, the jog and the lap-less copy under it', () => {
    const laps: QsLap[] = [[1000, 300, 'easy'], [1000, 300, 'easy']];
    const rs = runnersOf([
      run({ id: 'jog', athleteId: 'a', start: '05:01', dist: 1000, laps }),
      run({ id: 'copy', athleteId: 'a', start: '05:02', dist: 26000, laps: [] }),
      run({ id: 'main', athleteId: 'a', start: '05:10', dist: 25000, laps }),
      run({ id: 'b', athleteId: 'b' }),
    ]);
    expect(rs.map(r => [r.run.id, r.extra.map(e => e.id)])).toEqual([['main', ['jog', 'copy']], ['b', []]]);
  });
});

describe('the plan\'s targets', () => {
  const step = (o: Record<string, unknown>) => o as never;
  const pack = (fast: number, float: number, s45: number[]) => ({
    workouts: [w({ name: 'פארטלק', steps: [
      ...s45.map(p => step({ type: 'interval', durationType: 'time', durationValue: 45, targetPaceMinPerKm: p })),
      step({ type: 'interval', durationType: 'time', durationValue: 20 }),
      step({ type: 'repeat', repeatCount: 9, repeatSteps: [
        step({ type: 'interval', durationType: 'distance', durationValue: 1000, targetPaceMinPerKm: fast }),
        step({ type: 'recovery', durationType: 'distance', durationValue: 1000, targetPaceMinPerKm: float }),
      ] }),
      step({ type: 'interval', durationType: 'distance', durationValue: 1000, targetPaceMinPerKm: fast }),
    ] })],
  });
  const plan = planTargets({ group1: pack(204, 265, [230, 220, 210, 200]), group3: pack(218, 285, [250, 240, 230, 220]) }, 2);

  it('spells out each pack\'s repeats, with the float after them', () => {
    expect(plan[2]).toBeUndefined();
    const fast = plan[1]!.filter(r => r.unit === 'distance');
    expect(fast).toHaveLength(10);
    expect(fast.every(r => r.pace === 204)).toBe(true);
    expect(fast[0].float).toBe(265);
  });
  it('matches a set to its step: the fast kms out of ten, the 45″ in their descending order', () => {
    const parts = parseParts(LAPS.pack3).parts;
    const fart = parts.find(p => p.unit === 'fart')!;
    expect(targetFor(fart, plan[3])).toEqual({ paces: Array(10).fill(218), float: 285, planned: 10 });
    const s45 = parts.find(p => partLabel(p) === '4 × 45″')!;
    expect(targetFor(s45, plan[3])?.paces).toEqual([250, 240, 230, 220]);
    expect(targetFor(parts.find(p => partLabel(p) === '5 × 300 מ׳')!, plan[3])).toBeNull();
  });
});
