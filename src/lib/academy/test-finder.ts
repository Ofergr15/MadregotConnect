// "למשוך מהשעון" (mockup academy-existing-trainees, phone 3): the runs already synced from
// the watch that look like a test, so a trainee who tested months ago on a notebook page gets
// their threshold from the run itself instead of from memory.
//
// Pure. GET /api/academy/tests/watch reads the last six months of runs and hands them here.
//
// Two ways a run looks like a test, and both are needed:
//
//  1. **By name.** The club calls it "טסט" and so do the trainees: "טסט 30 דק׳", "test".
//     A named run of 25-40 minutes IS the test (the distance scaled to exactly 30:00 when the
//     watch stopped a few seconds either side). A longer named run — a warm-up, the test, a
//     jog home — is searched with the laps rule below for the 30 minutes inside it. A named
//     run that is ~2000 m, or whose name says 2000 and that has a ~2000 m lap, is a 2000 m
//     candidate.
//
//  2. **By laps.** A test nobody named is 30 continuous, hard minutes: consecutive laps that
//     add up to 28-32 minutes, no lap in them more than `CONTINUOUS_SPREAD` slower than the
//     stretch (a recovery jog breaks it — that is intervals, not a test), and the stretch at
//     least `HARD_MARGIN` faster than this athlete's own median run. The fastest such stretch
//     in a run is the run's candidate. A tempo run passes this, and that is right: a coach who
//     knows Shahar ran 30 minutes at 4:21 on 06.07 can take it as his test, and the screen
//     says plainly what it found ("30 דקות רצופות בתוך ריצה של 10 ק״מ").
//
// A run without laps (a Strava-only run that was never enriched, a manual entry) can only
// match by name: there is nothing inside it to search. Counted and said, never silently
// dropped — "no test found" about a trainee whose runs have no laps would be false.
//
// Ranked: named first, then how much faster than their median the stretch was, then newest.
// At most `MAX_CANDIDATES`.

import { normalizeStoredLaps, type StoredLap } from '@/lib/garmin/laps';
import { activityLocalDateStr } from '@/lib/utils';
import { isRunType, shiftDate } from './load';
import type { EntryProtocol } from './test-entry';

/** Six months: older than this the test no longer describes the runner. */
export const WINDOW_DAYS = 183;
export const MAX_CANDIDATES = 3;
/** The laps rule: a stretch of 28-32 minutes is "30 minutes". */
export const SEGMENT_MIN_SEC = 28 * 60;
export const SEGMENT_MAX_SEC = 32 * 60;
/** A whole named run of 25-40 minutes is the test itself. */
export const NAMED_MIN_SEC = 25 * 60;
export const NAMED_MAX_SEC = 40 * 60;
/** No lap inside the stretch may be more than 12% slower than the stretch: no recovery jog. */
export const CONTINUOUS_SPREAD = 0.12;
/** "Hard": at least 6% faster than the athlete's median run pace. */
export const HARD_MARGIN = 0.06;
/** A 2000 m in metres, as a lap or a run: 1950-2100 (GPS and the lap press). */
export const TWO_K = { min: 1950, max: 2100 };

const TEST_NAME = /(טסט|\btest\b)/i;
/** "טסט 2000", "2k test", "2 ק״מ": the name says which protocol. */
const TWO_K_NAME = /(2000|\b2\s?k\b|2\s?ק)/i;

export function looksNamedTest(name: string | null | undefined): boolean {
  return !!name && TEST_NAME.test(name);
}

export interface FinderActivity {
  id: string;
  start_time: string;
  activity_name?: string | null;
  activity_type?: string | null;
  source?: string | null;
  distance?: number | null;
  duration?: number | null;
  moving_duration?: number | null;
  average_hr?: number | null;
  laps?: unknown;
}

export type CandidateKind = 'named' | 'namedSegment' | 'segment';

