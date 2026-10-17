import { describe, expect, it } from 'vitest';
import { computeDistanceBests, type RunActivityRow } from '@/lib/prs/pr-buckets';
import {
  CHART_MAX_POINTS,
  agoUnit,
  chartWindow,
  computeRecordHistory,
  daysBetween,
  realBreaks,
  recordBreaks,
  recordScreenModel,
  timelineDateParts,
  timelineLayout,
  yearBests,
} from '@/lib/prs/record-history';
import { profileClubRanks, type ClubRecordBucket } from '@/lib/prs/club-records';

/** A whole-run 5K (5.0 km, no laps) in `seconds`, on `date`. */
const fiveK = (id: string, date: string, seconds: number, type = 'running'): RunActivityRow => ({
  id,
  activity_type: type,
  activity_name: `run ${id}`,
  start_time: `${date}T06:00:00+00:00`,
  distance: 5000,
  duration: seconds,
});

// Ofer's real 5K progression from the mockup data (2021 run-walks first).
const OFER_5K: Array<[string, number]> = [
  ['2021-10-02', 2955],
  ['2021-10-23', 2894],
  ['2021-10-29', 2828],
  ['2021-11-07', 1356],
  ['2022-07-05', 1130],
  ['2026-03-27', 1117],
  ['2026-09-23', 1092],
];

describe('recordBreaks', () => {
  it('lists every run that set a new best, oldest first, whatever order the rows came in', () => {
    // Newest-first, the way the routes read athlete_activities, plus slower runs between.
    const runs = [
      fiveK('g', '2026-09-23', 1092),
      fiveK('x', '2026-05-01', 1200),
      fiveK('f', '2026-03-27', 1117),
      fiveK('e', '2022-07-05', 1130),
      fiveK('y', '2022-01-01', 1400),
      fiveK('d', '2021-11-07', 1356),
    ];
    expect(recordBreaks(runs, '5k').map((b) => [b.activityId, b.seconds])).toEqual([
      ['d', 1356],
      ['e', 1130],
      ['f', 1117],
      ['g', 1092],
    ]);
  });

  it('equalling the record is not breaking it', () => {
    const runs = [fiveK('a', '2026-01-01', 1200), fiveK('b', '2026-02-01', 1200)];
    expect(recordBreaks(runs, '5k').map((b) => b.activityId)).toEqual(['a']);
  });

  it('a treadmill run can never be a break — outdoor, measured runs only', () => {
    const runs = [
      fiveK('a', '2026-01-01', 1300),
      fiveK('tm', '2026-02-01', 886, 'treadmill_running'),
      fiveK('v', '2026-02-02', 900, 'virtual_run'),
      fiveK('b', '2026-03-01', 1250),
    ];
    expect(recordBreaks(runs, '5k').map((b) => b.activityId)).toEqual(['a', 'b']);
  });

  it('the bad-data fix holds: 5,000 m in 27 s is no record and no break', () => {
    const runs = [fiveK('a', '2026-01-01', 1070), fiveK('bug', '2026-02-01', 27), fiveK('b', '2026-03-01', 1060)];
    const breaks = recordBreaks(runs, '5k');
    expect(breaks.map((b) => b.seconds)).toEqual([1070, 1060]);
    expect(breaks.some((b) => b.seconds < 100)).toBe(false);
  });

  it("the last break IS the record the card shows", () => {
    const runs = OFER_5K.map(([d, s], i) => fiveK(String(i), d, s));
    const breaks = recordBreaks(runs, '5k');
    const card = computeDistanceBests(runs).find((b) => b.key === '5k');
    expect(breaks.at(-1)?.seconds).toBe(card?.seconds);
    expect(breaks.at(-1)?.activityId).toBe(card?.activityId);
  });

  it('an unknown bucket has no history', () => {
    expect(recordBreaks([fiveK('a', '2026-01-01', 1200)], 'mile')).toEqual([]);
  });
});

