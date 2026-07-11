'use client';

import { useState } from 'react';
import { ParsedWorkout, WorkoutStep } from '@/lib/ai/types';
import { WorkoutPreview, inferWorkoutType } from './WorkoutPreview';
import { WorkoutEditorPanel } from './WorkoutEditor';
import { cn } from '@/lib/utils';
import { Route, Timer, Zap, X, Pencil } from 'lucide-react';
import { formatPace } from '@/lib/garmin/pace';
import { workoutDistanceMeters, totalDistanceMeters } from '@/lib/workout-distance';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

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

const stepTypeLabels: Record<string, string> = {
  warmup: 'Warmup', cooldown: 'Cooldown', interval: 'Hard',
  active: 'Run', rest: 'Recovery', recovery: 'Recovery',
};

const stepTypeColors: Record<string, string> = {
  warmup: '#f59e0b', cooldown: '#3b82f6', interval: '#ef4444',
  active: '#a855f7', rest: '#22c55e', recovery: '#22c55e',
};

function fmtStepDuration(step: WorkoutStep): string {
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
  return 'Open';
}

function fmtStepPace(step: WorkoutStep): string {
  if (step.targetPaceMinPerKm && step.targetPaceMaxPerKm) {
    return `${formatPace(step.targetPaceMinPerKm)}–${formatPace(step.targetPaceMaxPerKm)}`;
  }
  if (step.targetPaceMinPerKm) return formatPace(step.targetPaceMinPerKm);
  return '';
}

