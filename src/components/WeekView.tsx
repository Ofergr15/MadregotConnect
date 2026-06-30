'use client';

import { useState } from 'react';
import { ParsedWorkout } from '@/lib/ai/types';
import { WorkoutPreview } from './WorkoutPreview';
import { WorkoutEditorPanel } from './WorkoutEditor';
import { cn } from '@/lib/utils';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

interface WeekViewProps {
  workouts: ParsedWorkout[];
  editable?: boolean;
  onWorkoutChange?: (index: number, workout: ParsedWorkout) => void;
}

export function WeekView({ workouts, editable = false, onWorkoutChange }: WeekViewProps) {
  const [editingIdx, setEditingIdx] = useState<number | null>(null);

  const editingWorkout = editingIdx !== null ? workouts[editingIdx] : null;
  const todayIdx = new Date().getDay();

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-3">
        {DAYS.map((day, dayIndex) => {
          const dayWorkouts = workouts.filter((w) => w.dayOfWeek === dayIndex);
          const isToday = dayIndex === todayIdx;

          return (
            <div key={day} className="flex flex-col min-w-0">
              {/* Day Header */}
              <div className={cn(
                'flex items-center justify-between mb-2.5 px-1',
              )}>
                <h4 className={cn(
                  'text-xs font-bold uppercase tracking-wide hidden lg:block',
                  isToday ? 'text-primary-400' : 'text-slate-400'
                )}>
                  {day}
                </h4>
                <h4 className={cn(
                  'text-xs font-bold uppercase tracking-wide lg:hidden',
                  isToday ? 'text-primary-400' : 'text-slate-400'
                )}>
                  {DAYS_SHORT[dayIndex]}
                </h4>
                {isToday && (
                  <span className="text-[9px] font-bold text-primary-400 bg-primary-500/15 px-2 py-0.5 rounded-full">
                    TODAY
                  </span>
                )}
              </div>

              {/* Workout Cards or Rest */}
              <div className={cn(
                'flex-1 flex flex-col gap-2 min-h-[180px]',
                isToday && 'ring-2 ring-primary-500/25 rounded-xl p-1'
              )}>
                {dayWorkouts.length > 0 ? (
                  dayWorkouts.map((workout, sessionIdx) => {
                    const globalIdx = workouts.indexOf(workout);
                    return (
                      <div
                        key={globalIdx}
                        onDoubleClick={() => { if (editable) setEditingIdx(globalIdx); }}
                        className={cn(
                          'flex-1 relative',
                          editable && 'cursor-pointer hover:ring-2 hover:ring-primary-500/40 rounded-xl transition-all'
                        )}
                      >
                        {sessionIdx > 0 && (
                          <div className="absolute -top-1 right-2 z-10">
                            <span className="text-[9px] font-bold text-amber-300 bg-amber-500/20 border border-amber-500/30 px-1.5 py-0.5 rounded-full">
                              2nd
                            </span>
                          </div>
                        )}
                        <WorkoutPreview workout={workout} />
                      </div>
                    );
                  })
                ) : (
                  <div className="flex-1 bg-slate-800/20 border border-slate-700/20 border-dashed rounded-xl flex items-center justify-center">
                    <div className="text-center py-8">
                      <div className="w-8 h-8 rounded-full bg-slate-800/50 flex items-center justify-center mx-auto mb-2">
                        <span className="text-slate-600 text-lg">—</span>
                      </div>
                      <p className="text-[11px] text-slate-600 font-medium">Rest</p>
                    </div>
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
