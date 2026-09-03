'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ParsedWorkout, WorkoutStep } from '@/lib/ai/types';
import { groupPaceTokens, joinGroupPaces } from '@/lib/garmin/pace';
import { cn } from '@/lib/utils';
import { ChevronDown, ChevronUp, Timer, Route } from 'lucide-react';
import { workoutDistanceMeters } from '@/lib/workout-distance';

const stepColors: Record<string, { dot: string; bg: string }> = {
  warmup: { dot: 'bg-band-3', bg: 'bg-band-3/10' },
  cooldown: { dot: 'bg-band-2', bg: 'bg-band-2/10' },
  interval: { dot: 'bg-accent-red', bg: 'bg-accent-red/10' },
  active: { dot: 'bg-purple-400', bg: 'bg-purple-400/10' },
  rest: { dot: 'bg-accent-600', bg: 'bg-accent-600/10' },
  recovery: { dot: 'bg-accent-600/10', bg: 'bg-accent-600/10' },
};

const workoutTypeStyles: Record<string, { border: string; color: string }> = {
  intervals: { border: 'border-s-red-400', color: 'text-accent-red' },
  long_run: { border: 'border-s-purple-400', color: 'text-purple-600' },
  tempo: { border: 'border-s-orange-400', color: 'text-band-3' },
  fartlek: { border: 'border-s-pink-400', color: 'text-pink-600' },
  progressive: { border: 'border-s-teal-400', color: 'text-teal-600' },
  easy: { border: 'border-s-blue-400', color: 'text-band-2' },
  recovery: { border: 'border-s-green-400', color: 'text-accent-600' },
};

function fmtDuration(step: WorkoutStep, lapLabel: string): string {
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
  return lapLabel;
}

