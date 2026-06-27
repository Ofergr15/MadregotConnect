'use client';

import { useState } from 'react';
import { ParsedWorkout, WorkoutStep } from '@/lib/ai/types';
import { cn } from '@/lib/utils';
import { Plus, Trash2, X, Copy, ArrowUp, ArrowDown, ChevronDown, ChevronRight } from 'lucide-react';

const stepTypes = ['warmup', 'interval', 'rest', 'recovery', 'cooldown', 'active'] as const;
const targetZones = ['easy', 'threshold', 'interval', 'tempo', 'sprint', 'marathon_pace', 'no_target'] as const;

const stepColors: Record<string, string> = {
  warmup: 'border-l-yellow-400',
  interval: 'border-l-red-400',
  rest: 'border-l-slate-400',
  recovery: 'border-l-green-400',
  cooldown: 'border-l-blue-400',
  active: 'border-l-purple-400',
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
  marathon_pace: 'Marathon',
  no_target: 'No Target',
};

function formatDuration(step: WorkoutStep): string {
  if (step.durationType === 'open') return 'Lap button';
  if (step.durationType === 'distance') {
    const m = step.durationValue || 0;
    return m >= 1000 ? `${(m / 1000).toFixed(m % 1000 === 0 ? 0 : 1)} km` : `${m} m`;
  }
  if (step.durationType === 'time') {
    const s = step.durationValue || 0;
    if (s >= 3600) {
      const h = Math.floor(s / 3600);
      const min = Math.floor((s % 3600) / 60);
      return min > 0 ? `${h}:${min.toString().padStart(2, '0')}:00` : `${h}:00:00`;
    }
    if (s >= 60) {
      const min = Math.floor(s / 60);
      const sec = s % 60;
      return sec > 0 ? `${min}:${sec.toString().padStart(2, '0')}` : `${min}:00`;
    }
    return `0:${s.toString().padStart(2, '0')}`;
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
    return `${min}:${minSec.toString().padStart(2, '0')}-${max}:${maxSec.toString().padStart(2, '0')}/km`;
  }
  return '';
}

