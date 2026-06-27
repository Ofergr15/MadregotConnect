'use client';

import { useState } from 'react';
import { ParsedWorkout } from '@/lib/ai/types';
import { WorkoutPreview } from './WorkoutPreview';
import { WorkoutEditorPanel } from './WorkoutEditor';

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

  return (
    <>
      <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-7 gap-2 h-[420px]">
        {DAYS.map((day, dayIndex) => {
          const dayWorkout = workouts.find((w) => w.dayOfWeek === dayIndex);

          return (
            <div key={day} className="flex flex-col min-w-0 min-h-0">
              <h4 className="text-[10px] font-medium text-slate-400 mb-1.5 uppercase tracking-wider shrink-0 hidden lg:block">
                {day}
              </h4>
              <h4 className="text-[10px] font-medium text-slate-400 mb-1.5 uppercase tracking-wider shrink-0 lg:hidden">
                {DAYS_SHORT[dayIndex]}
              </h4>
              <div className="flex-1 min-h-0 overflow-y-auto scrollbar-thin">
                {dayWorkout ? (
                  <div
                    onClick={() => { if (editable) setEditingDay(dayIndex); }}
                    className={editable ? 'cursor-pointer hover:ring-1 hover:ring-primary-500/50 rounded-lg transition-all' : ''}
                  >
                    <WorkoutPreview workout={dayWorkout} />
                  </div>
                ) : (
                  <div className="bg-slate-800/50 border border-slate-700/50 rounded-lg p-3">
                    <p className="text-[10px] text-slate-500 text-center">Rest</p>
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
