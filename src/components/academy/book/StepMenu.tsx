'use client';

import type { PaceAdjust } from '@/lib/academy/pace-kinds';
import { useTranslations } from 'next-intl';
import { ArrowDown, ArrowUp, Copy, Plus, Trash2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import {
  convertStep, duplicateStep, insertStep, moveStep, paceSpread, removeStep, setMeasure, setPaceSpread, stepType,
  type BookStep, type Measure, type StepType,
} from '@/lib/academy/book-steps';

// ── One step's sheet (Ofer, 2026-10-19: "a coach needs EDITING too, not only auto-detection —
// to fix and to add") ─────────────────────────────────────────────────────────────────────
//
// The numbers stay where they were — blue in the sentence, − + and the wheel. Everything a
// number cannot say lives here, one sheet per step, opened by its ⋯: what the step IS, by
// distance or by time, an exact pace or a range, and the structure — up, down, again, a new
// step after it, delete. Same overlay as the wheel, inside the flow, no second editor.

const TYPES: StepType[] = ['warmup', 'steady', 'interval', 'recovery', 'cooldown'];
const SPREADS = [0, 5, 10];

export function StepMenu({ steps, index, thresholdSec, paceAdjust, onChange, onClose }: {
  steps: BookStep[];
  index: number;
  thresholdSec: number | null;
  paceAdjust?: PaceAdjust | null;
  onChange: (next: BookStep[], focus?: number | null) => void;
  onClose: () => void;
}) {
  const t = useTranslations('workoutBook');
  const step = steps[index];
  if (!step) return null;
  const type = stepType(step);
  const len = step.kind === 'reps' ? step.work : step.kind === 'run' || step.kind === 'rest' ? step.length : null;
  const paced = (step.kind === 'run' || step.kind === 'reps') && !!step.effort && !!thresholdSec;
  const spread = paceSpread(step, thresholdSec);
  const chip = (on: boolean) => cn('min-h-[40px] rounded-full px-3.5 text-[14.5px] font-bold', on ? 'bg-brand-600 text-white' : 'bg-[#F1F2F7] text-ink-700');
  const act = 'flex min-h-[48px] flex-1 flex-col items-center justify-center gap-0.5 rounded-[14px] bg-[#F1F2F7] text-[12.5px] font-bold text-ink-700 disabled:opacity-40';

  return (
    <>
      <button type="button" aria-label={t('a11y.closeWheel')} onClick={onClose} className="absolute inset-0 z-10 bg-black/20" />
      <div
        role="dialog"
        aria-label={t('stepMenu.title')}
        className="absolute inset-x-0 bottom-0 z-20 space-y-3.5 rounded-t-[22px] bg-white px-[18px] pt-3 shadow-[0_-10px_30px_rgba(20,22,40,.12)]"
        style={{ paddingBottom: 'max(30px, env(safe-area-inset-bottom))' }}
        dir="rtl"
      >
        <div className="mx-auto h-1 w-9 rounded-full bg-ink-300" aria-hidden />
        <p className="text-center text-sm font-extrabold text-ink-400">{t('stepMenu.title')}</p>

        {type && (
          <div>
            <p className="mb-1.5 text-13 font-bold text-ink-400">{t('stepMenu.type')}</p>
            <div className="flex flex-wrap gap-1.5">
              {TYPES.map(k => (
                <button key={k} type="button" aria-pressed={k === type} className={chip(k === type)} onClick={() => onChange(convertStep(steps, index, k), index)}>
                  {t(`stepMenu.types.${k}`)}
                </button>
              ))}
            </div>
          </div>
        )}

        {len && (
          <div>
            <p className="mb-1.5 text-13 font-bold text-ink-400">{t('stepMenu.measure')}</p>
            <div className="flex gap-1.5">
              {(['distance', 'time'] as Measure[]).map(m => (
                <button key={m} type="button" aria-pressed={len.measure === m} className={chip(len.measure === m)} onClick={() => onChange(setMeasure(steps, index, m, thresholdSec), index)}>
                  {t(`stepMenu.${m}`)}
                </button>
              ))}
            </div>
          </div>
        )}

        {paced && (
          <div>
            <p className="mb-1.5 text-13 font-bold text-ink-400">{t('stepMenu.pace')}</p>
            <div className="flex gap-1.5">
              {SPREADS.map(s => (
                <button key={s} type="button" aria-pressed={spread === s} className={chip(spread === s)} onClick={() => onChange(setPaceSpread(steps, index, s, thresholdSec, paceAdjust), index)}>
                  {s === 0 ? t('stepMenu.exact') : t('stepMenu.spread', { s })}
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="flex gap-2">
          <button type="button" className={act} disabled={index === 0} onClick={() => onChange(moveStep(steps, index, -1), index - 1)}>
            <ArrowUp className="h-[18px] w-[18px]" aria-hidden />{t('stepMenu.up')}
          </button>
          <button type="button" className={act} disabled={index === steps.length - 1} onClick={() => onChange(moveStep(steps, index, 1), index + 1)}>
            <ArrowDown className="h-[18px] w-[18px]" aria-hidden />{t('stepMenu.down')}
          </button>
          <button type="button" className={act} onClick={() => onChange(duplicateStep(steps, index), index + 1)}>
            <Copy className="h-[18px] w-[18px]" aria-hidden />{t('stepMenu.duplicate')}
          </button>
          <button type="button" className={cn(act, 'text-accent-red-ink')} disabled={steps.length <= 1} onClick={() => onChange(removeStep(steps, index), null)}>
            <Trash2 className="h-[18px] w-[18px]" aria-hidden />{t('stepMenu.delete')}
          </button>
        </div>

        <div>
          <p className="mb-1.5 text-13 font-bold text-ink-400">{t('stepMenu.addAfter')}</p>
          <div className="flex gap-1.5">
            {(['run', 'reps', 'rest'] as const).map(kind => (
              <button key={kind} type="button" className={chip(false)} onClick={() => onChange(insertStep(steps, index, kind), index + 1)}>
                <Plus className="-mt-0.5 me-0.5 inline h-4 w-4" aria-hidden />{t(`add.${kind}`)}
              </button>
            ))}
          </div>
        </div>
      </div>
    </>
  );
}
