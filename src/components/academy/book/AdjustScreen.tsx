'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Minus, Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  addStep, bookTotals, fieldValue, nudgeField, profileBar, quickFields, setField, wheelOptions,
  type BookStep, type FieldRef,
} from '@/lib/academy/book-steps';
import { BarButton, CARD, FlowScreen, N, PrimaryButton, ProfileBar, RICH, SectionLabel, kmText } from './ui';
import { StepLines, fieldDisplay, formatField } from './StepLines';
import { Wheel } from './Wheel';
import { useFavourites } from './BookPicker';
import type { Draft } from './types';

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
  draft, thresholdSec, traineeName, dayLabel, sending, sendError, onCancel, onChange, onSend,
}: {
  draft: Draft;
  thresholdSec: number | null;
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
  const model = draft.model;
  const T = thresholdSec;

  const setModel = (next: BookStep[]) => onChange({ ...draft, model: next });
  const nudge = (ref: FieldRef, sign: 1 | -1) => { if (model) setModel(nudgeField(model, ref, sign, T)); };
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
            <PrimaryButton onClick={() => onSend(draft)} disabled={blocked} busy={sending}>{t('putOn', { day: dayLabel })}</PrimaryButton>
          </>
        }
      >
        <div className="flex items-start justify-between gap-2">
          <h2 className="text-[24px] font-black leading-tight text-ink-900"><bdi>{draft.name}</bdi></h2>
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

        {model && quick.length > 0 && (
          <div className={cn('grid gap-2', quick.length === 3 ? 'grid-cols-3' : 'grid-cols-2')}>
            {quick.map(ref => (
              <div key={ref.field} className={cn(CARD, 'rounded-[18px] px-1.5 py-2.5 text-center')}>
                <small className="mb-1.5 block text-[12.5px] font-bold text-ink-400">{t(`quick.${ref.field}`)}</small>
                <div className="flex items-center justify-between">
                  <StepperButton sign={-1} onClick={() => nudge(ref, -1)} />
                  <button type="button" onClick={() => setWheel(ref)} className="shrink-0 text-[19px] font-black tracking-tight text-ink-900" aria-label={t('a11y.openWheel')}>
                    <N>{fieldDisplay(model, ref, T)}</N>
                  </button>
                  <StepperButton sign={1} onClick={() => nudge(ref, 1)} />
                </div>
              </div>
            ))}
          </div>
        )}

        <SectionLabel>{model ? t('stepsHint') : t('stepsReadOnly')}</SectionLabel>
        {model ? (
          <StepLines steps={model} thresholdSec={T} selected={selected} onTap={tap} onNudge={nudge} />
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
                ↺ {t('reset')}
              </button>
            )}
          </div>
        )}
      </FlowScreen>

      {wheel && model && (
        <Wheel
          title={t(`wheel.${wheel.field}`)}
          options={wheelOptions(model, wheel, T)}
          value={fieldValue(model, wheel, T) ?? 0}
          format={v => formatField(model, wheel, v, T)}
          onClose={() => setWheel(null)}
          onPick={v => { setModel(setField(model, wheel, v, T)); setWheel(null); }}
        />
      )}
    </div>
  );
}

/** The quick row's − + — 28px drawn (three cells share 354px), 44px to the thumb. */
function StepperButton({ sign, onClick }: { sign: 1 | -1; onClick: () => void }) {
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
