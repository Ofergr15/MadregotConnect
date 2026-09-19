// What a test MEANS: thresholds, training paces, race predictions and a band.
//
// Funnel step 8 — `ניתוח הטסט`, the one the process map marks "חדש — כאן יש הרבה לקחת". Today a
// coach reads 6.42 km in 30 minutes off a watch and turns it into a threshold, five training
// paces, a band and a paragraph of Hebrew, by hand, per trainee, from a spreadsheet he
// maintains himself. None of that arithmetic is hard. What makes it expensive is that it is
// done fifteen times a season and that no two people would do it identically.
//
// Pure and Supabase-free, like every other decision lib in here, and for a sharper reason than
// usual: these numbers become pace-zone alerts on a watch. Anything that can be checked by a
// test rather than by reading a screen must be.
//
// ── EVERY COEFFICIENT BELOW IS A GUESS, EXCEPT ONE ──────────────────────────────────────
//
// The exception is Riegel's exponent (1.06), which is a published, forty-year-old, widely used
// endurance-prediction constant rather than something I picked. Everything else — what fraction
// of threshold an easy run is, what fraction an interval is — is a defensible textbook figure
// and NOT the club's own. Ofer maintains a table that answers all of it (1500 up to marathon,
// thresholds, HR percentages) and that table is what this file is meant to replace itself with.
// They are therefore all named constants in one block, not sprinkled through the arithmetic.
//
// ── AND THE THRESHOLD AGREES WITH THE REGISTRY BY CONSTRUCTION ──────────────────────────
//
// `thresholdPaceSec` in `tests.ts` already turns a test into a threshold — it is what the
// registry lists, what the trend plots and what the staleness clock is about. This file does
// NOT define a second, cleverer version of that number. A screen that says 4:52 above a
// registry row that says 4:40 for the same test is a screen nobody can act on, and "which one
// is my threshold" is not a question a coach should have to ask the app twice.
//
// The one place it departs is a protocol that is not about thirty minutes: a 2000m effort is
// roughly seven minutes long and its pace is nowhere near a threshold pace. That is corrected
// through Riegel, flagged on the result, and said on screen — rather than quietly reporting an
// interval pace as a threshold.

import {
  PLAUSIBLE_PACE_SEC,
  paceLooksImplausible,
  thresholdPaceSec,
  protocolShape,
  type TestRow,
} from './tests';
import type { AcademyBand } from './bands';

/**
 * Riegel's exponent. `t2 = t1 * (d2 / d1) ^ 1.06`.
 *
 * NOT a guess — Pete Riegel's 1977 endurance formula, still the standard way a race time at
 * one distance becomes a prediction at another. Its known limit is that it flatters long
 * extrapolations: predicting a marathon off a 30-minute test assumes a marathon's worth of
 * endurance the runner may not have built, which is exactly why the marathon row on this screen
 * is labelled a prediction and never a pace to train at.
 */
export const RIEGEL_EXPONENT = 1.06;

/**
 * The effort a threshold pace corresponds to, in seconds.
 *
 * Thirty minutes, because that is the club's own test and because the standard field estimate
 * is that the average pace of a 30-minute all-out effort IS approximately threshold pace. It is
 * written as a constant so the 2000m correction below has something to aim at instead of a
 * magic number.
 */
export const THRESHOLD_EFFORT_SEC = 1800;

/**
 * How far a protocol's duration may sit from thirty minutes before its pace gets corrected.
 *
 * A GUESS. 20% covers a 30-minute test that came in at 28 or 35 minutes — the same effort, a
 * stopwatch started late — while a 2000m at around seven minutes is plainly a different
 * physiology and gets adjusted. Correcting everything would mean a 29-minute test no longer
 * matches the registry row beside it for no gain at all.
 */
export const THRESHOLD_EFFORT_TOLERANCE = 0.2;

