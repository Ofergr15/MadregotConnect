'use client';

import { useState } from 'react';
import { ParsedWorkout, WorkoutStep } from '@/lib/ai/types';
import { WorkoutPreview } from './WorkoutPreview';
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

  const editingWorkout = editingIdx !== null ? workouts[editingIdx] : null;
  const todayIdx = new Date().getDay();

  const totalDist = workouts.reduce((s, w) => s + estimateWorkoutDistance(w.steps), 0);
  const totalTime = workouts.reduce((s, w) => s + estimateWorkoutTime(w.steps), 0);
  const trainingDays = new Set(workouts.map(w => w.dayOfWeek)).size;

  return (
    <>
      {/* Weekly Summary Strip */}
      <div className="mb-5 flex items-center gap-6 px-1">
        <div className="flex items-center gap-5">
          {totalDist > 0 && (
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-primary-500/15 flex items-center justify-center">
                <Route className="h-3.5 w-3.5 text-primary-400" />
              </div>
              <div>
                <p className="text-sm font-bold text-white tabular-nums">
                  {totalDist >= 1000 ? `${(totalDist / 1000).toFixed(1)}` : totalDist}
                  <span className="text-[10px] text-slate-400 ml-0.5 font-medium">{totalDist >= 1000 ? 'km' : 'm'}</span>
                </p>
                <p className="text-[10px] text-slate-500">Total dist.</p>
              </div>
            </div>
          )}
          {totalTime > 0 && (
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-lg bg-emerald-500/15 flex items-center justify-center">
                <Timer className="h-3.5 w-3.5 text-emerald-400" />
              </div>
              <div>
                <p className="text-sm font-bold text-white tabular-nums">
                  {totalTime >= 3600 ? `${Math.floor(totalTime / 3600)}h${Math.floor((totalTime % 3600) / 60)}m` : `${Math.floor(totalTime / 60)}m`}
                </p>
                <p className="text-[10px] text-slate-500">Total time</p>
              </div>
            </div>
          )}
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-lg bg-amber-500/15 flex items-center justify-center">
              <Zap className="h-3.5 w-3.5 text-amber-400" />
            </div>
            <div>
              <p className="text-sm font-bold text-white tabular-nums">
                {trainingDays}<span className="text-[10px] text-slate-400 ml-0.5 font-medium">/ 7</span>
              </p>
              <p className="text-[10px] text-slate-500">Training days</p>
            </div>
          </div>
        </div>

        {/* Mini distance bar per day */}
        <div className="flex-1 flex items-end gap-1 h-8 ml-auto max-w-[220px]">
          {DAYS.map((_, dayIndex) => {
            const dayWorks = workouts.filter(w => w.dayOfWeek === dayIndex);
            const dayDist = dayWorks.reduce((s, w) => s + estimateWorkoutDistance(w.steps), 0);
            const maxDayDist = Math.max(...DAYS.map((__, di) => {
              const dw = workouts.filter(w => w.dayOfWeek === di);
              return dw.reduce((s, w) => s + estimateWorkoutDistance(w.steps), 0);
            }), 1);
            const h = dayDist > 0 ? Math.max((dayDist / maxDayDist) * 100, 15) : 4;
            const isToday = dayIndex === todayIdx;
            return (
              <div key={dayIndex} className="flex-1 flex flex-col items-center gap-0.5">
                <div
                  className={cn(
                    'w-full rounded-sm transition-all',
                    dayDist > 0 ? 'bg-primary-500/50' : 'bg-slate-700/30',
                    isToday && dayDist > 0 && 'bg-primary-400 ring-1 ring-primary-400/50'
                  )}
                  style={{ height: `${h}%` }}
                />
                <span className={cn(
                  'text-[8px] font-medium',
                  isToday ? 'text-primary-400' : 'text-slate-600'
                )}>
                  {DAYS_SHORT[dayIndex][0]}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Day columns */}
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-3">
        {DAYS.map((day, dayIndex) => {
          const dayWorkouts = workouts.filter((w) => w.dayOfWeek === dayIndex);
          const isToday = dayIndex === todayIdx;
          const hasMultiple = dayWorkouts.length > 1;

          return (
            <div key={day} className="flex flex-col min-w-0">
              {/* Day Header */}
              <div className={cn(
                'flex items-center justify-between mb-2 px-0.5',
              )}>
                <div className="flex items-center gap-1.5">
                  {isToday && (
                    <div className="w-2 h-2 rounded-full bg-primary-400 animate-pulse" />
                  )}
                  <h4 className={cn(
                    'text-[11px] font-bold uppercase tracking-wider hidden lg:block',
                    isToday ? 'text-primary-400' : 'text-slate-500'
                  )}>
                    {day}
                  </h4>
                  <h4 className={cn(
                    'text-[11px] font-bold uppercase tracking-wider lg:hidden',
                    isToday ? 'text-primary-400' : 'text-slate-500'
                  )}>
                    {DAYS_SHORT[dayIndex]}
                  </h4>
                </div>
                {hasMultiple && (
                  <span className="text-[9px] font-bold text-amber-300 bg-amber-500/15 px-1.5 py-0.5 rounded">
                    {dayWorkouts.length}x
                  </span>
                )}
              </div>

              {/* Workout Cards or Rest */}
              <div className={cn(
                'flex-1 flex flex-col gap-2',
                isToday && 'rounded-xl ring-1 ring-primary-500/20 bg-primary-500/[0.03] p-1'
              )}>
                {dayWorkouts.length > 0 ? (
                  dayWorkouts.map((workout, sessionIdx) => {
                    const globalIdx = workouts.indexOf(workout);
                    return (
                      <div
                        key={globalIdx}
                        onDoubleClick={() => { if (editable) setEditingIdx(globalIdx); }}
                        className={cn(
                          editable && 'cursor-pointer hover:ring-2 hover:ring-primary-500/40 rounded-xl transition-all'
                        )}
                      >
                        <WorkoutPreview workout={workout} compact={hasMultiple} />
                      </div>
                    );
                  })
                ) : (
                  <div className="flex-1 min-h-[100px] border border-slate-700/20 border-dashed rounded-xl flex items-center justify-center bg-slate-800/10">
                    <p className="text-[10px] text-slate-600/80 font-medium">Rest</p>
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
