'use client';

import { useState, useEffect, useRef, useMemo, useLayoutEffect } from 'react';
import { createPortal } from 'react-dom';
import { useTranslations } from 'next-intl';
import { ParsedWorkout, WorkoutStep } from '@/lib/ai/types';
import { cn } from '@/lib/utils';
import { Plus, Minus, Pencil, Save, AlertCircle, X, Undo2 } from 'lucide-react';
import { Sheet, ConfirmSheet, SegmentedControl, Button } from '@/components/ui';
import { groupPaceTokens, joinGroupPaces } from '@/lib/garmin/pace';
import { workoutDurationSec, stepDurationSec } from '@/lib/workout-duration';
import { workoutDistanceMeters } from '@/lib/workout-distance';
import {
  withIds, stripIds, locate, moveStep, insertAt, removeStep, updateStep, duplicateStep, unwrapRepeat,
  remapAutoFixes, parseDistance, parseTime, parsePace, durationBoxText, durationNudge,
  defaultDistanceUnit, defaultTimeUnit, chartSeconds, chartIntensity, mmss, newId,
  type DraftStep, type Slot, type DistanceUnit, type TimeUnit,
} from '@/lib/plans/step-tree';

const durationTypes = ['distance', 'time', 'open'] as const;

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

// ── The builder ─────────────────────────────────────────────────────────────────
//
// TrainingPeaks' workout builder, on a phone: the structure chart on top (every step a
// bar — width how long, height how hard — with a repeat drawn out in full under its
// "3×" bracket), a palette of blocks to drag in, and the steps as cards that drag by
// their ⠿ handle into any gap, including into and out of a repeat. Tapping a card or a
// bar docks that step's panel where the Save bar sits, so the chart stays in sight
// while it changes. All placement logic is lib/plans/step-tree.ts.

const TYPE_COLOR: Record<string, string> = {
  warmup: '#2BA8B5', active: '#1525FF', interval: '#E5484D', rest: '#B5B5BD', recovery: '#7FB89A', cooldown: '#6E7BFF',
};
/** The four types a coach picks from. `recovery`/`cooldown` still display when a parse wrote them. */
const PICK_TYPES = ['warmup', 'active', 'interval', 'rest'] as const;

type Block = 'warmup' | 'active' | 'interval' | 'rest' | 'rep2' | 'rep3';
const BLOCKS: { k: Block; glyph: [string, number][] }[] = [
  { k: 'warmup', glyph: [['warmup', 0.45]] },
  { k: 'active', glyph: [['active', 0.7]] },
  { k: 'interval', glyph: [['interval', 1]] },
  { k: 'rest', glyph: [['rest', 0.3]] },
  { k: 'rep2', glyph: [['interval', 1], ['rest', 0.3], ['interval', 1], ['rest', 0.3]] },
  { k: 'rep3', glyph: [['interval', 1], ['rest', 0.3], ['active', 0.6]] },
];

const plain = (type: WorkoutStep['type'], durationType: WorkoutStep['durationType'], durationValue: number | undefined, pace?: [number, number], notes?: string): DraftStep => ({
  _id: newId(), order: 0, type, durationType, durationValue,
  targetType: pace ? 'pace' : 'no_target',
  targetPaceMinPerKm: pace?.[0], targetPaceMaxPerKm: pace?.[1], notes,
});

function blockStep(k: Block, restNote: string): DraftStep {
  switch (k) {
    case 'warmup': return plain('warmup', 'distance', 2000, [300, 330]);
    case 'active': return plain('active', 'time', 600, [270, 285]);
    case 'interval': return plain('interval', 'distance', 400, [230, 230]);
    case 'rest': return plain('rest', 'time', 60, undefined, restNote);
    case 'rep2': return { ...plain('interval', 'distance', 400), repeatCount: 4, repeatSteps: [plain('interval', 'distance', 400, [230, 230]), plain('rest', 'time', 60, undefined, restNote)] };
    case 'rep3': return { ...plain('interval', 'time', 30), repeatCount: 3, repeatSteps: [plain('interval', 'time', 30), plain('rest', 'open', undefined), plain('active', 'time', 60, [285, 285])] };
  }
}

const fmtPace = (s: number) => mmss(s);

function cardDuration(step: WorkoutStep, t: T): string {
  if (step.durationType === 'open') return t('lap');
  const v = step.durationValue || 0;
  if (step.durationType === 'distance') return v >= 1000 ? `${+(v / 1000).toFixed(2)} ${t('unitKm')}` : `${v} ${t('unitM')}`;
  return v < 60 ? `${v} ${t('unitSec')}` : mmss(v);
}

/** Bars in play order, each knowing which step (and which repeat) it draws. */
function chartBars(steps: DraftStep[]) {
  const out: { step: DraftStep; repeat?: DraftStep; key: string }[] = [];
  steps.forEach((s) => {
    if (s.repeatSteps) {
      for (let r = 0; r < (s.repeatCount || 1); r++) s.repeatSteps.forEach((c) => out.push({ step: c, repeat: s, key: `${c._id}-${r}` }));
    } else out.push({ step: s, key: s._id });
  });
  return out;
}