/**
 * Training paces as a multiple of threshold pace. All GUESSES, all replaceable by Ofer's table.
 *
 * `easy` at 1.21 puts a 4:40 threshold runner at about 5:39/km for an easy run, which is the
 * classic "conversational, 75–80% of threshold speed" range and deliberately SLOWER than most
 * trainees run easy days — the single most common fault in a self-coached runner's week, and
 * one this screen is well placed to name.
 *
 * `interval` at 0.90 is roughly 3–5K race pace: what a VO2max rep is run at. Faster than that
 * is not a training pace, it is a sprint, and 0.90 is deliberately conservative because this
 * number is what ends up as the alert on the watch for eight repetitions.
 */
export const PACE_MULTIPLE = {
  easy: 1.21,
  interval: 0.9,
} as const;

/** The distances the club's own table is kept in, metres. Predictions are reported for these. */
export const PREDICTED_DISTANCES_M = [1500, 5000, 10000, 21097, 42195] as const;

/** What a number on this screen came from. The screen prints it; see the mockup's `מקור` column. */
export type MetricSource =
  /** Read off the watch. Nothing was inferred. */
  | 'measured'
  /** One step of arithmetic from the measurement — the threshold itself. */
  | 'calculated'
  /** A coefficient was applied. A training pace, replaceable by the club's own table. */
  | 'derived'
  /** Riegel over a long extrapolation. Informative, never a pace to train at. */
  | 'predicted';

export interface RacePrediction {
  distanceM: number;
  /** Predicted finishing time, seconds. */
  sec: number;
  /** The pace it implies, sec/km — what makes the prediction checkable by eye. */
  paceSec: number;
}

export interface TestAnalysis {
  /** The threshold pace, sec/km. The same number the registry shows, except when adjusted. */
  thresholdPaceSec: number;
  /**
   * True when the protocol was too short or too long for its raw pace to be a threshold, so
   * Riegel moved it to a 30-minute equivalent. The screen must say so: this is the one row that
   * will not match the registry, and an unexplained mismatch reads as a bug.
   */
  thresholdAdjusted: boolean;
  /**
   * Average heart rate over the whole test, when the watch recorded one — NOT threshold HR.
   *
   * Migration 105 is explicit about why the column is not called that: the lab-free estimate of
   * threshold HR is the average of the LAST TWENTY MINUTES of a 30-minute effort, and this is
   * the average of all thirty, which is lower because the first ten include the ramp. No
   * correction is invented here. Two to five beats of made-up arithmetic would be written into
   * every HR-based workout this athlete ever gets, and the honest figure needs the HR stream
   * (migration 094), which is a later job.
   */
  avgHrBpm: number | null;
  easyPaceSec: number;
  intervalPaceSec: number;
  predictions: RacePrediction[];
  /**
   * The units slip, surfaced. `6.42` typed into a metres field is the failure `tests.ts`
   * already warns about, and this screen is where it would become somebody's training paces.
   */
  implausible: boolean;
}

/** `t2 = t1 * (d2 / d1) ^ 1.06`. Seconds in, seconds out. */
export function riegelSec(fromSec: number, fromM: number, toM: number): number {
  if (!(fromSec > 0) || !(fromM > 0) || !(toM > 0)) return 0;
  return fromSec * Math.pow(toM / fromM, RIEGEL_EXPONENT);
}

/** sec/km from a duration and a distance. */
function paceOf(sec: number, metres: number): number {
  return sec / (metres / 1000);
}

/**
 * The whole analysis of one test, or null when the row cannot produce one.
 *
 * Null rather than zeroes: a test with no distance is not a runner with a 0:00 threshold, and
 * every caller has something better to say than a table of dashes.
 */
