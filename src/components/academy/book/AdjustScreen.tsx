'use client';

import type { PaceAdjust } from '@/lib/academy/pace-kinds';
import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Minus, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { apiHeaders } from '@/lib/api';
import {
  addStep, bookTotals, fieldValue, nudgeField, profileBar, quickFields, setField, wheelOptions,
  type BookStep, type FieldRef, sessionGlance, toLibrarySteps,
} from '@/lib/academy/book-steps';
import { BarButton, CARD, FlowScreen, N, PrimaryButton, ProfileBar, RICH, SectionLabel, kmText } from './ui';
import { StepLines, fieldDisplay, formatField } from './StepLines';
import { Wheel } from './Wheel';
import { StepMenu } from './StepMenu';
import { useFavourites } from './BookPicker';
import type { Draft } from './types';
import { renamedForStructure } from '@/lib/academy/draft-name';

// ── להתאים · הכל במסך אחד (mockup phone 2) ───────────────────────────────────────────────
//
// Top: the three numbers that change most (reps · each rep · pace) with − +. Under them the
// whole session as sentences with blue numbers; tapping a number opens − + on its row, a
// second tap opens the wheel. The bar and the total move with every tap, and the total
// says how far the session has moved from where it started (`+0.2 ק״מ`).
//
// Every edit here is ONE-OFF: it changes what this trainee is sent this day, not the book
// entry it came from. Saving a version to the book is a separate, explicit toggle on the
// send screen — an accidental + on a canon entry must not rewrite what everybody pushes.

