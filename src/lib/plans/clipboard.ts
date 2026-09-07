import type { ParsedWorkout, WorkoutStep } from '@/lib/ai/types';
import type {
  PlannedWorkout,
  WorkoutSegment,
  WorkoutSegmentKind,
} from '@/lib/run-chat/mock-workout';
import { getWorkoutKm } from '@/lib/plans/workout-parsing';
import { isEstimate, type EstimateOptions } from '@/lib/plans/step-estimate';

const LABELS: Record<WorkoutStep['type'], string> = {
  warmup: 'Warm Up',
  interval: 'Run',
  rest: 'Rest',
  recovery: 'Recover',
  cooldown: 'Cool Down',
  active: 'Run',
};

function pace(seconds: number): string {
  const rounded = Math.round(seconds);
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')}`;
}

function clock(seconds: number): string {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  const rest = seconds % 60;
  if (hours) return `${hours}:${String(minutes).padStart(2, '0')}:${String(rest).padStart(2, '0')}`;
  return `${minutes}:${String(rest).padStart(2, '0')}`;
}

function durationText(step: WorkoutStep): string {
  if (step.durationType === 'distance' && step.durationValue) {
    if (step.durationValue >= 1000) {
      const km = step.durationValue / 1000;
      return `${Number.isInteger(km) ? km : km.toFixed(1)} km`;
    }
    return `${step.durationValue} m`;
  }
  if (step.durationType === 'time' && step.durationValue) {
    // The RANGE where the step has one. This line is what the athlete's board
    // prints, and it is the whole reason the import restores collapsed ranges:
    // a 40–50 minute run reached sixty phones as "40:00". Whole minutes get the
    // short form ("40-50 min"), because "40:00-50:00" is a stopwatch reading of
    // something the coach wrote as two numbers.
    const max = step.durationMaxValue;
    if (max && max > step.durationValue) {
      return step.durationValue % 60 === 0 && max % 60 === 0
        ? `${step.durationValue / 60}-${max / 60} min`
        : `${clock(step.durationValue)}-${clock(max)}`;
    }
    return clock(step.durationValue);
  }
  return 'Lap Button Press';
}

function targetText(step: WorkoutStep): string {
  if (step.targetType === 'pace' && step.targetPaceMinPerKm) {
    const min = pace(step.targetPaceMinPerKm);
    const max = step.targetPaceMaxPerKm ? pace(step.targetPaceMaxPerKm) : min;
    return min === max ? min : `${min}-${max}`;
  }
  if (step.targetType === 'heart_rate' && step.targetHrMinPct) {
    const max = step.targetHrMaxPct || step.targetHrMinPct;
    return step.targetHrMinPct === max
      ? `${step.targetHrMinPct}% HR`
      : `${step.targetHrMinPct}-${max}% HR`;
  }
  return step.targetZone || '';
}

function detailText(step: WorkoutStep): string {
  return [durationText(step), targetText(step), step.notes]
    .map((part) => part?.trim())
    .filter((part, index, parts) => Boolean(part) && parts.indexOf(part) === index)
    .join(', ');
}

function segmentKind(type: WorkoutStep['type']): WorkoutSegmentKind {
  return type === 'active' ? 'easy' : type;
}

function stepToSegment(step: WorkoutStep): WorkoutSegment {
  if (step.repeatCount && step.repeatSteps?.length) {
    return {
      kind: 'repeat',
      label: 'Repeat',
      detail: `${step.repeatCount} Times`,
      reps: step.repeatCount,
      note: step.notes,
      steps: step.repeatSteps.map(stepToSegment),
    };
  }
  return {
    kind: segmentKind(step.type),
    label: LABELS[step.type],
    detail: detailText(step),
    distanceM: step.durationType === 'distance' ? step.durationValue : undefined,
    durationSec: step.durationType === 'time' ? step.durationValue : undefined,
    targetPaceSec: step.targetPaceMinPerKm,
    note: step.notes,
  };
}

export function workoutToClipboardText(workout: ParsedWorkout): string {
  const part =
    workout.partCount && workout.partCount > 1
      ? `חלק ${workout.partIndex || 1} מתוך ${workout.partCount}`
      : null;
  const lines = [
    `📋 ${workout.name}`,
    part,
    workout.description,
  ].filter(Boolean) as string[];

  workout.steps.forEach((step, index) => {
    if (step.repeatCount && step.repeatSteps?.length) {
      lines.push(`${index + 1}. Repeat — ${step.repeatCount} Times${step.notes ? `, ${step.notes}` : ''}`);
      step.repeatSteps.forEach((sub) => {
        lines.push(`   • ${LABELS[sub.type]} — ${detailText(sub)}`);
      });
      return;
    }
    lines.push(`${index + 1}. ${LABELS[step.type]} — ${detailText(step)}`);
  });

  return lines.join('\n');
}

/**
 * `opts` carries the plan-wide pace band (`planEstimateOptions`) when the caller
 * has the whole week to hand: a session written only in minutes is priced off
 * the easy pace THIS plan states, not a default. Without it the derivation still
 * works, just more coarsely.
 */
export function parsedWorkoutToClipboard(workout: ParsedWorkout, opts?: EstimateOptions): PlannedWorkout {
  const km = getWorkoutKm(workout, opts);
  return {
    title: workout.name,
    prompt: workout.clipboardText || workoutToClipboardText(workout),
    segments: workout.steps.map(stepToSegment),
    // `from: 'none'` means the session says nothing about distance and nothing
    // about time either — a drills or strength evening. No line rather than 0.
    distanceKm:
      km.from === 'none' || km.max <= 0
        ? undefined
        : { min: km.min, max: km.max, estimated: isEstimate(km.from) },
  };
}

export function withClipboardText(workout: ParsedWorkout): ParsedWorkout {
  return { ...workout, clipboardText: workoutToClipboardText(workout) };
}
