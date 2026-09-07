import { ParsedWorkout } from '../ai/types';
import { DEFAULT_TOLERANCES, PaceStatus, assessPace } from './adherence';
import { Lap, PlannedSegment, flattenPlannedSteps } from './segments';
import type { ActivityStream } from '../garmin/streams';

/**
 * Grading a plan against the run that was actually done, block by block.
 *
 * The bug this exists to kill: `assessWorkout` can only ever see ONE number for the
 * run — `average_pace` — and a plan is not one number. The published Sunday session
 * was "2 km easy, 20 km at 4:25, 8×15 s strides". Five of the seven athletes who ran
 * it were told they were slower than target at 4:33 (the whole-run average, warm-up
 * and walk breaks included) while the 20 km they were actually asked to run at 4:25
 * came out at 4:23. The pace was never wrong; the question was.
 *
 * `computeGradedPaceBand` tried to protect against this by refusing to grade unless
 * one band covers ≥90% of the plan — but 20 km of 22 km IS 90.9%, so the session
 * slipped through and the remaining 9% was enough to move the average 10 s/km. The
 * coverage rule cannot be tightened into correctness: any warm-up at all biases an
 * average, and refusing to grade whenever there's a warm-up means never grading.
 *
 * So stop averaging. A plan lays out blocks along the distance axis, and an activity
 * that carries a distance/time trace can be asked about a RANGE of that axis. Which
 * range? Not a fixed offset — an athlete who warms up for 2.4 km instead of 2.0 km
 * did not miss the session. So each block is located by SEARCHING for the window of
 * the planned length that best fits the planned band, forward of the previous block.
 * Same philosophy as `findPlannedEfforts`: look for the work, don't demand it appear
 * at a predicted offset.
 *
 * Evidence comes from either source, and the coarse one is enough far more often
 * than expected:
 *  - `activity_streams.series` — ~1 Hz, places a boundary within a few metres.
 *  - `athlete_activities.laps` — the watch's own markers. Even plain 1 km auto-laps
 *    resolve a 20 km block to within a kilometre, which is well inside the accuracy
 *    that matters for a pace verdict, and laps need no migration to read.
 *
 * Units throughout: distance METRES, duration SECONDS, pace SECONDS PER KM.
 */

// ── The evidence, from either source ────────────────────────────────────────

/**
 * A cumulative distance/time trace. `d` is monotonic non-decreasing (it stands
 * still through a walk break) and `t` non-decreasing — time spent moving, so it
 * stands still through a pause (see `movingTimeAxis`).
 */
export interface Trace {
  d: number[];
  t: number[];
  /** Typical distance between points — how precisely a window boundary can be
   *  placed. ~3 m from a stream, ~1000 m from plain auto-laps. Reported so a
   *  caller can say how much to trust a short block. */
  resolutionM: number;
  source: 'stream' | 'laps';
}

const median = (nums: number[]): number => {
  if (!nums.length) return 0;
  const sorted = [...nums].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};

/** A gap in the samples this long with the distance axis standing still is the watch
 *  stopped, not the athlete jogging slowly: 2 m in 5 s is 1.4 km/h, well under a walk.
 *  Both bounds are needed — a 5 s gap that covered ground is just a downsampled
 *  stretch, and a genuine standstill shorter than this moves no verdict. */
const PAUSE_MIN_SEC = 5;
const PAUSE_MAX_M = 2;

/**
 * Time spent moving, cumulative, with the watch's stops taken out.
 *
 * The raw stream's clock runs from the first sample to the last INCLUDING every
 * pause, while Garmin's own `duration` — the number on the athlete's wrist and in
 * `average_pace` — does not. On 2026-09-06's sixteen streamed runs the gap was 0 to
 * 882 s, and subtracting exactly these intervals reproduced Garmin's duration to
 * within a few seconds on fourteen of them.
 *
 * Left in, it is not a rounding error, it is wrong verdicts: three athletes stopped
 * at 22 km, between the block and the strides, for 97-228 s. That pause sits inside
 * the 20 km block's window, so the block came out 5-11 s/km slow — and two of them
 * were told they missed a 4:25 target their own lap press puts at 4:23.
 *
 * "Moving" and not "what the timer counted" is also the right question: the coach
 * asked for a running pace, so a red light is not part of it whether or not the watch
 * happened to auto-pause. That does mean a stop taken with the timer running makes
 * this trace slightly faster than `average_pace` — which is the honest answer to
 * "how fast were you running".
 */