function WorkoutDetailModal({ workout, dayName, onClose }: { workout: ParsedWorkout; dayName: string; onClose: () => void }) {
  const totalDist = estimateWorkoutDistance(workout.steps);
  const totalTime = estimateWorkoutTime(workout.steps);

  return (
    <div className="fixed inset-0 z-[2000] flex items-end sm:items-center justify-center bg-black/70 backdrop-blur-sm" onClick={onClose}>
      <div className="bg-slate-900 border border-slate-700 rounded-t-2xl sm:rounded-2xl w-full sm:max-w-md max-h-[85vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-700/50 shrink-0">
          <div className="flex items-start justify-between">
            <div>
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
                <span className="text-xs text-slate-500">{workout.steps.length} steps</span>
              </div>
            </div>
            <button onClick={onClose} className="p-2 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors">
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Steps — scrolls when the workout is longer than the modal */}
        <div className="px-5 py-4 overflow-y-auto flex-1 min-h-0 space-y-1.5 scrollbar-thin">
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
                      const dur = fmtStepDuration(sub);
                      const pace = fmtStepPace(sub);
                      const isRest = sub.type === 'rest' || sub.type === 'recovery';
                      return (
                        <div key={j} className="flex items-center gap-2 text-sm">
                          <div className="w-1 h-4 rounded-full shrink-0" style={{ background: stepTypeColors[sub.type] || '#64748b' }} />
                          <span className={cn("font-medium shrink-0", isRest ? "text-slate-500" : "text-white")}>{dur}</span>
                          {sub.notes && <span className="text-slate-400 truncate flex-1 text-xs">{sub.notes}</span>}
                          {pace && <span className="text-xs text-slate-500 tabular-nums shrink-0 ms-auto">{pace}</span>}
                        </div>
                      );
                    })}
                  </div>
                </div>
              );
            }

            const dur = fmtStepDuration(step);
            const pace = fmtStepPace(step);
            const label = step.notes || stepTypeLabels[step.type] || step.type;
            return (
              <div key={i} className="flex items-center gap-2 py-2 px-3 rounded-lg bg-slate-800/40 text-sm">
                <div className="w-1 h-5 rounded-full shrink-0" style={{ background: stepTypeColors[step.type] || '#64748b' }} />
                <span className="font-medium text-white shrink-0">{dur}</span>
                <span className="text-slate-400 truncate flex-1 text-xs">{label}</span>
                {pace && <span className="text-xs text-slate-500 tabular-nums shrink-0 ms-auto">{pace}</span>}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function WeekView({ workouts, editable = false, onWorkoutChange }: WeekViewProps) {
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [viewingIdx, setViewingIdx] = useState<number | null>(null);
  const [expandedDay, setExpandedDay] = useState<number | null>(null);

  const editingWorkout = editingIdx !== null ? workouts[editingIdx] : null;
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
              <span className="text-[10px] text-slate-400 ms-0.5">{totalDist >= 1000 ? 'km' : 'm'}</span>
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
            {trainingDays}<span className="text-[10px] text-slate-400 ms-0.5">days</span>
          </span>
        </div>
      </div>

      {/* Day columns */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-2">
        {DAYS.map((day, dayIndex) => {
          const dayWorkouts = workouts.filter((w) => w.dayOfWeek === dayIndex);
          const isToday = dayIndex === todayIdx;
          const hasMultiple = dayWorkouts.length > 1;
          const isExpanded = expandedDay === dayIndex;

          return (
            <div key={day} className="flex flex-col min-w-0">
              {/* Day Header */}
              <div className="flex items-center justify-between mb-1.5 px-0.5">
                <h4 className={cn(
                  'text-[10px] font-bold uppercase tracking-wider hidden lg:block',
                  isToday ? 'text-primary-400' : 'text-slate-500'
                )}>
                  {day}
                </h4>
                <h4 className={cn(
                  'text-[10px] font-bold uppercase tracking-wider lg:hidden',
                  isToday ? 'text-primary-400' : 'text-slate-500'
                )}>
                  {DAYS_SHORT[dayIndex]}
                </h4>
                <div className="flex items-center gap-1">
                  {hasMultiple && (
                    <button
                      onClick={() => setExpandedDay(isExpanded ? null : dayIndex)}
                      className="flex items-center justify-center w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-black"
                    >
                      {dayWorkouts.length}
                    </button>
                  )}
                  {/* Per-day edit pencil — always available when editing is possible */}
                  {canEdit && dayWorkouts.length > 0 && (
                    <button
                      onClick={() => setEditingIdx(workouts.indexOf(dayWorkouts[0]))}
                      title={`Edit ${day}`}
                      className="flex items-center justify-center w-5 h-5 rounded-md bg-primary-500/15 text-primary-400 hover:bg-primary-500/25 transition-colors"
                    >
                      <Pencil className="h-3 w-3" />
                    </button>
                  )}
                </div>
              </div>

              {/* Workout Card(s) */}
              <div className={cn(
                'flex-1 flex flex-col gap-1.5',
                isToday && 'ring-1 ring-primary-500/30 rounded-lg p-0.5'
              )}>
                {dayWorkouts.length > 0 ? (
                  <>
                    {/* Primary workout — single click edits in edit mode, else opens view */}
                    <div
                      onClick={() => { if (editable) setEditingIdx(workouts.indexOf(dayWorkouts[0])); }}
                      onDoubleClick={() => handleCardDoubleTap(workouts.indexOf(dayWorkouts[0]))}
                      className="flex-1 cursor-pointer hover:ring-1 hover:ring-primary-500/50 rounded-lg transition-all"
                    >
                      <WorkoutPreview workout={dayWorkouts[0]} />
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
                        className="text-[9px] font-bold text-red-400 bg-red-500/10 border border-red-500/20 rounded-md py-1.5 px-2 text-center hover:bg-red-500/15 transition-colors"
                      >
                        +{dayWorkouts.length - 1} more
                      </button>
                    ))}
                  </>
                ) : (
                  <div className="flex-1 min-h-[100px] border border-slate-700/20 border-dashed rounded-lg flex items-center justify-center">
                    <p className="text-[10px] text-slate-600">Rest</p>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {/* Workout Detail Modal (view mode) */}
      {viewingWorkout && viewingIdx !== null && (
        <WorkoutDetailModal
          workout={viewingWorkout}
          dayName={DAYS[viewingWorkout.dayOfWeek]}
          onClose={() => setViewingIdx(null)}
        />
      )}

      {/* Workout Editor */}
      {canEdit && editingWorkout && editingIdx !== null && (
        <WorkoutEditorPanel
          workout={editingWorkout}
          dayName={DAYS[editingWorkout.dayOfWeek]}
          onChange={(w) => onWorkoutChange?.(editingIdx, w)}
          onClose={() => setEditingIdx(null)}
        />
      )}
    </>
  );
}
