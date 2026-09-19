/**
 * The academy's tests, the threshold pace they produce, and the improvement trend.
 *
 * Ofer's own words on why this exists: "it would be very cool to have an improvement
 * graph; that is something very hard to do by hand unless you have two or three
 * trainees." The data already arrives — the club runs a fixed test at intake and every
 * couple of months after it. Nothing here is hard except that the numbers sit in a
 * spreadsheet nobody plots.
 *
 * Four decisions in this file carry the honesty of the whole screen, and each is easier
 * to get wrong than right:
 *
 *  1. **A trend never crosses protocols.** A 2000m is run faster than a 30-minute effort
 *     at identical fitness. Plotting both on one line makes the day the club switched
 *     protocol look like a breakthrough, and the day it switched back look like an
 *     injury. Series are built per protocol, and the caller must choose one.
 *
 *  2. **Faster is a smaller number.** Every delta here is reported as a DIRECTION as well
 *     as a signed number, for the reason the plan-vs-execution verdict was rebuilt: a
 *     screen that renders `-6` and lets the reader work out which way that is will be
 *     read backwards by someone, and being told you got slower when you got faster is
 *     the kind of wrong that ends a coaching relationship.
 *
 *  3. **Small differences are not improvement.** A 30-minute time trial is run on a real
 *     road in real wind and measured by a GPS watch; a couple of seconds per kilometre is
 *     noise. Calling it progress teaches the trainee to read noise as signal, and worse,
 *     teaches the coach to. See `MEANINGFUL_SEC_PER_KM`.
 *
 *  4. **An excluded test does not reset the clock.** See `latestUsable`.
 *
 * Pure and dependency-free, so all four are testable without a database or a clock.
 */

/** A row of `academy_tests` (migration 105), as far as this cares. */
export interface TestRow {
  id: string;
  athleteId: string;
  /** `YYYY-MM-DD`, the athlete's own calendar day. */
  date: string;
  /** '30min' | '2000m' | whatever the club labels it. Never compared across. */
  protocol: string;
  durationSec: number;
  distanceM: number;
  avgHr?: number | null;
  /** Non-null means this test is out of the trend, and says why. */
  excludedReason?: string | null;
}

/**
 * The threshold pace a test produces, in seconds per kilometre.
 *
 * One line of arithmetic for every protocol, which is the entire reason migration 105
 * stores both a distance and a duration rather than one column per test type.
 *
 * The reading that "the average pace of a 30-minute all-out effort is approximately
 * threshold pace" is the standard field estimate, and it is an ESTIMATE — the club is
 * not putting anyone on a lab treadmill. It is stated here rather than buried so nobody
 * later mistakes this number for a measured lactate threshold.
 */
export function thresholdPaceSec(test: Pick<TestRow, 'durationSec' | 'distanceM'>): number | null {
  if (!(test.durationSec > 0) || !(test.distanceM > 0)) return null;
  return test.durationSec / (test.distanceM / 1000);
}

/**
 * What a protocol holds fixed, and therefore which half of the row is the measurement.
 *
 * A 30-minute test fixes the clock and measures the distance; a 2000m fixes the distance
 * and measures the clock. Both are stored, always, because the threshold is one division
 * either way — but only ONE of them is a thing a person types in, and a form that asks for
 * both invites the failure migration 105's header warns about: a test whose pace cannot be
 * trusted because the wrong field was filled in. `PROTOCOL_SHAPE` is what lets the entry
 * form state the fixed half as a fact and ask only for the measured one.
 *
 * An unlisted protocol is legitimate — the club can invent one — and simply has no fixed
 * half, so the form asks for both. Nothing else in this file branches on protocol.
 */
export interface ProtocolShape {
  fixed: 'duration' | 'distance';
  /** Seconds when `fixed` is duration, metres when it is distance. */
  value: number;
}

export const PROTOCOL_SHAPE: Record<string, ProtocolShape> = {
  '30min': { fixed: 'duration', value: 1800 },
  '2000m': { fixed: 'distance', value: 2000 },
  '5000m': { fixed: 'distance', value: 5000 },
};

export function protocolShape(protocol: string): ProtocolShape | null {
  return PROTOCOL_SHAPE[protocol] ?? null;
}

