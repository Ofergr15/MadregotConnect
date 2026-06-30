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
  const [editingDay, setEditingDay] = useState<number | null>(null);

  const editingWorkout = editingDay !== null ? workouts.find(w => w.dayOfWeek === editingDay) : null;
  const editingIndex = editingDay !== null ? workouts.findIndex(w => w.dayOfWeek === editingDay) : -1;
  const todayIdx = new Date().getDay();

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-3">
        {DAYS.map((day, dayIndex) => {
          const dayWorkout = workouts.find((w) => w.dayOfWeek === dayIndex);
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

              {/* Workout Card or Rest */}
              <div className={cn(
                'flex-1 min-h-[180px]',
                isToday && 'ring-2 ring-primary-500/25 rounded-xl'
              )}>
                {dayWorkout ? (
                  <div
                    onDoubleClick={() => { if (editable) setEditingDay(dayIndex); }}
                    className={cn(
                      'h-full',
                      editable && 'cursor-pointer hover:ring-2 hover:ring-primary-500/40 rounded-xl transition-all'
                    )}
                  >
                    <WorkoutPreview workout={dayWorkout} />
                  </div>
                ) : (
                  <div className="h-full bg-slate-800/20 border border-slate-700/20 border-dashed rounded-xl flex items-center justify-center">
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

      {editable && editingWorkout && editingDay !== null && (
        <WorkoutEditorPanel
          workout={editingWorkout}
          dayName={DAYS[editingDay]}
          onChange={(w) => onWorkoutChange?.(editingIndex, w)}
          onClose={() => setEditingDay(null)}
        />
      )}
    </>
  );
}