export function analyzeTest(
  test: Pick<TestRow, 'protocol' | 'durationSec' | 'distanceM' | 'avgHr'>,
): TestAnalysis | null {
  const raw = thresholdPaceSec(test);
  if (raw === null || !Number.isFinite(raw) || raw <= 0) return null;

  // Is this protocol about a thirty-minute effort? The duration of the test itself answers it,
  // not the protocol label — a club-invented '4km' has no entry in PROTOCOL_SHAPE and still
  // takes whatever time it took.
  const off = Math.abs(test.durationSec - THRESHOLD_EFFORT_SEC) / THRESHOLD_EFFORT_SEC;
  const thresholdAdjusted = off > THRESHOLD_EFFORT_TOLERANCE;

  // Riegel to the distance this athlete would cover in thirty minutes, then the pace of that.
  // Slower than the raw pace for a short test and faster for a long one, which is the right
  // direction in both cases.
  const thresholdPace = thresholdAdjusted
    ? paceOf(THRESHOLD_EFFORT_SEC, equivalentDistanceM(test.durationSec, test.distanceM))
    : raw;

  return {
    thresholdPaceSec: Math.round(thresholdPace),
    thresholdAdjusted,
    avgHrBpm: typeof test.avgHr === 'number' && test.avgHr > 0 ? Math.round(test.avgHr) : null,
    easyPaceSec: Math.round(thresholdPace * PACE_MULTIPLE.easy),
    intervalPaceSec: Math.round(thresholdPace * PACE_MULTIPLE.interval),
    predictions: PREDICTED_DISTANCES_M.map(distanceM => {
      const sec = riegelSec(test.durationSec, test.distanceM, distanceM);
      return { distanceM, sec: Math.round(sec), paceSec: Math.round(paceOf(sec, distanceM)) };
    }),
    implausible: paceLooksImplausible(raw),
  };
}

/**
 * How far this athlete would run in thirty minutes, from what they actually ran.
 *
 * Riegel inverted: `d2 = d1 * (t2 / t1) ^ (1 / 1.06)`.
 */
export function equivalentDistanceM(durationSec: number, distanceM: number): number {
  if (!(durationSec > 0) || !(distanceM > 0)) return 0;
  return distanceM * Math.pow(THRESHOLD_EFFORT_SEC / durationSec, 1 / RIEGEL_EXPONENT);
}

/** Which of the five table rows a metric is, with where it came from. Used by the screen. */
export function sourceOf(metric: 'threshold' | 'hr' | 'easy' | 'interval' | 'prediction'): MetricSource {
  switch (metric) {
    case 'threshold': return 'calculated';
    case 'hr': return 'measured';
    case 'prediction': return 'predicted';
    default: return 'derived';
  }
}

// ── THE BAND RECOMMENDATION ───────────────────────────────────────────────────────────────
//
// "הניתוח נותן את האינדיקציה מי הוא" — of everything on this screen, the band is the decision
// the process actually turns on, because the band is what prices every workout the trainee will
// ever receive.
//
// And it is BLOCKED ON DATA, not on code. A band's `pace_profile` (migration 077) holds
// `offsetSeconds` and a marathon goal; nothing in it says which threshold paces belong to which
// band, and nobody has set the offsets either. So the honest behaviour is to say so, by name,
// rather than to invent a mapping — a recommendation derived from a rule I made up would be
// indistinguishable on screen from one derived from the club's own experience, and a coach would
// have no way to know which they were looking at.
//
// `thresholdPaceSec` on a band's pace profile is the field that unblocks it, and it needs no
// migration: pace_profile is JSONB. The moment the club writes its bands' threshold ranges in,
// this function starts answering.

/** Why there is no recommendation. Each one is a different thing for the screen to say. */
export type NoBandReason =
  /** No band has a threshold pace recorded, so there is nothing to compare against. */
  | 'bands_have_no_paces'
  /** There are no bands at all — a setup gap, like an empty roster. */
  | 'no_bands';

export interface BandRecommendation {
  band: AcademyBand | null;
  reason: NoBandReason | null;
  /** How far the trainee's threshold sits from the recommended band's own, sec/km. */
  gapSec: number | null;
}

/**
 * The nearest band by threshold pace, or an explanation.
 *
 * Nearest rather than "the first band the pace falls inside", because ranges written by hand
 * leave gaps: a runner at 4:47 between a band ending at 4:45 and one starting at 4:50 must not
 * produce "no recommendation", which is the answer that sends a coach back to the spreadsheet.
 */