export function AdjustScreen({
  draft, thresholdSec, paceAdjust, traineeName, dayLabel, sending, sendError, onCancel, onChange, onSend,
}: {
  draft: Draft;
  thresholdSec: number | null;
  /** The coach's pace update in force: every pace shown and set is the one the watch gets. */
  paceAdjust?: PaceAdjust | null;
  traineeName: string;
  dayLabel: string;
  sending: boolean;
  sendError: string | null;
  onCancel: () => void;
  onChange: (draft: Draft) => void;
  onSend: (draft: Draft) => void;
}) {
  const t = useTranslations('workoutBook');
  const { favourites, toggle } = useFavourites();
  const [selected, setSelected] = useState<FieldRef | null>(null);
  const [wheel, setWheel] = useState<FieldRef | null>(null);
  const [adding, setAdding] = useState(false);
  const [menu, setMenu] = useState<number | null>(null);
  const model = draft.model;
  const T = thresholdSec;
  const A = paceAdjust ?? null;

  // A derived name follows the structure (launch N24); a written one stays.
  const setModel = (next: BookStep[]) => onChange({ ...draft, model: next, name: renamedForStructure(draft.name, draft.model, next, draft.original) });
  const nudge = (ref: FieldRef, sign: 1 | -1) => { if (model) setModel(nudgeField(model, ref, sign, T, A)); };
  const tap = (ref: FieldRef) => {
    if (selected && selected.step === ref.step && selected.field === ref.field) setWheel(ref);
    else setSelected(ref);
  };

  const totals = useMemo(() => (model ? bookTotals(model, T) : null), [model, T]);
  const before = useMemo(() => (draft.original ? bookTotals(draft.original, T) : null), [draft.original, T]);
  const bar = useMemo(() => (model ? profileBar(model, T) : []), [model, T]);
  const quick = model ? quickFields(model) : [];
  const deltaKm = totals && before ? Math.round((totals.distanceM - before.distanceM) / 100) / 10 : 0;
  const changed = !!model && !!draft.original && JSON.stringify(model) !== JSON.stringify(draft.original);
  const blocked = !T;

  return (
    <div className="relative flex h-full min-h-0 flex-col">
      <FlowScreen
        title={t('adjustTitle')}
        leading={<BarButton onClick={onCancel}>{t('cancel')}</BarButton>}
        trailing={<BarButton strong onClick={() => onSend(draft)} disabled={blocked || sending}>{t('done')}</BarButton>}
        className="gap-3"
        footer={
          <>
            {totals && (
              <div className="flex items-center justify-between px-1 text-[16px] text-ink-500">
                <span>
                  {t.rich(totals.estimated ? 'outcomeEstimated' : 'outcome', {
                    ...RICH, km: kmText(totals.distanceM), min: Math.round(totals.durationSec / 60),
                  })}
                </span>
                {changed && deltaKm !== 0 && (
                  <span className="text-sm font-extrabold text-[#0E7A3C]">
                    <N>{deltaKm > 0 ? '+' : '−'}{Math.abs(deltaKm)}</N> {t('unit.km')}
                  </span>
                )}
              </div>
            )}
            {blocked && <p className="text-center text-sm font-bold text-[#8A4308]">{t('noTestBlock', { name: traineeName })}</p>}
            {sendError && <p className="text-center text-sm font-bold text-accent-red-ink">{sendError}</p>}
            <PrimaryButton onClick={() => onSend(draft)} disabled={blocked} busy={sending}>{t('putOn', { day: dayLabel, name: traineeName.split(' ')[0] || traineeName })}</PrimaryButton>
          </>
        }
      >
        <div className="flex items-start justify-between gap-2">
          {/* The name is the coach's to write: the parse names it from the structure, never for good. */}
          <input
            value={draft.name}
            onChange={e => onChange({ ...draft, name: e.target.value })}
            aria-label={t('workoutName')}
            dir="auto"
            className="min-w-0 flex-1 rounded-lg bg-transparent text-[24px] font-black leading-tight text-ink-900 outline-none focus:bg-[#F4F4F8] focus:px-2"
          />
          {draft.entryId && (
            <button
              type="button"
              onClick={() => void toggle(draft.entryId!)}
              aria-pressed={favourites.has(draft.entryId)}
              aria-label={t('favourite')}
              className="-m-2 grid h-11 w-11 shrink-0 place-items-center text-xl"
            >
              {favourites.has(draft.entryId) ? '❤' : '♡'}
            </button>
          )}
        </div>
        {bar.length > 0 && <ProfileBar segments={bar} />}
        {draft.source === 'book' && model && <Glance steps={model} thresholdSec={T} paceAdjust={A} />}

        {model && quick.length > 0 && (
          <div className={cn('grid gap-2', quick.length === 3 ? 'grid-cols-3' : 'grid-cols-2')}>
            {quick.map(ref => (
              <div key={ref.field} className={cn(CARD, 'rounded-[18px] px-1.5 py-2.5 text-center')}>
                <small className="mb-1.5 block text-[12.5px] font-bold text-ink-400">{t(`quick.${ref.field}`)}</small>
                <div className="flex items-center justify-between">
                  <StepperButton sign={-1} onClick={() => nudge(ref, -1)} />
                  {/* Not a button: three cells share 354px, and a third target between the
                      two 44px halos would be a target nobody can hit. The wheel for these is
                      a second tap on the same number in the sentences below. */}
                  <N className="shrink-0 text-[19px] font-black tracking-tight text-ink-900">{fieldDisplay(model, ref, T, A)}</N>
                  <StepperButton sign={1} onClick={() => nudge(ref, 1)} />
                </div>
              </div>
            ))}
          </div>
        )}

        <SectionLabel>{model ? t('stepsHint') : t('stepsReadOnly')}</SectionLabel>
        {model ? (
          <StepLines steps={model} thresholdSec={T} paceAdjust={A} selected={selected} onTap={tap} onNudge={nudge} onStepMenu={i => { setSelected(null); setMenu(i); }} />
        ) : (
          <p className={cn(CARD, 'px-4 py-3 text-sm text-ink-500')}>{t('notEditable')}</p>
        )}

        {model && (
          <div className="flex items-center justify-between px-1">
            {adding ? (
              <div className="flex gap-2">
                {(['run', 'reps', 'rest'] as const).map(kind => (
                  <button
                    key={kind}
                    type="button"
                    onClick={() => { setModel(addStep(model, kind)); setAdding(false); }}
                    className="h-11 rounded-full bg-white px-3.5 text-sm font-bold text-brand-600 shadow-sm"
                  >
                    {t(`add.${kind}`)}
                  </button>
                ))}
              </div>
            ) : (
              <button type="button" onClick={() => setAdding(true)} className="min-h-[44px] text-[16px] font-bold text-brand-600">
                + {t('addStep')}
              </button>
            )}
            {draft.original && (
              <button
                type="button"
                onClick={() => { setSelected(null); setModel(draft.original!); }}
                disabled={!changed}
                className="min-h-[44px] text-[16px] font-bold text-ink-400 disabled:opacity-50"
              >
                ↺ {draft.source === 'book' ? t('resetBook') : t('reset')}
              </button>
            )}
          </div>
        )}

        {draft.source === 'book' && model && <SaveAsNew draft={draft} model={model} />}

        {/* What the trainee reads on the day and on the watch — the coach's words, editable. */}
        <label className="block">
          <span className="mb-1.5 block px-1 text-13 font-bold text-ink-400">{t('notesLabel')}</span>
          <textarea
            value={draft.notes ?? ''}
            onChange={e => onChange({ ...draft, notes: e.target.value || null })}
            placeholder={t('notesPlaceholder')}
            rows={3}
            dir="auto"
            className={cn(CARD, 'block w-full resize-none px-4 py-3 text-[16px] text-ink-900 outline-none placeholder:text-ink-300')}
          />
        </label>
      </FlowScreen>

      {menu !== null && model && (
        <StepMenu
          steps={model}
          index={menu}
          thresholdSec={T}
          paceAdjust={A}
          onChange={(next, focus) => { setModel(next); setMenu(focus ?? null); }}
          onClose={() => setMenu(null)}
        />
      )}

      {wheel && model && (
        <Wheel
          title={t(`wheel.${wheel.field}`)}
          options={wheelOptions(model, wheel, T, A)}
          value={fieldValue(model, wheel, T, A) ?? 0}
          format={v => formatField(model, wheel, v, T)}
          onClose={() => setWheel(null)}
          onPick={v => { setModel(setField(model, wheel, v, T, A)); setWheel(null); }}
        />
      )}
    </div>
  );
}

