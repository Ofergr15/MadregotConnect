'use client';

import { useState } from 'react';
import { ParsedWorkout, WorkoutStep } from '@/lib/ai/types';
import { WorkoutPreview, inferWorkoutType } from './WorkoutPreview';
import { WorkoutEditorPanel } from './WorkoutEditor';
import { cn } from '@/lib/utils';
import { Route, Timer, Zap } from 'lucide-react';

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

export function WeekView({ workouts, editable = false, onWorkoutChange }: WeekViewProps) {
  const [editingIdx, setEditingIdx] = useState<number | null>(null);
  const [expandedDay, setExpandedDay] = useState<number | null>(null);

  const editingWorkout = editingIdx !== null ? workouts[editingIdx] : null;
  const todayIdx = new Date().getDay();

  const totalDist = workouts.reduce((s, w) => s + estimateWorkoutDistance(w.steps), 0);
  const totalTime = workouts.reduce((s, w) => s + estimateWorkoutTime(w.steps), 0);
  const trainingDays = new Set(workouts.map(w => w.dayOfWeek)).size;

  return (
    <>
      {/* Weekly Summary */}
      <div className="mb-4 flex items-center gap-6 text-sm">
        {totalDist > 0 && (
          <div className="flex items-center gap-1.5">
            <Route className="h-3.5 w-3.5 text-primary-400" />
            <span className="font-bold text-white tabular-nums">
              {totalDist >= 1000 ? `${(totalDist / 1000).toFixed(1)}` : totalDist}
              <span className="text-[10px] text-slate-400 ml-0.5">{totalDist >= 1000 ? 'km' : 'm'}</span>
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
            {trainingDays}<span className="text-[10px] text-slate-400 ml-0.5">days</span>
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
                {hasMultiple && (
                  <button
                    onClick={() => setExpandedDay(isExpanded ? null : dayIndex)}
                    className="flex items-center justify-center w-4 h-4 rounded-full bg-red-500 text-white text-[9px] font-black"
                  >
                    {dayWorkouts.length}
                  </button>
                )}
              </div>

              {/* Workout Card(s) */}
              <div className={cn(
                'flex-1 flex flex-col gap-1.5',
                isToday && 'ring-1 ring-primary-500/30 rounded-lg p-0.5'
              )}>
                {dayWorkouts.length > 0 ? (
                  <>
                    {/* Primary workout - always show full */}
                    <div
                      onDoubleClick={() => { if (editable) setEditingIdx(workouts.indexOf(dayWorkouts[0])); }}
                      className={cn(
                        'flex-1',
                        editable && 'cursor-pointer hover:ring-1 hover:ring-primary-500/50 rounded-lg transition-all'
                      )}
                    >
                      <WorkoutPreview workout={dayWorkouts[0]} />
                    </div>

                    {/* Additional workouts - compact, shown when expanded or always if few */}
                    {hasMultiple && (isExpanded ? (
                      dayWorkouts.slice(1).map((workout) => {
                        const globalIdx = workouts.indexOf(workout);
                        return (
                          <div
                            key={globalIdx}
                            onDoubleClick={() => { if (editable) setEditingIdx(globalIdx); }}
                            className={cn(
                              editable && 'cursor-pointer hover:ring-1 hover:ring-primary-500/50 rounded-lg transition-all'
                            )}
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
                        +{dayWorkouts.length - 1} more session{dayWorkouts.length > 2 ? 's' : ''}
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

      {editable && editingWorkout && editingIdx !== null && (
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
