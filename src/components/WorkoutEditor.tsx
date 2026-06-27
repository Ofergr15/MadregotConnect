'use client';

import { useState } from 'react';
import { ParsedWorkout, WorkoutStep } from '@/lib/ai/types';
import { cn } from '@/lib/utils';
import { Plus, Trash2, GripVertical, ChevronDown, ChevronUp, Copy, ArrowUp, ArrowDown } from 'lucide-react';

const stepTypes = ['warmup', 'interval', 'rest', 'recovery', 'cooldown', 'active'] as const;
const durationTypes = ['distance', 'time', 'open'] as const;
const targetZones = ['easy', 'threshold', 'interval', 'tempo', 'sprint', 'marathon_pace', 'no_target'] as const;

const stepColors: Record<string, string> = {
  warmup: 'border-l-yellow-400 bg-yellow-500/5',
  interval: 'border-l-red-400 bg-red-500/5',
  rest: 'border-l-slate-400 bg-slate-500/5',
  recovery: 'border-l-green-400 bg-green-500/5',
  cooldown: 'border-l-blue-400 bg-blue-500/5',
  active: 'border-l-purple-400 bg-purple-500/5',
};

const stepLabels: Record<string, string> = {
  warmup: 'Warmup',
  interval: 'Interval',
  rest: 'Rest',
  recovery: 'Recovery',
  cooldown: 'Cooldown',
  active: 'Run',
};

const zoneLabels: Record<string, string> = {
  easy: 'Easy',
  threshold: 'Threshold',
  interval: 'Interval',
  tempo: 'Tempo',
  sprint: 'Sprint',
  marathon_pace: 'Marathon Pace',
  no_target: 'No Target',
};

interface WorkoutEditorProps {
  workout: ParsedWorkout;
  onChange: (workout: ParsedWorkout) => void;
}

function formatDuration(step: WorkoutStep): string {
  if (step.durationType === 'open') return 'Lap button';
  if (step.durationType === 'distance') {
    const m = step.durationValue || 0;
    return m >= 1000 ? `${(m / 1000).toFixed(m % 1000 === 0 ? 0 : 1)} km` : `${m} m`;
  }
  if (step.durationType === 'time') {
    const s = step.durationValue || 0;
    if (s >= 60) {
      const min = Math.floor(s / 60);
      const sec = s % 60;
      return sec > 0 ? `${min}:${sec.toString().padStart(2, '0')} min` : `${min} min`;
    }
    return `${s} sec`;
  }
  return '';
}

function formatPaceTarget(step: WorkoutStep): string {
  if (step.targetZone && step.targetZone !== 'no_target') {
    return zoneLabels[step.targetZone] || step.targetZone;
  }
  if (step.targetPaceMinPerKm && step.targetPaceMaxPerKm) {
    const min = Math.floor(step.targetPaceMinPerKm / 60);
    const minSec = step.targetPaceMinPerKm % 60;
    const max = Math.floor(step.targetPaceMaxPerKm / 60);
    const maxSec = step.targetPaceMaxPerKm % 60;
    return `${min}:${minSec.toString().padStart(2, '0')} - ${max}:${maxSec.toString().padStart(2, '0')} /km`;
  }
  return '';
}