function StepRow({
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
    <div className={cn('border-l-3 rounded-md', stepColors[step.type] || 'border-l-slate-400')}>
      <div
        className="flex items-center gap-2 px-3 py-2.5 cursor-pointer hover:bg-slate-700/30 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="text-[10px] text-slate-500 w-4 text-right">{index + 1}</span>
        <span className={cn(
          'text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide',
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
          <span className="text-[11px] text-primary-400 ml-auto mr-1">@{formatPaceTarget(step)}</span>
        )}
        {step.repeatCount && (
          <span className="text-[10px] bg-orange-500/20 text-orange-400 px-1.5 py-0.5 rounded font-bold">
            {step.repeatCount}x
          </span>
        )}
        {expanded ? <ChevronDown className="h-3.5 w-3.5 text-slate-500 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-500 shrink-0" />}
      </div>

      {expanded && (
        <div className="px-3 pb-3 space-y-3 border-t border-slate-700/50 pt-3 ml-4">
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-slate-500 uppercase tracking-wide mb-1 block">Type</label>
              <select
                value={step.type}
                onChange={(e) => onChange({ ...step, type: e.target.value as any })}
                className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-xs text-white"
              >
                {stepTypes.map((t) => (
                  <option key={t} value={t}>{stepLabels[t]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-slate-500 uppercase tracking-wide mb-1 block">Duration</label>
              <select
                value={step.durationType}
                onChange={(e) => onChange({ ...step, durationType: e.target.value as any })}
                className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-xs text-white"
              >
                <option value="distance">Distance</option>
                <option value="time">Time</option>
                <option value="open">Lap Button</option>
              </select>
            </div>
          </div>

          {step.durationType !== 'open' && (
            <div>
              <label className="text-[10px] text-slate-500 uppercase tracking-wide mb-1 block">
                {step.durationType === 'distance' ? 'Meters' : 'Seconds'}
              </label>
              <input
                type="number"
                value={step.durationValue || ''}
                onChange={(e) => onChange({ ...step, durationValue: parseInt(e.target.value) || 0 })}
                className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-xs text-white"
              />
            </div>
          )}

          <div>
            <label className="text-[10px] text-slate-500 uppercase tracking-wide mb-1 block">Target</label>
            <div className="grid grid-cols-3 gap-2">
              <select
                value={step.targetZone || (step.targetPaceMinPerKm ? 'custom' : 'no_target')}
                onChange={(e) => {
                  const zone = e.target.value;
                  if (zone === 'no_target') {
                    onChange({ ...step, targetType: 'no_target', targetZone: undefined, targetPaceMinPerKm: undefined, targetPaceMaxPerKm: undefined });
                  } else if (zone === 'custom') {
                    onChange({ ...step, targetType: 'pace', targetZone: undefined });
                  } else {
                    onChange({ ...step, targetType: 'pace', targetZone: zone, targetPaceMinPerKm: undefined, targetPaceMaxPerKm: undefined });
                  }
                }}
                className="bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-xs text-white"
              >
                {targetZones.map((z) => (
                  <option key={z} value={z}>{zoneLabels[z]}</option>
                ))}
                <option value="custom">Custom</option>
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
                    placeholder="4:00"
                    className="bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-xs text-white"
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
                    placeholder="4:30"
                    className="bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-xs text-white"
                  />
                </>
              )}
            </div>
          </div>

          {step.repeatCount !== undefined && (
            <div>
              <label className="text-[10px] text-slate-500 uppercase tracking-wide mb-1 block">Repeat</label>
              <input
                type="number"
                value={step.repeatCount || ''}
                onChange={(e) => onChange({ ...step, repeatCount: parseInt(e.target.value) || undefined })}
                min={1}
                className="w-20 bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-xs text-white"
              />
            </div>
          )}

          <div className="flex items-center gap-1 pt-1">
            <button onClick={onMoveUp} disabled={index === 0} className="p-1 rounded hover:bg-slate-700 text-slate-400 disabled:opacity-30"><ArrowUp className="h-3.5 w-3.5" /></button>
            <button onClick={onMoveDown} disabled={index === total - 1} className="p-1 rounded hover:bg-slate-700 text-slate-400 disabled:opacity-30"><ArrowDown className="h-3.5 w-3.5" /></button>
            <button onClick={onDuplicate} className="p-1 rounded hover:bg-slate-700 text-slate-400"><Copy className="h-3.5 w-3.5" /></button>
            <button onClick={onDelete} className="p-1 rounded hover:bg-slate-700 text-red-400 ml-auto"><Trash2 className="h-3.5 w-3.5" /></button>
          </div>
        </div>
      )}
    </div>
  );
}

interface WorkoutEditorPanelProps {
  workout: ParsedWorkout;
  dayName: string;
  onChange: (workout: ParsedWorkout) => void;
  onClose: () => void;
}

export function WorkoutEditorPanel({ workout, dayName, onChange, onClose }: WorkoutEditorPanelProps) {
  const updateStep = (index: number, step: WorkoutStep) => {
    const newSteps = [...workout.steps];
    newSteps[index] = step;
    onChange({ ...workout, steps: newSteps });
  };

  const deleteStep = (index: number) => {
    onChange({ ...workout, steps: workout.steps.filter((_, i) => i !== index) });
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
    <div className="fixed inset-0 bg-black/60 z-50 flex justify-end" onClick={onClose}>
      <div
        className="w-full max-w-md bg-slate-900 border-l border-slate-700 h-full overflow-hidden flex flex-col animate-slide-in-right"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700 shrink-0">
          <div>
            <h3 className="font-semibold text-sm text-white">{dayName}</h3>
            <input
              value={workout.name}
              onChange={(e) => onChange({ ...workout, name: e.target.value })}
              className="bg-transparent text-xs text-slate-400 focus:outline-none focus:text-white mt-0.5 w-full"
              placeholder="Workout name"
            />
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-400">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Steps */}
        <div className="flex-1 overflow-y-auto divide-y divide-slate-800">
          {workout.steps.map((step, i) => (
            <StepRow
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

        {/* Footer */}
        <div className="px-4 py-3 border-t border-slate-700 shrink-0">
          <button
            onClick={addStep}
            className="flex items-center gap-2 text-sm text-primary-400 hover:text-primary-300"
          >
            <Plus className="h-4 w-4" /> Add Step
          </button>
        </div>
      </div>
    </div>
  );
}

// Keep backward compatibility export
export function WorkoutEditor({ workout, onChange }: { workout: ParsedWorkout; onChange: (w: ParsedWorkout) => void }) {
  return (
    <WorkoutEditorPanel
      workout={workout}
      dayName={workout.name}
      onChange={onChange}
      onClose={() => {}}
    />
  );
}
