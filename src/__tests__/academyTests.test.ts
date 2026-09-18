import { describe, it, expect } from 'vitest';
import {
  buildRegistry,
  buildTrend,
  daysBetween,
  directionOf,
  latestUsable,
  paceLooksImplausible,
  protocolShape,
  thresholdPaceSec,
  MEANINGFUL_SEC_PER_KM,
  STALE_TEST_DAYS,
  type TestRow,
} from '@/lib/academy/tests';

const TODAY = '2026-09-18';

let seq = 0;
const test = (over: Partial<TestRow> = {}): TestRow => ({
  id: `t${++seq}`,
  athleteId: 'a1',
  date: '2026-09-14',
  protocol: '30min',
  durationSec: 1800,
  distanceM: 6420,
  ...over,
});

/** A 30-minute test covering `km`, i.e. a known threshold pace. */
const km = (date: string, meters: number, over: Partial<TestRow> = {}) =>
  test({ date, distanceM: meters, durationSec: 1800, ...over });

describe('thresholdPaceSec', () => {
  it('reduces any protocol to seconds per kilometre through one line of arithmetic', () => {
    // 6420m in 30:00 → 1800 / 6.42 = 280.4 s/km, the mockup's 4:40.
    expect(thresholdPaceSec({ durationSec: 1800, distanceM: 6420 })).toBeCloseTo(280.37, 1);
    // A 2000m in 7:00 is the same arithmetic, which is why `protocol` is metadata.
    expect(thresholdPaceSec({ durationSec: 420, distanceM: 2000 })).toBe(210);
  });

  it('refuses to invent a pace from an impossible measurement', () => {
    expect(thresholdPaceSec({ durationSec: 0, distanceM: 6000 })).toBeNull();
    expect(thresholdPaceSec({ durationSec: 1800, distanceM: 0 })).toBeNull();
  });
});

describe('directionOf — faster is a smaller number', () => {
  it('reports a direction, never a bare sign', () => {
    expect(directionOf(-20)).toBe('improved');
    expect(directionOf(20)).toBe('regressed');
  });

  it('calls anything inside the noise floor unchanged', () => {
    // A 30-minute time trial on a real road, measured by GPS. Two seconds per km is
    // wind and course, and teaching the trainee to read that as progress teaches them
    // to read noise as signal.
    expect(directionOf(-2)).toBe('same');
    expect(directionOf(MEANINGFUL_SEC_PER_KM - 0.01)).toBe('same');
    expect(directionOf(-MEANINGFUL_SEC_PER_KM)).toBe('improved');
  });

  it('has no opinion when there is nothing to compare', () => {
    expect(directionOf(null)).toBeNull();
  });
});