function movingTimeAxis(d: number[], t: number[]): number[] {
  const out = [t[0]];
  let shift = 0;
  for (let i = 1; i < t.length; i++) {
    const dt = t[i] - t[i - 1];
    if (dt >= PAUSE_MIN_SEC && d[i] - d[i - 1] <= PAUSE_MAX_M) shift += dt;
    out.push(t[i] - shift);
  }
  return out;
}

export function traceFromStream(series: ActivityStream | null | undefined): Trace | null {
  if (!series || !Array.isArray(series.d) || series.d.length < 2) return null;
  const { d } = series;
  if (series.t.length !== d.length) return null;
  const t = movingTimeAxis(d, series.t);
  const gaps = d.slice(1).map((x, i) => x - d[i]).filter(g => g > 0);
  const resolutionM = Math.max(1, median(gaps));

  // The axis must start at the origin, because callers ask about metre 0 and
  // `timeArriving`/`timeLeaving` return null below `d[0]`. Garmin's first sample is
  // taken a moment after the start, so it sits at 1-3 m — and that silently cost a
  // verdict: the only windows that begin at exactly 0 are the ones the block search
  // has no slack for, i.e. a run that fell far short of the plan (`maxStart` clamps
  // to the cursor), and the truncated fallback that is supposed to rescue exactly
  // that case. Two of one Sunday's seventeen runs came back "not found" for every
  // block on a clean 1 Hz trace.
  //
  // Bounded by one sample's worth of distance so this stays a correction and not an
  // invention: a downsampled trace whose first sample lands 500 m in really does not
  // know what happened before it, and pretending otherwise would put 500 m in zero
  // seconds inside the first window. `t[0]` rather than 0 for the same reason —
  // duplicating the first timestamp reads as a standstill, which is honest, whereas
  // extrapolating backwards would invent a pace.
  if (d[0] > 0 && d[0] <= Math.max(resolutionM, 10)) {
    return { d: [0, ...d], t: [t[0], ...t], resolutionM, source: 'stream' };
  }
  return { d, t, resolutionM, source: 'stream' };
}

/**
 * Laps into a cumulative trace. Each lap contributes one point at its end, and a
 * leading zero starts the axis — so a 5-lap run gives 6 points, and pace inside a
 * lap is assumed constant (which is all a lap ever claimed).
 */
export function traceFromLaps(laps: Lap[] | null | undefined): Trace | null {
  if (!Array.isArray(laps) || laps.length < 1) return null;
  const d = [0];
  const t = [0];
  for (const lap of laps) {
    const dist = Number(lap?.distance) || 0;
    const dur = Number(lap?.duration) || 0;
    // A zero-duration lap is a double lap-press, and keeping it would give a
    // segment with distance and no time — an infinite speed inside the window.
    if (dur <= 0) continue;
    d.push(d[d.length - 1] + Math.max(0, dist));
    t.push(t[t.length - 1] + dur);
  }
  if (d.length < 2) return null;
  const gaps = d.slice(1).map((x, i) => x - d[i]).filter(g => g > 0);
  return { d, t, resolutionM: Math.max(1, median(gaps)), source: 'laps' };
}

/** Total metres the trace covers. */
export const traceDistance = (trace: Trace): number => trace.d[trace.d.length - 1];

/**
 * Elapsed time at the moment the athlete reached `metres` (`arriving`) or last left
 * it (`leaving`), interpolating inside the enclosing segment.
 *
 * The pair exists because distance stands still through a walk break: at a boundary
 * where the athlete stopped, `arriving` is when they got there and `leaving` is when
 * they set off again. Using `leaving` for a window's start and `arriving` for its end
 * keeps a stop that happened exactly on a boundary out of the window, while any stop
 * inside it still counts — which is the honest reading of "the block starts when
 * they left the 2 km mark".
 */