describe('realBreaks — the run-walk start is not history', () => {
  it("drops the 2021 run-walks: Ofer's 5K broke 4 times, not 7", () => {
    const runs = OFER_5K.map(([d, s], i) => fiveK(String(i), d, s));
    const all = recordBreaks(runs, '5k');
    expect(all).toHaveLength(7);
    expect(realBreaks(all).map((b) => b.seconds)).toEqual([1356, 1130, 1117, 1092]);
  });

  it('keeps a short history whole', () => {
    // Ido: on Strava since April — four real breaks in half a year.
    const runs = [
      fiveK('a', '2026-04-06', 1200),
      fiveK('b', '2026-04-07', 1187),
      fiveK('c', '2026-04-12', 1057),
      fiveK('d', '2026-09-04', 960),
    ];
    expect(computeRecordHistory(runs)['5k']).toHaveLength(4);
  });

  it('every bucket is present, empty when never run', () => {
    const h = computeRecordHistory([fiveK('a', '2026-01-01', 1200)]);
    expect(Object.keys(h)).toEqual(['5k', '10k', 'hm', 'fm']);
    expect(h['10k']).toEqual([]);
  });
});

describe('yearBests', () => {
  it("is this year's best per bucket, null where the bucket wasn't run", () => {
    const runs = [fiveK('a', '2022-11-02', 1050), fiveK('b', '2026-03-01', 1140), fiveK('c', '2026-08-01', 1120)];
    const y = yearBests(runs, '2026');
    expect(y['5k']).toBe(1120);
    expect(y['10k']).toBeNull();
  });
});

describe('chartWindow — the last-6 rule', () => {
  it('twelve breaks: the chart draws the last 6 and says "6 earlier"', () => {
    const twelve = Array.from({ length: 12 }, (_, i) => ({ seconds: 6000 - i * 100, date: `2020-01-${10 + i}` }));
    const { points, hidden } = chartWindow(twelve);
    expect(CHART_MAX_POINTS).toBe(6);
    expect(hidden).toBe(6);
    expect(points).toEqual(twelve.slice(6));
  });

  it('six or fewer: everything, nothing hidden', () => {
    const four = [1, 2, 3, 4].map((n) => ({ seconds: 100 - n, date: '2026-01-01' }));
    expect(chartWindow(four)).toEqual({ points: four, hidden: 0 });
    const six = Array.from({ length: 6 }, (_, i) => i);
    expect(chartWindow(six).hidden).toBe(0);
  });
});

describe('recordScreenModel', () => {
  const b = (date: string, seconds: number) => ({ date, seconds });

  it('a watch record: newest first, each row with what it took off, the newest filled', () => {
    const m = recordScreenModel({ seconds: 1092, date: '2026-09-23', source: 'auto' }, [
      b('2021-11-07', 1356),
      b('2022-07-05', 1130),
      b('2026-09-23', 1092),
    ]);
    expect(m.body).toBe('chart');
    expect(m.breakCount).toBe(3);
    expect(m.rows.map((r) => [r.seconds, r.gain, r.current])).toEqual([
      [1092, 38, true],
      [1130, 226, false],
      [1356, null, false],
    ]);
  });

  it('a stated record older than the watch (Ran, 5K 14:59 in 2005): dashed line above, dashed first row, nothing filled', () => {
    const m = recordScreenModel({ seconds: 899, date: '2005-06-13', source: 'manual', note: 'הדר יוסף' }, [
      b('2019-07-15', 1343),
      b('2019-10-08', 1269),
      b('2025-05-10', 1073),
      b('2026-02-13', 1014),
    ]);
    expect(m.manual).toBe(true);
    expect(m.manualAbove).toBe(true);
    expect(m.body).toBe('chart');
    expect(m.rows[0]).toMatchObject({ kind: 'manual', seconds: 899, run: null, gain: null });
    expect(m.rows.slice(1).map((r) => r.seconds)).toEqual([1014, 1073, 1269, 1343]);
    expect(m.rows.some((r) => r.current)).toBe(false);
  });

  it('a stated record with one watch break draws nothing and claims no "first record"', () => {
    const m = recordScreenModel({ seconds: 1881, date: '2004-02-13', source: 'manual' }, [b('2011-02-06', 1903)]);
    expect(m.body).toBe('none');
    expect(m.rows.map((r) => r.kind)).toEqual(['manual', 'run']);
  });

  it('a stated record slower than the watch is still the record, but not drawn above the dots', () => {
    const m = recordScreenModel({ seconds: 1300, date: null, source: 'manual' }, [b('2026-01-01', 1400), b('2026-02-01', 1250)]);
    expect(m.manualAbove).toBe(false);
    expect(m.rows[0].kind).toBe('manual');
  });

  it('a stated record with no watch history at all', () => {
    const m = recordScreenModel({ seconds: 9166, date: '2016-01-08', source: 'manual', note: 'מרתון טבריה' }, []);
    expect(m.manualAbove).toBe(true);
    expect(m.body).toBe('none');
    expect(m.rows).toHaveLength(1);
  });

  it('a single break: no chart, a sentence', () => {
    const m = recordScreenModel({ seconds: 14494, date: '2023-04-23', source: 'auto' }, [b('2023-04-23', 14494)]);
    expect(m.body).toBe('single');
    expect(m.rows).toHaveLength(1);
    expect(m.rows[0].current).toBe(true);
  });

  it('no record at this distance (never run, or hidden)', () => {
    const m = recordScreenModel({ seconds: null, date: null }, []);
    expect(m.empty).toBe(true);
    expect(m.rows).toEqual([]);
  });
});

