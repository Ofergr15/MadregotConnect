'use client';

import { useState, useEffect } from 'react';
import { useTranslations } from 'next-intl';
import { ParsedWorkout, WorkoutStep } from '@/lib/ai/types';
import { cn } from '@/lib/utils';
import { Plus, Minus, Trash2, Copy, ArrowUp, ArrowDown, ChevronDown, ChevronRight, Save, AlertCircle } from 'lucide-react';
import { Sheet, ConfirmSheet, SegmentedControl, Button } from '@/components/ui';
import { groupPaceTokens, joinGroupPaces } from '@/lib/garmin/pace';

const stepTypes = ['warmup', 'interval', 'rest', 'recovery', 'cooldown', 'active'] as const;
const targetZones = ['easy', 'threshold', 'interval', 'tempo', 'sprint', 'marathon_pace', 'no_target'] as const;
const durationTypes = ['distance', 'time', 'open'] as const;

const stepColors: Record<string, string> = {
  warmup: 'border-s-yellow-400',
  interval: 'border-s-red-400',
  rest: 'border-s-ink-300',
  recovery: 'border-s-green-400',
  cooldown: 'border-s-blue-400',
  active: 'border-s-purple-400',
};

type T = (key: string, values?: Record<string, string | number>) => string;

function stepLabel(type: string, t: T): string {
  switch (type) {
    case 'warmup': return t('stepWarmup');
    case 'interval': return t('stepInterval');
    case 'rest': return t('stepRest');
    case 'recovery': return t('stepRecovery');
    case 'cooldown': return t('stepCooldown');
    case 'active': return t('stepActive');
    default: return type;
  }
}

function zoneLabel(zone: string, t: T): string {
  switch (zone) {
    case 'easy': return t('zoneEasy');
    case 'threshold': return t('zoneThreshold');
    case 'interval': return t('zoneInterval');
    case 'tempo': return t('zoneTempo');
    case 'sprint': return t('zoneSprint');
    case 'marathon_pace': return t('zoneMarathonPace');
    case 'no_target': return t('zoneNoTarget');
    default: return zone;
  }
}

function durationTypeLabel(type: string, t: T): string {
  switch (type) {
    case 'distance': return t('distance');
    case 'time': return t('time');
    case 'open': return t('lap');
    default: return type;
  }
}

