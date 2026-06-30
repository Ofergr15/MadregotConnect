'use client';

import { useState } from 'react';
import { ParsedWorkout, WorkoutStep } from '@/lib/ai/types';
import { formatPace } from '@/lib/garmin/pace';
import { cn } from '@/lib/utils';
import { ChevronDown, ChevronUp, Timer, Route } from 'lucide-react';

const stepColors: Record<string, { dot: string; bg: string }> = {
  warmup: { dot: 'bg-yellow-400', bg: 'bg-yellow-400/10' },
  cooldown: { dot: 'bg-blue-400', bg: 'bg-blue-400/10' },
  interval: { dot: 'bg-red-400', bg: 'bg-red-400/10' },
  active: { dot: 'bg-purple-400', bg: 'bg-purple-400/10' },
  rest: { dot: 'bg-green-400', bg: 'bg-green-400/10' },
  recovery: { dot: 'bg-green-300', bg: 'bg-green-300/10' },
};

const workoutTypeColors: Record<string, string> = {
  intervals: 'border-l-red-400',
  long_run: 'border-l-purple-400',
  tempo: 'border-l-orange-400',
  fartlek: 'border-l-pink-400',
  progressive: 'border-l-teal-400',
  easy: 'border-l-blue-400',
  recovery: 'border-l-green-400',
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

function estimateDistance(steps: WorkoutStep[]): number {
  let total = 0;
  for (const step of steps) {
    if (step.repeatCount && step.repeatSteps) {
      total += estimateDistance(step.repeatSteps) * step.repeatCount;
    } else if (step.durationType === 'distance' && step.durationValue) {
      total += step.durationValue;
    }
  }
  return total;
}

function estimateTime(steps: WorkoutStep[]): number {
  let total = 0;
  for (const step of steps) {
    if (step.repeatCount && step.repeatSteps) {
      total += estimateTime(step.repeatSteps) * step.repeatCount;
    } else if (step.durationType === 'time' && step.durationValue) {
      total += step.durationValue;
    }
  }
  return total;
}

function StepLine({ step }: { step: WorkoutStep }) {
  const colors = stepColors[step.type] || { dot: 'bg-slate-400', bg: 'bg-slate-400/10' };

  if (step.repeatCount && step.repeatSteps) {
    return (
      <div className="flex items-center gap-1.5 py-0.5 min-w-0">
        <div className={cn('w-1.5 h-1.5 rounded-full shrink-0', stepColors['interval'].dot)} />
        <span className="text-[11px] text-slate-200 font-medium truncate">
          {step.repeatCount}x
        </span>
      </div>
    );
  }

  const target = fmtTarget(step);
  const note = step.notes && !target ? step.notes : '';
  return (
    <div className={cn('flex items-center gap-1.5 py-[3px] px-1.5 rounded min-w-0', colors.bg)}>
      <div className={cn('w-1.5 h-1.5 rounded-full shrink-0', colors.dot)} />
      <span className="text-[11px] text-slate-200 truncate flex-1 min-w-0 font-medium">
        {fmtDuration(step)}
      </span>
      {target && <span className="text-[10px] text-slate-400 shrink-0">{target}</span>}
      {note && <span className="text-[10px] text-slate-500 truncate">{note}</span>}
    </div>
  );
}

export function WorkoutPreview({ workout }: { workout: ParsedWorkout }) {
  const [expanded, setExpanded] = useState(false);
  const MAX_VISIBLE = 4;
  const steps = workout.steps;
  const hasMore = steps.length > MAX_VISIBLE;
  const visibleSteps = expanded ? steps : steps.slice(0, MAX_VISIBLE);

  const totalDist = estimateDistance(steps);
  const totalTime = estimateTime(steps);

  const nameLower = workout.name.toLowerCase();
  const inferredType = nameLower.includes('interval') || nameLower.includes('pyramid') ? 'intervals'
    : nameLower.includes('long') ? 'long_run'
    : nameLower.includes('tempo') ? 'tempo'
    : nameLower.includes('fartlek') ? 'fartlek'
    : nameLower.includes('progressive') ? 'progressive'
    : nameLower.includes('recovery') || nameLower.includes('easy') ? 'recovery'
    : 'easy';
  const typeColor = workoutTypeColors[inferredType] || 'border-l-slate-500';

  return (
    <div className={cn(
      'bg-slate-800/80 border border-slate-700/60 rounded-lg overflow-hidden border-l-[3px] transition-all hover:border-slate-600/80',
      typeColor
    )}>
      {/* Header */}
      <div className="px-3 pt-2.5 pb-1.5">
        <h3 className="font-semibold text-[12px] text-white leading-tight truncate">{workout.name}</h3>
        {workout.description && (
          <p className="text-[10px] text-slate-400 truncate mt-0.5">{workout.description}</p>
        )}
      </div>

      {/* Steps */}
      <div className="px-2.5 pb-2 space-y-[2px]">
        {visibleSteps.map((step, i) => (
          <StepLine key={i} step={step} />
        ))}
      </div>

      {hasMore && (
        <button
          onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
          className="flex items-center gap-0.5 text-[10px] text-primary-400 px-3 pb-2 hover:text-primary-300 font-medium"
        >
          {expanded ? (
            <><ChevronUp className="h-3 w-3" /> less</>
          ) : (
            <><ChevronDown className="h-3 w-3" /> +{steps.length - MAX_VISIBLE} more</>
          )}
        </button>
      )}

      {/* Footer with distance/time estimates */}
      {(totalDist > 0 || totalTime > 0) && (
        <div className="border-t border-slate-700/40 px-3 py-1.5 flex items-center gap-3 bg-slate-900/30">
          {totalDist > 0 && (
            <span className="flex items-center gap-1 text-[10px] text-slate-400">
              <Route className="h-2.5 w-2.5" />
              {totalDist >= 1000 ? `${(totalDist / 1000).toFixed(1)}km` : `${totalDist}m`}
            </span>
          )}
          {totalTime > 0 && (
            <span className="flex items-center gap-1 text-[10px] text-slate-400">
              <Timer className="h-2.5 w-2.5" />
              {totalTime >= 3600 ? `${Math.floor(totalTime / 3600)}h${Math.floor((totalTime % 3600) / 60)}m` : `${Math.floor(totalTime / 60)}m`}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