describe('buildTrend', () => {
  it('draws the series oldest first, whatever order the rows arrive in', () => {
    const trend = buildTrend([
      km('2026-09-14', 6420),
      km('2026-02-18', 5850),
      km('2026-07-12', 6280),
      km('2026-05-03', 6080),
    ], '30min');
    expect(trend.points.map(p => p.date)).toEqual([
      '2026-02-18', '2026-05-03', '2026-07-12', '2026-09-14',
    ]);
  });

  it('leaves the baseline without a delta instead of calling it "no change"', () => {
    // The first test is a measurement, not a result. Reporting `same` would be a claim
    // about a comparison that does not exist.
    const trend = buildTrend([km('2026-02-18', 5850)], '30min');
    expect(trend.points[0].deltaPrevSec).toBeNull();
    expect(trend.points[0].directionPrev).toBeNull();
    expect(trend.totalDeltaSec).toBeNull();
  });

  it('quotes the headline against the first test and gets the direction right', () => {
    // 5850m → 6420m in 30 minutes: 307.7 → 280.4 s/km, 27 seconds per km faster.
    const trend = buildTrend([km('2026-02-18', 5850), km('2026-09-14', 6420)], '30min');
    expect(trend.totalDeltaSec).toBeCloseTo(-27.3, 1);
    expect(trend.totalDirection).toBe('improved');
    expect(trend.spanDays).toBe(208);
  });

  it('NEVER compares two protocols, because that gap is not improvement', () => {
    // A 2000m is run faster than a 30-minute effort at identical fitness. On one line
    // the day the club switched protocol looks like a breakthrough.
    const rows = [
      km('2026-02-18', 5850),
      test({ date: '2026-05-03', protocol: '2000m', durationSec: 420, distanceM: 2000 }),
      km('2026-09-14', 6420),
    ];
    const half = buildTrend(rows, '30min');
    expect(half.points.map(p => p.date)).toEqual(['2026-02-18', '2026-09-14']);
    expect(buildTrend(rows, '2000m').points).toHaveLength(1);
  });

  it('separates an excluded test instead of silently dropping it', () => {
    // A series that quietly loses a test the coach knows he recorded looks like data
    // loss, and the reason is the context that makes the graph readable later.
    const trend = buildTrend([
      km('2026-02-18', 5850),
      km('2026-05-03', 5600, { excludedReason: 'רץ עם שפעת' }),
      km('2026-09-14', 6420),
    ], '30min');
    expect(trend.points).toHaveLength(2);
    expect(trend.excluded).toEqual([{ testId: expect.any(String), date: '2026-05-03', reason: 'רץ עם שפעת' }]);
  });

  it('does not let an excluded test become the baseline the headline is quoted against', () => {
    const trend = buildTrend([
      km('2026-01-01', 4000, { excludedReason: 'עצר באמצע' }),
      km('2026-02-18', 5850),
      km('2026-09-14', 6420),
    ], '30min');
    // Against 5850m, not against the abandoned 4000m — which would have read as a
    // 170-second-per-km improvement.
    expect(trend.totalDeltaSec).toBeCloseTo(-27.3, 1);
  });

  it('carries the heart rate through as information', () => {
    const trend = buildTrend([km('2026-09-14', 6420, { avgHr: 171 })], '30min');
    expect(trend.points[0].avgHr).toBe(171);
  });
});

describe('latestUsable', () => {
  it('takes the most recent test, not the most recently entered', () => {
    const found = latestUsable([km('2026-09-14', 6420), km('2026-02-18', 5850)]);
    expect(found?.date).toBe('2026-09-14');
  });

  it('does not let a thrown-out test count as having tested', () => {
    // The athlete did turn up and run. But this clock answers whether the paces in his
    // plan still describe him, and a test we refused to use produced no threshold at
    // all — so marking him current on the strength of it is the one wrong answer.
    const found = latestUsable([
      km('2026-02-18', 5850),
      km('2026-09-14', 6420, { excludedReason: 'סופה' }),
    ]);
    expect(found?.date).toBe('2026-02-18');
  });

  it('returns nothing when every test was thrown out', () => {
    expect(latestUsable([km('2026-09-14', 6420, { excludedReason: 'x' })])).toBeNull();
  });
});