/**
 * The range of threshold paces a running human actually produces, in sec/km.
 *
 * 2:30/km is faster than the world record pace for 10,000m and 12:00/km is a walk, so a
 * number outside this is not a fast or slow athlete — it is a units mistake, and there are
 * two waiting in every entry form: a distance typed in kilometres into a metres field
 * (6.42 for 6420), and a duration typed in minutes into a seconds field (30 for 1800).
 * Either one produces a pace off by a factor of a thousand or sixty.
 *
 * A WARNING and never a block. The club may one day test a walker, someone returning from
 * surgery, or a protocol I have not thought of, and a form that refuses the number leaves
 * the coach with no way to record what happened — which is how data ends up back in Excel.
 * The point is only that a slip is caught before it is plotted, because a bad test does not
 * just look wrong on one graph: it becomes the threshold that prices every workout in that
 * athlete's plan.
 */
export const PLAUSIBLE_PACE_SEC = { fastest: 150, slowest: 720 };

export function paceLooksImplausible(paceSec: number | null): boolean {
  if (paceSec === null || !Number.isFinite(paceSec)) return false;
  return paceSec < PLAUSIBLE_PACE_SEC.fastest || paceSec > PLAUSIBLE_PACE_SEC.slowest;
}

/**
 * How much faster or slower counts as a real change, in seconds per kilometre.
 *
 * A GUESS, flagged as one like `SILENT_DAYS` and the ±10 s/km tolerance before it, and
 * kept in one place for the same reason. Five seconds per km over a 30-minute effort is
 * roughly the spread you get from wind, a different course, and GPS distance error alone,
 * so anything inside it is reported as unchanged rather than as progress. Ofer's number
 * replaces this one; the club has run enough tests to know its own noise floor better
 * than I can guess it.
 */
export const MEANINGFUL_SEC_PER_KM = 5;

/**
 * How long a test stays current, in days.
 *
 * The mockup's own line is "4 trainees have not tested in over four months — without a
 * test there is no threshold update, and their plans are running on old data", so 120
 * days is his number rather than mine. It is the age at which the paces in a plan stop
 * describing the runner executing it.
 */
export const STALE_TEST_DAYS = 120;

export type Direction = 'improved' | 'regressed' | 'same';

/**
 * Which way a pace moved, given that a smaller number is faster.
 *
 * Returns a direction and never a bare sign, so no screen has to remember the inversion.
 */
export function directionOf(deltaSec: number | null, meaningful = MEANINGFUL_SEC_PER_KM): Direction | null {
  if (deltaSec === null || Number.isNaN(deltaSec)) return null;
  if (Math.abs(deltaSec) < meaningful) return 'same';
  return deltaSec < 0 ? 'improved' : 'regressed';
}

export interface TrendPoint {
  testId: string;
  date: string;
  protocol: string;
  distanceM: number;
  durationSec: number;
  /** sec/km. Null only if the row is unusable arithmetic, which the CHECKs forbid. */
  paceSec: number | null;
  avgHr: number | null;
  /**
   * sec/km against the PREVIOUS counted test. Negative is faster. Null on the first
   * point, which is a baseline and not a result — reporting the baseline as "no change"
   * would be a claim about a comparison that does not exist.
   */
  deltaPrevSec: number | null;
  /** sec/km against the FIRST counted test — what the headline number quotes. */
  deltaFirstSec: number | null;
  directionPrev: Direction | null;
  directionFirst: Direction | null;
}

export interface TrendSeries {
  protocol: string;
  /** Oldest first, which is the order a line is drawn in. */
  points: TrendPoint[];
  /** Total movement from first to last counted test. Negative is faster. */
  totalDeltaSec: number | null;
  totalDirection: Direction | null;
  /** Months covered, for the headline ("24 seconds in seven months"). */
  spanDays: number | null;
  /** Tests thrown out, kept so the screen can say so rather than silently dropping them. */
  excluded: { testId: string; date: string; reason: string }[];
}

/**
 * One athlete's trend for ONE protocol.
 *
 * Excluded tests are separated out rather than filtered away: a series that quietly
 * drops a test the coach knows he recorded looks like data loss, and the reason he
 * excluded it ("ran it with the flu") is exactly the context that makes the graph
 * readable six months later.
 */