// Group ❶ plain, (❷) single brackets, ((❸)) double brackets — the same
// notation the coach writes the plan in, now shown directly in the unified
// editor instead of requiring a tab switch to see another group's pace.
function fmtTarget(step: WorkoutStep): string {
  if (step.targetType === 'no_target') return '';
  if (step.targetPaceMinPerKm) {
    const tokens = groupPaceTokens(
      { min: step.targetPaceMinPerKm, max: step.targetPaceMaxPerKm ?? step.targetPaceMinPerKm },
      step.group2Pace,
      step.group3Pace,
    );
    return joinGroupPaces(tokens);
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

function StepLine({ step, lapLabel }: { step: WorkoutStep; lapLabel: string }) {
  const colors = stepColors[step.type] || { dot: 'bg-ink-300', bg: 'bg-ink-300/10' };

  if (step.repeatCount && step.repeatSteps) {
    return (
      <div className="flex items-center gap-2 py-1 px-2 rounded bg-accent-red/8 min-w-0">
        <div className={cn('w-1.5 h-1.5 rounded-full shrink-0', stepColors['interval'].dot)} />
        <span className="text-[11px] text-ink-700 font-bold">
          {step.repeatCount}x
        </span>
      </div>
    );
  }

  const target = fmtTarget(step);
  // A multi-group bracket target ("4:20 (4:25) ((4:30))") is real content,
  // not a short label — squeezing it onto the same row as duration+type
  // fought for space and clipped. Give it its own row only when it's
  // actually multi-group; the common single-pace case stays inline.
  const isMultiGroup = !!(step.group2Pace || step.group3Pace);

  return (
    <div className={cn('py-1 px-2 rounded min-w-0', colors.bg)}>
      <div className="flex items-center gap-1.5 min-w-0">
        <div className={cn('w-1.5 h-1.5 rounded-full shrink-0', colors.dot)} />
        <span className="text-[11px] text-ink-700 truncate flex-1 min-w-0 font-medium">
          {fmtDuration(step, lapLabel)}
        </span>
        {target && !isMultiGroup && <span className="text-[10px] text-ink-400 shrink-0">{target}</span>}
      </div>
      {target && isMultiGroup && (
        <p dir="ltr" className="text-[10px] text-ink-400 ps-3 tabular-nums">{target}</p>
      )}
    </div>
  );
}

interface WorkoutPreviewProps {
  workout: ParsedWorkout;
  compact?: boolean;
  /** Merged onto the card's own classes — e.g. to strip top rounding/border when a day-header sits directly above it. */
  className?: string;
}

export function WorkoutPreview({ workout, compact = false, className }: WorkoutPreviewProps) {
  const t = useTranslations('workoutEditor');
  const tp = useTranslations('planner');
  const [expanded, setExpanded] = useState(false);
  const steps = workout.steps;

  // Coach-aware distance (prefers the day's km range) so per-day cards sum to
  // the same weekly total shown on the athlete dashboard.
  const totalDist = workoutDistanceMeters(workout);
  const totalTime = estimateTime(steps);
  const type = inferWorkoutType(workout);
  const style = workoutTypeStyles[type] || workoutTypeStyles['easy'];

  // Compact: minimal card
  if (compact) {
    return (
      <div className={cn(
        'bg-card/80 border border-page/40 rounded-lg overflow-hidden border-s-[3px] h-full',
        style.border,
        className
      )}>
        <div className="px-3 py-2.5">
          <p className="text-[11px] font-semibold text-ink-700 truncate">{workout.name}</p>
          <div className="flex items-center gap-2 mt-1.5">
            {totalDist > 0 && (
              <span className="text-[10px] text-ink-400">
                {totalDist >= 1000 ? `${(totalDist / 1000).toFixed(1)}km` : `${totalDist}m`}
              </span>
            )}
            {totalTime > 0 && (
              <span className="text-[10px] text-ink-400">
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
      'bg-card/80 border border-page/40 rounded-lg overflow-hidden border-s-[3px] transition-all hover:bg-page h-full flex flex-col',
      style.border,
      className
    )}>
      {/* Header */}
      <div className="px-3 pt-3 pb-1.5">
        <h3 className="font-semibold text-[12px] text-ink-700 leading-snug truncate">{workout.name}</h3>
        {workout.description && (
          <p className="text-[10px] text-ink-400 mt-0.5 truncate">{workout.description}</p>
        )}
      </div>

      {/* Steps */}
      <div className="px-2.5 pb-2 space-y-0.5 flex-1">
        {visibleSteps.map((step, i) => (
          <StepLine key={i} step={step} lapLabel={t('lap')} />
        ))}
      </div>

      {hasMore && (
        <button
          onClick={(e) => { e.stopPropagation(); setExpanded(!expanded); }}
          className="flex items-center gap-0.5 text-[10px] text-brand-600 px-3 pb-2 hover:text-brand-700 font-medium"
        >
          {expanded ? (
            <><ChevronUp className="h-3 w-3" /> {tp('stepsLess')}</>
          ) : (
            <><ChevronDown className="h-3 w-3" /> {tp('stepsMore', { count: steps.length - MAX_VISIBLE })}</>
          )}
        </button>
      )}

      {/* Footer */}
      {(totalDist > 0 || totalTime > 0) && (
        <div className="border-t border-page/30 px-3 py-1.5 flex items-center gap-3 bg-page/30">
          {totalDist > 0 && (
            <span className="flex items-center gap-1 text-[10px] text-ink-400">
              <Route className="h-2.5 w-2.5" />
              {totalDist >= 1000 ? `${(totalDist / 1000).toFixed(1)}km` : `${totalDist}m`}
            </span>
          )}
          {totalTime > 0 && (
            <span className="flex items-center gap-1 text-[10px] text-ink-400">
              <Timer className="h-2.5 w-2.5" />
              {totalTime >= 3600 ? `${Math.floor(totalTime / 3600)}h${Math.floor((totalTime % 3600) / 60)}m` : `${Math.floor(totalTime / 60)}m`}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
