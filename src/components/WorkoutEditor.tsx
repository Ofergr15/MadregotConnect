'use client';

import { useState } from 'react';
import { ParsedWorkout, WorkoutStep } from '@/lib/ai/types';
import { formatPace, parsePaceString } from '@/lib/garmin/pace';
import { cn } from '@/lib/utils';
import { Plus, Trash2, GripVertical } from 'lucide-react';

const stepTypes = ['warmup', 'interval', 'rest', 'recovery', 'cooldown', 'active'] as const;
const durationTypes = ['distance', 'time', 'open'] as const;
const targetZones = ['easy', 'threshold', 'interval', 'tempo', 'sprint', 'marathon_pace'] as const;

interface WorkoutEditorProps {
  workout: ParsedWorkout;
  onChange: (workout: ParsedWorkout) => void;
}

function StepEditor({
  step,
  onChange,
  onDelete,
}: {
  step: WorkoutStep;
  onChange: (step: WorkoutStep) => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center gap-2 py-2 px-3 bg-slate-700/50 rounded-lg">
      <GripVertical className="h-4 w-4 text-slate-500 cursor-grab" />

      <select
        value={step.type}
        onChange={(e) => onChange({ ...step, type: e.target.value as any })}
        className="input text-xs py-1 px-2 w-24"
      >
        {stepTypes.map((t) => (
          <option key={t} value={t}>{t}</option>
        ))}
      </select>

      <select
        value={step.durationType}
        onChange={(e) => onChange({ ...step, durationType: e.target.value as any })}
        className="input text-xs py-1 px-2 w-24"
      >
        {durationTypes.map((t) => (
          <option key={t} value={t}>{t}</option>
        ))}
      </select>

      {step.durationType === 'distance' && (
        <input
          type="number"
          value={step.durationValue || ''}
          onChange={(e) => onChange({ ...step, durationValue: parseInt(e.target.value) || 0 })}
          placeholder="meters"
          className="input text-xs py-1 px-2 w-20"
        />
      )}

      {step.durationType === 'time' && (
        <input
          type="number"
          value={step.durationValue || ''}
          onChange={(e) => onChange({ ...step, durationValue: parseInt(e.target.value) || 0 })}
          placeholder="seconds"
          className="input text-xs py-1 px-2 w-20"
        />
      )}

      <select
        value={step.targetZone || 'no_target'}
        onChange={(e) => {
          const zone = e.target.value;
          if (zone === 'no_target') {
            onChange({ ...step, targetType: 'no_target', targetZone: undefined });
          } else {
            onChange({ ...step, targetType: 'pace', targetZone: zone });
          }
        }}
        className="input text-xs py-1 px-2 w-28"
      >
        <option value="no_target">No target</option>
        {targetZones.map((z) => (
          <option key={z} value={z}>{z}</option>
        ))}
      </select>

      <button onClick={onDelete} className="text-red-400 hover:text-red-300 ml-auto">
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}

export function WorkoutEditor({ workout, onChange }: WorkoutEditorProps) {
  const updateStep = (index: number, step: WorkoutStep) => {
    const newSteps = [...workout.steps];
    newSteps[index] = step;
    onChange({ ...workout, steps: newSteps });
  };

  const deleteStep = (index: number) => {
    const newSteps = workout.steps.filter((_, i) => i !== index);
    onChange({ ...workout, steps: newSteps });
  };

  const addStep = () => {
    const newStep: WorkoutStep = {
      order: workout.steps.length + 1,
      type: 'active',
      durationType: 'distance',
      durationValue: 1000,
      targetType: 'no_target',
    };
    onChange({ ...workout, steps: [...workout.steps, newStep] });
  };

  return (
    <div className="card">
      <div className="flex items-center justify-between mb-3">
        <input
          value={workout.name}
          onChange={(e) => onChange({ ...workout, name: e.target.value })}
          className="input text-sm font-semibold py-1"
        />
      </div>

      <div className="space-y-1">
        {workout.steps.map((step, i) => (
          <StepEditor
            key={i}
            step={step}
            onChange={(s) => updateStep(i, s)}
            onDelete={() => deleteStep(i)}
          />
        ))}
      </div>

      <button
        onClick={addStep}
        className="flex items-center gap-1 text-xs text-primary-400 hover:text-primary-300 mt-2"
      >
        <Plus className="h-3 w-3" /> Add step
      </button>
    </div>
  );
}