export function recommendBand(
  thresholdPaceSecValue: number | null,
  bands: readonly AcademyBand[],
): BandRecommendation {
  if (bands.length === 0) return { band: null, reason: 'no_bands', gapSec: null };
  const withPace = bands.filter(b => typeof b.paceProfile?.thresholdPaceSec === 'number');
  if (withPace.length === 0 || thresholdPaceSecValue === null) {
    return { band: null, reason: 'bands_have_no_paces', gapSec: null };
  }

  let best = withPace[0];
  let bestGap = Math.abs((best.paceProfile.thresholdPaceSec as number) - thresholdPaceSecValue);
  for (const band of withPace.slice(1)) {
    const gap = Math.abs((band.paceProfile.thresholdPaceSec as number) - thresholdPaceSecValue);
    // Strictly closer, so an exact tie keeps the FASTER band's position in the caller's own
    // ordering rather than depending on iteration luck.
    if (gap < bestGap) { best = band; bestGap = gap; }
  }
  return { band: best, reason: null, gapSec: Math.round(bestGap) };
}

// ── WHAT THE TRAINEE IS TOLD ──────────────────────────────────────────────────────────────
//
// The mockup writes the draft summary as a quote, and its content is worth reading twice:
// "you ran 6.42 km at 4:40 with a high heart rate the whole way — good aerobic base, but you
// opened too fast. Your paces are set, and the first two weeks we will keep easy."
//
// Three things in one paragraph: what happened, what it says about them, what happens next. A
// template cannot write the middle one — that is the coach's read of the person — so this
// function writes the parts that are arithmetic and leaves the judgement to the coach, who edits
// this text before it is sent. A draft that pretends to be the whole thing is worse than no
// draft: it gets approved unread.

/** Hebrew `m:ss` for a pace, LTR-safe at the call site. */
function mmss(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return `${m}:${String(s).padStart(2, '0')}`;
}

/**
 * The opening of the summary: the facts, in the trainee's own units.
 *
 * Deliberately ends mid-thought, with the coach's sentence still to write. The alternative is a
 * paragraph that reads finished and says nothing, which is how a personal summary becomes a
 * form letter the trainee stops reading.
 */
export function draftSummary(
  test: Pick<TestRow, 'durationSec' | 'distanceM' | 'avgHr'>,
  analysis: TestAnalysis,
  previous?: { paceSec: number } | null,
): string {
  const km = (test.distanceM / 1000).toFixed(2);
  const pace = mmss(Math.round(paceOf(test.durationSec, test.distanceM)));
  const minutes = Math.round(test.durationSec / 60);

  const parts = [`רצת ${km} ק"מ ב-${minutes} דקות, בקצב ממוצע של ${pace} לק"מ`];
  if (analysis.avgHrBpm !== null) parts.push(`עם דופק ממוצע ${analysis.avgHrBpm}`);

  // The comparison only when there is something to compare with, and only in the direction the
  // numbers support. A pace is better when the number is SMALLER, which is the sign error this
  // sentence exists to not make.
  let trend = '';
  if (previous && Number.isFinite(previous.paceSec)) {
    const diff = Math.round(previous.paceSec - paceOf(test.durationSec, test.distanceM));
    if (diff > 0) trend = ` זה ${diff} שניות לק"מ מהר יותר מהטסט הקודם שלך.`;
    else if (diff < 0) trend = ` זה ${Math.abs(diff)} שניות לק"מ אטי יותר מהטסט הקודם שלך.`;
    else trend = ' זה בדיוק אותו קצב כמו בטסט הקודם שלך.';
  }

  return `${parts.join(' ')}.${trend} מכאן נגזרו הקצבים שלך: סף ${mmss(analysis.thresholdPaceSec)}, `
    + `ריצה קלה ${mmss(analysis.easyPaceSec)}, אינטרוולים ${mmss(analysis.intervalPaceSec)}.`;
}

/** The plausibility range, re-exported so the analysis screen warns in the registry's words. */
export { PLAUSIBLE_PACE_SEC, protocolShape };
