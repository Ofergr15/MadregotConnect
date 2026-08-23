'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ParsedWorkout, WorkoutStep } from '@/lib/ai/types';
import { WorkoutPreview } from './WorkoutPreview';
import { WorkoutEditorPanel } from './WorkoutEditor';
import { Sheet } from '@/components/ui';
import { cn } from '@/lib/utils';
import { Route, Timer, Zap, Pencil, Plus } from 'lucide-react';
import { formatPace } from '@/lib/garmin/pace';
import { workoutDistanceMeters, totalDistanceMeters } from '@/lib/workout-distance';

interface WeekViewProps {
  workouts: ParsedWorkout[];
  editable?: boolean;
  onWorkoutChange?: (index: number, workout: ParsedWorkout) => void;
}

function estimateWorkoutDistance(steps: WorkoutStep[]): number {
  let total = 0;
  for (const step of steps) {
    if (step.repeatCount && step.repeatSteps) {
      total += estimateWorkoutDistance(step.repeatSteps) * step.repeatCount;
    } else if (step.durationType === 'distance' && step.durationValue) {
      total += step.durationValue;
    }
  }
  return total;
}

function estimateWorkoutTime(steps: WorkoutStep[]): number {
  let total = 0;
  for (const step of steps) {
    if (step.repeatCount && step.repeatSteps) {
      total += estimateWorkoutTime(step.repeatSteps) * step.repeatCount;
    } else if (step.durationType === 'time' && step.durationValue) {
      total += step.durationValue;
    }
  }
  return total;
}

const stepTypeColors: Record<string, string> = {
  warmup: '#f59e0b', cooldown: '#3b82f6', interval: '#ef4444',
  active: '#a855f7', rest: '#22c55e', recovery: '#22c55e',
};

function stepTypeLabel(type: string, t: (key: string) => string): string {
  switch (type) {
    case 'warmup': return t('stepWarmup');
    case 'cooldown': return t('stepCooldown');
    case 'interval': return t('stepInterval');
    case 'active': return t('stepActive');
    case 'rest': return t('stepRest');
    case 'recovery': return t('stepRecovery');
    default: return type;
  }
}

function fmtStepDuration(step: WorkoutStep, lapLabel: string): string {
  if (step.durationType === 'distance' && step.durationValue) {
    return step.durationValue >= 1000
      ? `${(step.durationValue / 1000).toFixed(step.durationValue % 1000 === 0 ? 0 : 1)} km`
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
      return secs > 0 ? `${mins}:${secs.toString().padStart(2, '0')}` : `${mins} min`;
    }
    return `${step.durationValue}s`;
  }
  return lapLabel;
}

function fmtStepPace(step: WorkoutStep): string {
  if (step.targetPaceMinPerKm && step.targetPaceMaxPerKm) {
    return `${formatPace(step.targetPaceMinPerKm)}–${formatPace(step.targetPaceMaxPerKm)}`;
  }
  if (step.targetPaceMinPerKm) return formatPace(step.targetPaceMinPerKm);
  return '';
}

