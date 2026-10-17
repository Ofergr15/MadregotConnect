'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import {
  bookTotals, fieldValue, isPureZone, nudgeField, profileBar, quickFields, removeStep, setField, structureName, wheelOptions,
  type BookStep, type FieldRef, type Measure,
} from '@/lib/academy/book-steps';
import { BarButton, CARD, FlowScreen, N, PrimaryButton, ProfileBar, RICH, SectionLabel, clockText, kmText } from '@/components/academy/book/ui';
import { StepLines, fieldDisplay, formatField } from '@/components/academy/book/StepLines';
import { StepperButton } from '@/components/academy/book/AdjustScreen';
import { Wheel } from '@/components/academy/book/Wheel';
import {
  buildStep, EDIT_THRESHOLD_SEC, insertStep, moveStep, NEW_STEP_KINDS, newStepDefaults, numberRuns, parseClockText, parsePaceText,
  switchMeasure, type NewStepKind,
} from '@/lib/day-session/model';

// ── "אימון ליום אחד" · the step editor ─────────────────────────────────────────────────
//
// The workout book's "להתאים · הכל במסך אחד" (workout-book-v3 phone 2) for a club session:
// the quick row (reps · each rep · pace) with − +, the steps as sentences with blue numbers
// (a tap opens − + on its row, a second tap the wheel), "+ שלב" and the live bar + total.
// Two things the book's screen does not need and a hand-built session does: a type picker
// with distance OR time and an optional pace, and moving / deleting the tapped step.
//
// Everything is drawn at the book's typical threshold (EDIT_THRESHOLD_SEC) — a club session
// has no one trainee — and a named zone nobody gave a pace says its word (zoneWords), so
// the screen never shows a pace the coach did not type.

const T = EDIT_THRESHOLD_SEC;

export function StepEditor({ initial, original, onCancel, onDone }: {
  initial: BookStep[];
  /** What "↺ כמו במשפט" goes back to; null for a session entered by hand. */
  original: BookStep[] | null;
  onCancel: () => void;
  onDone: (steps: BookStep[]) => void;
}) {
  const t = useTranslations('daySession');
  const tb = useTranslations('workoutBook');
  const [model, setModel] = useState<BookStep[]>(initial);
  const [selected, setSelected] = useState<FieldRef | null>(null);
  const [wheel, setWheel] = useState<FieldRef | null>(null);
  const [adding, setAdding] = useState(initial.length === 0);

  const tap = (ref: FieldRef) => {
    if (selected && selected.step === ref.step && selected.field === ref.field) setWheel(ref);
    else setSelected(ref);
  };
  const nudge = (ref: FieldRef, sign: 1 | -1) => setModel((m) => nudgeField(m, ref, sign, T));

  const totals = useMemo(() => (model.length ? bookTotals(model, null) : null), [model]);
  const bar = useMemo(() => profileBar(model, null), [model]);
  const quick = quickFields(model);
  const changed = !!original && JSON.stringify(model) !== JSON.stringify(original);
  const sel = selected ? selected.step : null;

  const display = (ref: FieldRef) => {
    const s = model[ref.step];
    if (ref.field === 'pace' && s && (s.kind === 'reps' || s.kind === 'run') && isPureZone(s.effort)) {
      return s.effort?.zone ? tb(`zone.${s.effort.zone}`) : '—';
    }
    return fieldDisplay(model, ref, T);
  };

  const act = (next: BookStep[], keep: number | null) => {
    setModel(next);
    setSelected(keep === null ? null : { step: keep, field: firstField(next, keep) });
  };

  return (
    <div className="relative flex h-full min-h-0 flex-col">
        <FlowScreen
          title={t('editorTitle')}
          leading={<BarButton onClick={onCancel}>{t('cancel')}</BarButton>}
          trailing={<BarButton strong onClick={() => onDone(model)}>{t('editorDone')}</BarButton>}
          className="gap-3"
          footer={
            <>
              {totals && (
                <p className="px-1 text-[16px] text-ink-500">
                  {t.rich('outcome', { ...RICH, km: kmText(totals.distanceM), min: Math.round(totals.durationSec / 60) })}
                </p>
              )}
              <PrimaryButton onClick={() => onDone(model)}>{t('editorDone')}</PrimaryButton>
            </>
          }
        >
          {model.length > 0 && (
            <h2 className="text-[24px] font-black leading-tight text-ink-900"><Runs text={structureName(model)} /></h2>
          )}
          {bar.length > 0 && <ProfileBar segments={bar} />}

          {quick.length > 0 && (
            <div className={cn('grid gap-2', quick.length === 3 ? 'grid-cols-3' : 'grid-cols-2')}>
              {quick.map((ref) => (
                <div key={ref.field} className={cn(CARD, 'rounded-[18px] px-1.5 py-2.5 text-center')}>
                  <small className="mb-1.5 block text-[12.5px] font-bold text-ink-400">{tb(`quick.${ref.field}`)}</small>
                  <div className="flex items-center justify-between">
                    <StepperButton sign={-1} onClick={() => nudge(ref, -1)} />
                    <N className="shrink-0 text-[19px] font-black tracking-tight text-ink-900">{display(ref)}</N>
                    <StepperButton sign={1} onClick={() => nudge(ref, 1)} />
                  </div>
                </div>
              ))}
            </div>
          )}

          <SectionLabel>{tb('stepsHint')}</SectionLabel>
          {model.length ? (
            <StepLines steps={model} thresholdSec={T} zoneWords selected={selected} onTap={tap} onNudge={nudge} />
          ) : (
            <p className={cn(CARD, 'px-4 py-3 text-sm text-ink-500')}>{t('editorEmpty')}</p>
          )}

          {sel !== null && model[sel] && (
            <div className={cn(CARD, 'flex flex-wrap items-center justify-between gap-1 px-2 py-1.5')} role="group" aria-label={t('stepActions', { n: sel + 1 })}>
              <ActionButton disabled={sel === 0} onClick={() => act(moveStep(model, sel, -1), sel - 1)}>{t('moveUp')}</ActionButton>
              <ActionButton disabled={sel === model.length - 1} onClick={() => act(moveStep(model, sel, 1), sel + 1)}>{t('moveDown')}</ActionButton>
              {model[sel].kind !== 'hr' && (
                <ActionButton onClick={() => act(switchMeasure(model, sel), sel)}>
                  {lengthMeasure(model[sel]) === 'time' ? t('toDistance') : t('toTime')}
                </ActionButton>
              )}
              <ActionButton danger onClick={() => act(removeStep(model, sel), null)}>{t('removeStep')}</ActionButton>
            </div>
          )}

          {adding ? (
            <AddStep
              onCancel={model.length ? () => setAdding(false) : undefined}
              onAdd={(step) => { const next = insertStep(model, step); setModel(next); setSelected(null); setAdding(false); }}
            />
          ) : (
            <div className="flex items-center justify-between px-1">
              <button type="button" onClick={() => { setAdding(true); setSelected(null); }} className="min-h-[44px] text-[16px] font-bold text-brand-600">
                + {tb('addStep')}
              </button>
              {original && original.length > 0 && (
                <button
                  type="button"
                  onClick={() => { setSelected(null); setModel(original); }}
                  disabled={!changed}
                  className="min-h-[44px] text-[16px] font-bold text-ink-400 disabled:opacity-50"
                >
                  {t('resetEdit')}
                </button>
              )}
            </div>
          )}
        </FlowScreen>

        {wheel && model[wheel.step] && (
          <Wheel
            title={tb(`wheel.${wheel.field}`)}
            options={wheelOptions(model, wheel, T)}
            value={fieldValue(model, wheel, T) ?? 0}
            format={(v) => formatField(model, wheel, v, T)}
            onClose={() => setWheel(null)}
            onPick={(v) => { setModel(setField(model, wheel, v, T)); setWheel(null); }}
          />
        )}
    </div>
  );
}