type Drag =
  | { kind: 'move'; id: string; isRepeat: boolean; label: React.ReactNode }
  | { kind: 'new'; block: Block; label: React.ReactNode };

function StructureChart({ steps, selected, onPick, dropActive, chartRef }: {
  steps: DraftStep[]; selected: string | null; onPick: (id: string) => void; dropActive: boolean;
  chartRef: React.RefObject<HTMLDivElement | null>;
}) {
  const t = useTranslations('workoutEditor');
  const total = chartBars(steps).reduce((a, b) => a + chartSeconds(b.step), 0) || 1;
  const minutes = Math.round(total / 60);
  return (
    <div
      ref={chartRef}
      data-vaul-no-drag
      aria-label={t('structure')}
      className={cn('mx-3 rounded-card bg-page/60 px-3 pt-5 pb-1.5', dropActive && 'outline-2 outline-dashed outline-brand-600 -outline-offset-2')}
    >
      <div className="flex items-end gap-[1.5px] h-[64px]">
        {steps.map((s, i) => {
          const blockSec = s.repeatSteps ? s.repeatSteps.reduce((a, c) => a + chartSeconds(c), 0) * (s.repeatCount || 1) : chartSeconds(s);
          const bars = chartBars([s]);
          return (
            <div key={s._id} data-top-index={i} className="relative flex items-end gap-[1.5px] h-full min-w-[2px]" style={{ flexGrow: blockSec, flexBasis: 0 }}>
              {s.repeatSteps && (
                <div className="absolute -top-4 inset-x-0 h-2.5 border-t-[1.5px] border-x-[1.5px] border-ink-900 rounded-t-sm pointer-events-none">
                  <span className="absolute left-1/2 -translate-x-1/2 -top-[13px] bg-transparent px-1 text-[10px] font-extrabold text-ink-900">{s.repeatCount}×</span>
                </div>
              )}
              {bars.map((b) => {
                const isSel = !!selected && (b.step._id === selected || b.repeat?._id === selected);
                return (
                  <button
                    key={b.key}
                    type="button"
                    onClick={() => onPick(b.step._id)}
                    aria-label={stepLabel(b.step.type, t)}
                    className={cn('min-w-[2px] rounded-[2.5px] transition-opacity', selected && !isSel && 'opacity-35')}
                    style={{
                      flexGrow: chartSeconds(b.step), flexBasis: 0,
                      height: `${Math.round(chartIntensity(b.step) * 100)}%`,
                      background: TYPE_COLOR[b.step.type] || TYPE_COLOR.active,
                      opacity: b.step.durationType === 'open' && !(selected && !isSel) ? 0.6 : undefined,
                    }}
                  />
                );
              })}
            </div>
          );
        })}
      </div>
      <div className="flex justify-between text-3xs text-ink-400 pt-0.5 tabular-nums">
        <span>0</span><span>{Math.round(minutes / 2)}′</span><span>{minutes}′</span>
      </div>
    </div>
  );
}

function BlockGlyph({ glyph }: { glyph: [string, number][] }) {
  return (
    <span className="flex items-end gap-[1.5px] h-[18px]">
      {glyph.map(([ty, v], i) => <i key={i} className="block w-[5px] rounded-[1.5px]" style={{ height: v * 18, background: TYPE_COLOR[ty] }} />)}
    </span>
  );
}

function blockLabel(k: Block, t: T) {
  return k === 'rep2' ? t('blockRepeat2') : k === 'rep3' ? t('blockRepeat3') : stepLabel(k, t);
}

