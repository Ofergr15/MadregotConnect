import { describe, expect, it } from 'vitest';
import {
  HARD_MARGIN, MAX_CANDIDATES, WINDOW_DAYS, bestStretch, findTestRuns, looksNamedTest, olderTests, type FinderActivity,
} from '@/lib/academy/test-finder';
import { shiftDate } from '@/lib/academy/load';

/**
 * "למשוך מהשעון" (mockup academy-existing-trainees, phone 3). The detector decides which of a
 * trainee's synced runs could be the test their threshold is computed from, so each rule here is
 * a way to price a whole plan wrong: intervals mistaken for 30 continuous minutes, an easy run
 * mistaken for a hard one, a run from last year, or a Strava run with no laps reported as "no test".
 */

const TODAY = '2026-10-11';
let seq = 0;

/** A lap of `km` at `pace` sec/km, as Garmin stores it. */
const lap = (km: number, pace: number, hr: number | null = 165) => ({ distance: km * 1000, duration: km * pace, averageHR: hr });

function run(over: Partial<FinderActivity> & { daysAgo?: number; lapsOf?: ReturnType<typeof lap>[] } = {}): FinderActivity {
  const { daysAgo = 3, lapsOf, ...rest } = over;
  const laps = lapsOf ?? [];
  const distance = laps.length ? laps.reduce((s, l) => s + l.distance, 0) : 10_000;
  const duration = laps.length ? laps.reduce((s, l) => s + l.duration, 0) : 10 * 330;
  return {
    id: `a${++seq}`,
    start_time: `${shiftDate(TODAY, -daysAgo)}T07:00:00+00:00`,
    activity_name: 'ריצה קלה',
    activity_type: 'running',
    source: 'garmin',
    distance,
    duration,
    moving_duration: duration,
    average_hr: 150,
    laps,
    ...rest,
  };
}

/** The athlete's usual: easy 10 km at 5:30 with km laps. */
const easy = (daysAgo: number) => run({ daysAgo, lapsOf: Array.from({ length: 10 }, () => lap(1, 330, 140)) });

describe('looksNamedTest', () => {
  it('Hebrew and English, any case; not a word that merely contains "test"', () => {
    expect(looksNamedTest('טסט 30 דק׳')).toBe(true);
    expect(looksNamedTest('Test')).toBe(true);
    expect(looksNamedTest('30 min TEST')).toBe(true);
    expect(looksNamedTest('contest run')).toBe(false);
    expect(looksNamedTest(null)).toBe(false);
  });
});

describe('bestStretch', () => {
  it('finds 30 continuous minutes inside warm-up · test · cool-down', () => {
    const laps = [lap(2, 330), ...Array.from({ length: 7 }, () => lap(1, 253)), lap(0.12, 253), lap(2, 340)];
    const s = bestStretch(laps as any);
    expect(s).not.toBeNull();
    expect(s!.from).toBe(1);
    expect(Math.round(s!.paceSec)).toBe(253);
  });
  it('intervals are not a test: a recovery jog inside the stretch breaks it', () => {
    const reps = Array.from({ length: 8 }, () => [lap(1, 240), lap(0.4, 420)]).flat();
    expect(bestStretch(reps as any)).toBeNull();
  });
});