function lengthMeasure(s: BookStep): Measure | null {
  if (s.kind === 'reps') return s.work.measure;
  if (s.kind === 'rest') return s.length.measure;
  if (s.kind === 'run') return s.length?.measure ?? null;
  return null;
}

/** The field a step's action row keeps selected after a move: the reps' count, else its length. */
function firstField(steps: BookStep[], i: number): FieldRef['field'] {
  const s = steps[i];
  if (s?.kind === 'reps') return 'count';
  if (s?.kind === 'run' && !s.length) return 'pace';
  return 'length';
}

function ActionButton({ children, onClick, disabled, danger }: { children: React.ReactNode; onClick: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={cn('min-h-[44px] rounded-xl px-2.5 text-sm font-extrabold disabled:opacity-40', danger ? 'text-accent-red' : 'bg-[#EEF0FF] text-brand-600')}
    >
      {children}
    </button>
  );
}

/** "+ שלב": the type, distance OR time, and an optional pace. */
function AddStep({ onAdd, onCancel }: { onAdd: (step: BookStep) => void; onCancel?: () => void }) {
  const t = useTranslations('daySession');
  const [kind, setKind] = useState<NewStepKind>('warmup');
  const [measure, setMeasure] = useState<Measure>('distance');
  const [length, setLength] = useState('2');
  const [count, setCount] = useState('5');
  const [pace, setPace] = useState('');
  const [rest, setRest] = useState('2:00');
  const [bad, setBad] = useState(false);

  const pick = (k: NewStepKind) => {
    const d = newStepDefaults(k);
    setKind(k);
    setMeasure(d.measure);
    setLength(lengthText(k, d.measure, d.value));
    setCount(String(d.count ?? 5));
    setRest(d.restSec ? clockText(d.restSec) : '');
    setPace('');
    setBad(false);
  };
  const flip = (m: Measure) => {
    if (m === measure) return;
    setMeasure(m);
    setLength(m === 'time' ? (kind === 'reps' ? '3:00' : kind === 'rest' ? '2:00' : '10') : kind === 'reps' ? '1000' : kind === 'rest' ? '200' : '2');
  };

  const add = () => {
    const value = readLength(kind, measure, length);
    const p = pace.trim() ? parsePaceText(pace) : null;
    const restSec = kind === 'reps' && rest.trim() ? parseClockText(rest) : null;
    const step = value === null || (pace.trim() && p === null) || (kind === 'reps' && rest.trim() && restSec === null)
      ? null
      : buildStep({ kind, measure, value, pace: kind === 'rest' ? null : p, count: Number(count), restSec });
    if (!step) { setBad(true); return; }
    onAdd(step);
  };

  const unit = measure === 'time' ? t('lengthTime') : kind === 'reps' || kind === 'rest' ? t('lengthM') : t('lengthKm');
  const field = 'min-h-[44px] w-full rounded-xl border border-[#E6E6EC] bg-white px-3 text-center text-lg font-black text-ink-900 outline-none';

  return (
    <div className={cn(CARD, 'space-y-3 p-3.5')}>
      <SectionLabel>{t('addStepTitle')}</SectionLabel>
      <div className="grid grid-cols-5 gap-1">
        {NEW_STEP_KINDS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => pick(k)}
            aria-pressed={kind === k}
            className={cn('min-h-[44px] rounded-xl border px-0.5 text-[13px] font-extrabold', kind === k ? 'border-brand-600 bg-brand-600 text-white' : 'border-[#E6E6EC] bg-white text-ink-500')}
          >
            {t(`kind.${k}`)}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-1.5" role="radiogroup">
        {(['distance', 'time'] as Measure[]).map((m) => (
          <button
            key={m}
            type="button"
            role="radio"
            aria-checked={measure === m}
            onClick={() => flip(m)}
            className={cn('min-h-[44px] rounded-xl text-sm font-extrabold', measure === m ? 'bg-ink-900 text-white' : 'bg-[#F1F1F5] text-ink-500')}
          >
            {m === 'distance' ? t('byDistance') : t('byTime')}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {kind === 'reps' && (
          <label className="space-y-1">
            <span className="block text-13 font-bold text-ink-400">{t('count')}</span>
            <input value={count} onChange={(e) => setCount(e.target.value)} inputMode="numeric" dir="ltr" aria-label={t('count')} className={field} />
          </label>
        )}
        <label className="space-y-1">
          <span className="block text-13 font-bold text-ink-400">{unit}</span>
          <input value={length} onChange={(e) => setLength(e.target.value)} inputMode="decimal" dir="ltr" aria-label={unit} className={field} />
        </label>
        {kind !== 'rest' && (
          <label className="space-y-1">
            <span className="block text-13 font-bold text-ink-400">{t('pace')}</span>
            <input value={pace} onChange={(e) => setPace(e.target.value)} inputMode="decimal" dir="ltr" placeholder="–:––" aria-label={t('pace')} className={cn(field, 'placeholder:text-ink-300')} />
          </label>
        )}
        {kind === 'reps' && (
          <label className="space-y-1">
            <span className="block text-13 font-bold text-ink-400">{t('restBetween')}</span>
            <input value={rest} onChange={(e) => setRest(e.target.value)} inputMode="decimal" dir="ltr" placeholder="2:00" aria-label={t('restBetween')} className={cn(field, 'placeholder:text-ink-300')} />
          </label>
        )}
      </div>
      {bad && <p role="alert" className="text-13 font-bold text-accent-red">{t('badStep')}</p>}
      <div className="flex gap-2">
        <PrimaryButton onClick={add} className="flex-1">{t('addIt')}</PrimaryButton>
        {onCancel && <PrimaryButton secondary onClick={onCancel} className="flex-1">{t('cancel')}</PrimaryButton>}
      </div>
    </div>
  );
}

/** The add form's length field as typed: km for a run, metres for reps and a rest, m:ss for time. */
function lengthText(kind: NewStepKind, measure: Measure, value: number): string {
  if (measure === 'time') return kind === 'reps' || kind === 'rest' ? clockText(value) : String(Math.round(value / 60));
  return kind === 'reps' || kind === 'rest' ? String(value) : kmText(value);
}

function readLength(kind: NewStepKind, measure: Measure, text: string): number | null {
  if (measure === 'time') return parseClockText(text);
  const n = Number(text.trim().replace(',', '.'));
  if (!Number.isFinite(n) || n <= 0) return null;
  return kind === 'reps' || kind === 'rest' ? Math.round(n) : Math.round(n * 1000);
}

/** The title with each number run in an LTR isolate (`5 × 1` never flips). */
function Runs({ text }: { text: string }) {
  return <>{numberRuns(text).map((r, i) => (r.ltr ? <bdi key={i} dir="ltr">{r.text}</bdi> : <span key={i}>{r.text}</span>))}</>;
}