function StepCard({ step, selected, onPick, onHandleDown, dragging, t }: {
  step: DraftStep; selected: boolean; onPick?: () => void; dragging?: boolean; t: T;
  onHandleDown?: (e: React.PointerEvent) => void;
}) {
  const pace = formatBracketPaceTarget(step, t);
  return (
    <div
      data-id={step._id}
      onClick={onPick}
      className={cn(
        'flex items-center gap-2 bg-card rounded-[18px] ps-1 pe-2 py-1.5 border-2 cursor-pointer',
        selected ? 'border-brand-600' : 'border-transparent',
        dragging && 'opacity-25',
      )}
    >
      <span
        data-vaul-no-drag
        onPointerDown={onHandleDown}
        onClick={(e) => e.stopPropagation()}
        aria-label={t('dragHandle')}
        className="w-8 h-10 flex items-center justify-center text-ink-300 text-xl cursor-grab touch-none select-none shrink-0"
      >⠿</span>
      <span className="w-[5px] self-stretch rounded-full shrink-0" style={{ background: TYPE_COLOR[step.type] || TYPE_COLOR.active }} />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <span className="text-xs font-bold" style={{ color: step.type === 'rest' ? '#5F5F5F' : TYPE_COLOR[step.type] }}>{stepLabel(step.type, t)}</span>
          <span className="text-lg font-extrabold text-ink-900 tabular-nums">{cardDuration(step, t)}</span>
        </div>
        {(pace || step.notes) && (
          <div className="flex gap-2 text-xs text-ink-400 truncate">
            {pace && <span dir="ltr" className="text-brand-600 font-semibold tabular-nums">@{pace}</span>}
            {step.notes && <span className="truncate">{step.notes}</span>}
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={(e) => { e.stopPropagation(); onPick?.(); }}
        aria-label={t('editStep')}
        className="w-9 h-9 rounded-full bg-page/70 text-ink-900 flex items-center justify-center shrink-0 active:bg-brand-600/15"
      >
        <Pencil className="h-4 w-4" />
      </button>
    </div>
  );
}

/** A gap a step can land in. Opens (dashed, brand) while it is the drop target. */
function Gap({ slot, open }: { slot: string; open: boolean }) {
  return (
    <div
      data-slot={slot}
      className={cn('transition-[height] duration-150', open ? 'h-[52px] my-0.5 rounded-[16px] border-2 border-dashed border-brand-600 bg-brand-600/10' : 'h-1.5')}
    />
  );
}

const slotKey = (s: Slot) => (s.kind === 'top' ? `top:${s.index}` : `in:${s.repeatId}:${s.index}`);
function parseSlot(key: string): Slot {
  const [k, a, b] = key.split(':');
  return k === 'top' ? { kind: 'top', index: +a } : { kind: 'in', repeatId: a, index: +b };
}

/** A typed number with − / + beside it. Commits on Enter or blur; bad input shakes and snaps back. */
function TypedNumber({ text, onCommit, onNudge, wide, label }: {
  text: string; onCommit: (text: string) => boolean; onNudge: (dir: 1 | -1) => void; wide?: boolean; label: string;
}) {
  const [val, setVal] = useState(text);
  const [focused, setFocused] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  if (!focused && val !== text) setVal(text);
  const commit = () => {
    if (val.trim() === text) return;
    if (!onCommit(val)) {
      setVal(text);
      ref.current?.animate([{ transform: 'translateX(-4px)' }, { transform: 'translateX(4px)' }, { transform: 'none' }], { duration: 180 });
    }
  };
  const btn = 'rounded-full bg-page/70 text-ink-900 flex items-center justify-center active:bg-brand-600/15 shrink-0';
  return (
    <div dir="ltr" className="flex items-center gap-1.5">
      <button type="button" onClick={() => onNudge(-1)} className={cn(btn, wide ? 'w-11 h-11' : 'w-8 h-8')} aria-label="−"><Minus className="h-4 w-4" /></button>
      <input
        ref={ref}
        aria-label={label}
        inputMode="decimal"
        enterKeyHint="done"
        value={val}
        onFocus={(e) => { setFocused(true); e.currentTarget.select(); }}
        onChange={(e) => setVal(e.target.value)}
        onBlur={() => { setFocused(false); commit(); }}
        onKeyDown={(e) => { if (e.key === 'Enter') (e.target as HTMLInputElement).blur(); }}
        className={cn(
          'bg-page/70 rounded-xl text-center font-extrabold text-ink-900 tabular-nums outline-none focus:bg-card focus:ring-2 focus:ring-brand-600',
          wide ? 'w-[104px] h-11 text-2xl' : 'w-[62px] h-9 text-lg',
        )}
      />
      <button type="button" onClick={() => onNudge(1)} className={cn(btn, wide ? 'w-11 h-11' : 'w-8 h-8')} aria-label="+"><Plus className="h-4 w-4" /></button>
    </div>
  );
}

function UnitSwitch<U extends string>({ value, options, onChange }: { value: U; options: [U, string][]; onChange: (u: U) => void }) {
  return (
    <div className="flex flex-col gap-1">
      {options.map(([u, l]) => (
        <button key={u} type="button" onClick={() => onChange(u)}
          className={cn('rounded-lg px-2 py-0.5 text-[11px] font-bold', value === u ? 'bg-ink-900 text-white' : 'bg-page/70 text-ink-500')}>
          {l}
        </button>
      ))}
    </div>
  );
}

function StepPanel({ step, insideRepeat, onPatch, onDuplicate, onDelete, onUnwrap, onClose }: {
  step: DraftStep; insideRepeat: boolean;
  onPatch: (fn: (s: DraftStep) => DraftStep) => void;
  onDuplicate: () => void; onDelete: () => void; onUnwrap: () => void; onClose: () => void;
}) {
  const t = useTranslations('workoutEditor');
  const tc = useTranslations('common');
  // The unit beside the duration box is the coach's choice per step, not stored.
  const [distUnit, setDistUnit] = useState<DistanceUnit>(() => defaultDistanceUnit(step.durationValue || 0));
  const [timeUnit, setTimeUnit] = useState<TimeUnit>(() => defaultTimeUnit(step.durationValue || 0));
  useEffect(() => {
    setDistUnit(defaultDistanceUnit(step.durationValue || 0));
    setTimeUnit(defaultTimeUnit(step.durationValue || 0));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step._id]);

  const act = 'flex-1 rounded-xl py-2.5 text-sm font-bold bg-page/70 text-ink-700 active:bg-page';
  const header = (title: string) => (
    <div className="flex items-center gap-2 mb-2.5">
      <span className="text-base font-bold text-ink-900">{title}</span>
      {insideRepeat && <span className="text-xs text-ink-400">{t('insideRepeat')}</span>}
      <button type="button" onClick={onClose} aria-label={t('closeStep')} className="ms-auto w-8 h-8 rounded-full bg-page/70 flex items-center justify-center"><X className="h-4 w-4" /></button>
    </div>
  );

  if (step.repeatSteps) {
    return (
      <div className="px-4 pt-3 pb-4 border-t border-page">
        {header(t('repeat'))}
        <div className="flex items-center gap-3 mb-3">
          <span className="text-xs font-semibold text-ink-400 w-12">{t('times')}</span>
          <div className="flex-1 flex justify-center">
            <TypedNumber
              wide label={t('times')} text={String(step.repeatCount || 1)}
              onNudge={(d) => onPatch((s) => ({ ...s, repeatCount: Math.max(1, (s.repeatCount || 1) + d) }))}
              onCommit={(txt) => { const n = parseInt(txt, 10); if (!(n >= 1 && n <= 99)) return false; onPatch((s) => ({ ...s, repeatCount: n })); return true; }}
            />
          </div>
        </div>
        <div className="flex gap-2">
          <button type="button" className={act} onClick={onDuplicate}>{t('duplicate')}</button>
          <button type="button" className={act} onClick={onUnwrap}>{t('unwrapRepeat')}</button>
          <button type="button" className={cn(act, 'text-accent-red')} onClick={onDelete}>{tc('delete')}</button>
        </div>
      </div>
    );
  }

  const unit = step.durationType === 'distance' ? distUnit : timeUnit;
  const canPace = step.type !== 'rest';
  const hasPace = canPace && !!step.targetPaceMinPerKm;
  const isRange = hasPace && !!step.targetPaceMaxPerKm && step.targetPaceMaxPerKm !== step.targetPaceMinPerKm;
  const typeOptions = (PICK_TYPES as readonly string[]).includes(step.type) ? PICK_TYPES : [...PICK_TYPES, step.type];

  return (
    <div className="px-4 pt-3 pb-4 border-t border-page max-h-[60dvh] overflow-y-auto">
      {header(stepLabel(step.type, t))}
      <SegmentedControl<string>
        className="mb-2"
        value={step.type}
        onChange={(v) => onPatch((s) => ({
          ...s, type: v as WorkoutStep['type'],
          ...(v === 'rest' ? { targetType: 'no_target' as const, targetPaceMinPerKm: undefined, targetPaceMaxPerKm: undefined, targetZone: undefined } : {}),
        }))}
        options={typeOptions.map((ty) => ({ value: ty, label: stepLabel(ty, t) }))}
      />
      <SegmentedControl<WorkoutStep['durationType']>
        className="mb-2.5"
        value={step.durationType}
        onChange={(v) => onPatch((s) => ({
          ...s, durationType: v,
          durationValue: v === 'open' ? undefined : v === s.durationType ? s.durationValue : v === 'time' ? 60 : 400,
          durationMaxValue: undefined,
        }))}
        options={durationTypes.map((d) => ({ value: d, label: durationTypeLabel(d, t) }))}
      />

      {step.durationType !== 'open' && (
        <div className="flex items-center gap-3 mb-2.5">
          <span className="text-xs font-semibold text-ink-400 w-12">{t('duration')}</span>
          <div className="flex-1 flex justify-center">
            <TypedNumber
              wide label={t('duration')}
              text={durationBoxText(step, unit)}
              onNudge={(d) => onPatch((s) => {
                const st = durationNudge(s, unit);
                return { ...s, durationValue: Math.max(st, (s.durationValue || 0) + d * st), durationMaxValue: undefined };
              })}
              onCommit={(txt) => {
                const v = step.durationType === 'distance' ? parseDistance(txt, distUnit) : parseTime(txt, timeUnit);
                if (v === null) return false;
                onPatch((s) => ({ ...s, durationValue: v, durationMaxValue: undefined }));
                return true;
              }}
            />
          </div>
          {step.durationType === 'distance'
            ? <UnitSwitch value={distUnit} onChange={setDistUnit} options={[['km', t('unitKm')], ['m', t('unitM')]]} />
            : <UnitSwitch value={timeUnit} onChange={setTimeUnit} options={[['min', t('unitMin')], ['sec', t('unitSec')]]} />}
        </div>
      )}

      {canPace && (
        <div className="flex items-center gap-2 mb-2.5 flex-wrap">
          <span className="text-xs font-semibold text-ink-400 w-12">{t('pace')}</span>
          {step.targetZone && step.targetZone !== 'no_target' && !hasPace ? (
            <span className="text-sm font-semibold text-brand-600">{zoneLabel(step.targetZone, t)}</span>
          ) : null}
          {hasPace ? (
            <>
              <div dir="ltr" className="flex items-center gap-1">
                <TypedNumber
                  label={isRange ? t('fromFast') : t('pacePerKm')} text={fmtPace(step.targetPaceMinPerKm!)}
                  onNudge={(d) => onPatch((s) => {
                    const min = Math.max(120, (s.targetPaceMinPerKm || 0) + d * 5);
                    return { ...s, targetPaceMinPerKm: min, targetPaceMaxPerKm: isRange ? Math.max(min, s.targetPaceMaxPerKm || min) : min };
                  })}
                  onCommit={(txt) => {
                    const v = parsePace(txt); if (v === null) return false;
                    onPatch((s) => ({ ...s, targetType: 'pace', targetZone: undefined, targetPaceMinPerKm: v, targetPaceMaxPerKm: isRange ? Math.max(v, s.targetPaceMaxPerKm || v) : v }));
                    return true;
                  }}
                />
                {isRange && (
                  <>
                    <span className="text-ink-400 px-0.5">–</span>
                    <TypedNumber
                      label={t('toSlow')} text={fmtPace(step.targetPaceMaxPerKm!)}
                      onNudge={(d) => onPatch((s) => ({ ...s, targetPaceMaxPerKm: Math.max(s.targetPaceMinPerKm || 0, (s.targetPaceMaxPerKm || 0) + d * 5) }))}
                      onCommit={(txt) => {
                        const v = parsePace(txt); if (v === null) return false;
                        onPatch((s) => ({ ...s, targetPaceMaxPerKm: Math.max(v, s.targetPaceMinPerKm || v), targetPaceMinPerKm: Math.min(v, s.targetPaceMinPerKm || v) }));
                        return true;
                      }}
                    />
                  </>
                )}
              </div>
              <div className="flex gap-2 ms-auto">
                <button type="button" className="text-xs font-semibold text-ink-400"
                  onClick={() => onPatch((s) => ({ ...s, targetPaceMaxPerKm: isRange ? s.targetPaceMinPerKm : (s.targetPaceMinPerKm || 210) + 10 }))}>
                  {isRange ? t('single') : t('addRange')}
                </button>
                <button type="button" className="text-xs font-semibold text-ink-400"
                  onClick={() => onPatch((s) => ({ ...s, targetType: 'no_target', targetZone: undefined, targetPaceMinPerKm: undefined, targetPaceMaxPerKm: undefined }))}>
                  {t('noPace')}
                </button>
              </div>
            </>
          ) : (
            <button type="button"
              onClick={() => onPatch((s) => ({ ...s, targetType: 'pace', targetZone: undefined, targetPaceMinPerKm: 285, targetPaceMaxPerKm: 285 }))}
              className="rounded-xl border-[1.5px] border-dashed border-ink-300 px-3 py-1.5 text-xs font-semibold text-ink-500">
              {t('addPace')}
            </button>
          )}
        </div>
      )}

      <input
        type="text"
        value={step.notes || ''}
        onChange={(e) => onPatch((s) => ({ ...s, notes: e.target.value || undefined }))}
        placeholder={t('notesPlaceholder')}
        className="w-full bg-page/70 rounded-xl px-3 py-2.5 text-sm text-ink-700 mb-2.5 outline-none focus:ring-2 focus:ring-brand-600"
      />
      <div className="flex gap-2">
        <button type="button" className={act} onClick={onDuplicate}>{t('duplicate')}</button>
        <button type="button" className={cn(act, 'text-accent-red')} onClick={onDelete}>{tc('delete')}</button>
      </div>
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
  const t = useTranslations('workoutEditor');
  const tc = useTranslations('common');
  // Edit a local DRAFT — nothing is applied until Save is confirmed. The draft's
  // steps carry ids so a drag can name a step whose position keeps moving.
  const [base, setBase] = useState(() => withIds(workout.steps || []));
  const [name, setName] = useState(workout.name);
  const [steps, setSteps] = useState<DraftStep[]>(base);
  const [history, setHistory] = useState<DraftStep[][]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [confirmingSave, setConfirmingSave] = useState(false);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);
  useEffect(() => {
    const b = withIds(workout.steps || []);
    setBase(b); setSteps(b); setName(workout.name); setHistory([]); setSelected(null);
  }, [workout]);

  const draft: ParsedWorkout = useMemo(() => ({ ...workout, name, steps: stripIds(steps) }), [workout, name, steps]);
  const saved: ParsedWorkout = useMemo(() => ({ ...workout, steps: stripIds(base) }), [workout, base]);
  const dirty = JSON.stringify(draft) !== JSON.stringify(saved);
  const changes = diffWorkouts(saved, draft, t);

  // FLIP: cards glide to their new place after a move instead of jumping.
  const listRef = useRef<HTMLDivElement>(null);
  const before = useRef<Map<string, DOMRect> | null>(null);
  const measure = () => {
    const m = new Map<string, DOMRect>();
    listRef.current?.querySelectorAll<HTMLElement>('[data-id]').forEach((el) => m.set(el.dataset.id!, el.getBoundingClientRect()));
    return m;
  };
  useLayoutEffect(() => {
    const prev = before.current;
    before.current = null;
    if (!prev) return;
    listRef.current?.querySelectorAll<HTMLElement>('[data-id]').forEach((el) => {
      const a = prev.get(el.dataset.id!);
      if (!a) return;
      const dy = a.top - el.getBoundingClientRect().top;
      if (Math.abs(dy) > 1) el.animate([{ transform: `translateY(${dy}px)` }, { transform: 'none' }], { duration: 220, easing: 'cubic-bezier(.2,.8,.2,1)' });
    });
  }, [steps]);

  const commit = (next: DraftStep[] | null, opts: { animate?: boolean } = {}) => {
    if (!next) return;
    if (opts.animate) before.current = measure();
    setHistory((h) => [...h.slice(-49), steps]);
    setSteps(next);
  };
  const undo = () => {
    if (!history.length) return;
    before.current = measure();
    const prev = history[history.length - 1];
    setHistory((h) => h.slice(0, -1));
    setSteps(prev);
    if (selected && !locate(prev, selected)) setSelected(null);
  };

  const sel = selected ? locate(steps, selected) : null;
  const selStep = sel ? sel.list[sel.index] : null;

  // ── drag & drop ──────────────────────────────────────────────────────────────
  // Pointer events, so a finger works the same as a mouse; the handle and palette
  // are `touch-none` + `data-vaul-no-drag` so neither the list's scroll nor the
  // sheet's swipe-to-close takes the gesture.
  const chartRef = useRef<HTMLDivElement>(null);
  const [drag, setDrag] = useState<Drag | null>(null);
  const [ghost, setGhost] = useState<{ x: number; y: number; w: number; dx: number; dy: number } | null>(null);
  const [slot, setSlot] = useState<string | null>(null);
  const [overChart, setOverChart] = useState(false);
  const dragRef = useRef<{ drag: Drag; slot: string | null; overChart: boolean } | null>(null);

  const startDrag = (e: React.PointerEvent, d: Drag) => {
    e.preventDefault();
    e.stopPropagation();
    const el = (e.currentTarget as HTMLElement).closest('[data-id],[data-block]') as HTMLElement | null;
    const r = (el ?? (e.currentTarget as HTMLElement)).getBoundingClientRect();
    (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    dragRef.current = { drag: d, slot: null, overChart: false };
    setDrag(d);
    setGhost({ x: e.clientX, y: e.clientY, w: r.width, dx: e.clientX - r.left, dy: e.clientY - r.top });
  };

  useEffect(() => {
    if (!drag) return;
    const scroller = listRef.current?.closest('.overflow-y-auto') as HTMLElement | null;
    const isRepeatDrag = drag.kind === 'move' ? drag.isRepeat : drag.block === 'rep2' || drag.block === 'rep3';

    // Every gap and every repeat frame is measured ONCE, when the drag starts, in the
    // scroller's content coordinates. Deciding from live positions feeds back on itself:
    // the gap that opens under the finger pushes the frame 52px down, the frame grows to
    // meet the finger, and "below the repeat" can never be reached.
    const list = listRef.current;
    const scrollTop = () => scroller?.scrollTop ?? 0;
    const dragged = drag.kind === 'move' ? list?.querySelector(`[data-node="${drag.id}"]`) : null;
    const gaps = Array.from(list?.querySelectorAll<HTMLElement>('[data-slot]') ?? [])
      .filter((g) => !dragged?.contains(g))
      .map((g) => {
        const r = g.getBoundingClientRect();
        return { key: g.dataset.slot!, y: r.top + r.height / 2 + scrollTop(), frame: g.closest('[data-repeat-body]') };
      });
    const frames = Array.from(list?.querySelectorAll<HTMLElement>('[data-repeat-body]') ?? []).map((f) => {
      const r = f.getBoundingClientRect();
      return { el: f, top: r.top + scrollTop(), bottom: r.bottom + scrollTop() };
    });
    const header = listRef.current?.previousElementSibling as HTMLElement | null;

    const findSlot = (x: number, y: number): { slot: string | null; chart: boolean } => {
      const cr = chartRef.current?.getBoundingClientRect();
      if (cr && y >= cr.top && y <= cr.bottom) {
        // Over the chart: drop between top-level blocks, by x. RTL — the first block is on the right.
        const blocks = Array.from(chartRef.current!.querySelectorAll<HTMLElement>('[data-top-index]'));
        let idx = blocks.length;
        for (const b of blocks) {
          const r = b.getBoundingClientRect();
          if (x > r.left + r.width / 2) { idx = +b.dataset.topIndex!; break; }
        }
        return { slot: `top:${idx}`, chart: true };
      }
      const cy = y + scrollTop();
      // Inside a repeat's grey frame a step can only land inside it; outside, only outside.
      // Otherwise the frame's last gap and the gap right after the block sit a few pixels
      // apart and "take it out of the repeat" lands back in it.
      const frame = isRepeatDrag ? null : frames.find((f) => cy > f.top + 4 && cy < f.bottom - 4)?.el ?? null;
      let best: string | null = null;
      let bd = Infinity;
      for (const g of gaps) {
        if (frame ? g.frame !== frame : g.frame) continue;
        const dist = Math.abs(g.y - cy);
        if (dist < bd) { bd = dist; best = g.key; }
      }
      return { slot: best, chart: false };
    };

    let raf = 0;
    const onMove = (e: PointerEvent) => {
      setGhost((g) => (g ? { ...g, x: e.clientX, y: e.clientY } : g));
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        const f = findSlot(e.clientX, e.clientY);
        if (dragRef.current) { dragRef.current.slot = f.slot; dragRef.current.overChart = f.chart; }
        setSlot(f.slot);
        setOverChart(f.chart);
        if (scroller) {
          // The scroll-up zone starts under the sticky chart + palette, not under the
          // sheet's top edge — a block picked off the palette is already in that strip.
          const sr = scroller.getBoundingClientRect();
          const top = header ? header.getBoundingClientRect().bottom : sr.top;
          if (e.clientY > top && e.clientY < top + 36) scroller.scrollTop -= 10;
          else if (e.clientY > sr.bottom - 60) scroller.scrollTop += 10;
        }
      });
    };
    const onUp = () => {
      cancelAnimationFrame(raf);
      const cur = dragRef.current;
      dragRef.current = null;
      setDrag(null); setGhost(null); setSlot(null); setOverChart(false);
      if (!cur?.slot) return;
      const target = parseSlot(cur.slot);
      if (cur.drag.kind === 'new') {
        const item = blockStep(cur.drag.block, t('stepRest'));
        const next = insertAt(steps, item, target);
        if (next) { commit(next, { animate: true }); setSelected(item._id); }
      } else {
        commit(moveStep(steps, cur.drag.id, target), { animate: true });
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [drag]);

  const pick = (id: string) => setSelected((cur) => (cur === id ? null : id));
  const draggingId = drag?.kind === 'move' ? drag.id : null;

  const requestClose = () => {
    if (dirty) { setConfirmingDiscard(true); return; }
    onClose();
  };

  const confirmSave = () => {
    onChange({ ...draft, autoFixes: remapAutoFixes(workout.autoFixes, base, steps) });
    setConfirmingSave(false);
    onClose();
  };

  const totalSec = workoutDurationSec(draft);
  const totalKm = workoutDistanceMeters(draft) / 1000;

  const footer = selStep ? (
    <StepPanel
      step={selStep}
      insideRepeat={!!sel?.parent}
      onPatch={(fn) => commit(updateStep(steps, selStep._id, fn))}
      onDuplicate={() => { const d = duplicateStep(steps, selStep._id); if (d) { commit(d.steps, { animate: true }); setSelected(d.newId); } }}
      onDelete={() => { commit(removeStep(steps, selStep._id), { animate: true }); setSelected(null); }}
      onUnwrap={() => { commit(unwrapRepeat(steps, selStep._id), { animate: true }); setSelected(null); }}
      onClose={() => setSelected(null)}
    />
  ) : (
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
  );

  return (
    <>
      <Sheet
        open
        onOpenChange={(o) => { if (!o) requestClose(); }}
        title={dayName}
        className="max-h-[94dvh]"
        bodyClassName="px-0 pt-0"
        footer={footer}
      >
        <div className="sticky top-0 z-10 bg-card pb-1">
          <div className="flex items-center gap-2 px-4 pb-2">
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="bg-transparent text-sm text-ink-700 focus:outline-none flex-1 min-w-0 font-medium"
              placeholder={t('workoutNamePlaceholder')}
            />
            <bdi dir="ltr" className="text-xs text-ink-400 tabular-nums shrink-0">
              {mmss(totalSec)} · ~{totalKm.toFixed(1)} {t('unitKm')}
            </bdi>
            <button
              type="button"
              onClick={undo}
              disabled={!history.length}
              aria-label={t('undo')}
              className="w-9 h-9 rounded-full bg-page/70 flex items-center justify-center text-ink-900 disabled:opacity-35 shrink-0"
            >
              <Undo2 className="h-4 w-4" />
            </button>
          </div>
          <StructureChart steps={steps} selected={selected} onPick={pick} dropActive={overChart} chartRef={chartRef} />
          <div className="text-[11px] font-semibold text-ink-400 px-4 pt-2 pb-1">{t('dragBlock')}</div>
          <div className="flex gap-1 px-3 [container-type:inline-size]">
            {BLOCKS.map((b) => (
              <div
                key={b.k}
                data-block={b.k}
                data-vaul-no-drag
                onPointerDown={(e) => startDrag(e, { kind: 'new', block: b.k, label: blockLabel(b.k, t) })}
                className="flex-1 min-w-0 flex flex-col items-center gap-[3px] rounded-[14px] bg-page/70 px-0.5 pt-[7px] pb-[5px] font-bold text-ink-700 whitespace-nowrap overflow-hidden cursor-grab touch-none select-none text-[clamp(8px,2.6cqi,11px)] active:ring-2 active:ring-brand-600"
              >
                <BlockGlyph glyph={b.glyph} />
                {blockLabel(b.k, t)}
              </div>
            ))}
          </div>
        </div>

        <div ref={listRef} className="px-3 pt-1 pb-4">
          {steps.map((s, i) => (
            <div key={s._id}>
              <Gap slot={slotKey({ kind: 'top', index: i })} open={slot === `top:${i}` && !overChart} />
              {s.repeatSteps ? (
                <div data-node={s._id} data-id={s._id} className={cn('rounded-[20px] bg-card border-2 p-1.5', selected === s._id ? 'border-brand-600' : 'border-page', draggingId === s._id && 'opacity-25')}>
                  <div className="flex items-center gap-2 pe-1 cursor-pointer" onClick={() => pick(s._id)}>
                    <span
                      data-vaul-no-drag
                      onPointerDown={(e) => startDrag(e, { kind: 'move', id: s._id, isRepeat: true, label: `${s.repeatCount}× ${t('repeat')}` })}
                      onClick={(e) => e.stopPropagation()}
                      aria-label={t('dragHandle')}
                      className="w-8 h-9 flex items-center justify-center text-ink-300 text-xl cursor-grab touch-none select-none"
                    >⠿</span>
                    <span className="bg-ink-900 text-white font-extrabold text-sm rounded-[10px] px-2.5 py-0.5 tabular-nums">{s.repeatCount}×</span>
                    <span className="text-sm font-bold text-ink-700">{t('repeat')}</span>
                    <span className="ms-auto text-xs text-ink-400 tabular-nums">
                      {mmss(s.repeatSteps.reduce((a, c) => a + stepDurationSec(c), 0) * (s.repeatCount || 1))}
                    </span>
                    <button type="button" onClick={(e) => { e.stopPropagation(); pick(s._id); }} aria-label={t('editStep')}
                      className="w-9 h-9 rounded-full bg-page/70 text-ink-900 flex items-center justify-center">
                      <Pencil className="h-4 w-4" />
                    </button>
                  </div>
                  <div data-repeat-body className="mt-1 rounded-[16px] bg-page/60 px-1.5 py-0.5">
                    {s.repeatSteps.map((c, j) => (
                      <div key={c._id} data-node={c._id}>
                        <Gap slot={slotKey({ kind: 'in', repeatId: s._id, index: j })} open={slot === `in:${s._id}:${j}`} />
                        <StepCard
                          step={c} t={t} selected={selected === c._id} dragging={draggingId === c._id}
                          onPick={() => pick(c._id)}
                          onHandleDown={(e) => startDrag(e, { kind: 'move', id: c._id, isRepeat: false, label: <StepCard step={c} t={t} selected={false} /> })}
                        />
                      </div>
                    ))}
                    <Gap slot={slotKey({ kind: 'in', repeatId: s._id, index: s.repeatSteps.length })} open={slot === `in:${s._id}:${s.repeatSteps.length}`} />
                  </div>
                </div>
              ) : (
                <div data-node={s._id}>
                  <StepCard
                    step={s} t={t} selected={selected === s._id} dragging={draggingId === s._id}
                    onPick={() => pick(s._id)}
                    onHandleDown={(e) => startDrag(e, { kind: 'move', id: s._id, isRepeat: false, label: <StepCard step={s} t={t} selected={false} /> })}
                  />
                </div>
              )}
            </div>
          ))}
          <Gap slot={slotKey({ kind: 'top', index: steps.length })} open={slot === `top:${steps.length}` && !overChart} />
          <p className="text-center text-[11px] text-ink-400 pt-2">{t('dropHint')}</p>
        </div>
      </Sheet>

      {/* The dragged card, following the finger. Portalled: vaul transforms the sheet,
          and position:fixed inside a transformed parent is relative to the parent. */}
      {drag && ghost && typeof document !== 'undefined' && createPortal(
        <div
          className="fixed z-[400] pointer-events-none rounded-[18px] shadow-2xl rotate-[-1.5deg] scale-[1.03] opacity-95"
          style={{ left: ghost.x - ghost.dx, top: ghost.y - ghost.dy, width: ghost.w }}
        >
          {typeof drag.label === 'string' || drag.kind === 'new'
            ? <div className="bg-card rounded-[18px] px-4 py-3 text-sm font-bold text-ink-900">{drag.label}</div>
            : drag.label}
        </div>,
        document.body,
      )}

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
                  'text-3xs font-bold uppercase tracking-wide px-1.5 py-0.5 rounded',
                  c.kind === 'added' ? 'bg-accent-600/20 text-accent-900' :
                  c.kind === 'removed' ? 'bg-accent-red/20 text-accent-red-ink' :
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
                    {f.to !== undefined && <span className="text-accent-900">{f.to}</span>}
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