function formatSingleDuration(step: WorkoutStep, lapLabel: string): string {
  if (step.durationType === 'open') return lapLabel;
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

function formatDuration(step: WorkoutStep, lapLabel: string): string {
  // For repeat blocks, summarize the sub-steps so the rest segment is visible
  // even when the row is collapsed, e.g. "0:30 + 1:00".
  if (step.repeatCount) {
    if (step.repeatSteps && step.repeatSteps.length > 0) {
      return step.repeatSteps.map((s) => formatSingleDuration(s, lapLabel)).filter(Boolean).join(' + ');
    }
    return '';
  }
  return formatSingleDuration(step, lapLabel);
}

function formatPaceTarget(step: WorkoutStep, t: T): string {
  if (step.targetZone && step.targetZone !== 'no_target') {
    return zoneLabel(step.targetZone, t);
  }
  if (step.targetPaceMinPerKm) {
    const fmt = (s: number) => `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, '0')}`;
    const max = step.targetPaceMaxPerKm;
    // A single pace (no max, or max === min) shows as "3:25/km", not "3:25-3:25/km".
    if (!max || max === step.targetPaceMinPerKm) return `${fmt(step.targetPaceMinPerKm)}/km`;
    return `${fmt(step.targetPaceMinPerKm)}-${fmt(max)}/km`;
  }
  return '';
}

// Group ❶ plain, (❷) single brackets, ((❸)) double brackets — for the
// collapsed step-row summary in the unified editor. Deliberately separate
// from formatPaceTarget: the confirm-changes diff view uses that one and
// wants a clean single-group before/after, not three brackets repeated on
// both sides of the arrow when only one group's pace actually changed.
function formatBracketPaceTarget(step: WorkoutStep, t: T): string {
  if (step.targetZone && step.targetZone !== 'no_target') {
    return zoneLabel(step.targetZone, t);
  }
  if (!step.targetPaceMinPerKm) return '';
  const tokens = groupPaceTokens(
    { min: step.targetPaceMinPerKm, max: step.targetPaceMaxPerKm ?? step.targetPaceMinPerKm },
    step.group2Pace,
    step.group3Pace,
  );
  return joinGroupPaces(tokens);
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
  const t = useTranslations('workoutEditor');
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

  // Step by 1 s/km per click (min 2:00/km). Bumps off the current value or 4:30.
  const bump = (delta: number) => {
    const base = seconds ?? inputToPace(text) ?? 270;
    const next = Math.max(120, base + delta);
    setText(paceToInput(next));
    onCommit(next);
  };

  return (
    <div className="flex flex-col">
      {label && <span className="text-[9px] text-ink-400 mb-0.5">{label}</span>}
      <div className="flex items-stretch">
        <button
          type="button"
          onClick={() => bump(-1)}
          className="px-1.5 rounded-s bg-ink-300 hover:bg-page text-ink-700 text-sm flex items-center"
          title={t('faster')}
        >
          <Minus className="h-3 w-3" />
        </button>
        <input
          type="text"
          inputMode="numeric"
          value={text}
          onFocus={() => setFocused(true)}
          onChange={(e) => setText(e.target.value)}
          onBlur={() => { setFocused(false); commit(); }}
          onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
          placeholder={placeholder}
          className="bg-page border-y border-ink-300 px-2 py-1.5 text-xs text-ink-700 w-full text-center min-w-0"
        />
        <button
          type="button"
          onClick={() => bump(1)}
          className="px-1.5 rounded-e bg-ink-300 hover:bg-page text-ink-700 text-sm flex items-center"
          title={t('slower')}
        >
          <Plus className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}

/**
 * Numeric field with −/+ stepper buttons (for seconds / meters / reps), so
 * coaches can adjust without free-text. Clamps to >= min.
 */
function NumberStepper({
  value,
  onChange,
  step = 1,
  min = 0,
  suffix,
}: {
  value: number;
  onChange: (v: number) => void;
  step?: number;
  min?: number;
  suffix?: string;
}) {
  const set = (v: number) => onChange(Math.max(min, v));
  return (
    <div className="flex items-stretch">
      <button
        type="button"
        onClick={() => set((value || 0) - step)}
        className="px-2 rounded-s bg-ink-300 hover:bg-page text-ink-700 flex items-center"
      >
        <Minus className="h-3 w-3" />
      </button>
      <div className="relative flex-1 min-w-0">
        <input
          type="number"
          value={value || ''}
          onChange={(e) => set(parseInt(e.target.value) || 0)}
          className="w-full bg-page border-y border-ink-300 px-2 py-1.5 text-xs text-ink-700 text-center"
        />
        {suffix && <span className="absolute end-2 top-1/2 -translate-y-1/2 text-[10px] text-ink-400 pointer-events-none">{suffix}</span>}
      </div>
      <button
        type="button"
        onClick={() => set((value || 0) + step)}
        className="px-2 rounded-e bg-ink-300 hover:bg-page text-ink-700 flex items-center"
      >
        <Plus className="h-3 w-3" />
      </button>
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
  const t = useTranslations('workoutEditor');
  const tc = useTranslations('common');
  // Rest/recovery never take a pace. Everything else CAN, but we only show the
  // pace fields once one is set (or the coach adds it via "+ pace").
  const canHavePace = step.type !== 'rest' && step.type !== 'recovery';
  const hasPace = canHavePace && step.targetType === 'pace' && !!step.targetPaceMinPerKm;
  // A "range" is two distinct bounds. A single pace (no max, or max === min) is
  // shown as ONE field, matching how the coach writes "3:25" (not "3:25-3:25").
  const isRange = hasPace && !!step.targetPaceMaxPerKm && step.targetPaceMaxPerKm !== step.targetPaceMinPerKm;
  return (
    <div className="bg-card/50 rounded-md p-2 space-y-2">
      <div className="flex items-center gap-2">
        <select
          value={step.type}
          onChange={(e) => onChange({ ...step, type: e.target.value as any })}
          className="bg-page border border-ink-300 rounded px-1.5 py-1 text-[11px] text-ink-700 min-h-[32px]"
        >
          {stepTypes.map((s) => (
            <option key={s} value={s}>{stepLabel(s, t)}</option>
          ))}
        </select>
        <select
          value={step.durationType}
          onChange={(e) => onChange({ ...step, durationType: e.target.value as any })}
          className="bg-page border border-ink-300 rounded px-1.5 py-1 text-[11px] text-ink-700 min-h-[32px]"
        >
          {durationTypes.map((d) => (
            <option key={d} value={d}>{durationTypeLabel(d, t)}</option>
          ))}
        </select>
        {step.durationType !== 'open' && (
          <div className="w-28">
            <NumberStepper
              value={step.durationValue || 0}
              step={step.durationType === 'distance' ? 100 : 5}
              onChange={(v) => onChange({ ...step, durationValue: v })}
              suffix={step.durationType === 'distance' ? 'm' : 's'}
            />
          </div>
        )}
        <button onClick={onDelete} className="p-1 rounded hover:bg-page text-accent-red ms-auto" aria-label={tc('delete')}>
          <Trash2 className="h-3 w-3" />
        </button>
      </div>
      <div className="flex items-end gap-2">
        {/* Pace fields ONLY when this sub-step actually targets a pace. Rest
            segments and effort-based cuts (e.g. מתגברת "No Target") have none —
            showing empty From/To boxes made their placeholders (3:20/3:30) look
            like real targets. A running segment with no pace gets a "+ pace"
            toggle instead. */}
        {hasPace ? (
          <>
            <div className="w-24 shrink-0">
              <PaceInput
                label={isRange ? t('fromFast') : t('pacePerKm')}
                seconds={step.targetPaceMinPerKm}
                placeholder="3:25"
                onCommit={(secs) => onChange({ ...step, targetType: 'pace', targetPaceMinPerKm: secs })}
              />
            </div>
            {isRange && (
              <div className="w-24 shrink-0">
                <PaceInput
                  label={t('toSlow')}
                  seconds={step.targetPaceMaxPerKm}
                  placeholder="3:35"
                  onCommit={(secs) => onChange({ ...step, targetPaceMaxPerKm: secs })}
                />
              </div>
            )}
            {isRange ? (
              // Collapse back to a single pace (drop the slow bound).
              <button
                type="button"
                onClick={() => onChange({ ...step, targetPaceMaxPerKm: undefined })}
                className="text-[10px] text-ink-400 hover:text-ink-500 mb-1 shrink-0"
              >
                {t('single')}
              </button>
            ) : (
              // Expand to a From–To range (seed slow bound 10s slower).
              <button
                type="button"
                onClick={() => onChange({ ...step, targetPaceMaxPerKm: (step.targetPaceMinPerKm || 210) + 10 })}
                className="text-[10px] text-ink-400 hover:text-brand-700 mb-1 shrink-0"
              >
                {t('addRange')}
              </button>
            )}
            <button
              type="button"
              onClick={() => onChange({ ...step, targetType: 'no_target', targetPaceMinPerKm: undefined, targetPaceMaxPerKm: undefined })}
              title={t('noPace')}
              className="text-[10px] text-ink-400 hover:text-accent-red mb-1 shrink-0"
            >
              {t('noPace')}
            </button>
          </>
        ) : canHavePace ? (
          <button
            type="button"
            onClick={() => onChange({ ...step, targetType: 'pace', targetPaceMinPerKm: 210 })}
            className="flex items-center gap-1 text-[10px] text-ink-400 hover:text-brand-700 mb-1 shrink-0"
          >
            <Plus className="h-3 w-3" /> {t('addPace')}
          </button>
        ) : null}
        <input
          type="text"
          value={step.notes || ''}
          onChange={(e) => onChange({ ...step, notes: e.target.value || undefined })}
          placeholder={t('notesPlaceholderShort')}
          className="flex-1 min-w-0 bg-page border border-ink-300 rounded px-1.5 py-1 text-[11px] text-ink-700"
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
  const t = useTranslations('workoutEditor');
  const tc = useTranslations('common');
  const [expanded, setExpanded] = useState(false);

  // A repeat block is just "do these sub-steps N times" — its own type,
  // duration, and pace are meaningless (the parser mirrors the first sub-step
  // onto the parent). Show only REPEAT + the sub-steps, not a redundant second
  // copy of the interval's distance/pace.
  const isRepeat = step.repeatCount !== undefined && !!step.repeatSteps && step.repeatSteps.length > 0;

  return (
    <div className={cn('border-s-3 rounded-md', stepColors[step.type] || 'border-s-ink-300')}>
      <div
        className="flex items-center gap-2 px-3 py-2.5 cursor-pointer hover:bg-page/30 transition-colors"
        onClick={() => setExpanded(!expanded)}
      >
        <span className="text-[10px] text-ink-400 w-4 text-end">{index + 1}</span>
        <span className={cn(
          'text-[10px] font-bold px-1.5 py-0.5 rounded uppercase tracking-wide',
          step.type === 'interval' ? 'bg-accent-red/20 text-accent-red' :
          step.type === 'warmup' ? 'bg-band-3/20 text-band-3-ink' :
          step.type === 'cooldown' ? 'bg-band-2/20 text-band-2-ink' :
          step.type === 'rest' ? 'bg-ink-300/20 text-ink-400' :
          step.type === 'recovery' ? 'bg-accent-600/20 text-accent-900' :
          'bg-purple-500/20 text-purple-800'
        )}>
          {stepLabel(step.type, t)}
        </span>
        <span className="text-sm text-ink-700 font-medium">{formatDuration(step, t('lap'))}</span>
        {formatBracketPaceTarget(step, t) && (
          <span dir="ltr" className="text-[11px] text-brand-600 ms-auto me-1 tabular-nums">@{formatBracketPaceTarget(step, t)}</span>
        )}
        {step.repeatCount && (
          <span className="text-[10px] bg-band-3/20 text-band-3-ink px-1.5 py-0.5 rounded font-bold">
            {step.repeatCount}x
          </span>
        )}
        {step.notes && (
          <span className="text-[10px] text-ink-400 truncate max-w-[120px]">{step.notes}</span>
        )}
        {expanded ? <ChevronDown className="h-3.5 w-3.5 text-ink-400 shrink-0" /> : <ChevronRight className="h-3.5 w-3.5 text-ink-400 shrink-0" />}
      </div>

      {expanded && (
        <div className="px-3 pb-3 space-y-3 border-t border-page/50 pt-3 ms-4">
          {/* A repeat block's own type/duration/pace are redundant with its
              sub-steps — hide them and show only REPEAT + the sub-steps. */}
          {!isRepeat && (
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="text-[10px] text-ink-400 uppercase tracking-wide mb-1 block">{t('type')}</label>
              <select
                value={step.type}
                onChange={(e) => onChange({ ...step, type: e.target.value as any })}
                className="w-full bg-page border border-ink-300 rounded px-2 py-1.5 text-xs text-ink-700 min-h-[36px]"
              >
                {stepTypes.map((s) => (
                  <option key={s} value={s}>{stepLabel(s, t)}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-[10px] text-ink-400 uppercase tracking-wide mb-1 block">{t('duration')}</label>
              <SegmentedControl<typeof durationTypes[number]>
                value={step.durationType}
                onChange={(v) => onChange({ ...step, durationType: v })}
                options={durationTypes.map((d) => ({ value: d, label: durationTypeLabel(d, t) }))}
              />
            </div>
          </div>
          )}

          {!isRepeat && step.durationType !== 'open' && (
            <div>
              <label className="text-[10px] text-ink-400 uppercase tracking-wide mb-1 block">
                {step.durationType === 'distance' ? t('meters') : t('seconds')}
              </label>
              <NumberStepper
                value={step.durationValue || 0}
                step={step.durationType === 'distance' ? 100 : 5}
                onChange={(v) => onChange({ ...step, durationValue: v })}
                suffix={step.durationType === 'distance' ? 'm' : 's'}
              />
            </div>
          )}

          {!isRepeat && (
          <div>
            <label className="text-[10px] text-ink-400 uppercase tracking-wide mb-1 block">{t('target')}</label>
            <div className="grid grid-cols-3 gap-2 items-end">
              <div className="flex flex-col">
                <span className="text-[9px] text-ink-400 mb-0.5">{t('type')}</span>
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
                  className="bg-page border border-ink-300 rounded px-2 py-1.5 text-xs text-ink-700 min-h-[36px]"
                >
                  {targetZones.map((z) => (
                    <option key={z} value={z}>{zoneLabel(z, t)}</option>
                  ))}
                  <option value="custom">{t('zoneCustom')}</option>
                </select>
              </div>
              {(step.targetPaceMinPerKm || (!step.targetZone && step.targetType === 'pace')) && (() => {
                // Single pace vs From–To range: only show the second box when the
                // coach actually gave two distinct bounds. A lone "3:25" is one field.
                const isRange = !!step.targetPaceMaxPerKm && step.targetPaceMaxPerKm !== step.targetPaceMinPerKm;
                return (
                  <>
                    <PaceInput
                      label={isRange ? t('fromFast') : t('pacePerKm')}
                      seconds={step.targetPaceMinPerKm}
                      placeholder="3:25"
                      onCommit={(secs) => onChange({ ...step, targetType: 'pace', targetZone: undefined, targetPaceMinPerKm: secs })}
                    />
                    {isRange ? (
                      <PaceInput
                        label={t('toSlow')}
                        seconds={step.targetPaceMaxPerKm}
                        placeholder="3:35"
                        onCommit={(secs) => onChange({ ...step, targetPaceMaxPerKm: secs })}
                      />
                    ) : (
                      <button
                        type="button"
                        onClick={() => onChange({ ...step, targetPaceMaxPerKm: (step.targetPaceMinPerKm || 210) + 10 })}
                        className="text-[10px] text-ink-400 hover:text-brand-700 self-end mb-2"
                      >
                        {t('addRange')}
                      </button>
                    )}
                  </>
                );
              })()}
            </div>
          </div>
          )}

          {step.repeatCount !== undefined && (
            <div>
              <label className="text-[10px] text-ink-400 uppercase tracking-wide mb-1 block">{t('repeat')}</label>
              <div className="w-28">
                <NumberStepper
                  value={step.repeatCount || 1}
                  min={1}
                  step={1}
                  onChange={(v) => onChange({ ...step, repeatCount: v })}
                  suffix="×"
                />
              </div>
            </div>
          )}

          {/* Sub-steps inside a repeat block (e.g. the interval + its rest) */}
          {step.repeatSteps && step.repeatSteps.length > 0 && (
            <div>
              <label className="text-[10px] text-ink-400 uppercase tracking-wide mb-1 block">
                {t('repeatedSteps', { count: step.repeatCount || 1 })}
              </label>
              <div className="space-y-2 ms-2 border-s-2 border-band-3/30 ps-2">
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
                  className="flex items-center gap-1 text-[11px] text-brand-600 hover:text-brand-700"
                >
                  <Plus className="h-3 w-3" /> {t('addSubStep')}
                </button>
              </div>
            </div>
          )}

          <div>
            <label className="text-[10px] text-ink-400 uppercase tracking-wide mb-1 block">{t('notes')}</label>
            <input
              type="text"
              value={step.notes || ''}
              onChange={(e) => onChange({ ...step, notes: e.target.value || undefined })}
              placeholder={t('notesPlaceholder')}
              className="w-full bg-page border border-ink-300 rounded px-2 py-1.5 text-xs text-ink-700"
            />
          </div>

          <div className="flex items-center gap-1 pt-1">
            <button onClick={onMoveUp} disabled={index === 0} className="p-1 rounded hover:bg-page text-ink-400 disabled:opacity-30" aria-label={t('moveUp')}><ArrowUp className="h-3.5 w-3.5" /></button>
            <button onClick={onMoveDown} disabled={index === total - 1} className="p-1 rounded hover:bg-page text-ink-400 disabled:opacity-30" aria-label={t('moveDown')}><ArrowDown className="h-3.5 w-3.5" /></button>
            <button onClick={onDuplicate} className="p-1 rounded hover:bg-page text-ink-400" aria-label={t('duplicate')}><Copy className="h-3.5 w-3.5" /></button>
            <button onClick={onDelete} className="p-1 rounded hover:bg-page text-accent-red ms-auto" aria-label={tc('delete')}><Trash2 className="h-3.5 w-3.5" /></button>
          </div>
        </div>
      )}
    </div>
  );
}

/** One-line human summary of a single step, for the diff view. */
function describeStep(step: WorkoutStep, t: T): string {
  if (step.repeatCount && step.repeatSteps) {
    const inner = step.repeatSteps.map((s) => describeStep(s, t)).join(' + ');
    return `${step.repeatCount}× (${inner})`;
  }
  const parts: string[] = [stepLabel(step.type, t)];
  const dur = formatSingleDuration(step, t('lap'));
  if (dur) parts.push(dur);
  const pace = formatPaceTarget(step, t);
  if (pace) parts.push(`@${pace}`);
  if (step.notes) parts.push(`“${step.notes}”`);
  return parts.join(' ');
}

interface StepChange {
  title: string;             // e.g. "Step 4 · Interval"
  kind: 'added' | 'removed' | 'modified';
  fields: { label: string; from?: string; to?: string }[];
}

function paceTargetLabel(step: WorkoutStep, t: T): string {
  return formatPaceTarget(step, t) || t('zoneNoTarget');
}

/** Field-level changes for a single (non-repeat) step. */
function fieldChanges(b: WorkoutStep, a: WorkoutStep, t: T): { label: string; from: string; to: string }[] {
  const out: { label: string; from: string; to: string }[] = [];
  if (b.type !== a.type) out.push({ label: t('type'), from: stepLabel(b.type, t), to: stepLabel(a.type, t) });
  const bDur = formatSingleDuration(b, t('lap')), aDur = formatSingleDuration(a, t('lap'));
  if (bDur !== aDur) out.push({ label: t('duration'), from: bDur || '—', to: aDur || '—' });
  const bPace = paceTargetLabel(b, t), aPace = paceTargetLabel(a, t);
  if (bPace !== aPace) out.push({ label: t('pace'), from: bPace, to: aPace });
  if ((b.notes || '') !== (a.notes || '')) out.push({ label: t('notes'), from: b.notes || '—', to: a.notes || '—' });
  return out;
}

/** Compute a structured, field-level diff between two workouts. */
function diffWorkouts(before: ParsedWorkout, after: ParsedWorkout, t: T): StepChange[] {
  const changes: StepChange[] = [];
  if (before.name !== after.name) {
    changes.push({ title: t('name'), kind: 'modified', fields: [{ label: t('name'), from: before.name, to: after.name }] });
  }
  const bSteps = before.steps || [];
  const aSteps = after.steps || [];
  const max = Math.max(bSteps.length, aSteps.length);
  for (let i = 0; i < max; i++) {
    const b = bSteps[i];
    const a = aSteps[i];
    if (b && !a) { changes.push({ title: t('stepLabel', { n: i + 1, type: stepLabel(b.type, t) }), kind: 'removed', fields: [{ label: '', to: describeStep(b, t) }] }); continue; }
    if (!b && a) { changes.push({ title: t('stepLabel', { n: i + 1, type: stepLabel(a.type, t) }), kind: 'added', fields: [{ label: '', to: describeStep(a, t) }] }); continue; }
    if (JSON.stringify(b) === JSON.stringify(a)) continue;

    // Repeat block: diff reps + each sub-step field.
    if (b.repeatCount || a.repeatCount) {
      const fields: { label: string; from?: string; to?: string }[] = [];
      if ((b.repeatCount || 0) !== (a.repeatCount || 0)) {
        fields.push({ label: t('repeats'), from: `${b.repeatCount || 0}×`, to: `${a.repeatCount || 0}×` });
      }
      const bSub = b.repeatSteps || [], aSub = a.repeatSteps || [];
      const subMax = Math.max(bSub.length, aSub.length);
      for (let j = 0; j < subMax; j++) {
        if (bSub[j] && aSub[j]) {
          for (const fc of fieldChanges(bSub[j], aSub[j], t)) {
            fields.push({ label: `${stepLabel(bSub[j].type, t)} ${fc.label}`, from: fc.from, to: fc.to });
          }
        } else if (aSub[j]) {
          fields.push({ label: t('addedSubStep'), to: describeStep(aSub[j], t) });
        } else if (bSub[j]) {
          fields.push({ label: t('removedSubStep'), from: describeStep(bSub[j], t) });
        }
      }
      if (fields.length) changes.push({ title: t('stepRepeatLabel', { n: i + 1 }), kind: 'modified', fields });
      continue;
    }

    const fields = fieldChanges(b, a, t);
    if (fields.length) changes.push({ title: t('stepLabel', { n: i + 1, type: stepLabel(a.type, t) }), kind: 'modified', fields });
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
  const t = useTranslations('workoutEditor');
  const tc = useTranslations('common');
  // Edit a local DRAFT — nothing is applied until Save is confirmed.
  const [draft, setDraft] = useState<ParsedWorkout>(workout);
  const [confirmingSave, setConfirmingSave] = useState(false);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  useEffect(() => { setDraft(workout); }, [workout]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(workout);
  const changes = diffWorkouts(workout, draft, t);

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

  const requestClose = () => {
    if (dirty) { setConfirmingDiscard(true); return; }
    onClose();
  };

  const confirmSave = () => {
    onChange(draft);
    setConfirmingSave(false);
    onClose();
  };

  return (
    <>
      <Sheet
        open
        onOpenChange={(o) => { if (!o) requestClose(); }}
        title={dayName}
        className="max-h-[92vh]"
        bodyClassName="px-0"
        footer={
          <div className="px-4 py-3 border-t border-page shrink-0 flex items-center justify-between gap-3">
            <span className="text-xs text-ink-400">
              {dirty ? (changes.length === 1 ? t('unsavedChange') : t('unsavedChanges', { count: changes.length })) : t('noChanges')}
            </span>
            <div className="flex items-center gap-2">
              <Button variant="ghost" size="sm" onClick={requestClose}>{tc('cancel')}</Button>
              <Button size="sm" onClick={() => setConfirmingSave(true)} disabled={!dirty}>
                <Save className="h-4 w-4" /> {tc('save')}
              </Button>
            </div>
          </div>
        }
      >
        <div className="px-4 pt-1 pb-2">
          <input
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
            className="bg-transparent text-sm text-ink-700 focus:outline-none w-full font-medium"
            placeholder={t('workoutNamePlaceholder')}
          />
        </div>

        <div className="divide-y divide-page">
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
              className="flex items-center gap-2 text-sm text-brand-600 hover:text-brand-700"
            >
              <Plus className="h-4 w-4" /> {t('addStep')}
            </button>
          </div>
        </div>
      </Sheet>

      {/* Confirm dialog with a diff of what will change */}
      <Sheet
        open={confirmingSave}
        onOpenChange={setConfirmingSave}
        title={
          <span className="flex items-center justify-center gap-2">
            <AlertCircle className="h-4 w-4 text-brand-600" /> {t('confirmChangesTitle')}
          </span>
        }
        className="max-h-[85vh]"
        footer={
          <div className="px-4 py-3 border-t border-page shrink-0 flex items-center justify-end gap-2">
            <Button variant="ghost" size="sm" onClick={() => setConfirmingSave(false)}>{t('keepEditing')}</Button>
            <Button size="sm" onClick={confirmSave}>
              <Save className="h-4 w-4" /> {t('saveChanges')}
            </Button>
          </div>
        }
      >
        <p className="text-sm text-ink-400 mb-3">
          {t('confirmChangesDesc', { day: dayName })}
        </p>
        <div className="space-y-2.5">
          {changes.map((c, i) => (
            <div key={i} className="bg-card/60 rounded-lg px-3 py-2.5">
              <div className="flex items-center gap-2 mb-1.5">
                <span className={cn(
                  'text-[9px] font-bold uppercase tracking-wide px-1.5 py-0.5 rounded',
                  c.kind === 'added' ? 'bg-accent-600/20 text-accent-900' :
                  c.kind === 'removed' ? 'bg-accent-red/20 text-accent-red' :
                  'bg-brand-600/20 text-brand-600'
                )}>
                  {c.kind === 'added' ? t('kindAdded') : c.kind === 'removed' ? t('kindRemoved') : t('kindModified')}
                </span>
                <span className="text-xs font-semibold text-ink-700">{c.title}</span>
              </div>
              <div className="space-y-1">
                {c.fields.map((f, j) => (
                  <div key={j} className="flex items-center gap-2 text-xs flex-wrap">
                    {f.label && <span className="text-ink-400 min-w-[70px]">{f.label}</span>}
                    {f.from !== undefined && <span className="text-accent-red/80 line-through">{f.from}</span>}
                    {f.from !== undefined && f.to !== undefined && <span className="text-ink-400">→</span>}
                    {f.to !== undefined && <span className="text-accent-600">{f.to}</span>}
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
      </Sheet>

      <ConfirmSheet
        open={confirmingDiscard}
        onOpenChange={setConfirmingDiscard}
        title={t('discardTitle')}
        description={t('discardDesc')}
        confirmLabel={t('discardConfirm')}
        cancelLabel={t('keepEditing')}
        onConfirm={onClose}
      />
    </>
  );
}