function WorkoutDetailSheet({ workout, dayName, open, onClose }: { workout: ParsedWorkout | null; dayName: string; open: boolean; onClose: () => void }) {
  const t = useTranslations('workoutEditor');
  const tp = useTranslations('planner');
  const totalDist = workout ? estimateWorkoutDistance(workout.steps) : 0;
  const totalTime = workout ? estimateWorkoutTime(workout.steps) : 0;

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()} className="max-h-[85vh]">
      {workout && (
        <>
          <div className="px-1 pb-2">
            <p className="text-xs font-bold text-primary-400 uppercase tracking-wider">{dayName}</p>
            <h3 className="text-lg font-bold text-white mt-1">{workout.name}</h3>
            {workout.description && (
              <p className="text-sm text-slate-400 mt-0.5">{workout.description}</p>
            )}
            <div className="flex items-center gap-4 mt-2">
              {totalDist > 0 && (
                <span className="flex items-center gap-1 text-sm text-slate-300 font-medium">
                  <Route className="h-3.5 w-3.5 text-slate-500" />
                  {totalDist >= 1000 ? `${(totalDist / 1000).toFixed(1)} km` : `${totalDist}m`}
                </span>
              )}
              {totalTime > 0 && (
                <span className="flex items-center gap-1 text-sm text-slate-300 font-medium">
                  <Timer className="h-3.5 w-3.5 text-slate-500" />
                  {totalTime >= 3600 ? `${Math.floor(totalTime / 3600)}h${Math.floor((totalTime % 3600) / 60)}m` : `${Math.floor(totalTime / 60)}m`}
                </span>
              )}
              <span className="text-xs text-slate-400">{tp('stepsCount', { count: workout.steps.length })}</span>
            </div>
          </div>

          <div className="space-y-1.5 scrollbar-thin">
            {workout.steps.map((step, i) => {
              if (step.repeatCount && step.repeatSteps) {
                return (
                  <div key={i} className="rounded-lg border border-primary-500/20 bg-primary-500/5 px-3 py-2.5">
                    <div className="flex items-center gap-2 mb-2">
                      <span className="text-sm font-bold text-white">{step.repeatCount}x</span>
                      {step.notes && <span className="text-xs text-slate-400">{step.notes}</span>}
                    </div>
                    <div className="space-y-1">
                      {step.repeatSteps.map((sub, j) => {
                        const dur = fmtStepDuration(sub, t('lap'));
                        const pace = fmtStepPace(sub);
                        const isRest = sub.type === 'rest' || sub.type === 'recovery';
                        return (
                          <div key={j} className="flex items-center gap-2 text-sm">
                            <div className="w-1 h-4 rounded-full shrink-0" style={{ background: stepTypeColors[sub.type] || '#64748b' }} />
                            <span className={cn("font-medium shrink-0", isRest ? "text-slate-400" : "text-white")}>{dur}</span>
                            {sub.notes && <span className="text-slate-400 truncate flex-1 text-xs">{sub.notes}</span>}
                            {pace && <span className="text-xs text-slate-400 tabular-nums shrink-0 ms-auto">{pace}</span>}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              }

              const dur = fmtStepDuration(step, t('lap'));
              const pace = fmtStepPace(step);
              const label = step.notes || stepTypeLabel(step.type, t);
              return (
                <div key={i} className="flex items-center gap-2 py-2 px-3 rounded-lg bg-slate-800/40 text-sm">
                  <div className="w-1 h-5 rounded-full shrink-0" style={{ background: stepTypeColors[step.type] || '#64748b' }} />
                  <span className="font-medium text-white shrink-0">{dur}</span>
                  <span className="text-slate-400 truncate flex-1 text-xs">{label}</span>
                  {pace && <span className="text-xs text-slate-400 tabular-nums shrink-0 ms-auto">{pace}</span>}
                </div>
              );
            })}
          </div>
        </>
      )}
    </Sheet>
  );
}

export function WeekView({ workouts, editable = false, onWorkoutChange }: WeekViewProps) {
  const t = useTranslations('common');
  const tp = useTranslations('planner');
  const dayNames = t.raw('dayNames') as string[];
  const dayNamesShort = t.raw('dayNamesShort') as string[];
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [viewingIdx, setViewingIdx] = useState<number | null>(null);
  const [expandedDay, setExpandedDay] = useState<number | null>(null);
  // A brand-new, not-yet-saved workout for a specific day (e.g. "tomorrow
  // needs something different") — distinct from editingIdx, which always
  // indexes an existing entry in `workouts`. Kept as just the day number so
  // the blank draft object is only created where it's actually rendered.
  const [newWorkoutDay, setNewWorkoutDay] = useState<number | null>(null);

  const editingWorkout = editingIdx !== null ? workouts[editingIdx]
    : newWorkoutDay !== null ? { dayOfWeek: newWorkoutDay, name: '', steps: [] } as ParsedWorkout
    : null;
  const viewingWorkout = viewingIdx !== null ? workouts[viewingIdx] : null;
  const todayIdx = new Date().getDay();
  // The per-day edit pencil is available whenever editing is possible — either
  // Edit mode is on, or the parent provided an onWorkoutChange handler. This
  // lets coaches edit a specific day without toggling Edit first.
  const canEdit = editable || !!onWorkoutChange;

  // Use the shared, coach-aware distance so the planner total matches the
  // athlete dashboard (prefers distanceMinKm/Max, falls back to time+pace).
  const totalDist = totalDistanceMeters(workouts);
  const totalTime = workouts.reduce((s, w) => s + estimateWorkoutTime(w.steps), 0);
  const trainingDays = new Set(workouts.map(w => w.dayOfWeek)).size;

  const handleCardDoubleTap = (globalIdx: number) => {
    if (editable) {
      setEditingIdx(globalIdx);
    } else {
      setViewingIdx(globalIdx);
    }
  };

  return (
    <>
      {/* Weekly Summary */}
      <div className="mb-4 flex items-center gap-6 text-sm">
        {totalDist > 0 && (
          <div className="flex items-center gap-1.5">
            <Route className="h-3.5 w-3.5 text-primary-400" />
            <span className="font-bold text-white tabular-nums">
              {totalDist >= 1000 ? `${(totalDist / 1000).toFixed(1)}` : totalDist}
              <span className="text-[10px] text-slate-400 ms-0.5">{totalDist >= 1000 ? t('km') : 'm'}</span>
            </span>
          </div>
        )}
        {totalTime > 0 && (
          <div className="flex items-center gap-1.5">
            <Timer className="h-3.5 w-3.5 text-emerald-400" />
            <span className="font-bold text-white tabular-nums">
              {totalTime >= 3600 ? `${Math.floor(totalTime / 3600)}h${Math.floor((totalTime % 3600) / 60)}m` : `${Math.floor(totalTime / 60)}m`}
            </span>
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <Zap className="h-3.5 w-3.5 text-amber-400" />
          <span className="font-bold text-white tabular-nums">
            {trainingDays}<span className="text-[10px] text-slate-400 ms-0.5">{t('days')}</span>
          </span>
        </div>
      </div>

      {/* Day list — one full-width row per day on phones (where this app is
          actually used), matching the native InsetSection list idiom used
          everywhere else (Settings, Profile) instead of cramming 7 days into
          a 2-column grid of half-width cards. Widens to a grid only once
          there's real room for it (tablet/desktop). */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-7 gap-3 lg:gap-2 lg:items-start">
        {dayNames.map((day, dayIndex) => {
          const dayWorkouts = workouts.filter((w) => w.dayOfWeek === dayIndex);
          const isToday = dayIndex === todayIdx;
          const hasMultiple = dayWorkouts.length > 1;
          const isExpanded = expandedDay === dayIndex;

          return (
            <div key={day} className="flex flex-col min-w-0">
              {/* Day header — attached directly to the card below (shared
                  border, no rounding on the seam) so it reads as one card
                  with a header section, not a floating label + a separate
                  disconnected card. */}
              <div className={cn(
                'flex items-center justify-between gap-2 px-3 py-2 rounded-t-xl border border-b-0 shrink-0',
                isToday ? 'bg-primary-500/10 border-primary-500/30' : 'bg-slate-800/60 border-slate-700/40'
              )}>
                <div className="flex items-center gap-2 min-w-0">
                  <h4 className={cn(
                    'text-sm font-bold shrink-0',
                    isToday ? 'text-primary-400' : 'text-white'
                  )}>
                    <span className="lg:hidden">{dayNamesShort[dayIndex]}</span>
                    <span className="hidden lg:inline">{day}</span>
                  </h4>
                  {hasMultiple && (
                    <button
                      onClick={() => setExpandedDay(isExpanded ? null : dayIndex)}
                      className="flex items-center justify-center w-5 h-5 rounded-full bg-red-500 text-white text-[10px] font-black shrink-0"
                    >
                      {dayWorkouts.length}
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                  {/* Per-day edit pencil — always available when editing is possible */}
                  {canEdit && dayWorkouts.length > 0 && (
                    <button
                      onClick={() => setEditingIdx(workouts.indexOf(dayWorkouts[0]))}
                      title={tp('editDayTooltip', { day })}
                      className="flex items-center justify-center w-7 h-7 rounded-lg text-primary-400 hover:bg-primary-500/15 transition-colors touch-target"
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                  )}
                  {/* Build a workout from scratch for this day — works on a
                      rest day (nothing exists yet) or to add an extra
                      workout alongside an existing one (e.g. tomorrow needs
                      something different from what was originally planned). */}
                  {canEdit && (
                    <button
                      onClick={() => setNewWorkoutDay(dayIndex)}
                      title={tp('addWorkoutTooltip', { day })}
                      className="flex items-center justify-center w-7 h-7 rounded-lg text-slate-400 hover:bg-slate-700 hover:text-white transition-colors touch-target"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Workout Card(s) */}
              <div className="flex-1 flex flex-col gap-1.5">
                {dayWorkouts.length > 0 ? (
                  <>
                    {/* Primary workout — single click edits in edit mode, else opens view */}
                    <div
                      onClick={() => { if (editable) setEditingIdx(workouts.indexOf(dayWorkouts[0])); }}
                      onDoubleClick={() => handleCardDoubleTap(workouts.indexOf(dayWorkouts[0]))}
                      className="flex-1 cursor-pointer transition-all"
                    >
                      <WorkoutPreview
                        workout={dayWorkouts[0]}
                        className={cn('rounded-t-none border-t-0 hover:ring-1 hover:ring-primary-500/50', isToday && 'border-primary-500/30')}
                      />
                    </div>

                    {/* Additional workouts */}
                    {hasMultiple && (isExpanded ? (
                      dayWorkouts.slice(1).map((workout) => {
                        const globalIdx = workouts.indexOf(workout);
                        return (
                          <div
                            key={globalIdx}
                            onClick={() => { if (editable) setEditingIdx(globalIdx); }}
                            onDoubleClick={() => handleCardDoubleTap(globalIdx)}
                            className="cursor-pointer hover:ring-1 hover:ring-primary-500/50 rounded-lg transition-all"
                          >
                            <WorkoutPreview workout={workout} compact />
                          </div>
                        );
                      })
                    ) : (
                      <button
                        onClick={() => setExpandedDay(dayIndex)}
                        className="text-xs font-bold text-red-400 bg-red-500/10 border border-red-500/20 rounded-lg py-2 px-3 text-center hover:bg-red-500/15 transition-colors min-h-[36px]"
                      >
                        {tp('moreCount', { count: dayWorkouts.length - 1 })}
                      </button>
                    ))}
                  </>
                ) : (
                  <div
                    onClick={() => { if (canEdit) setNewWorkoutDay(dayIndex); }}
                    className={cn(
                      'flex-1 min-h-[64px] lg:min-h-[100px] border border-t-0 border-dashed rounded-b-xl flex items-center justify-center',
                      isToday ? 'border-primary-500/30' : 'border-slate-700/40',
                      canEdit && 'cursor-pointer hover:border-primary-500/40 hover:bg-primary-500/5 transition-colors'
                    )}
                  >
                    <p className="text-xs text-slate-600">{tp('restDay')}</p>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Workout Detail Sheet (view mode) */}
      <WorkoutDetailSheet
        workout={viewingWorkout}
        dayName={viewingWorkout ? dayNames[viewingWorkout.dayOfWeek] : ''}
        open={!!viewingWorkout}
        onClose={() => setViewingIdx(null)}
      />

      {/* Workout Editor — editingWorkout covers both an existing entry
          (editingIdx) and a not-yet-saved blank draft (newWorkoutDay); the
          save target differs (replace vs. append) but the editor itself
          doesn't need to know which. */}
      {canEdit && editingWorkout && (
        <WorkoutEditorPanel
          workout={editingWorkout}
          dayName={dayNames[editingWorkout.dayOfWeek]}
          onChange={(w) => onWorkoutChange?.(editingIdx !== null ? editingIdx : workouts.length, w)}
          onClose={() => { setEditingIdx(null); setNewWorkoutDay(null); }}
        />
      )}
    </>
  );
}