export interface TestCandidate {
  activityId: string;
  /** The athlete's own calendar day, `YYYY-MM-DD`. */
  date: string;
  name: string;
  kind: CandidateKind;
  protocol: EntryProtocol;
  /** The stored row's halves: 1800 s and the distance at 30:00, or 2000 m and its time. */
  durationSec: number;
  distanceM: number;
  /** The average HR of the stretch (laps), or of the run. Null when the watch had none. */
  avgHr: number | null;
  paceSec: number;
  /** The whole run, for "30 דקות רצופות בתוך ריצה של 10 ק״מ". */
  runDistanceM: number;
  /** The test is part of a longer run. */
  insideLonger: boolean;
  /** How much faster than the athlete's median run, 0.08 = 8%. Null without a median. */
  hardness: number | null;
}

export interface FinderResult {
  candidates: TestCandidate[];
  /** Runs looked at in the window. */
  scanned: number;
  /** Runs in the window with no laps, so only a name can match them. */
  noLaps: number;
  /** Of those, the ones that came from Strava. */
  stravaNoLaps: number;
  /** Why nothing was found, when nothing was: the screen's Hebrew line. */
  emptyReason: 'noRuns' | 'noLaps' | 'none' | null;
}

const runSec = (a: FinderActivity) => Number(a.moving_duration) > 0 ? Number(a.moving_duration) : Number(a.duration) || 0;

const median = (xs: number[]) => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length ? (s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) : null;
};

/** Laps with a real distance, the order the watch recorded them. */
function usableLaps(raw: unknown): StoredLap[] {
  return normalizeStoredLaps(raw).filter(l => l.distance > 0 && l.duration > 0);
}

export interface Stretch {
  from: number;
  to: number;
  durationSec: number;
  distanceM: number;
  avgHr: number | null;
  paceSec: number;
}

/**
 * The fastest continuous 28-32 minute stretch of consecutive laps, or null. Continuous: no lap
 * in it more than `CONTINUOUS_SPREAD` slower than the stretch as a whole.
 */
export function bestStretch(laps: StoredLap[]): Stretch | null {
  let best: Stretch | null = null;
  for (let i = 0; i < laps.length; i++) {
    let sec = 0;
    let dist = 0;
    for (let j = i; j < laps.length; j++) {
      sec += laps[j].duration;
      dist += laps[j].distance;
      if (sec > SEGMENT_MAX_SEC) break;
      if (sec < SEGMENT_MIN_SEC) continue;
      const pace = sec / (dist / 1000);
      const slice = laps.slice(i, j + 1);
      const continuous = slice.every(l => l.duration / (l.distance / 1000) <= pace * (1 + CONTINUOUS_SPREAD));
      if (!continuous) continue;
      if (!best || pace < best.paceSec) {
        const hrs = slice.filter(l => Number(l.averageHR) > 0);
        const hrSec = hrs.reduce((s, l) => s + l.duration, 0);
        const avgHr = hrSec > 0 ? Math.round(hrs.reduce((s, l) => s + Number(l.averageHR) * l.duration, 0) / hrSec) : null;
        best = { from: i, to: j, durationSec: sec, distanceM: dist, avgHr, paceSec: pace };
      }
    }
  }
  return best;
}

/** The distance a stretch of `sec` seconds would have covered in exactly 30:00, at its pace. */
const at30 = (distanceM: number, sec: number) => Math.round(distanceM * (1800 / sec));

/**
 * The runs that look like a test, best first, and why there are none when there are none.
 * `today` is the Israel calendar day; runs older than `WINDOW_DAYS` are not looked at.
 */
