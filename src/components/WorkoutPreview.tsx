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
      <div className="flex items-center gap-2 py-1 px-2 rounded-md bg-red-400/8 min-w-0">
        <div className={cn('w-2 h-2 rounded-full shrink-0', stepColors['interval'].dot)} />
        <span className="text-[12px] text-slate-200 font-bold">
          {step.repeatCount}x
        </span>
      </div>
    );
  }

  const target = fmtTarget(step);
  const note = step.notes && !target ? step.notes : '';
  return (
    <div className={cn('flex items-center gap-2 py-1.5 px-2.5 rounded-md min-w-0', colors.bg)}>
      <div className={cn('w-2 h-2 rounded-full shrink-0', colors.dot)} />
      <span className="text-[12px] text-slate-200 truncate flex-1 min-w-0 font-semibold">
        {fmtDuration(step)}
      </span>
      {target && <span className="text-[11px] text-slate-400 shrink-0 font-medium">{target}</span>}
      {note && <span className="text-[11px] text-slate-500 truncate">{note}</span>}
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
      'bg-slate-800/90 border border-slate-700/50 rounded-xl overflow-hidden border-l-[4px] transition-all hover:bg-slate-800 hover:shadow-lg hover:shadow-black/20 h-full flex flex-col',
      typeColor
    )}>
      {/* Header */}
      <div className="px-4 pt-3.5 pb-2">
        <h3 className="font-bold text-[13px] text-white leading-snug">{workout.name}</h3>
        {workout.description && (
          <p className="text-[11px] text-slate-400 mt-1 line-clamp-2">{workout.description}</p>
        )}
      </div>

      {/* Steps */}
      <div className="px-3 pb-3 space-y-1 flex-1">
        {visibleSteps.map((step, i) => (
          <StepLine key={i} step={step} />
        ))}
      </div>

      {hasMore && (
        <button
          onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
          className="flex items-center gap-1 text-[11px] text-primary-400 px-4 pb-3 hover:text-primary-300 font-semibold"
        >
          {expanded ? (
            <><ChevronUp className="h-3.5 w-3.5" /> Show less</>
          ) : (
            <><ChevronDown className="h-3.5 w-3.5" /> +{steps.length - MAX_VISIBLE} more</>
          )}
        </button>
      )}

      {/* Footer with distance/time estimates */}
      {(totalDist > 0 || totalTime > 0) && (
        <div className="border-t border-slate-700/40 px-4 py-2.5 flex items-center gap-4 bg-slate-900/40">
          {totalDist > 0 && (
            <span className="flex items-center gap-1.5 text-[11px] text-slate-300 font-medium">
              <Route className="h-3 w-3 text-slate-500" />
              {totalDist >= 1000 ? `${(totalDist / 1000).toFixed(1)}km` : `${totalDist}m`}
            </span>
          )}
          {totalTime > 0 && (
            <span className="flex items-center gap-1.5 text-[11px] text-slate-300 font-medium">
              <Timer className="h-3 w-3 text-slate-500" />
              {totalTime >= 3600 ? `${Math.floor(totalTime / 3600)}h${Math.floor((totalTime % 3600) / 60)}m` : `${Math.floor(totalTime / 60)}m`}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
