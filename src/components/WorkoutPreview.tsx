'use client';

import { useState } from 'react';
import { ParsedWorkout, WorkoutStep } from '@/lib/ai/types';
import { formatPace } from '@/lib/garmin/pace';
import { cn } from '@/lib/utils';
import { ChevronDown, ChevronUp } from 'lucide-react';

const stepDot: Record<string, string> = {
  warmup: 'bg-yellow-400',
  cooldown: 'bg-blue-400',
  interval: 'bg-red-400',
  active: 'bg-purple-400',
  rest: 'bg-green-400',
  recovery: 'bg-green-300',
};

function fmtDuration(step: WorkoutStep): string {
  if (step.durationType === 'distance' && step.durationValue) {
    return step.durationValue >= 1000
      ? `${(step.durationValue / 1000).toFixed(step.durationValue % 1000 === 0 ? 0 : 1)}km`
      : `${step.durationValue}m`;
  }
  if (step.durationType === 'time' && step.durationValue) {
    if (step.durationValue >= 3600) {
      const h = Math.floor(step.durationValue / 3600);
      const m = Math.floor((step.durationValue % 3600) / 60);
      return m > 0 ? `${h}h${m}m` : `${h}h`;
    }
    if (step.durationValue >= 60) {
      const mins = Math.floor(step.durationValue / 60);
      const secs = step.durationValue % 60;
      return secs > 0 ? `${mins}:${secs.toString().padStart(2, '0')}` : `${mins}m`;
    }
    return `${step.durationValue}s`;
  }
  return 'Open';
}

function fmtTarget(step: WorkoutStep): string {
  if (step.targetType === 'no_target') return '';
  if (step.targetPaceMinPerKm && step.targetPaceMaxPerKm) {
    return `${formatPace(step.targetPaceMinPerKm)}-${formatPace(step.targetPaceMaxPerKm)}`;
  }
  if (step.targetZone) return step.targetZone;
  return '';
}

function StepLine({ step }: { step: WorkoutStep }) {
  if (step.repeatCount && step.repeatSteps) {
    return (
      <div className="flex items-center gap-1.5 py-0.5 min-w-0">
        <div className={cn('w-1.5 h-1.5 rounded-full shrink-0', stepDot['interval'])} />
        <span className="text-[11px] text-slate-300 truncate">
          {step.repeatCount}x
        </span>
      </div>
    );
  }

  const target = fmtTarget(step);
  return (
    <div className="flex items-center gap-1.5 py-0.5 min-w-0">
      <div className={cn('w-1.5 h-1.5 rounded-full shrink-0', stepDot[step.type] || 'bg-slate-400')} />
      <span className="text-[11px] text-slate-300 truncate flex-1 min-w-0">
        {fmtDuration(step)}
        {target && <span className="text-slate-500"> {target}</span>}
      </span>
    </div>
  );
}

export function WorkoutPreview({ workout }: { workout: ParsedWorkout }) {
  const [expanded, setExpanded] = useState(false);
  const MAX_VISIBLE = 3;
  const steps = workout.steps;
  const hasMore = steps.length > MAX_VISIBLE;
  const visibleSteps = expanded ? steps : steps.slice(0, MAX_VISIBLE);

  return (
    <div className="bg-slate-800 border border-slate-700 rounded-lg p-2.5 overflow-hidden">
      <h3 className="font-medium text-[11px] text-white truncate mb-1">{workout.name}</h3>
      {workout.description && (
        <p className="text-[10px] text-slate-500 truncate mb-1">{workout.description}</p>
      )}
      <div className="space-y-0 overflow-hidden">
        {visibleSteps.map((step, i) => (
          <StepLine key={i} step={step} />
        ))}
      </div>
      {hasMore && (
        <button
          onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
          className="flex items-center gap-0.5 text-[10px] text-primary-400 mt-1 hover:text-primary-300"
        >
          {expanded ? (
            <><ChevronUp className="h-3 w-3" /> less</>
          ) : (
            <><ChevronDown className="h-3 w-3" /> +{steps.length - MAX_VISIBLE} more</>
          )}
        </button>
      )}
    </div>
  );
}