export function buildTrend(tests: TestRow[], protocol: string): TrendSeries {
  const mine = tests.filter(t => t.protocol === protocol);
  const excluded = mine
    .filter(t => t.excludedReason)
    .map(t => ({ testId: t.id, date: t.date, reason: String(t.excludedReason) }))
    .sort((a, b) => a.date.localeCompare(b.date));

  const counted = mine
    .filter(t => !t.excludedReason)
    // Dates are `YYYY-MM-DD`, so a string compare is the correct chronological sort and
    // sidesteps the timezone question entirely.
    .sort((a, b) => a.date.localeCompare(b.date) || a.id.localeCompare(b.id));

  const first = counted.length ? thresholdPaceSec(counted[0]) : null;
  let previousPace: number | null = null;

  const points: TrendPoint[] = counted.map((test, i) => {
    const paceSec = thresholdPaceSec(test);
    const deltaPrevSec = paceSec !== null && previousPace !== null ? paceSec - previousPace : null;
    // Indexed rather than compared by identity: the baseline is "the first counted test",
    // and two tests can legitimately be equal by value.
    const deltaFirstSec = paceSec !== null && first !== null && i > 0 ? paceSec - first : null;
    if (paceSec !== null) previousPace = paceSec;
    return {
      testId: test.id,
      date: test.date,
      protocol: test.protocol,
      distanceM: test.distanceM,
      durationSec: test.durationSec,
      paceSec,
      avgHr: test.avgHr ?? null,
      deltaPrevSec,
      deltaFirstSec,
      directionPrev: directionOf(deltaPrevSec),
      directionFirst: directionOf(deltaFirstSec),
    };
  });

  const last = points.length ? points[points.length - 1] : null;
  const totalDeltaSec = points.length > 1 ? last!.deltaFirstSec : null;

  return {
    protocol,
    points,
    totalDeltaSec,
    totalDirection: directionOf(totalDeltaSec),
    spanDays: points.length > 1 ? daysBetween(points[0].date, last!.date) : null,
    excluded,
  };
}

/** Whole days from `from` to `to`, both `YYYY-MM-DD`. Negative if `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) return 0;
  return Math.round((b - a) / 86_400_000);
}

/**
 * The most recent test that produced a usable number.
 *
 * An excluded test is NOT one. The athlete did turn up and run, so it is tempting to let
 * it reset the "when did he last test" clock — but that clock exists to answer whether
 * the paces in his plan still describe him, and a test thrown out for a gale produced no
 * threshold at all. Letting it count would mark an athlete current on the strength of a
 * measurement we ourselves refused to use.
 */
export function latestUsable(tests: TestRow[], protocol?: string): TestRow | null {
  const usable = tests
    .filter(t => !t.excludedReason)
    .filter(t => !protocol || t.protocol === protocol)
    .sort((a, b) => b.date.localeCompare(a.date) || b.id.localeCompare(a.id));
  return usable[0] ?? null;
}

export interface RegistryAthlete {
  id: string;
  name: string;
  /** The goal band, for the per-band rollup. Null when unassigned. */
  bandNumber?: number | null;
}

export interface RegistryRow {
  athleteId: string;
  name: string;
  bandNumber: number | null;
  /** Null when they have never produced a usable test — the intake gap, not a regression. */
  lastTestDate: string | null;
  /**
   * The id of that last test, so the row can open its analysis.
   *
   * Carried here rather than fetched by the screen because the registry has already decided
   * WHICH test is this athlete's current one — newest, counted, right protocol — and a second
   * answer to that question is a screen analysing a test the row above it is not showing.
   */
  lastTestId: string | null;
  lastPaceSec: number | null;
  /** Against their previous counted test. Negative is faster. */
  deltaSec: number | null;
  direction: Direction | null;
  /** Days since the last usable test. Null when there has never been one. */
  ageDays: number | null;
  /**
   * Tests of this protocol that were thrown out.
   *
   * Carried so the screen can tell the two silences apart. An athlete who never turned up
   * and an athlete whose only test the coach threw out both have `lastTestDate === null`,
   * and reporting the second as "never recorded a test" is false to the person who
   * recorded it — the same overclaim as saying "no workout" about a workout Garmin
   * accepted and never confirmed.
   */
  excludedCount: number;
  /**
   * True when the plan's paces are running on data too old to describe this runner —
   * including the never-tested case, which is the most stale state there is.
   */
  overdue: boolean;
}

export interface RegistrySummary {
  improved: number;
  same: number;
  regressed: number;
  /**
   * Athletes with no direction to report — one test, or none.
   *
   * Exists so `improved + same + regressed + noDelta === rows.length`, always. Without it
   * the header counted four people above a list of seven and the other three appeared
   * nowhere in it: someone who tested once, recently, is in no bucket and is not overdue
   * either. A KPI row that does not add up to the list beneath it is the exact defect that
   * shipped on the dispatch screen, and it is only visible by reading the screen.
   */
  noDelta: number;
  /** Athletes whose paces are stale, never-tested included. */
  overdue: number;
  /** Of those, the ones who have never produced a usable test at all. */
  neverTested: number;
}

