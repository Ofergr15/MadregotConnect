/**
 * Reverse-engineer a training plan from what was actually run.
 *
 * Laps are the coach's intent leaking through the watch: button presses and
 * auto-laps mark the step boundaries, repeated lap pairs are the interval
 * set, the slow tail is the cooldown. We collapse repeats with `groupLaps`,
 * classify each block by pace relative to the whole run, and emit the same
 * `PlannedWorkout` shape the prompt editor produces — so the result can be
 * rendered as a Garmin clipboard and edited further with a prompt.
 */

import type { StravaLap } from '@/lib/strava/client';
import { groupLaps, type LapBlock, type LapStepSummary } from './lap-groups';
import type { PlannedWorkout, WorkoutSegment, WorkoutSegmentKind } from './mock-workout';

export interface LapsWorkoutActivity {
  id?: string;
  activity_name?: string | null;
  distance?: number | null;
  duration?: number | null;
  moving_duration?: number | null;
}

type Measure = { durationSec?: number; distanceM?: number };

const LABELS: Record<WorkoutSegmentKind, string> = {
  warmup: 'Warm Up',
  interval: 'Run',
  recovery: 'Recover',
  cooldown: 'Cool Down',
  easy: 'Run',
  rest: 'Rest',
  repeat: 'Repeat',
};

/** Laps shorter than this are watch noise (the 0:02 "stop" lap), not steps. */
const MIN_LAP_SEC = 10;
/** Slower than this is walking regardless of the run's average. */
const WALK_PACE_SEC = 540;
/** Relative to the run's average pace. */
const RECOVERY_RATIO = 1.35;
const STEADY_RATIO = 0.97;

function isNear(value: number, target: number, tolerance: number): boolean {
  return Math.abs(value - target) <= tolerance;
}

function roundDurationOrNull(sec: number): number | null {
  if (sec >= 60) {
    const minutes = Math.round(sec / 60) * 60;
    if (isNear(sec, minutes, Math.max(2, sec * 0.02))) return minutes;
  }
  // Half-minutes (2:30, 7:30) and ten-second steps (0:40) are only plausible
  // prescriptions for short efforts; a 10:20 lap is not a "10:20 step".
  if (sec >= 20 && sec < 600) {
    const halves = Math.round(sec / 30) * 30;
    if (isNear(sec, halves, 2)) return halves;
  }
  if (sec >= 20 && sec < 120) {
    const tens = Math.round(sec / 10) * 10;
    if (isNear(sec, tens, 1)) return tens;
  }
  return null;
}

function roundDistanceOrNull(m: number): number | null {
  if (m >= 950) {
    // Over a kilometre only whole/half kilometres count as prescribed
    // distances; 2.33 km is a 10-minute lap, not a "2.3 km" step.
    const km = Math.round(m / 1000) * 1000;
    if (isNear(m, km, m * 0.02)) return km;
    const halfKm = Math.round(m / 500) * 500;
    if (isNear(m, halfKm, m * 0.015)) return halfKm;
    return null;
  }
  if (m >= 180) {
    const hundreds = Math.round(m / 100) * 100;
    if (isNear(m, hundreds, Math.max(6, m * 0.03))) return hundreds;
  }
  return null;
}

/** Pick the unit the coach most likely prescribed: a round time or a round distance. */
export function measureFor(durationSec: number, distanceM: number): Measure {
  const roundDuration = roundDurationOrNull(durationSec);
  const roundDistance = roundDistanceOrNull(distanceM);
  if (roundDistance && !roundDuration) return { distanceM: roundDistance };
  if (roundDuration && !roundDistance) return { durationSec: roundDuration };
  if (roundDistance && roundDuration) {
    // Both look round (e.g. 1 km in exactly 5:00): distance is the more
    // common prescription for anything over a few hundred metres.
    return roundDistance >= 400 ? { distanceM: roundDistance } : { durationSec: roundDuration };
  }
  if (distanceM >= 1000) return { distanceM: Math.round(distanceM / 100) * 100 };
  return { durationSec: Math.max(10, Math.round(durationSec / 10) * 10) };
}