describe('buildRegistry — the fact the spreadsheet will not volunteer', () => {
  const athletes = [
    { id: 'a1', name: 'Dor Alon', bandNumber: 5 },
    { id: 'a2', name: 'Noa Shemesh', bandNumber: 5 },
    { id: 'a3', name: 'Michal Cohen', bandNumber: 8 },
  ];

  it('flags an athlete whose threshold is older than the plan he is running', () => {
    const registry = buildRegistry({
      athletes,
      tests: [
        km('2026-09-14', 6420, { athleteId: 'a1' }),
        km('2026-02-18', 5850, { athleteId: 'a2' }),
      ],
      protocol: '30min',
      today: TODAY,
    });
    const byId = new Map(registry.rows.map(r => [r.athleteId, r]));
    expect(byId.get('a1')!.overdue).toBe(false);
    expect(byId.get('a2')!.overdue).toBe(true);
    expect(byId.get('a2')!.ageDays).toBe(212);
  });

  it('treats never tested as the most stale state there is, not as a clean slate', () => {
    const registry = buildRegistry({ athletes, tests: [], protocol: '30min', today: TODAY });
    expect(registry.rows.every(r => r.overdue)).toBe(true);
    expect(registry.summary.neverTested).toBe(3);
    expect(registry.summary.overdue).toBe(3);
    expect(registry.rows[0].ageDays).toBeNull();
  });

  it('ranks on what needs doing — never tested, then longest overdue — and not on who got slower', () => {
    // A trainee getting slower may be entirely expected in a base block. An athlete
    // whose threshold is four months old is the club's own process failing.
    const registry = buildRegistry({
      athletes: [...athletes, { id: 'a4', name: 'Uri Gal', bandNumber: 6 }],
      tests: [
        // Regressed, but tested last week.
        km('2026-09-10', 6300, { athleteId: 'a1' }),
        km('2026-06-01', 6420, { athleteId: 'a1' }),
        // Overdue by a lot.
        km('2026-02-18', 5850, { athleteId: 'a2' }),
        // Overdue by a little more.
        km('2026-01-20', 5600, { athleteId: 'a4' }),
      ],
      protocol: '30min',
      today: TODAY,
    });
    expect(registry.rows.map(r => r.name)).toEqual([
      'Michal Cohen', // never tested
      'Uri Gal',      // 241 days
      'Noa Shemesh',  // 212 days
      'Dor Alon',     // current, despite having got slower
    ]);
    expect(registry.rows[3].direction).toBe('regressed');
  });

  it('counts the summary off the same directions the rows report', () => {
    const registry = buildRegistry({
      athletes,
      tests: [
        km('2026-06-01', 6000, { athleteId: 'a1' }),
        km('2026-09-14', 6420, { athleteId: 'a1' }),   // faster
        km('2026-06-01', 6000, { athleteId: 'a2' }),
        km('2026-09-14', 5800, { athleteId: 'a2' }),   // slower
        km('2026-09-14', 6000, { athleteId: 'a3' }),   // baseline only
      ],
      protocol: '30min',
      today: TODAY,
    });
    expect(registry.summary.improved).toBe(1);
    expect(registry.summary.regressed).toBe(1);
    // The baseline-only athlete is in neither: one test is not a trend.
    expect(registry.summary.same).toBe(0);
  });

  it('averages a band only over the athletes who actually have a delta', () => {
    // A band full of first-timers must report "not yet" rather than a flattering zero.
    const registry = buildRegistry({
      athletes,
      tests: [
        km('2026-06-01', 6000, { athleteId: 'a1' }),
        km('2026-09-14', 6420, { athleteId: 'a1' }),
        km('2026-09-14', 6000, { athleteId: 'a2' }),   // band 5, baseline only
        km('2026-09-14', 5000, { athleteId: 'a3' }),   // band 8, baseline only
      ],
      protocol: '30min',
      today: TODAY,
    });
    const byBand = new Map(registry.byBand.map(b => [b.bandNumber, b]));
    expect(byBand.get(5)!.athletes).toBe(2);
    // 6000m → 6420m in 30:00 is 300 → 280.4 s/km, and Noa contributes nothing.
    expect(byBand.get(5)!.averageDeltaSec).toBeCloseTo(-19.6, 1);
    expect(byBand.get(8)!.averageDeltaSec).toBeNull();
    expect(byBand.get(8)!.direction).toBeNull();
  });

  it('puts an unassigned athlete last rather than inventing a band for them', () => {
    const registry = buildRegistry({
      athletes: [{ id: 'a1', name: 'Dor', bandNumber: 7 }, { id: 'a2', name: 'Noa' }],
      tests: [],
      protocol: '30min',
      today: TODAY,
    });
    expect(registry.byBand.map(b => b.bandNumber)).toEqual([7, null]);
  });

  it('uses the club\'s own staleness threshold, and lets it be overridden', () => {
    // 92 days old: current under the club's 120, stale under a stricter 90.
    const tests = [km('2026-06-18', 6000, { athleteId: 'a1' })];
    expect(buildRegistry({ athletes, tests, protocol: '30min', today: TODAY }).rows
      .find(r => r.athleteId === 'a1')!.overdue).toBe(false);
    expect(buildRegistry({ athletes, tests, protocol: '30min', today: TODAY, staleAfterDays: 90 }).rows
      .find(r => r.athleteId === 'a1')!.overdue).toBe(true);
    expect(STALE_TEST_DAYS).toBe(120);
  });

  it('accounts for every athlete in the summary, so the KPI row adds up to the list', () => {
    // The four states, one athlete each: improved, unchanged inside the noise floor,
    // regressed, and a single test with nothing to compare against. That last one is the
    // case the three-bucket header lost — she is not overdue and not in any direction, so
    // she appeared in the list and in no number above it.
    const registry = buildRegistry({
      athletes: [
        { id: 'faster', name: 'Faster' },
        { id: 'flat', name: 'Flat' },
        { id: 'slower', name: 'Slower' },
        { id: 'once', name: 'Once' },
      ],
      tests: [
        km('2026-08-01', 6000, { athleteId: 'faster' }), km('2026-09-14', 6420, { athleteId: 'faster' }),
        km('2026-08-01', 7400, { athleteId: 'flat' }), km('2026-09-14', 7420, { athleteId: 'flat' }),
        km('2026-08-01', 5400, { athleteId: 'slower' }), km('2026-09-14', 5300, { athleteId: 'slower' }),
        km('2026-09-14', 6000, { athleteId: 'once' }),
      ],
      protocol: '30min',
      today: TODAY,
    });
    const { improved, same, regressed, noDelta } = registry.summary;
    expect([improved, same, regressed, noDelta]).toEqual([1, 1, 1, 1]);
    expect(improved + same + regressed + noDelta).toBe(registry.rows.length);
  });

  it('tells a thrown-out test apart from never having tested at all', () => {
    const registry = buildRegistry({
      athletes: [{ id: 'thrown', name: 'Thrown' }, { id: 'absent', name: 'Absent' }],
      tests: [km('2026-09-14', 6000, { athleteId: 'thrown', excludedReason: 'שעון איבד קליטה' })],
      protocol: '30min',
      today: TODAY,
    });
    const thrown = registry.rows.find(r => r.athleteId === 'thrown')!;
    const absent = registry.rows.find(r => r.athleteId === 'absent')!;
    // Both have no usable test — that part has to stay true, or the queue would mark
    // someone current on a measurement we refused to use.
    expect(thrown.lastTestDate).toBeNull();
    expect(absent.lastTestDate).toBeNull();
    // But the screen must not tell the coach nobody recorded the test he recorded.
    expect(thrown.excludedCount).toBe(1);
    expect(absent.excludedCount).toBe(0);
  });
});

