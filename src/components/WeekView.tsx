'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { ParsedWorkout, WorkoutStep } from '@/lib/ai/types';
import { WorkoutPreview } from './WorkoutPreview';
import { WorkoutEditorPanel } from './WorkoutEditor';
import { Sheet } from '@/components/ui';
import { cn } from '@/lib/utils';
import { Route, Timer, Zap, Pencil, Plus } from 'lucide-react';
import { workoutDistanceMeters, totalDistanceMeters } from '@/lib/workout-distance';
import { StepPace } from './PaceTokens';

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
            <p className="text-xs font-bold text-brand-600 uppercase tracking-wider">{dayName}</p>
            <h3 className="text-lg font-bold text-ink-700 mt-1">{workout.name}</h3>
            {workout.description && (
              <p className="text-sm text-ink-400 mt-0.5">{workout.description}</p>
            )}
            <div className="flex items-center gap-4 mt-2">
              {totalDist > 0 && (
                <span className="flex items-center gap-1 text-sm text-ink-500 font-medium">
                  <Route className="h-3.5 w-3.5 text-ink-400" />
                  {totalDist >= 1000 ? `${(totalDist / 1000).toFixed(1)} km` : `${totalDist}m`}
                </span>
              )}
              {totalTime > 0 && (
                <span className="flex items-center gap-1 text-sm text-ink-500 font-medium">
                  <Timer className="h-3.5 w-3.5 text-ink-400" />
                  {totalTime >= 3600 ? `${Math.floor(totalTime / 3600)}h${Math.floor((totalTime % 3600) / 60)}m` : `${Math.floor(totalTime / 60)}m`}
                </span>
              )}
              <span className="text-xs text-ink-400">{tp('stepsCount', { count: workout.steps.length })}</span>
            </div>
          </div>

          <div className="space-y-1.5 scrollbar-thin">
            {workout.steps.map((step, i) => {
              if (step.repeatCount && step.repeatSteps) {
                return (
                  <div key={i} className="rounded-lg border border-brand-600/20 bg-brand-600/5 px-3 py-2.5">
                    <div className="flex items-center gap-2 mb-2">
                      <span dir="ltr" className="text-sm font-bold text-brand-600">{step.repeatCount}x</span>
                      {step.notes && <span className="text-xs text-ink-400">{step.notes}</span>}
                    </div>
                    <div className="space-y-1">
                      {step.repeatSteps.map((sub, j) => {
                        const dur = fmtStepDuration(sub, t('lap'));
                        const isRest = sub.type === 'rest' || sub.type === 'recovery';
                        return (
                          <div key={j} className="flex items-center gap-2 text-sm">
                            <div className="w-1 h-4 rounded-full shrink-0" style={{ background: stepTypeColors[sub.type] || '#969696' }} />
                            <span className={cn("font-medium shrink-0", isRest ? "text-ink-400" : "text-ink-700")}>{dur}</span>
                            {sub.notes && <span className="text-ink-400 truncate flex-1 text-xs">{sub.notes}</span>}
                            <StepPace step={sub} size="sm" className="shrink-0 ms-auto" />
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              }

              const dur = fmtStepDuration(step, t('lap'));
              const label = step.notes || stepTypeLabel(step.type, t);
              return (
                <div key={i} className="flex items-center gap-2 py-2 px-3 rounded-lg bg-card/40 text-sm">
                  <div className="w-1 h-5 rounded-full shrink-0" style={{ background: stepTypeColors[step.type] || '#969696' }} />
                  <span className="font-medium text-ink-700 shrink-0">{dur}</span>
                  <span className="text-ink-400 truncate flex-1 text-xs">{label}</span>
                  <StepPace step={step} size="sm" className="shrink-0 ms-auto" />
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
            <Route className="h-3.5 w-3.5 text-brand-600" />
            <span className="font-bold text-ink-700 tabular-nums">
              {totalDist >= 1000 ? `${(totalDist / 1000).toFixed(1)}` : totalDist}
              <span className="text-[10px] text-ink-400 ms-0.5">{totalDist >= 1000 ? t('km') : 'm'}</span>
            </span>
          </div>
        )}
        {totalTime > 0 && (
          <div className="flex items-center gap-1.5">
            <Timer className="h-3.5 w-3.5 text-accent-600" />
            <span className="font-bold text-ink-700 tabular-nums">
              {totalTime >= 3600 ? `${Math.floor(totalTime / 3600)}h${Math.floor((totalTime % 3600) / 60)}m` : `${Math.floor(totalTime / 60)}m`}
            </span>
          </div>
        )}
        <div className="flex items-center gap-1.5">
          <Zap className="h-3.5 w-3.5 text-band-3" />
          <span className="font-bold text-ink-700 tabular-nums">
            {trainingDays}<span className="text-[10px] text-ink-400 ms-0.5">{t('days')}</span>
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

          return (
            <div key={day} className="flex flex-col min-w-0">
              {/* Day header — attached directly to the card below (shared
                  border, no rounding on the seam) so it reads as one card
                  with a header section, not a floating label + a separate
                  disconnected card. */}
              <div className={cn(
                'flex items-center justify-between gap-2 px-3 py-2 rounded-t-xl border border-b-0 shrink-0',
                isToday ? 'bg-brand-600/10 border-brand-600/30' : 'bg-card/60 border-page/40'
              )}>
                <div className="flex items-center gap-2 min-w-0">
                  <h4 className={cn(
                    'text-sm font-bold shrink-0',
                    isToday ? 'text-brand-600' : 'text-ink-700'
                  )}>
                    <span className="lg:hidden">{dayNamesShort[dayIndex]}</span>
                    <span className="hidden lg:inline">{day}</span>
                  </h4>
                  {/* A two-a-day is a fact about the week, not a problem with
                      it. This was a red circle you had to press to reveal the
                      second session, which read as an error badge and hid the
                      thing it was counting; now it just says how many, and
                      both sessions are on screen. */}
                  {hasMultiple && (
                    <span className="rounded-full bg-brand-600/12 px-2 py-0.5 text-[10px] font-bold text-brand-600 shrink-0">
                      {tp('sessionCount', { count: dayWorkouts.length })}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-0.5 shrink-0">
                  {/* Per-day edit pencil — only for a day with a single session.
                      On a two-a-day it always opened `dayWorkouts[0]`, so it
                      silently edited the morning while you were looking at the
                      evening; those days get a pencil per card instead. */}
                  {canEdit && dayWorkouts.length === 1 && (
                    <button
                      onClick={() => setEditingIdx(workouts.indexOf(dayWorkouts[0]))}
                      title={tp('editDayTooltip', { day })}
                      aria-label={tp('editDayTooltip', { day })}
                      className="flex items-center justify-center w-7 h-7 rounded-lg text-brand-600 hover:bg-brand-600/15 transition-colors touch-target"
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
                      /* `title` alone is a weak accessible name — it is not read at
                         all by some screen readers and never on touch. This is an
                         icon-only button, so it needs the real thing. */
                      aria-label={tp('addWorkoutTooltip', { day })}
                      className="flex items-center justify-center w-7 h-7 rounded-lg text-ink-400 hover:bg-page hover:text-ink-900 transition-colors touch-target focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600"
                    >
                      <Plus className="h-3.5 w-3.5" />
                    </button>
                  )}
                </div>
              </div>

              {/* Session card(s) — every session of the day, always. A second
                  session used to sit behind a "+1 more" button, so the one
                  case where the week view most needed to be explicit (Tuesday
                  is a morning AND an evening run) was the one it hid. */}
              <div className="flex-1 flex flex-col gap-1.5">
                {dayWorkouts.length > 0 ? (
                  dayWorkouts.map((workout, sessionIdx) => {
                    const globalIdx = workouts.indexOf(workout);
                    const isFirst = sessionIdx === 0;
                    // Single click does the one thing this card can do: open the
                    // editor when the week is editable, open the read-only detail
                    // otherwise. Read mode used to need a double click, which
                    // nothing on the screen said and no touch device suggests.
                    const activate = () => {
                      if (editable) setEditingIdx(globalIdx);
                      else setViewingIdx(globalIdx);
                    };
                    return (
                      <div key={globalIdx} className={cn('relative', isFirst && 'flex-1 flex flex-col')}>
                        <div
                          role="button"
                          tabIndex={0}
                          aria-label={editable ? tp('editDayTooltip', { day }) : tp('viewDayTooltip', { day })}
                          onClick={activate}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              activate();
                            }
                          }}
                          onDoubleClick={() => handleCardDoubleTap(globalIdx)}
                          className={cn(
                            'cursor-pointer transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600',
                            isFirst ? 'flex-1 rounded-b-xl' : 'rounded-lg',
                          )}
                        >
                          <WorkoutPreview
                            workout={workout}
                            className={cn(
                              'hover:ring-1 hover:ring-brand-600/50',
                              // Only the first card is welded to the day header.
                              isFirst && 'rounded-t-none border-t-0',
                              isToday && 'border-brand-600/30',
                            )}
                          />
                        </div>
                        {/* This session's own pencil, so a two-a-day can be
                            edited session by session. */}
                        {canEdit && hasMultiple && (
                          <button
                            onClick={(event) => { event.stopPropagation(); setEditingIdx(globalIdx); }}
                            title={tp('editDayTooltip', { day })}
                            aria-label={tp('editDayTooltip', { day })}
                            className="absolute top-1.5 end-1.5 flex items-center justify-center w-7 h-7 rounded-lg bg-card/80 text-brand-600 hover:bg-brand-600/15 transition-colors touch-target"
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </button>
                        )}
                      </div>
                    );
                  })
                ) : (
                  <div
                    role={canEdit ? 'button' : undefined}
                    tabIndex={canEdit ? 0 : undefined}
                    /* The empty cell reads "rest day", so on its own it says nothing
                       about being the way to ADD a workout — obvious enough with a
                       mouse (the dashed border lights up on hover), invisible without
                       one. Only labelled when it is actually actionable. */
                    aria-label={canEdit ? tp('addWorkoutTooltip', { day }) : undefined}
                    onClick={() => { if (canEdit) setNewWorkoutDay(dayIndex); }}
                    onKeyDown={(event) => {
                      if (canEdit && (event.key === 'Enter' || event.key === ' ')) {
                        event.preventDefault();
                        setNewWorkoutDay(dayIndex);
                      }
                    }}
                    className={cn(
                      'flex-1 min-h-[64px] lg:min-h-[100px] border border-t-0 border-dashed rounded-b-xl flex items-center justify-center',
                      isToday ? 'border-brand-600/30' : 'border-page/40',
                      canEdit && 'cursor-pointer hover:border-brand-600/40 hover:bg-brand-600/5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600'
                    )}
                  >
                    <p className="text-xs text-ink-400">{tp('restDay')}</p>
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