export interface BandRollup {
  bandNumber: number | null;
  athletes: number;
  /**
   * Mean of the per-athlete latest deltas, in sec/km, over athletes who HAVE a delta.
   * Negative is faster. Null when nobody in the band has two counted tests yet.
   */
  averageDeltaSec: number | null;
  direction: Direction | null;
}

export interface Registry {
  rows: RegistryRow[];
  summary: RegistrySummary;
  byBand: BandRollup[];
}

/**
 * The registry that replaces the spreadsheet: who tested, when, which way they moved,
 * and — the fact the spreadsheet will not volunteer — who is running on stale numbers.
 *
 * Ranked worst-first on the thing that needs doing: never tested, then longest overdue,
 * then everyone else by how recently they tested. Deliberately NOT ranked by who
 * regressed. A trainee getting slower is information for their coach and may be entirely
 * expected (a base block, a return from injury); an athlete whose threshold is four
 * months old is a plan being written against a runner who no longer exists, and that is
 * the club's own process failing rather than the athlete's training.
 */
export function buildRegistry({
  athletes,
  tests,
  protocol,
  today,
  staleAfterDays = STALE_TEST_DAYS,
}: {
  athletes: RegistryAthlete[];
  tests: TestRow[];
  /** Which protocol the registry is reporting on. Trends never cross protocols. */
  protocol: string;
  /** `YYYY-MM-DD`, the club's own calendar day. */
  today: string;
  staleAfterDays?: number;
}): Registry {
  const byAthlete = new Map<string, TestRow[]>();
  for (const test of tests) {
    if (test.protocol !== protocol) continue;
    const list = byAthlete.get(test.athleteId);
    if (list) list.push(test); else byAthlete.set(test.athleteId, [test]);
  }

  const rows: RegistryRow[] = athletes.map(athlete => {
    const trend = buildTrend(byAthlete.get(athlete.id) ?? [], protocol);
    const last = trend.points.length ? trend.points[trend.points.length - 1] : null;
    const ageDays = last ? daysBetween(last.date, today) : null;
    return {
      athleteId: athlete.id,
      name: athlete.name,
      bandNumber: athlete.bandNumber ?? null,
      lastTestDate: last?.date ?? null,
      lastTestId: last?.testId ?? null,
      lastPaceSec: last?.paceSec ?? null,
      deltaSec: last?.deltaPrevSec ?? null,
      direction: last?.directionPrev ?? null,
      ageDays,
      excludedCount: trend.excluded.length,
      // Never tested is overdue by definition: there is no threshold to have gone stale,
      // which is worse than a stale one and not better.
      overdue: ageDays === null || ageDays > staleAfterDays,
    };
  });

  rows.sort((a, b) => {
    const never = Number(b.lastTestDate === null) - Number(a.lastTestDate === null);
    if (never) return never;
    const overdue = Number(b.overdue) - Number(a.overdue);
    if (overdue) return overdue;
    // Oldest test first within each group — the longer it has been, the staler the plan.
    const age = (b.ageDays ?? 0) - (a.ageDays ?? 0);
    if (age) return age;
    return a.name.localeCompare(b.name);
  });

  const summary: RegistrySummary = {
    improved: rows.filter(r => r.direction === 'improved').length,
    same: rows.filter(r => r.direction === 'same').length,
    regressed: rows.filter(r => r.direction === 'regressed').length,
    noDelta: rows.filter(r => r.direction === null).length,
    overdue: rows.filter(r => r.overdue).length,
    neverTested: rows.filter(r => r.lastTestDate === null).length,
  };

  // Per band, which is the manager's question: is the method working, and does it work
  // the same at every level? Averaged over the athletes who HAVE a delta, so a band full
  // of first-timers reports "not yet" instead of a flattering zero.
  const bands = new Map<number | null, RegistryRow[]>();
  for (const row of rows) {
    const list = bands.get(row.bandNumber);
    if (list) list.push(row); else bands.set(row.bandNumber, [row]);
  }
  const byBand: BandRollup[] = [...bands.entries()]
    .map(([bandNumber, members]) => {
      const deltas = members.map(m => m.deltaSec).filter((d): d is number => d !== null);
      const averageDeltaSec = deltas.length
        ? deltas.reduce((sum, d) => sum + d, 0) / deltas.length
        : null;
      return {
        bandNumber,
        athletes: members.length,
        averageDeltaSec,
        direction: directionOf(averageDeltaSec),
      };
    })
    // Unassigned last; numbered bands in the order the club says them out loud.
    .sort((a, b) => {
      if (a.bandNumber === null) return 1;
      if (b.bandNumber === null) return -1;
      return a.bandNumber - b.bandNumber;
    });

  return { rows, summary, byBand };
}