export function formatMeasure(measure: Measure): string {
  if (measure.distanceM) {
    return measure.distanceM >= 1000
      ? `${(measure.distanceM / 1000).toFixed(measure.distanceM % 1000 ? 1 : 0)} km`
      : `${measure.distanceM} m`;
  }
  const sec = measure.durationSec || 0;
  if (sec % 60 === 0) return `${sec / 60} min`;
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

export function formatMeasureHe(measure: Measure): string {
  if (measure.distanceM) {
    return measure.distanceM >= 1000
      ? `${(measure.distanceM / 1000).toFixed(measure.distanceM % 1000 ? 1 : 0)} ק״מ`
      : `${measure.distanceM} מ׳`;
  }
  const sec = measure.durationSec || 0;
  if (sec % 60 === 0) return `${sec / 60} דק׳`;
  return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

function roundPace(paceSecPerKm: number): number {
  return Math.round(paceSecPerKm / 5) * 5;
}

export function formatPaceSec(paceSecPerKm: number): string {
  const minutes = Math.floor(paceSecPerKm / 60);
  const seconds = Math.round(paceSecPerKm % 60);
  return `${minutes}:${String(seconds).padStart(2, '0')}`;
}

function paceOf(lap: Pick<StravaLap, 'distance' | 'moving_time'>): number | null {
  if (lap.distance > 0 && lap.moving_time > 0) return lap.moving_time / (lap.distance / 1000);
  return null;
}

function segment(
  kind: WorkoutSegmentKind,
  measure: Measure,
  extra: { targetPaceSec?: number; note?: string } = {},
): WorkoutSegment {
  const details = [formatMeasure(measure)];
  if (extra.targetPaceSec) details.push(`${formatPaceSec(extra.targetPaceSec)}/km`);
  else if (extra.note) details.push(extra.note);
  return {
    kind,
    label: LABELS[kind],
    detail: details.join(', '),
    ...measure,
    ...(extra.targetPaceSec ? { targetPaceSec: extra.targetPaceSec } : {}),
    ...(extra.note ? { note: extra.note } : {}),
  };
}

function recoveryNote(paceSecPerKm: number | null): string {
  return paceSecPerKm != null && paceSecPerKm >= WALK_PACE_SEC ? 'הליכה' : 'קל';
}

function addMeasures(a: Measure, b: Measure): Measure {
  if (a.distanceM && b.distanceM) return { distanceM: a.distanceM + b.distanceM };
  if (a.durationSec && b.durationSec) return { durationSec: a.durationSec + b.durationSec };
  return a;
}

function stepSegment(step: LapStepSummary, role: 'interval' | 'recovery'): WorkoutSegment {
  const measure = measureFor(step.durationSec, step.distanceM);
  if (role === 'interval') {
    return segment('interval', measure, {
      targetPaceSec: step.paceSecPerKm ? roundPace(step.paceSecPerKm) : undefined,
    });
  }
  return segment('recovery', measure, { note: recoveryNote(step.paceSecPerKm) });
}

function repeatSegment(block: Extract<LapBlock, { kind: 'repeat' }>): WorkoutSegment {
  const fastest = block.steps.reduce((best, step) =>
    (step.paceSecPerKm ?? Infinity) < (best.paceSecPerKm ?? Infinity) ? step : best,
  );
  const steps = block.steps.map((step) =>
    stepSegment(step, step === fastest ? 'interval' : 'recovery'),
  );
  return {
    kind: 'repeat',
    label: LABELS.repeat,
    detail: `${block.reps} Times`,
    reps: block.reps,
    steps,
  };
}

export function workoutFromLaps(
  activity: LapsWorkoutActivity,
  rawLaps: StravaLap[] | null | undefined,
): PlannedWorkout | null {
  const laps = (rawLaps || []).filter(
    (lap) => lap && lap.moving_time >= MIN_LAP_SEC && lap.distance > 0,
  );
  if (laps.length < 2) return null;

  const totalTime = laps.reduce((sum, lap) => sum + lap.moving_time, 0);
  const totalDistance = laps.reduce((sum, lap) => sum + lap.distance, 0);
  const avgPace = totalTime / (totalDistance / 1000);

  // No real pace changes means a steady run, even if the auto-laps repeat.
  const paces = laps.map(paceOf).filter((p): p is number => p != null);
  const spread = Math.max(...paces) / Math.min(...paces);
  if (spread < 1.12) {
    const km = Math.round(totalDistance / 100) / 10;
    return {
      title: `ריצה ${km} ק״מ`,
      prompt: `${km} ק״מ בקצב ${formatPaceSec(roundPace(avgPace))}`,
      source: { matchMethod: 'laps', activityId: activity.id },
      segments: [
        segment('easy', { distanceM: Math.round(totalDistance / 100) * 100 }, {
          targetPaceSec: roundPace(avgPace),
        }),
      ],
    };
  }

  const blocks = groupLaps(laps);
  const firstWorkIndex = blocks.findIndex((block) => {
    if (block.kind === 'repeat') return true;
    const pace = paceOf(block.lap);
    return pace != null && pace < avgPace * STEADY_RATIO;
  });
  let lastWorkIndex = -1;
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    const block = blocks[i];
    const isWork =
      block.kind === 'repeat' ||
      (paceOf(block.lap) ?? Infinity) < avgPace * STEADY_RATIO;
    if (isWork) {
      lastWorkIndex = i;
      break;
    }
  }

  const segments: WorkoutSegment[] = [];
  blocks.forEach((block, index) => {
    if (block.kind === 'repeat') {
      segments.push(repeatSegment(block));
      return;
    }
    const { lap } = block;
    const pace = paceOf(lap);
    const measure = measureFor(lap.moving_time, lap.distance);
    let kind: WorkoutSegmentKind;
    if (pace != null && (pace >= WALK_PACE_SEC || pace >= avgPace * RECOVERY_RATIO)) {
      kind = firstWorkIndex === -1 || index < firstWorkIndex ? 'warmup' : index > lastWorkIndex ? 'cooldown' : 'recovery';
    } else if (firstWorkIndex === -1 || index < firstWorkIndex) {
      kind = 'warmup';
    } else if (index > lastWorkIndex) {
      kind = 'cooldown';
    } else {
      kind = 'interval';
    }

    const previous = segments[segments.length - 1];
    if ((kind === 'warmup' || kind === 'cooldown') && previous?.kind === kind) {
      const merged = addMeasures(
        { durationSec: previous.durationSec, distanceM: previous.distanceM },
        measure,
      );
      segments[segments.length - 1] = segment(kind, merged);
      return;
    }

    if (kind === 'interval') {
      segments.push(segment('interval', measure, { targetPaceSec: pace ? roundPace(pace) : undefined }));
    } else if (kind === 'recovery') {
      segments.push(segment('recovery', measure, { note: recoveryNote(pace) }));
    } else {
      segments.push(segment(kind, measure));
    }
  });

  if (!segments.length) return null;

  return {
    title: titleFor(segments, totalDistance),
    prompt: promptFromSegments(segments),
    source: { matchMethod: 'laps', activityId: activity.id },
    segments,
  };
}

function titleFor(segments: WorkoutSegment[], totalDistance: number): string {
  const repeat = segments.find((s) => s.kind === 'repeat');
  const work = repeat?.steps?.find((s) => s.kind === 'interval');
  if (repeat && work) {
    return `${repeat.reps}×${formatMeasure({ durationSec: work.durationSec, distanceM: work.distanceM })}`;
  }
  const intervals = segments.filter((s) => s.kind === 'interval');
  if (intervals.length > 1) return `${intervals.length} קטעי קצב`;
  return `ריצה ${Math.round(totalDistance / 100) / 10} ק״מ`;
}

function measureOf(step: WorkoutSegment): Measure {
  return { durationSec: step.durationSec, distanceM: step.distanceM };
}

/** Coach shorthand in Hebrew — the text shown on the plan card and editable with a prompt. */
export function promptFromSegments(segments: WorkoutSegment[]): string {
  const parts = segments.map((s) => {
    switch (s.kind) {
      case 'warmup':
        return `${formatMeasureHe(measureOf(s))} חימום`;
      case 'cooldown':
        return `${formatMeasureHe(measureOf(s))} שחרור`;
      case 'recovery':
      case 'rest':
        return `${formatMeasureHe(measureOf(s))} ${s.note || 'קל'}`;
      case 'repeat': {
        const inner = (s.steps || []).map((step) =>
          step.kind === 'interval'
            ? `${formatMeasureHe(measureOf(step))}${step.targetPaceSec ? ` בקצב ${formatPaceSec(step.targetPaceSec)}` : ''}`
            : `${formatMeasureHe(measureOf(step))} ${step.note || 'קל'}`,
        );
        return `${s.reps}×(${inner.join(' / ')})`;
      }
      default:
        return `${formatMeasureHe(measureOf(s))}${s.targetPaceSec ? ` בקצב ${formatPaceSec(s.targetPaceSec)}` : ''}`;
    }
  });
  return parts.join(' + ');
}
