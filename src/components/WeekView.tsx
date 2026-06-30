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
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-2.5">
        {DAYS.map((day, dayIndex) => {
          const dayWorkout = workouts.find((w) => w.dayOfWeek === dayIndex);
          const isToday = dayIndex === todayIdx;

          return (
            <div key={day} className="flex flex-col min-w-0">
              {/* Day Header */}
              <div className={cn(
                'flex items-center justify-between mb-2 px-1',
                isToday && 'relative'
              )}>
                <div>
                  <h4 className="text-[10px] font-bold text-slate-300 uppercase tracking-wider hidden lg:block">
                    {day}
                  </h4>
                  <h4 className="text-[10px] font-bold text-slate-300 uppercase tracking-wider lg:hidden">
                    {DAYS_SHORT[dayIndex]}
                  </h4>
                </div>
                {isToday && (
                  <span className="text-[8px] font-bold text-primary-400 bg-primary-400/10 px-1.5 py-0.5 rounded">
                    TODAY
                  </span>
                )}
              </div>

              {/* Workout Card or Rest */}
              <div className={cn(
                'flex-1 min-h-[140px]',
                isToday && 'ring-1 ring-primary-500/30 rounded-lg'
              )}>
                {dayWorkout ? (
                  <div
                    onClick={() => { if (editable) setEditingDay(dayIndex); }}
                    className={cn(
                      'h-full',
                      editable && 'cursor-pointer hover:ring-1 hover:ring-primary-500/50 rounded-lg transition-all'
                    )}
                  >
                    <WorkoutPreview workout={dayWorkout} />
                  </div>
                ) : (
                  <div className="h-full bg-slate-800/30 border border-slate-700/30 border-dashed rounded-lg flex items-center justify-center">
                    <div className="text-center py-6">
                      <p className="text-[10px] text-slate-600 font-medium">Rest Day</p>
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