/** First index with `d[i] >= metres`, by bisection — `bestWindow` calls this once
 *  per candidate start over a ~5400-sample stream, so a linear scan here would make
 *  the search quadratic. */
function firstAtOrAfter(d: number[], metres: number): number {
  let lo = 0;
  let hi = d.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (d[mid] < metres) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

function timeArriving(trace: Trace, metres: number): number | null {
  const { d, t } = trace;
  if (metres < d[0] || metres > d[d.length - 1]) return null;
  const i = firstAtOrAfter(d, metres);
  if (i === 0 || d[i] === metres) return t[i];
  const span = d[i] - d[i - 1];
  return span > 0 ? t[i - 1] + ((metres - d[i - 1]) / span) * (t[i] - t[i - 1]) : t[i - 1];
}

function timeLeaving(trace: Trace, metres: number): number | null {
  const { d, t } = trace;
  if (metres < d[0] || metres > d[d.length - 1]) return null;
  // The LAST index at or below `metres`: walk forward off the bisection result
  // through any run of samples sharing this distance — that run is a standstill,
  // and its end is the moment the athlete set off again.
  let i = firstAtOrAfter(d, metres);
  if (d[i] > metres) i -= 1;
  else while (i + 1 < d.length && d[i + 1] === metres) i += 1;
  if (d[i] === metres) return t[i];
  const span = d[i + 1] - d[i];
  return span > 0 ? t[i] + ((metres - d[i]) / span) * (t[i + 1] - t[i]) : t[i];
}

/** Shortest window a pace verdict is worth giving. Below this, GPS noise and the
 *  placement of a lap boundary move the answer by more than the tolerance does. */
const MIN_WINDOW_M = 400;

/**
 * Average pace (s/km) over `[fromM, toM]` of the distance axis — time over
 * distance, never a mean of sample paces (that over-weights the slow samples and
 * would flatter every session with a walk break in it).
 */
export function paceOverWindow(trace: Trace, fromM: number, toM: number): number | null {
  if (!(toM - fromM >= MIN_WINDOW_M)) return null;
  const start = timeLeaving(trace, fromM);
  const end = timeArriving(trace, toM);
  if (start == null || end == null) return null;
  const seconds = end - start;
  if (seconds <= 0) return null;
  return Math.round(seconds / ((toM - fromM) / 1000));
}

/** How far outside the band a pace is, in s/km. 0 while inside it. */
const bandMiss = (pace: number, min: number, max: number): number =>
  pace < min ? min - pace : pace > max ? pace - max : 0;

export interface Window {
  startM: number;
  endM: number;
  pace: number;
  /** s/km outside the planned band; 0 when inside it. */
  miss: number;
  /** Gap in s/km between this window's first and second half. A block asked for at
   *  one pace was run as one continuous effort, so a low spread is evidence the
   *  window really is the block rather than a lucky average across its edge. */
  spread: number;
}

/**
 * How unlike itself the window is: |pace of first half − pace of second half|.
 *
 * This is what tells two equally-on-target windows apart. An athlete who warms up
 * for 3 km instead of 2 and then runs 20 km at 4:23 has TWO windows averaging 4:25
 * — the real block, and the one starting a kilometre early that swaps a kilometre of
 * 4:23 for a kilometre of warm-up. Both fit the band; only one is internally one
 * effort. 0 when the halves are too short to compare.
 */
function halfSpread(trace: Trace, fromM: number, toM: number): number {
  const mid = (fromM + toM) / 2;
  const first = paceOverWindow(trace, fromM, mid);
  const second = paceOverWindow(trace, mid, toM);
  if (first == null || second == null) return 0;
  return Math.abs(first - second);
}

/**
 * The window of `lengthM` metres, starting at or after `minStartM`, whose average
 * pace best fits `[paceMin, paceMax]`.
 *
 * Best FIT rather than fastest: a plan that says "8 km easy at 5:30" is not better
 * served by the quickest 8 km in the run. Among windows that fit equally well the
 * most self-consistent one wins (see `halfSpread`), and only then the earliest — so
 * a session run exactly as written is reported at the offsets it was written at, and
 * one run after a longer warm-up is reported where it actually happened.
 *
 * `minStartM`/`maxStartM` bound the search, and the upper bound is not optional
 * politeness — see `gradePlanBlocks`. Left unbounded, a 2 km warm-up prescribed at
 * 5:00–5:30 is "found" in the 2 km an athlete jogged home at 5:04, twenty-three
 * kilometres in, and the 20 km block that was the actual session then has no run
 * left to be graded over.
 *
 * Candidate starts are the trace's own points. On a stream that is every sample; on
 * 1 km auto-laps it is every kilometre, which is why `resolutionM` travels with the
 * result — a block located to ±1 km is still a fine pace verdict and a poor answer
 * to "where exactly did it start".
 */
export function bestWindow(
  trace: Trace,
  lengthM: number,
  paceMin: number,
  paceMax: number,
  minStartM = 0,
  maxStartM = Infinity,
): Window | null {
  if (lengthM < MIN_WINDOW_M) return null;
  const total = traceDistance(trace);
  if (minStartM + lengthM > total) return null;

  let best: Window | null = null;
  for (const start of trace.d) {
    if (start < minStartM) continue;
    if (start > maxStartM) break;
    const end = start + lengthM;
    if (end > total) break;
    const pace = paceOverWindow(trace, start, end);
    if (pace == null) continue;
    const miss = bandMiss(pace, paceMin, paceMax);
    // Don't pay for the spread of a window that already loses on fit.
    if (best && miss > best.miss) continue;
    const spread = halfSpread(trace, start, end);
    if (!best || miss < best.miss || spread < best.spread) {
      best = { startM: start, endM: end, pace, miss, spread };
    }
  }
  return best;
}

// ── Turning a plan into blocks ──────────────────────────────────────────────

/**
 * Shortest paced stretch graded as a block. Below it, a lap-based trace cannot
 * place the window (a 1 km auto-lap boundary is ±500 m on a 1 km block) and the
 * stretch is a rep anyway — `findPlannedEfforts` answers those, by counting them.
 */
const MIN_BLOCK_M = 1500;

/** A timed stretch this long is a steady block, not an effort to go looking for.
 *  Mirrors `MAX_TIMED_REP_SEC` in segments.ts from the other side. */
const MIN_BLOCK_SEC = 10 * 60;

/** How far past where the plan put it a block may be found: this many metres, or
 *  this fraction of the block, whichever is more. A kilometre covers the usual
 *  "warmed up a bit longer than asked"; the fraction lets a long block absorb the
 *  drift that accumulates ahead of it. */
const BLOCK_DRIFT_M = 1000;
const BLOCK_DRIFT_FRAC = 0.25;

export interface PlannedBlock {
  /** Index of the first planned segment folded into this block. */
  index: number;
  label: string;
  type: PlannedSegment['type'];
  /** Planned length in metres — the plan's own number for a distance step, or
   *  estimated through the target pace for a timed one. */
  lengthM: number;
  /** True when `lengthM` came from a duration rather than the plan's own metres,
   *  so the window length is itself an estimate. */
  lengthEstimated: boolean;
  paceMin: number;
  paceMax: number;
}

/**
 * The plan's paced blocks, in order, with consecutive same-band segments merged —
 * "5 km at 4:30" written as five 1 km steps is one 5 km block, and grading it as
 * five separate 1 km windows would reject each on `MIN_BLOCK_M` and answer nothing.
 */
export function plannedBlocks(planned: PlannedSegment[]): PlannedBlock[] {
  const out: PlannedBlock[] = [];
  /** Did something unpaced come between the last block and this segment? */
  let interrupted = false;

  for (const seg of planned) {
    // A rest, a recovery jog, or any stretch the plan set no pace for BREAKS the
    // chain. Merging across one is the difference between "5 km at 4:30" and
    // "5×(1 km at 4:30 with a jog between)": the second is not a 5 km block, and
    // grading it as one puts the recovery jogs inside the window. It graded the
    // program's 5×(5 min at 3:25) as a single 7.3 km block and reported 4:28.
    if (!seg.graded || !seg.paceMin) {
      interrupted = true;
      continue;
    }
    const paceMin = seg.paceMin;
    const paceMax = seg.paceMax || seg.paceMin;
    const mid = (paceMin + paceMax) / 2;

    const byDistance = !!(seg.distanceM && seg.distanceM > 0);
    const lengthM = byDistance
      ? seg.distanceM!
      : seg.durationSec && seg.durationSec > 0 && mid > 0
        ? Math.round((seg.durationSec * 1000) / mid)
        : 0;
    if (lengthM <= 0) continue;

    const last = out[out.length - 1];
    if (last && !interrupted && last.paceMin === paceMin && last.paceMax === paceMax) {
      last.lengthM += lengthM;
      last.lengthEstimated = last.lengthEstimated || !byDistance;
      continue;
    }
    out.push({
      index: seg.index,
      label: seg.label,
      type: seg.type,
      lengthM,
      lengthEstimated: !byDistance,
      paceMin,
      paceMax,
    });
    interrupted = false;
  }

  // Only now decide what's a block: the merge above is what turns five 1 km steps
  // into a gradable 5 km, so filtering before it would throw them away.
  //
  // A stretch the plan wrote in TIME is judged on time, not on the metres it was
  // estimated at. "6 min at 3:25" is 1756 m, which would clear MIN_BLOCK_M and be
  // graded as a continuous block — but it is a rep, and the rep finder counts it.
  // Whichever axis the plan used is the axis that decides.
  return out.filter(b => (b.lengthEstimated
    ? b.lengthM >= (MIN_BLOCK_SEC * 1000) / ((b.paceMin + b.paceMax) / 2)
    : b.lengthM >= MIN_BLOCK_M));
}

// ── The verdict ─────────────────────────────────────────────────────────────

export interface BlockVerdict {
  index: number;
  label: string;
  type: PlannedSegment['type'];
  plannedLengthM: number;
  plannedPaceMin: number;
  plannedPaceMax: number;
  /** Where in the run this block was found, and how it went. Null when the run
   *  had no room left for it. */
  window: Window | null;
  actualPace: number | null;
  status: PaceStatus;
  /** True when the run ran out before the block's planned length and the pace
   *  reported is over the shorter distance that was actually covered. */
  truncated: boolean;
}

export interface BlockReport {
  blocks: BlockVerdict[];
  gradedCount: number;
  onTargetCount: number;
  /** How precisely the windows could be placed — carried from the evidence. */
  resolutionM: number;
  source: 'stream' | 'laps';
  reason?: 'no_blocks' | 'no_trace';
}

/**
 * Grade each planned block over its own stretch of the run.
 *
 * Blocks are located in plan order — each searched forward of where the previous
 * one ended — so a progression run ("5 km at 4:40 then 5 km at 4:20") can't be
 * satisfied by finding the fast block twice, and the warm-up can't be located
 * inside the tempo.
 */
export function gradePlanBlocks(
  planned: PlannedSegment[],
  trace: Trace | null,
  paceSec = DEFAULT_TOLERANCES.paceSec,
): BlockReport {
  const blocks = plannedBlocks(planned);
  const base = {
    blocks: [] as BlockVerdict[],
    gradedCount: 0,
    onTargetCount: 0,
    resolutionM: trace?.resolutionM ?? 0,
    source: trace?.source ?? ('laps' as const),
  };
  if (!blocks.length) return { ...base, reason: 'no_blocks' };
  if (!trace) return { ...base, reason: 'no_trace' };

  const total = traceDistance(trace);
  const verdicts: BlockVerdict[] = [];
  let cursor = 0;
  /** Planned metres still to be placed after the block being handled. */
  let remaining = blocks.reduce((sum, b) => sum + b.lengthM, 0);

  for (const block of blocks) {
    remaining -= block.lengthM;
    // Two things bound how far a block may drift from where the plan put it.
    //
    // The blocks have to FIT, in order: a block placed so late that the ones after
    // it run off the end of the activity is placed wrong, whatever its pace looked
    // like. That alone is what stops a 2 km warm-up being located in the last 2 km
    // of the run.
    //
    // And drift is bounded even when there is room, because "the athlete warmed up
    // for an extra kilometre" is a plausible story and "the athlete warmed up eight
    // kilometres in" is not. The allowance is proportional to the block, so a 20 km
    // block tolerates the couple of kilometres a long warm-up moves it by while a
    // 2 km warm-up stays at the start.
    const slack = Math.max(BLOCK_DRIFT_M, block.lengthM * BLOCK_DRIFT_FRAC);
    const maxStart = Math.max(cursor, Math.min(cursor + slack, total - remaining - block.lengthM));

    // The band is widened by the tolerance so a block a second outside it is still
    // LOCATED here and reported as slightly slow, rather than the scan wandering to
    // a window that fits better and reporting the wrong stretch of the run.
    const found = bestWindow(
      trace, block.lengthM, block.paceMin - paceSec, block.paceMax + paceSec, cursor, maxStart);

    let window = found;
    let truncated = false;
    if (!window) {
      // The run ended before this block could fit. Grade what's left rather than
      // reporting nothing: a 20 km block that came out as 14 km at 4:23 is a far
      // more useful answer than 'unknown'.
      const remaining = total - cursor;
      if (remaining >= MIN_WINDOW_M) {
        const pace = paceOverWindow(trace, cursor, total);
        if (pace != null) {
          window = {
            startM: cursor,
            endM: total,
            pace,
            miss: bandMiss(pace, block.paceMin, block.paceMax),
            spread: halfSpread(trace, cursor, total),
          };
          truncated = true;
        }
      }
    }

    const actualPace = window?.pace ?? null;
    verdicts.push({
      index: block.index,
      label: block.label,
      type: block.type,
      plannedLengthM: block.lengthM,
      plannedPaceMin: block.paceMin,
      plannedPaceMax: block.paceMax,
      window,
      actualPace,
      status: assessPace(actualPace, block.paceMin, block.paceMax, paceSec),
      truncated,
    });
    if (window) cursor = window.endM;
  }

  const graded = verdicts.filter(v => v.status !== 'unknown');
  return {
    ...base,
    blocks: verdicts,
    gradedCount: graded.length,
    onTargetCount: graded.filter(v => v.status === 'on_target').length,
  };
}

/**
 * The one block a single pace verdict should be about — for a card with room for one
 * number, or a feed badge with room for a colour.
 *
 * Three exclusions, each from a false verdict this produced against production data:
 *
 *  - **Warm-ups and cool-downs.** Once the reps of an interval session stop being
 *    blocks, the only block left on that day is often the warm-up, and the coach
 *    writes those at the session's pace ("3 km at 4:40, then 5×5 min"). Eleven
 *    athletes on 2026-08-25 warmed up between 4:55 and 6:16 and would have been told
 *    they were slower than target — on the jog before the workout. The session's
 *    verdict is the rep check; the warm-up stays in `blocks` to be seen, not judged.
 *  - **Truncated blocks.** The pace over the 7 km an athlete managed of a 22 km
 *    block is a real number, but "did you hit the pace" and "did you run the session"
 *    are then the same question twice, and the distance verdict already answers it.
 *  - **Ungraded blocks**, which have nothing to say.
 *
 * Longest wins among what survives: that's the block the session was mostly about.
 */
export function dominantBlock(report: BlockReport): BlockVerdict | null {
  return report.blocks
    .filter(b => b.status !== 'unknown' && !b.truncated
      && b.type !== 'warmup' && b.type !== 'cooldown')
    .sort((a, b) => b.plannedLengthM - a.plannedLengthM)[0] || null;
}

/** Convenience: plan → blocks in one call, for callers holding a ParsedWorkout. */
export function gradeWorkoutBlocks(
  workout: ParsedWorkout,
  trace: Trace | null,
  paceSec = DEFAULT_TOLERANCES.paceSec,
): BlockReport {
  return gradePlanBlocks(flattenPlannedSteps(workout), trace, paceSec);
}