/** The quick row's − + — 28px drawn (three cells share 354px), 44px to the thumb. */
export function StepperButton({ sign, onClick }: { sign: 1 | -1; onClick: () => void }) {
  const t = useTranslations('workoutBook');
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={sign < 0 ? t('a11y.less') : t('a11y.more')}
      className="relative grid h-7 w-7 shrink-0 place-items-center rounded-[9px] bg-[#EEF0FF] text-brand-600 after:absolute after:-inset-2 after:content-['']"
    >
      {sign < 0 ? <Minus className="h-4 w-4" strokeWidth={3} /> : <Plus className="h-4 w-4" strokeWidth={3} />}
    </button>
  );
}

const clockText = (sec: number) => {
  const m = Math.floor(sec / 60), x = Math.round(sec % 60);
  return x ? `${m}:${String(x).padStart(2, '0')}` : `${m}`;
};
const paceText = (sec: number) => `${Math.floor(sec / 60)}:${String(Math.round(sec % 60)).padStart(2, '0')}`;
/** A length as the coach says it, numbers isolated LTR and the unit in the line's own order. */
function LengthWords({ l }: { l: { measure: 'distance' | 'time'; value: number } | null }) {
  if (!l) return null;
  if (l.measure === 'distance') {
    return l.value >= 1000 ? <><N>{Math.round(l.value / 100) / 10}</N> ק״מ</> : <><N>{Math.round(l.value)}</N> מ׳</>;
  }
  return l.value >= 60 ? <><N>{clockText(l.value)}</N> דק׳</> : <><N>{Math.round(l.value)}</N> שנ׳</>;
}
function PartWords({ p }: { p: { distanceM: number; durationSec: number } }) {
  return <><N>{Math.round(p.distanceM / 100) / 10}</N> ק״מ · <N>{Math.round(p.durationSec / 60)}</N> דק׳</>;
}

