'use client';

import { useState, useEffect } from 'react';
import { ParsedWorkout, WorkoutStep } from '@/lib/ai/types';
import { cn } from '@/lib/utils';
import { Plus, Trash2, X, Copy, ArrowUp, ArrowDown, ChevronDown, ChevronRight, Save, AlertCircle } from 'lucide-react';

const stepTypes = ['warmup', 'interval', 'rest', 'recovery', 'cooldown', 'active'] as const;
const targetZones = ['easy', 'threshold', 'interval', 'tempo', 'sprint', 'marathon_pace', 'no_target'] as const;

const stepColors: Record<string, string> = {
  warmup: 'border-s-yellow-400',
  interval: 'border-s-red-400',
  rest: 'border-s-slate-400',
  recovery: 'border-s-green-400',
  cooldown: 'border-s-blue-400',
  active: 'border-s-purple-400',
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

function formatSingleDuration(step: WorkoutStep): string {
  if (step.durationType === 'open') return 'Lap button';
  if (step.durationType === 'distance') {
    const m = step.durationValue || 0;
    return m >= 1000 ? `${(m / 1000).toFixed(m % 1000 === 0 ? 0 : 1)} km` : `${m} m`;
  }
  if (step.durationType === 'time') {
    const s = step.durationValue || 0;
    if (s === 0) return '';
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

function formatDuration(step: WorkoutStep): string {
  // For repeat blocks, summarize the sub-steps so the rest segment is visible
  // even when the row is collapsed, e.g. "0:30 + 1:00".
  if (step.repeatCount) {
    if (step.repeatSteps && step.repeatSteps.length > 0) {
      return step.repeatSteps.map(formatSingleDuration).filter(Boolean).join(' + ');
    }
    return '';
  }
  return formatSingleDuration(step);
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

function paceToInput(secs?: number): string {
  if (!secs) return '';
  return `${Math.floor(secs / 60)}:${(secs % 60).toString().padStart(2, '0')}`;
}

function inputToPace(value: string): number | undefined {
  const parts = value.split(':');
  if (parts.length !== 2) return undefined;
  const secs = parseInt(parts[0]) * 60 + parseInt(parts[1]);
  return isNaN(secs) ? undefined : secs;
}

/**
 * Pace text field (M:SS per km). Keeps its own local text while typing so the
 * value doesn't snap back mid-keystroke, and only commits a parsed value on
 * blur or Enter. Fixes the "changing the number doesn't work" bug.
 */
function PaceInput({
  seconds,
  onCommit,
  placeholder,
  label,
}: {
  seconds?: number;
  onCommit: (secs: number | undefined) => void;
  placeholder?: string;
  label?: string;
}) {
  const [text, setText] = useState(paceToInput(seconds));
  const [focused, setFocused] = useState(false);

  // While not focused, mirror the external value; while typing, leave it alone.
  if (!focused && text !== paceToInput(seconds)) {
    setText(paceToInput(seconds));
  }

  const commit = () => {
    const trimmed = text.trim();
    if (trimmed === '') { onCommit(undefined); return; }
    const secs = inputToPace(trimmed);
    if (secs !== undefined) onCommit(secs);
    else setText(paceToInput(seconds)); // revert invalid input
  };

  return (
    <div className="flex flex-col">
      {label && <span className="text-[9px] text-slate-500 mb-0.5">{label}</span>}
      <input
        type="text"
        inputMode="numeric"
        value={text}
        onFocus={() => setFocused(true)}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => { setFocused(false); commit(); }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        placeholder={placeholder}
        className="bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-xs text-white w-full"
      />
    </div>
  );
}

/**
 * Compact inline editor for a single step INSIDE a repeat block
 * (e.g. the "run" and the "60s rest" that repeat together). Without this,
 * rest/recovery segments inside repeats were invisible and uneditable.
 */
function SubStepEditor({
  step,
  onChange,
  onDelete,
}: {
  step: WorkoutStep;
  onChange: (step: WorkoutStep) => void;
  onDelete: () => void;
}) {
  return (
    <div className="bg-slate-800/50 rounded-md p-2 space-y-2">
      <div className="flex items-center gap-2">
        <select
          value={step.type}
          onChange={(e) => onChange({ ...step, type: e.target.value as any })}
          className="bg-slate-700 border border-slate-600 rounded px-1.5 py-1 text-[11px] text-white"
        >
          {stepTypes.map((t) => (
            <option key={t} value={t}>{stepLabels[t]}</option>
          ))}
        </select>
        <select
          value={step.durationType}
          onChange={(e) => onChange({ ...step, durationType: e.target.value as any })}
          className="bg-slate-700 border border-slate-600 rounded px-1.5 py-1 text-[11px] text-white"
        >
          <option value="distance">Distance</option>
          <option value="time">Time</option>
          <option value="open">Lap</option>
        </select>
        {step.durationType !== 'open' && (
          <input
            type="number"
            value={step.durationValue || ''}
            onChange={(e) => onChange({ ...step, durationValue: parseInt(e.target.value) || 0 })}
            placeholder={step.durationType === 'distance' ? 'm' : 'sec'}
            className="w-16 bg-slate-700 border border-slate-600 rounded px-1.5 py-1 text-[11px] text-white"
          />
        )}
        <span className="text-[10px] text-slate-500">
          {step.durationType === 'distance' ? 'm' : step.durationType === 'time' ? 'sec' : ''}
        </span>
        <button onClick={onDelete} className="p-1 rounded hover:bg-slate-700 text-red-400 ms-auto">
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
      <div className="flex items-end gap-2">
        <div className="w-20">
          <PaceInput
            label="From /km"
            seconds={step.targetPaceMinPerKm}
            placeholder="3:20"
            onCommit={(secs) => onChange({ ...step, targetType: 'pace', targetPaceMinPerKm: secs })}
          />
        </div>
        <div className="w-20">
          <PaceInput
            label="To /km"
            seconds={step.targetPaceMaxPerKm}
            placeholder="3:30"
            onCommit={(secs) => onChange({ ...step, targetPaceMaxPerKm: secs })}
          />
        </div>
        <input
          type="text"
          value={step.notes || ''}
          onChange={(e) => onChange({ ...step, notes: e.target.value || undefined })}
          placeholder="notes"
          className="flex-1 bg-slate-700 border border-slate-600 rounded px-1.5 py-1 text-[11px] text-white"
        />
      </div>
    </div>
  );
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
    <div className={cn('border-s-3 rounded-md', stepColors[step.type] || 'border-s-slate-400')}>
      <div
        className="flex items-center gap-2 px-3 py-2.5 cursor-pointer hover:bg-slate-700/30 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="text-[10px] text-slate-500 w-4 text-end">{index + 1}</span>
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
          <span className="text-[11px] text-primary-400 ms-auto me-1">@{formatPaceTarget(step)}</span>
        )}
        {step.repeatCount && (
          <span className="text-[10px] bg-orange-500/20 text-orange-400 px-1.5 py-0.5 rounded font-bold">
            {step.repeatCount}x
          </span>
        )}
        {step.notes && (
          <span className="text-[10px] text-slate-500 truncate max-w-[120px]">{step.notes}</span>
        )}
        {expanded ? <ChevronDown className="h-3.5 w-3.5 text-slate-500 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 text-slate-500 shrink-0" />}
      </div>

      {expanded && (
        <div className="px-3 pb-3 space-y-3 border-t border-slate-700/50 pt-3 ms-4">
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
            <div className="grid grid-cols-3 gap-2 items-end">
              <div className="flex flex-col">
                <span className="text-[9px] text-slate-500 mb-0.5">Type</span>
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
              </div>
              {(step.targetPaceMinPerKm || (!step.targetZone && step.targetType === 'pace')) && (
                <>
                  <PaceInput
                    label="From (fast) /km"
                    seconds={step.targetPaceMinPerKm}
                    placeholder="3:20"
                    onCommit={(secs) => onChange({ ...step, targetType: 'pace', targetZone: undefined, targetPaceMinPerKm: secs })}
                  />
                  <PaceInput
                    label="To (slow) /km"
                    seconds={step.targetPaceMaxPerKm}
                    placeholder="3:30"
                    onCommit={(secs) => onChange({ ...step, targetPaceMaxPerKm: secs })}
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

          {/* Sub-steps inside a repeat block (e.g. the interval + its rest) */}
          {step.repeatSteps && step.repeatSteps.length > 0 && (
            <div>
              <label className="text-[10px] text-slate-500 uppercase tracking-wide mb-1 block">
                Repeated steps ({step.repeatCount || 1}x)
              </label>
              <div className="space-y-2 ms-2 border-s-2 border-orange-500/30 ps-2">
                {step.repeatSteps.map((sub, subIdx) => (
                  <SubStepEditor
                    key={subIdx}
                    step={sub}
                    onChange={(updated) => {
                      const newSubs = [...step.repeatSteps!];
                      newSubs[subIdx] = updated;
                      onChange({ ...step, repeatSteps: newSubs });
                    }}
                    onDelete={() => {
                      const newSubs = step.repeatSteps!.filter((_, i) => i !== subIdx);
                      onChange({ ...step, repeatSteps: newSubs });
                    }}
                  />
                ))}
                <button
                  onClick={() => {
                    const newSub: WorkoutStep = {
                      order: (step.repeatSteps?.length || 0) + 1,
                      type: 'rest',
                      durationType: 'time',
                      durationValue: 60,
                      targetType: 'no_target',
                    };
                    onChange({ ...step, repeatSteps: [...(step.repeatSteps || []), newSub] });
                  }}
                  className="flex items-center gap-1 text-[11px] text-primary-400 hover:text-primary-300"
                >
                  <Plus className="h-3 w-3" /> Add sub-step
                </button>
              </div>
            </div>
          )}

          <div>
            <label className="text-[10px] text-slate-500 uppercase tracking-wide mb-1 block">Notes</label>
            <input
              type="text"
              value={step.notes || ''}
              onChange={(e) => onChange({ ...step, notes: e.target.value || undefined })}
              placeholder="e.g. ג׳ל, הליכה..."
              className="w-full bg-slate-700 border border-slate-600 rounded px-2 py-1.5 text-xs text-white"
            />
          </div>

          <div className="flex items-center gap-1 pt-1">
            <button onClick={onMoveUp} disabled={index === 0} className="p-1 rounded hover:bg-slate-700 text-slate-400 disabled:opacity-30"><ArrowUp className="h-3.5 w-3.5" /></button>
            <button onClick={onMoveDown} disabled={index === total - 1} className="p-1 rounded hover:bg-slate-700 text-slate-400 disabled:opacity-30"><ArrowDown className="h-3.5 w-3.5" /></button>
            <button onClick={onDuplicate} className="p-1 rounded hover:bg-slate-700 text-slate-400"><Copy className="h-3.5 w-3.5" /></button>
            <button onClick={onDelete} className="p-1 rounded hover:bg-slate-700 text-red-400 ms-auto"><Trash2 className="h-3.5 w-3.5" /></button>
          </div>
        </div>
      )}
    </div>
  );
}

/** One-line human summary of a single step, for the diff view. */
function describeStep(step: WorkoutStep): string {
  if (step.repeatCount && step.repeatSteps) {
    const inner = step.repeatSteps.map(describeStep).join(' + ');
    return `${step.repeatCount}× (${inner})`;
  }
  const parts: string[] = [stepLabels[step.type] || step.type];
  const dur = formatSingleDuration(step);
  if (dur) parts.push(dur);
  const pace = formatPaceTarget(step);
  if (pace) parts.push(`@${pace}`);
  if (step.notes) parts.push(`“${step.notes}”`);
  return parts.join(' ');
}

/** Compute a human-readable list of changes between two workouts. */
function diffWorkouts(before: ParsedWorkout, after: ParsedWorkout): string[] {
  const changes: string[] = [];
  if (before.name !== after.name) {
    changes.push(`Name: “${before.name}” → “${after.name}”`);
  }
  const bSteps = before.steps || [];
  const aSteps = after.steps || [];
  const max = Math.max(bSteps.length, aSteps.length);
  for (let i = 0; i < max; i++) {
    const b = bSteps[i];
    const a = aSteps[i];
    if (b && !a) { changes.push(`Removed step ${i + 1}: ${describeStep(b)}`); continue; }
    if (!b && a) { changes.push(`Added step ${i + 1}: ${describeStep(a)}`); continue; }
    if (JSON.stringify(b) !== JSON.stringify(a)) {
      changes.push(`Step ${i + 1}: ${describeStep(b)} → ${describeStep(a)}`);
    }
  }
  return changes;
}

interface WorkoutEditorPanelProps {
  workout: ParsedWorkout;
  dayName: string;
  onChange: (workout: ParsedWorkout) => void;
  onClose: () => void;
}

export function WorkoutEditorPanel({ workout, dayName, onChange, onClose }: WorkoutEditorPanelProps) {
  // Edit a local DRAFT — nothing is applied until Save is confirmed.
  const [draft, setDraft] = useState<ParsedWorkout>(workout);
  const [confirming, setConfirming] = useState(false);
  useEffect(() => { setDraft(workout); }, [workout]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(workout);
  const changes = diffWorkouts(workout, draft);

  const updateStep = (index: number, step: WorkoutStep) => {
    const newSteps = [...draft.steps];
    newSteps[index] = step;
    setDraft({ ...draft, steps: newSteps });
  };

  const deleteStep = (index: number) => {
    setDraft({ ...draft, steps: draft.steps.filter((_, i) => i !== index) });
  };

  const moveStep = (index: number, direction: 'up' | 'down') => {
    const newSteps = [...draft.steps];
    const targetIndex = direction === 'up' ? index - 1 : index + 1;
    if (targetIndex < 0 || targetIndex >= newSteps.length) return;
    [newSteps[index], newSteps[targetIndex]] = [newSteps[targetIndex], newSteps[index]];
    setDraft({ ...draft, steps: newSteps });
  };

  const duplicateStep = (index: number) => {
    const newSteps = [...draft.steps];
    newSteps.splice(index + 1, 0, { ...newSteps[index], order: index + 2 });
    setDraft({ ...draft, steps: newSteps });
  };

  const addStep = () => {
    const newStep: WorkoutStep = {
      order: draft.steps.length + 1,
      type: 'interval',
      durationType: 'time',
      durationValue: 60,
      targetType: 'no_target',
    };
    setDraft({ ...draft, steps: [...draft.steps, newStep] });
  };

  const handleClose = () => {
    if (dirty && !window.confirm('Discard your unsaved changes?')) return;
    onClose();
  };

  const confirmSave = () => {
    onChange(draft);
    setConfirming(false);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/60 z-[2000] flex justify-end" onClick={handleClose}>
      <div
        className="w-full max-w-lg bg-slate-900 border-s border-slate-700 h-full overflow-hidden flex flex-col animate-slide-in-right"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-slate-700 shrink-0">
          <div>
            <h3 className="font-semibold text-sm text-white">{dayName}</h3>
            <input
              value={draft.name}
              onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              className="bg-transparent text-xs text-slate-400 focus:outline-none focus:text-white mt-0.5 w-full"
              placeholder="Workout name"
            />
          </div>
          <button onClick={handleClose} className="p-1.5 rounded-lg hover:bg-slate-700 text-slate-400">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Steps */}
        <div className="flex-1 overflow-y-auto divide-y divide-slate-800">
          {draft.steps.map((step, i) => (
            <StepRow
              key={i}
              step={step}
              index={i}
              total={draft.steps.length}
              onChange={(s) => updateStep(i, s)}
              onDelete={() => deleteStep(i)}
              onMoveUp={() => moveStep(i, 'up')}
              onMoveDown={() => moveStep(i, 'down')}
              onDuplicate={() => duplicateStep(i)}
            />
          ))}
          <div className="px-4 py-3">
            <button
              onClick={addStep}
              className="flex items-center gap-2 text-sm text-primary-400 hover:text-primary-300"
            >
              <Plus className="h-4 w-4" /> Add Step
            </button>
          </div>
        </div>

        {/* Footer — Save / Cancel */}
        <div className="px-4 py-3 border-t border-slate-700 shrink-0 flex items-center justify-between gap-3">
          <span className="text-xs text-slate-500">
            {dirty ? `${changes.length} unsaved change${changes.length !== 1 ? 's' : ''}` : 'No changes'}
          </span>
          <div className="flex items-center gap-2">
            <button onClick={handleClose} className="px-3 py-2 rounded-lg text-sm text-slate-300 hover:bg-slate-800">
              Cancel
            </button>
            <button
              onClick={() => setConfirming(true)}
              disabled={!dirty}
              className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-primary-600 hover:bg-primary-700 text-white disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <Save className="h-4 w-4" /> Save
            </button>
          </div>
        </div>
      </div>

      {/* Confirm dialog with a diff of what will change */}
      {confirming && (
        <div className="fixed inset-0 z-[2100] flex items-center justify-center bg-black/70 p-4" onClick={(e) => { e.stopPropagation(); setConfirming(false); }}>
          <div className="bg-slate-900 border border-slate-700 rounded-2xl w-full max-w-md max-h-[80vh] overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="px-5 py-4 border-b border-slate-700 shrink-0 flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-primary-400" />
              <h3 className="font-semibold text-white">Confirm changes</h3>
            </div>
            <div className="px-5 py-4 overflow-y-auto flex-1 min-h-0 scrollbar-thin">
              <p className="text-sm text-slate-400 mb-3">Review the {changes.length} change{changes.length !== 1 ? 's' : ''} to <span className="text-white font-medium">{dayName}</span>:</p>
              <ul className="space-y-2">
                {changes.map((c, i) => (
                  <li key={i} className="text-xs text-slate-300 bg-slate-800/60 rounded-lg px-3 py-2 leading-relaxed">
                    {c}
                  </li>
                ))}
              </ul>
            </div>
            <div className="px-5 py-4 border-t border-slate-700 shrink-0 flex items-center justify-end gap-2">
              <button onClick={() => setConfirming(false)} className="px-3 py-2 rounded-lg text-sm text-slate-300 hover:bg-slate-800">
                Keep editing
              </button>
              <button onClick={confirmSave} className="flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium bg-primary-600 hover:bg-primary-700 text-white">
                <Save className="h-4 w-4" /> Save changes
              </button>
            </div>
          </div>
        </div>
      )}
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
