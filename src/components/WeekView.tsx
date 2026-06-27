'use client';

import { ParsedWorkout } from '@/lib/ai/types';
import { WorkoutPreview } from './WorkoutPreview';
import { WorkoutEditor } from './WorkoutEditor';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

interface WeekViewProps {
  workouts: ParsedWorkout[];
  editable?: boolean;
  onWorkoutChange?: (index: number, workout: ParsedWorkout) => void;
}

export function WeekView({ workouts, editable = false, onWorkoutChange }: WeekViewProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 xl:grid-cols-7 gap-3">
      {DAYS.map((day, dayIndex) => {
        const dayWorkout = workouts.find((w) => w.dayOfWeek === dayIndex);
        const workoutIndex = workouts.findIndex((w) => w.dayOfWeek === dayIndex);

        return (
          <div key={day} className="min-w-0">
            <h4 className="text-xs font-medium text-slate-400 mb-2 uppercase tracking-wider">
              {day}
            </h4>
            {dayWorkout ? (
              editable && onWorkoutChange ? (
                <WorkoutEditor
                  workout={dayWorkout}
                  onChange={(w) => onWorkoutChange(workoutIndex, w)}
                />
              ) : (
                <WorkoutPreview workout={dayWorkout} />
              )
            ) : (
              <div className="card opacity-50">
                <p className="text-xs text-slate-500 text-center py-4">Rest day</p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
