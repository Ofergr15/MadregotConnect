'use client';

import { ParsedWorkout, WorkoutStep } from '@/lib/ai/types';
import { formatPace } from '@/lib/garmin/pace';
import { cn } from '@/lib/utils';

const stepColors: Record<string, string> = {
  warmup: 'bg-blue-500',
  cooldown: 'bg-blue-400',
  interval: 'bg-red-500',
  active: 'bg-orange-500',
  rest: 'bg-green-500',
  recovery: 'bg-green-400',
};

const stepLabels: Record<string, string> = {
  warmup: 'Warm Up',
  cooldown: 'Cool Down',
  interval: 'Interval',
  active: 'Active',
  rest: 'Rest',
  recovery: 'Recovery',
};

function formatDuration(step: WorkoutStep): string {
  if (step.durationType === 'distance' && step.durationValue) {
    return step.durationValue >= 1000
      ? `${(step.durationValue / 1000).toFixed(1)}km`
      : `${step.durationValue}m`;
  }
  if (step.durationType === 'time' && step.durationValue) {
    if (step.durationValue >= 60) {
      const mins = Math.floor(step.durationValue / 60);
      const secs = step.durationValue % 60;
      return secs > 0 ? `${mins}:${secs.toString().padStart(2, '0')}` : `${mins}min`;
    }
    return `${step.durationValue}s`;
  }
  return 'Open';
}

function formatTarget(step: WorkoutStep): string {
  if (step.targetType === 'no_target') return '';
  if (step.targetPaceMinPerKm && step.targetPaceMaxPerKm) {
    return `${formatPace(step.targetPaceMinPerKm)}-${formatPace(step.targetPaceMaxPerKm)}/km`;
  }
  if (step.targetZone) return step.targetZone;
  return '';
}

function StepRow({ step }: { step: WorkoutStep }) {
  if (step.repeatCount && step.repeatSteps) {
    return (
      <div className="border-l-2 border-slate-600 ml-2 pl-3 my-1">
        <div className="text-xs text-slate-400 mb-1">{step.repeatCount}x repeat</div>
        {step.repeatSteps.map((s, i) => (
          <StepRow key={i} step={s} />
        ))}
      </div>
    );
  }

  return (
    <div className="flex items-center gap-2 py-1">
      <div className={cn('w-2 h-2 rounded-full', stepColors[step.type] || 'bg-gray-500')} />
      <span className="text-xs text-slate-400 w-16">{stepLabels[step.type] || step.type}</span>
      <span className="text-sm font-medium">{formatDuration(step)}</span>
      {formatTarget(step) && (
        <span className="text-xs text-primary-400 ml-auto">@{formatTarget(step)}</span>
      )}
    </div>
  );
}

export function WorkoutPreview({ workout }: { workout: ParsedWorkout }) {
  return (
    <div className="card">
      <h3 className="font-semibold text-sm mb-2">{workout.name}</h3>
      {workout.description && (
        <p className="text-xs text-slate-400 mb-2">{workout.description}</p>
      )}
      <div className="space-y-0.5">
        {workout.steps.map((step, i) => (
          <StepRow key={i} step={step} />
        ))}
      </div>
    </div>
  );
}