/**
 * The book entry at a glance, at this trainee's paces (Ofer, 2026-10-20): totals, warm-up,
 * the main set, recoveries, cool-down. The same sizing and pricing the send uses.
 */
function Glance({ steps, thresholdSec, paceAdjust }: { steps: BookStep[]; thresholdSec: number | null; paceAdjust: PaceAdjust | null }) {
  const g = useMemo(() => sessionGlance(steps, thresholdSec, paceAdjust), [steps, thresholdSec, paceAdjust]);
  const rows: Array<[string, React.ReactNode]> = [];
  if (g.warmup) rows.push(['חימום', <PartWords key="w" p={g.warmup} />]);
  if (g.main) {
    const main = g.main;
    rows.push(['עיקר', (
      <span key="m">
        {main.count ? <><N>{main.count}</N> × <LengthWords l={main.work} /></> : main.work ? <LengthWords l={main.work} /> : <PartWords p={main.size} />}
        {main.paceSec ? <> ב־<N>{paceText(main.paceSec)}</N></> : null}
      </span>
    )]);
  }
  if (g.recovery) rows.push(['התאוששות', <span key="r"><LengthWords l={g.recovery.length} />{g.recovery.mode === 'walk' ? ' הליכה' : g.recovery.mode === 'jog' ? ' ריצה קלה' : g.recovery.mode === 'stand' ? ' עמידה' : ''}</span>]);
  if (g.cooldown) rows.push(['שחרור', <PartWords key="c" p={g.cooldown} />]);
  return (
    <div className={cn(CARD, 'rounded-[18px] px-4 py-3')}>
      <div className="flex items-baseline gap-3">
        <b className="text-[22px] font-black text-ink-900"><N>{g.total.estimated ? 'כ־' : ''}{Math.round(g.total.distanceM / 100) / 10}</N> <small className="text-[13px] font-bold text-ink-400">ק״מ</small></b>
        <b className="text-[22px] font-black text-ink-900"><N>{Math.round(g.total.durationSec / 60)}</N> <small className="text-[13px] font-bold text-ink-400">דק׳</small></b>
      </div>
      <div className="mt-1.5 grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[14px]">
        {rows.map(([k, v]) => (
          <div key={k} className="contents"><span className="font-bold text-ink-400">{k}</span><span className="font-bold text-ink-900">{v}</span></div>
        ))}
      </div>
    </div>
  );
}

/** "לשמור כגרסה חדשה בספר": a NEW entry from the edited steps — the original is never changed. */
function SaveAsNew({ draft, model }: { draft: Draft; model: BookStep[] }) {
  const [state, setState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle');
  const changed = !!draft.original && JSON.stringify(model) !== JSON.stringify(draft.original);
  if (!changed) return null;
  const save = async () => {
    setState('busy');
    const body = (scope: 'academy' | 'mine') => JSON.stringify({ name: `${draft.name} (גרסה)`, kind: draft.kind, notes: draft.notes, steps: toLibrarySteps(model), scope });
    try {
      let res = await fetch('/api/academy/library', { method: 'POST', headers: await apiHeaders(true), body: body('academy') });
      if (res.status === 403) res = await fetch('/api/academy/library', { method: 'POST', headers: await apiHeaders(true), body: body('mine') });
      setState(res.ok ? 'done' : 'error');
    } catch {
      setState('error');
    }
  };
  return (
    <button type="button" onClick={() => void save()} disabled={state === 'busy' || state === 'done'}
      className="min-h-[44px] px-1 text-start text-[14.5px] font-bold text-brand-600 disabled:text-ink-400">
      {state === 'done' ? '✓ נשמר כגרסה חדשה בספר' : state === 'error' ? 'לא נשמר — נסו שוב' : '＋ לשמור כגרסה חדשה בספר'}
    </button>
  );
}