export function findTestRuns(activities: FinderActivity[], today: string): FinderResult {
  const from = shiftDate(today, -WINDOW_DAYS);
  const runs = activities.filter((a) => {
    if (!isRunType(a.activity_type)) return false;
    const d = activityLocalDateStr(a.start_time);
    return d >= from && d <= today && runSec(a) > 0 && Number(a.distance) > 0;
  });
  const paces = runs.map(a => runSec(a) / (Number(a.distance) / 1000)).filter(p => p > 0 && Number.isFinite(p));
  const usual = median(paces);
  const hardnessOf = (pace: number) => (usual ? (usual - pace) / usual : null);

  let noLaps = 0;
  let stravaNoLaps = 0;
  const out: TestCandidate[] = [];
  for (const a of runs) {
    const laps = usableLaps(a.laps);
    if (!laps.length) {
      noLaps += 1;
      if ((a.source ?? '') === 'strava') stravaNoLaps += 1;
    }
    const named = looksNamedTest(a.activity_name);
    const sec = runSec(a);
    const dist = Number(a.distance);
    const base = {
      activityId: String(a.id),
      date: activityLocalDateStr(a.start_time),
      name: String(a.activity_name || ''),
      runDistanceM: Math.round(dist),
    };
    const runHr = Number(a.average_hr) > 0 ? Math.round(Number(a.average_hr)) : null;

    if (named) {
      // A 2000 m: the run itself is ~2000 m, or the name says 2000 and one lap is. A 2 km
      // warm-up lap inside an ordinary "טסט" is not one — hence the name, not just the lap.
      const runIs2k = dist >= TWO_K.min && dist <= TWO_K.max;
      const twoKLap = runIs2k
        ? { duration: sec, distance: dist, averageHR: runHr }
        : TWO_K_NAME.test(String(a.activity_name))
          ? laps.filter(l => l.distance >= TWO_K.min && l.distance <= TWO_K.max)
            .sort((x, y) => x.duration / x.distance - y.duration / y.distance)[0] ?? null
          : null;
      if (twoKLap) {
        const durationSec = Math.round(twoKLap.duration * (2000 / twoKLap.distance));
        out.push({
          ...base, kind: 'named', protocol: '2000m', durationSec, distanceM: 2000,
          avgHr: Number(twoKLap.averageHR) > 0 ? Math.round(Number(twoKLap.averageHR)) : runHr,
          paceSec: durationSec / 2, insideLonger: dist > TWO_K.max, hardness: hardnessOf(durationSec / 2),
        });
        continue;
      }
      if (sec >= NAMED_MIN_SEC && sec <= NAMED_MAX_SEC) {
        const distanceM = at30(dist, sec);
        out.push({
          ...base, kind: 'named', protocol: '30min', durationSec: 1800, distanceM, avgHr: runHr,
          paceSec: 1800 / (distanceM / 1000), insideLonger: false, hardness: hardnessOf(1800 / (distanceM / 1000)),
        });
        continue;
      }
    }

    // The laps rule: named-but-longer, or not named at all.
    const s = laps.length ? bestStretch(laps) : null;
    if (!s) continue;
    const hardness = hardnessOf(s.paceSec);
    if (!named && !(hardness !== null && hardness >= HARD_MARGIN)) continue;
    const distanceM = at30(s.distanceM, s.durationSec);
    out.push({
      ...base,
      kind: named ? 'namedSegment' : 'segment',
      protocol: '30min',
      durationSec: 1800,
      distanceM,
      avgHr: s.avgHr ?? runHr,
      paceSec: 1800 / (distanceM / 1000),
      insideLonger: s.from > 0 || s.to < laps.length - 1,
      hardness,
    });
  }

  const rank = (c: TestCandidate) => (c.kind === 'segment' ? 0 : 1);
  out.sort((x, y) => rank(y) - rank(x)
    || (y.hardness ?? -1) - (x.hardness ?? -1)
    || y.date.localeCompare(x.date));
  const candidates = out.slice(0, MAX_CANDIDATES);

  const emptyReason = candidates.length ? null
    : runs.length === 0 ? 'noRuns'
      : noLaps === runs.length ? 'noLaps'
        : 'none';
  return { candidates, scanned: runs.length, noLaps, stravaNoLaps, emptyReason };
}

/**
 * "Also save the older ones as past tests": the candidates of the same protocol older than the
 * chosen one, oldest first, one per day (the table holds one test per day and protocol).
 */
export function olderTests(candidates: TestCandidate[], chosenId: string): TestCandidate[] {
  const chosen = candidates.find(c => c.activityId === chosenId);
  if (!chosen) return [];
  const seen = new Set<string>([chosen.date]);
  return candidates
    .filter(c => c.protocol === chosen.protocol && c.date < chosen.date)
    .sort((a, b) => a.date.localeCompare(b.date))
    .filter((c) => (seen.has(c.date) ? false : (seen.add(c.date), true)));
}
