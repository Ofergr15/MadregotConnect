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

const workoutTypeStyles: Record<string, { border: string; color: string }> = {
  intervals: { border: 'border-l-red-400', color: 'text-red-400' },
  long_run: { border: 'border-l-purple-400', color: 'text-purple-400' },
  tempo: { border: 'border-l-orange-400', color: 'text-orange-400' },
  fartlek: { border: 'border-l-pink-400', color: 'text-pink-400' },
  progressive: { border: 'border-l-teal-400', color: 'text-teal-400' },
  easy: { border: 'border-l-blue-400', color: 'text-blue-400' },
  recovery: { border: 'border-l-green-400', color: 'text-green-400' },
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

export function inferWorkoutType(workout: ParsedWorkout): string {
  const name = workout.name.toLowerCase();
  const desc = (workout.description || '').toLowerCase();
  const text = `${name} ${desc}`;

  if (/interval|אינטרוול|pyramid|פירמידה/.test(text)) return 'intervals';
  if (/long|ארוכה|ארוך/.test(text)) return 'long_run';
  if (/tempo|טמפו/.test(text)) return 'tempo';
  if (/fartlek|פרטלק/.test(text)) return 'fartlek';
  if (/progressive|מתגברת/.test(text)) return 'progressive';
  if (/recovery|שחרור|easy|קל/.test(text)) return 'recovery';

  const hasRepeats = workout.steps.some(s => s.repeatCount && s.repeatCount > 2);
  if (hasRepeats) return 'intervals';

  const totalDist = estimateDistance(workout.steps);
  if (totalDist > 15000) return 'long_run';

  return 'easy';
}

function StepLine({ step }: { step: WorkoutStep }) {
  const colors = stepColors[step.type] || { dot: 'bg-slate-400', bg: 'bg-slate-400/10' };

  if (step.repeatCount && step.repeatSteps) {
    return (
      <div className="flex items-center gap-2 py-1 px-2 rounded bg-red-400/8 min-w-0">
        <div className={cn('w-1.5 h-1.5 rounded-full shrink-0', stepColors['interval'].dot)} />
        <span className="text-[11px] text-slate-200 font-bold">
          {step.repeatCount}x
        </span>
      </div>
    );
  }

  const target = fmtTarget(step);
  return (
    <div className={cn('flex items-center gap-1.5 py-1 px-2 rounded min-w-0', colors.bg)}>
      <div className={cn('w-1.5 h-1.5 rounded-full shrink-0', colors.dot)} />
      <span className="text-[11px] text-slate-200 truncate flex-1 min-w-0 font-medium">
        {fmtDuration(step)}
      </span>
      {target && <span className="text-[10px] text-slate-400 shrink-0">{target}</span>}
    </div>
  );
}

interface WorkoutPreviewProps {
  workout: ParsedWorkout;
  compact?: boolean;
}

export function WorkoutPreview({ workout, compact = false }: WorkoutPreviewProps) {
  const [expanded, setExpanded] = useState(false);
  const steps = workout.steps;

  const totalDist = estimateDistance(steps);
  const totalTime = estimateTime(steps);
  const type = inferWorkoutType(workout);
  const style = workoutTypeStyles[type] || workoutTypeStyles['easy'];

  // Compact: minimal card
  if (compact) {
    return (
      <div className={cn(
        'bg-slate-800/80 border border-slate-700/40 rounded-lg overflow-hidden border-l-[3px] h-full',
        style.border
      )}>
        <div className="px-3 py-2.5">
          <p className="text-[11px] font-semibold text-white truncate">{workout.name}</p>
          <div className="flex items-center gap-2 mt-1.5">
            {totalDist > 0 && (
              <span className="text-[10px] text-slate-400">
                {totalDist >= 1000 ? `${(totalDist / 1000).toFixed(1)}km` : `${totalDist}m`}
              </span>
            )}
            {totalTime > 0 && (
              <span className="text-[10px] text-slate-400">
                {totalTime >= 3600 ? `${Math.floor(totalTime / 3600)}h${Math.floor((totalTime % 3600) / 60)}m` : `${Math.floor(totalTime / 60)}m`}
              </span>
            )}
          </div>
        </div>
      </div>
    );
  }

  // Full card
  const MAX_VISIBLE = 3;
  const hasMore = steps.length > MAX_VISIBLE;
  const visibleSteps = expanded ? steps : steps.slice(0, MAX_VISIBLE);

  return (
    <div className={cn(
      'bg-slate-800/80 border border-slate-700/40 rounded-lg overflow-hidden border-l-[3px] transition-all hover:bg-slate-800 h-full flex flex-col',
      style.border
    )}>
      {/* Header */}
      <div className="px-3 pt-3 pb-1.5">
        <h3 className="font-semibold text-[12px] text-white leading-snug truncate">{workout.name}</h3>
        {workout.description && (
          <p className="text-[10px] text-slate-400 mt-0.5 truncate">{workout.description}</p>
        )}
      </div>

      {/* Steps */}
      <div className="px-2.5 pb-2 space-y-0.5 flex-1">
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

      {/* Footer */}
      {(totalDist > 0 || totalTime > 0) && (
        <div className="border-t border-slate-700/30 px-3 py-1.5 flex items-center gap-3 bg-slate-900/30">
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
