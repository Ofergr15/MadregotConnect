'use client';

import { useState } from 'react';
import { notFound } from 'next/navigation';

import { WorkoutEditorPanel } from '@/components/WorkoutEditor';
import type { ParsedWorkout } from '@/lib/ai/types';

// ── The workout builder, on the workout that asked for it ─────────────────────────
//
// Week 11.10's Sunday exactly as the parse stored it: the "4 דק׳ בין סטים" rest is the
// last sub-step of the 3× hills, so the watch plays it after every set. The fix is one
// drag — the 4:00 card out of the grey frame, onto the gap above the 40-minute run —
// and the chart should then show one low grey block between the bracket and the run.
// Saved output is printed under the button so the stored shape can be read, not guessed.

const SUNDAY: ParsedWorkout = {
  dayOfWeek: 0,
  name: 'יום ראשון',
  autoFixes: [],
  steps: [
    { order: 1, type: 'warmup', durationType: 'time', durationValue: 900, targetType: 'pace', targetPaceMinPerKm: 280, targetPaceMaxPerKm: 315, group2Pace: { min: 280, max: 315 }, group3Pace: { min: 280, max: 315 } },
    {
      order: 2, type: 'interval', durationType: 'time', durationValue: 30, targetType: 'no_target', repeatCount: 3,
      repeatSteps: [
        { order: 1, type: 'interval', durationType: 'time', durationValue: 30, targetType: 'no_target', notes: 'עליה' },
        { order: 2, type: 'rest', durationType: 'open', targetType: 'no_target', notes: 'עמידה הליכה למטה' },
        { order: 3, type: 'interval', durationType: 'time', durationValue: 20, targetType: 'no_target', notes: 'עליה' },
        { order: 4, type: 'rest', durationType: 'open', targetType: 'no_target', notes: 'עמידה הליכה למטה' },
        { order: 5, type: 'interval', durationType: 'time', durationValue: 10, targetType: 'no_target', notes: 'עליה' },
        { order: 6, type: 'rest', durationType: 'time', durationValue: 240, targetType: 'no_target', notes: 'בין סטים' },
      ],
    },
    { order: 3, type: 'active', durationType: 'time', durationValue: 2400, targetType: 'pace', targetPaceMinPerKm: 255, targetPaceMaxPerKm: 255, group2Pace: { min: 265, max: 265 }, group3Pace: { min: 275, max: 275 } },
  ],
};

export default function WorkoutBuilderPreview() {
  if (process.env.NODE_ENV === 'production') notFound();
  const [workout, setWorkout] = useState<ParsedWorkout>(SUNDAY);
  const [open, setOpen] = useState(true);
  return (
    <div className="min-h-screen bg-page px-4 py-6" dir="rtl">
      <button type="button" id="open-builder" onClick={() => setOpen(true)} className="rounded-full bg-brand-600 text-white px-4 py-2 font-bold">
        עריכה
      </button>
      <pre id="saved" dir="ltr" className="mt-4 text-[10px] whitespace-pre-wrap">{JSON.stringify(workout.steps)}</pre>
      {open && (
        <WorkoutEditorPanel workout={workout} dayName="יום ראשון" onChange={setWorkout} onClose={() => setOpen(false)} />
      )}
    </div>
  );
}