describe('protocolShape', () => {
  it('knows which half each protocol fixes, so the form asks for the measurement only', () => {
    expect(protocolShape('30min')).toEqual({ fixed: 'duration', value: 1800 });
    expect(protocolShape('2000m')).toEqual({ fixed: 'distance', value: 2000 });
  });

  it('leaves an unlisted protocol with no fixed half rather than guessing one', () => {
    // The club can invent a protocol, and inferring "probably a distance" from the label
    // would silently fix the wrong number at whatever value the parse produced.
    expect(protocolShape('hill-repeats')).toBeNull();
  });
});

describe('paceLooksImplausible', () => {
  it('catches the two units slips that would poison every workout in a plan', () => {
    // 6.42 typed into a metres field: 1800 / 0.00642 km. Off by a thousand.
    expect(paceLooksImplausible(thresholdPaceSec({ durationSec: 1800, distanceM: 6.42 }))).toBe(true);
    // 30 typed into a seconds field for a 30-minute test: 30 / 6.42 km, absurdly fast.
    expect(paceLooksImplausible(thresholdPaceSec({ durationSec: 30, distanceM: 6420 }))).toBe(true);
  });

  it('accepts the whole range of paces real club members produce', () => {
    // A fast 30-minute test and a slow one. Neither may be flagged: a warning that fires on
    // ordinary entries is a warning the coach stops reading, and then it protects nothing.
    expect(paceLooksImplausible(thresholdPaceSec({ durationSec: 1800, distanceM: 9000 }))).toBe(false);
    expect(paceLooksImplausible(thresholdPaceSec({ durationSec: 1800, distanceM: 4000 }))).toBe(false);
  });

  it('does not call a missing measurement implausible', () => {
    // Nothing typed yet is not a mistake, and warning about it would put a red note under
    // an empty field the moment the form opens.
    expect(paceLooksImplausible(null)).toBe(false);
  });
});

describe('daysBetween', () => {
  it('counts whole days across a DST boundary, because Israel changes clocks mid-season', () => {
    // 2026: IDT ends in late October. A trend spanning it must not lose or gain a day.
    expect(daysBetween('2026-10-01', '2026-11-01')).toBe(31);
    expect(daysBetween('2026-09-18', '2026-09-18')).toBe(0);
  });
});