describe('timelineLayout', () => {
  it('faster is higher, and time runs left to right', () => {
    const L = timelineLayout([1356, 1130, 1117, 1092], { hidden: 0, manualAbove: false, currentIsLast: true });
    const ys = L.points.map((p) => p.y);
    const xs = L.points.map((p) => p.x);
    // Every break is faster than the one before it, so every point sits higher (smaller y).
    expect(ys).toEqual([...ys].sort((a, b) => b - a));
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(L.points.at(-1)?.current).toBe(true);
    expect(L.points.slice(0, -1).every((p) => !p.current)).toBe(true);
  });

  it('makes room for the "earlier" stub and the manual line', () => {
    const plain = timelineLayout([200, 100], { hidden: 0, manualAbove: false, currentIsLast: true });
    const busy = timelineLayout([200, 100], { hidden: 6, manualAbove: true, currentIsLast: true });
    expect(busy.padLeft).toBeGreaterThan(plain.padLeft);
    expect(busy.height).toBeGreaterThan(plain.height);
    expect(plain.manualY).toBeNull();
    // The dashed line is above the fastest dot.
    expect(busy.manualY!).toBeLessThan(Math.min(...busy.points.map((p) => p.y)));
  });

  it('two breaks in one month get the day too', () => {
    expect(timelineDateParts(['2026-04-05', '2026-05-22', '2026-05-30', '2026-09-04'])).toEqual([
      { day: null, month: 4, year: 2026 },
      { day: 22, month: 5, year: 2026 },
      { day: 30, month: 5, year: 2026 },
      { day: null, month: 9, year: 2026 },
    ]);
  });
});

describe('"last … ago"', () => {
  it('reads the dates as calendar days', () => {
    expect(daysBetween('2026-09-23T05:53:17+00:00', '2026-10-17')).toBe(24);
    expect(daysBetween('2026-10-17', '2026-10-17')).toBe(0);
  });

  it('picks one unit the way the mockup words it', () => {
    expect(agoUnit(3)).toEqual({ unit: 'days', n: 3 });
    expect(agoUnit(24)).toEqual({ unit: 'weeks', n: 3 });
    expect(agoUnit(232)).toEqual({ unit: 'months', n: 8 });
    expect(agoUnit(1445)).toEqual({ unit: 'years', n: 4 });
  });
});

describe('profileClubRanks — the rank shows on your own profile only', () => {
  const entries = (n: number, meAt: number) =>
    Array.from({ length: n }, (_, i) => ({ athleteId: i === meAt ? 'me' : `x${i}` })) as ClubRecordBucket['entries'];
  const buckets = [
    { key: '5k', label: '5K', meters: 5000, entries: entries(26, 19) },
    { key: '10k', label: '10K', meters: 10000, entries: entries(25, 18) },
    { key: 'fm', label: 'Marathon', meters: 42195, entries: entries(3, -1) },
  ] as ClubRecordBucket[];

  it('own profile: "#20 of 26", absent where you have no time', () => {
    const r = profileClubRanks(buckets, 'me', true);
    expect(r['5k']).toEqual({ rank: 20, of: 26 });
    expect(r['10k']).toEqual({ rank: 19, of: 25 });
    expect(r.fm).toBeUndefined();
  });

  it("a friend's profile: nothing", () => {
    expect(profileClubRanks(buckets, 'me', false)).toEqual({});
  });

  it('before the board has loaded: nothing', () => {
    expect(profileClubRanks(undefined, 'me', true)).toEqual({});
  });
});