describe('findTestRuns', () => {
  it('a run named "טסט" of 25-40 minutes IS the test, scaled to exactly 30:00', () => {
    const named = run({ activity_name: 'טסט 30 דק׳', distance: 7120, duration: 1800, moving_duration: 1800, average_hr: 171, laps: [] });
    const r = findTestRuns([easy(10), easy(5), named], TODAY);
    expect(r.candidates[0]).toMatchObject({ kind: 'named', protocol: '30min', durationSec: 1800, distanceM: 7120, avgHr: 171 });
    expect(Math.round(r.candidates[0].paceSec)).toBe(253);
    // 31 minutes for 7.3 km → 7.06 km at 30:00, the same pace.
    const longer = findTestRuns([run({ activity_name: 'test', distance: 7300, duration: 1860, moving_duration: 1860, laps: [] })], TODAY);
    expect(longer.candidates[0].distanceM).toBe(Math.round(7300 * 1800 / 1860));
  });

  it('a named LONGER run: the 30 minutes inside it, said as "inside a run of N km"', () => {
    const withWarmup = run({ activity_name: 'טסט', lapsOf: [lap(3, 330), ...Array.from({ length: 7 }, () => lap(1, 255)), lap(0.06, 255), lap(2, 340)] });
    const r = findTestRuns([easy(9), withWarmup], TODAY);
    expect(r.candidates[0]).toMatchObject({ kind: 'namedSegment', insideLonger: true, protocol: '30min' });
    expect(Math.round(r.candidates[0].paceSec)).toBeGreaterThanOrEqual(254);
  });

  it('an unnamed tempo: found by laps when it is hard enough against their own median', () => {
    const tempo = run({ activity_name: 'טמפו', daysAgo: 20, lapsOf: [lap(2, 330), ...Array.from({ length: 7 }, () => lap(1, 261)), lap(0.1, 261), lap(1, 340)] });
    const r = findTestRuns([easy(30), easy(25), easy(10), tempo], TODAY);
    expect(r.candidates).toHaveLength(1);
    expect(r.candidates[0]).toMatchObject({ kind: 'segment', activityId: tempo.id });
    expect(r.candidates[0].hardness!).toBeGreaterThanOrEqual(HARD_MARGIN);
  });

  it('an easy 30-minute run is not a test, however continuous', () => {
    const easy30 = run({ lapsOf: Array.from({ length: 6 }, () => lap(1, 320)) });
    expect(findTestRuns([easy(12), easy(8), easy30], TODAY).candidates).toHaveLength(0);
  });

  it('only the last six months, and only runs', () => {
    const old = run({ activity_name: 'טסט', daysAgo: WINDOW_DAYS + 5, distance: 7000, duration: 1800, moving_duration: 1800, laps: [] });
    const ride = run({ activity_name: 'test', activity_type: 'cycling', distance: 15000, duration: 1800, moving_duration: 1800, laps: [] });
    const r = findTestRuns([old, ride], TODAY);
    expect(r.candidates).toHaveLength(0);
    expect(r.emptyReason).toBe('noRuns');
  });

  it('Strava-only runs without laps: matched by name only, and the reason is said', () => {
    const noLaps = (daysAgo: number, name = 'Morning Run') => run({ daysAgo, source: 'strava', activity_name: name, laps: null, distance: 8000, duration: 1900, moving_duration: 1900 });
    const r = findTestRuns([noLaps(4), noLaps(9), noLaps(15)], TODAY);
    expect(r.candidates).toHaveLength(0);
    expect(r).toMatchObject({ scanned: 3, noLaps: 3, stravaNoLaps: 3, emptyReason: 'noLaps' });
    // …but a lapless run CALLED test is still found.
    const named = findTestRuns([noLaps(4), noLaps(9, 'טסט')], TODAY);
    expect(named.candidates[0]).toMatchObject({ kind: 'named', protocol: '30min' });
    expect(named.stravaNoLaps).toBe(2);
  });

  it('a named run with a ~2000 m lap is a 2000 m candidate', () => {
    const twoK = run({ activity_name: 'טסט 2000', lapsOf: [lap(2, 330), { distance: 2010, duration: 430, averageHR: 175 }, lap(1.5, 340)] });
    const r = findTestRuns([twoK], TODAY);
    expect(r.candidates[0]).toMatchObject({ protocol: '2000m', distanceM: 2000, avgHr: 175 });
    expect(r.candidates[0].durationSec).toBe(Math.round(430 * 2000 / 2010));
  });

  it('ranked: named first, then harder, then newer — and at most three', () => {
    const named = run({ activity_name: 'טסט', daysAgo: 60, distance: 6800, duration: 1800, moving_duration: 1800, laps: [] });
    const tempo = (daysAgo: number, pace: number) => run({ daysAgo, activity_name: 'טמפו', lapsOf: Array.from({ length: 7 }, () => lap(1, pace)).concat([lap(0.2, pace)]) });
    const r = findTestRuns([easy(40), easy(30), easy(20), easy(15), tempo(5, 280), tempo(10, 262), tempo(12, 270), named], TODAY);
    expect(r.candidates).toHaveLength(MAX_CANDIDATES);
    expect(r.candidates[0].activityId).toBe(named.id);
    expect(r.candidates.slice(1).map(c => Math.round(c.paceSec))).toEqual([262, 270]);
  });
});

describe('olderTests', () => {
  it('the same protocol, older than the chosen one, oldest first, one per day', () => {
    const mk = (date: string, protocol: '30min' | '2000m' = '30min') => ({ activityId: date + protocol, date, protocol } as any);
    const list = [mk('2026-09-14'), mk('2026-07-06'), mk('2026-05-18'), mk('2026-05-18'), mk('2026-06-01', '2000m'), mk('2026-10-01')];
    expect(olderTests(list, '2026-09-1430min').map((c: any) => c.date)).toEqual(['2026-05-18', '2026-07-06']);
    expect(olderTests(list, 'nope')).toEqual([]);
  });
});