function StepCard({
  step,
  index,
  total,
  onChange,
  onDelete,
  onMoveUp,
  onMoveDown,
  onDuplicate,
}: {
  step: WorkoutStep;
  index: number;
  total: number;
  onChange: (step: WorkoutStep) => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onDuplicate: () => void;
}) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className={cn(
      'border-l-4 rounded-lg transition-all',
      stepColors[step.type] || 'border-l-slate-400'
    )}>
      {/* Compact View */}
      <div
        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-slate-700/30"
        onClick={() => setExpanded(!expanded)}
      >
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span className="text-xs text-slate-500 w-5">{index + 1}</span>
          <span className={cn(
            'text-xs font-semibold px-2 py-0.5 rounded',
            step.type === 'interval' ? 'bg-red-500/20 text-red-400' :
            step.type === 'warmup' ? 'bg-yellow-500/20 text-yellow-400' :
            step.type === 'cooldown' ? 'bg-blue-500/20 text-blue-400' :
            step.type === 'rest' ? 'bg-slate-500/20 text-slate-400' :
            step.type === 'recovery' ? 'bg-green-500/20 text-green-400' :
            'bg-purple-500/20 text-purple-400'
          )}>
            {stepLabels[step.type]}
          </span>
          <span className="text-sm text-white font-medium">{formatDuration(step)}</span>
          {formatPaceTarget(step) && (
            <span className="text-xs text-slate-400">@ {formatPaceTarget(step)}</span>
          )}
          {step.repeatCount && (
            <span className="text-xs bg-orange-500/20 text-orange-400 px-1.5 py-0.5 rounded">
              {step.repeatCount}x
            </span>
          )}
          {(step as any).notes && (
            <span className="text-xs text-slate-500 truncate max-w-[150px]">{(step as any).notes}</span>
          )}
        </div>
        {expanded ? <ChevronUp className="h-4 w-4 text-slate-400" /> : <ChevronDown className="h-4 w-4 text-slate-400" />}
      </div>

      {/* Expanded Edit View */}
      {expanded && (
        <div className="px-4 pb-4 space-y-3 border-t border-slate-700/50 pt-3">
          <div className="grid grid-cols-2 gap-3">
            {/* Step Type */}
            <div>
              <label className="text-xs text-slate-400 mb-1 block">Type</label>
              <select
                value={step.type}
                onChange={(e) => onChange({ ...step, type: e.target.value as any })}
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:ring-2 focus:ring-primary-500 focus:outline-none"
              >
                {stepTypes.map((t) => (
                  <option key={t} value={t}>{stepLabels[t]}</option>
                ))}
              </select>
            </div>

            {/* Duration Type */}
            <div>
              <label className="text-xs text-slate-400 mb-1 block">Duration</label>
              <select
                value={step.durationType}
                onChange={(e) => onChange({ ...step, durationType: e.target.value as any })}
                className="w-full bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:ring-2 focus:ring-primary-500 focus:outline-none"
              >
                <option value="distance">Distance</option>
                <option value="time">Time</option>
                <option value="open">Lap Button</option>
              </select>
            </div>
          </div>

          {/* Duration Value */}
          {step.durationType !== 'open' && (
            <div>
              <label className="text-xs text-slate-400 mb-1 block">
                {step.durationType === 'distance' ? 'Distance (meters)' : 'Time (seconds)'}
              </label>
              <div className="flex gap-2">
                <input
                  type="number"
                  value={step.durationValue || ''}
                  onChange={(e) => onChange({ ...step, durationValue: parseInt(e.target.value) || 0 })}
                  className="flex-1 bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:ring-2 focus:ring-primary-500 focus:outline-none"
                />
                {step.durationType === 'distance' && (
                  <div className="flex gap-1">
                    {[200, 400, 800, 1000, 2000].map(d => (
                      <button
                        key={d}
                        onClick={() => onChange({ ...step, durationValue: d })}
                        className={cn(
                          'px-2 py-1 rounded text-xs transition-colors',
                          step.durationValue === d ? 'bg-primary-600 text-white' : 'bg-slate-700 text-slate-400 hover:text-white'
                        )}
                      >
                        {d >= 1000 ? `${d/1000}k` : d}
                      </button>
                    ))}
                  </div>
                )}
                {step.durationType === 'time' && (
                  <div className="flex gap-1">
                    {[30, 60, 90, 120, 300, 600].map(t => (
                      <button
                        key={t}
                        onClick={() => onChange({ ...step, durationValue: t })}
                        className={cn(
                          'px-2 py-1 rounded text-xs transition-colors',
                          step.durationValue === t ? 'bg-primary-600 text-white' : 'bg-slate-700 text-slate-400 hover:text-white'
                        )}
                      >
                        {t >= 60 ? `${t/60}m` : `${t}s`}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Pace Target */}
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Target Pace</label>
            <div className="grid grid-cols-3 gap-2">
              <select
                value={step.targetZone || 'no_target'}
                onChange={(e) => {
                  const zone = e.target.value;
                  if (zone === 'no_target') {
                    onChange({ ...step, targetType: 'no_target', targetZone: undefined, targetPaceMinPerKm: undefined, targetPaceMaxPerKm: undefined });
                  } else {
                    onChange({ ...step, targetType: 'pace', targetZone: zone, targetPaceMinPerKm: undefined, targetPaceMaxPerKm: undefined });
                  }
                }}
                className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:ring-2 focus:ring-primary-500 focus:outline-none"
              >
                {targetZones.map((z) => (
                  <option key={z} value={z}>{zoneLabels[z]}</option>
                ))}
                <option value="custom">Custom Pace</option>
              </select>
              {(step.targetPaceMinPerKm || (!step.targetZone && step.targetType === 'pace')) && (
                <>
                  <input
                    type="text"
                    value={step.targetPaceMinPerKm ? `${Math.floor(step.targetPaceMinPerKm / 60)}:${(step.targetPaceMinPerKm % 60).toString().padStart(2, '0')}` : ''}
                    onChange={(e) => {
                      const parts = e.target.value.split(':');
                      if (parts.length === 2) {
                        const secs = parseInt(parts[0]) * 60 + parseInt(parts[1]);
                        if (!isNaN(secs)) onChange({ ...step, targetType: 'pace', targetZone: undefined, targetPaceMinPerKm: secs });
                      }
                    }}
                    placeholder="Min (4:00)"
                    className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:ring-2 focus:ring-primary-500 focus:outline-none"
                  />
                  <input
                    type="text"
                    value={step.targetPaceMaxPerKm ? `${Math.floor(step.targetPaceMaxPerKm / 60)}:${(step.targetPaceMaxPerKm % 60).toString().padStart(2, '0')}` : ''}
                    onChange={(e) => {
                      const parts = e.target.value.split(':');
                      if (parts.length === 2) {
                        const secs = parseInt(parts[0]) * 60 + parseInt(parts[1]);
                        if (!isNaN(secs)) onChange({ ...step, targetPaceMaxPerKm: secs });
                      }
                    }}
                    placeholder="Max (4:30)"
                    className="bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:ring-2 focus:ring-primary-500 focus:outline-none"
                  />
                </>
              )}
            </div>
          </div>

          {/* Repeat */}
          <div>
            <label className="text-xs text-slate-400 mb-1 block">Repeat</label>
            <div className="flex items-center gap-2">
              <input
                type="number"
                value={step.repeatCount || ''}
                onChange={(e) => onChange({ ...step, repeatCount: parseInt(e.target.value) || undefined })}
                placeholder="1"
                min={1}
                className="w-16 bg-slate-700 border border-slate-600 rounded-lg px-3 py-2 text-sm text-white focus:ring-2 focus:ring-primary-500 focus:outline-none"
              />
              <span className="text-xs text-slate-400">times</span>
            </div>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 pt-2 border-t border-slate-700/50">
            <button
              onClick={onMoveUp}
              disabled={index === 0}
              className="p-1.5 rounded hover:bg-slate-700 text-slate-400 hover:text-white disabled:opacity-30 transition-colors"
            >
              <ArrowUp className="h-4 w-4" />
            </button>
            <button
              onClick={onMoveDown}
              disabled={index === total - 1}
              className="p-1.5 rounded hover:bg-slate-700 text-slate-400 hover:text-white disabled:opacity-30 transition-colors"
            >
              <ArrowDown className="h-4 w-4" />
            </button>
            <button
              onClick={onDuplicate}
              className="p-1.5 rounded hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
            >
              <Copy className="h-4 w-4" />
            </button>
            <button
              onClick={onDelete}
              className="p-1.5 rounded hover:bg-slate-700 text-red-400 hover:text-red-300 ml-auto transition-colors"
            >
              <Trash2 className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
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

  const moveStep = (index: number, direction: 'up' | 'down') => {
    const newSteps = [...workout.steps];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= newSteps.length) return;
    [newSteps[index], newSteps[targetIndex]] = [newSteps[targetIndex], newSteps[index]];
    onChange({ ...workout, steps: newSteps });
  };

  const duplicateStep = (index: number) => {
    const newSteps = [...workout.steps];
    newSteps.splice(index + 1, 0, { ...newSteps[index], order: index + 2 });
    onChange({ ...workout, steps: newSteps });
  };

  const addStep = () => {
    const newStep: WorkoutStep = {
      order: workout.steps.length + 1,
      type: 'interval',
      durationType: 'time',
      durationValue: 60,
      targetType: 'no_target',
    };
    onChange({ ...workout, steps: [...workout.steps, newStep] });
  };

  return (
    <div className="bg-slate-800 rounded-xl border border-slate-700 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-slate-700 flex items-center gap-3">
        <input
          value={workout.name}
          onChange={(e) => onChange({ ...workout, name: e.target.value })}
          className="bg-transparent text-white font-semibold text-sm focus:outline-none focus:ring-0 border-none flex-1"
          placeholder="Workout name"
        />
        <span className="text-xs text-slate-500">{workout.steps.length} steps</span>
      </div>

      {/* Steps */}
      <div className="divide-y divide-slate-700/50">
        {workout.steps.map((step, i) => (
          <StepCard
            key={i}
            step={step}
            index={i}
            total={workout.steps.length}
            onChange={(s) => updateStep(i, s)}
            onDelete={() => deleteStep(i)}
            onMoveUp={() => moveStep(i, 'up')}
            onMoveDown={() => moveStep(i, 'down')}
            onDuplicate={() => duplicateStep(i)}
          />
        ))}
      </div>

      {/* Add Step */}
      <div className="px-4 py-3 border-t border-slate-700">
        <button
          onClick={addStep}
          className="flex items-center gap-2 text-sm text-primary-400 hover:text-primary-300 transition-colors"
        >
          <Plus className="h-4 w-4" /> Add Step
        </button>
      </div>
    </div>
  );
}
