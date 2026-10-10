'use client';

import { useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { parseQuickText, quickToBook, type AssumptionCode } from '@/lib/academy/quick-text';
import {
  bookTotals, effortPace, guessKind, mainStepIndex, profileBar, structureName, toLibrarySteps,
} from '@/lib/academy/book-steps';
import { BarButton, CARD, FlowScreen, PrimaryButton, ProfileBar, RICH, SectionLabel, clockText, kmText } from './ui';
import { StepLines } from './StepLines';
import type { Draft } from './types';

// ── ✎ לכתוב מהר (mockup phone 2ב) ────────────────────────────────────────────────────────
//
// One line, the way it would go into WhatsApp, and straight under it how it was understood
// ("הבנתי כך") — at the trainee's own paces, with the bar and the totals. Then on to the
// adjust screen, so nothing typed here is final. The grammar is lib/academy/quick-text.ts.
//
// Only the guesses that could plausibly be WRONG are said out loud (`מנוחה 20` — seconds or
// minutes?); the ones every coach means (`2 קל` is kilometres) are not, because a preview
// that annotates everything is a preview nobody reads.

const LOUD: AssumptionCode[] = ['rest-ambiguous', 'bare-seconds', 'bare-minutes', 'second-work', 'rest-default'];

export function QuickTextScreen({ traineeName, thresholdSec, onCancel, onContinue }: {
  traineeName: string;
  thresholdSec: number | null;
  onCancel: () => void;
  onContinue: (draft: Draft) => void;
}) {
  const t = useTranslations('workoutBook');
  const [text, setText] = useState('');
  const parse = useMemo(() => parseQuickText(text), [text]);
  const book = useMemo(() => quickToBook(parse, thresholdSec), [parse, thresholdSec]);
  const steps = book.steps;
  const totals = steps.length ? bookTotals(steps, thresholdSec) : null;
  const loud = parse.assumptions.filter(a => LOUD.includes(a.code));
  const main = steps[mainStepIndex(steps)];
  const mainEffort = main && (main.kind === 'reps' || main.kind === 'run') ? main.effort : null;
  // "הקצב 4:05 נשמר כ'מהיר ל־Shahar'" — said only when a pace was actually typed.
  const typedPace = parse.steps.some(s => s.kind !== 'rest' && s.effort?.kind === 'pace');
  const mainPace = mainEffort && thresholdSec ? effortPace(mainEffort, thresholdSec) : null;
  const ready = steps.length > 0 && !book.needsThreshold;

  const go = () => {
    if (!ready) return;
    onContinue({
      source: 'quick',
      name: structureName(steps),
      notes: null,
      entryId: null,
      kind: parse.kindHint ?? guessKind(steps),
      original: steps,
      model: steps,
      steps: toLibrarySteps(steps),
    });
  };

  return (
    <FlowScreen
      title={t('quickTitle')}
      leading={<BarButton onClick={onCancel}>{t('cancel')}</BarButton>}
      trailing={<BarButton strong onClick={go} disabled={!ready}>{t('continue')}</BarButton>}
      footer={<PrimaryButton onClick={go} disabled={!ready}>{t('continueToAdjust')}</PrimaryButton>}
    >
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        dir="rtl"
        rows={3}
        autoFocus
        aria-label={t('quickLabel')}
        placeholder={t('quickPlaceholder')}
        className={cn(CARD, 'min-h-[96px] resize-none rounded-[18px] border-2 border-brand-600 px-4 py-3.5 text-[18px] leading-relaxed text-ink-900 outline-none placeholder:text-ink-400')}
      />
      <p className="px-1 text-13 leading-normal text-ink-400">
        {t.rich('quickHint', { ...RICH, c: (chunks) => <bdi dir="auto" className="rounded-md bg-white px-1.5 font-extrabold text-ink-900">{chunks}</bdi> })}
      </p>

      {steps.length > 0 && (
        <>
          <SectionLabel>{t('understood')}</SectionLabel>
          <StepLines steps={steps} thresholdSec={thresholdSec} />
          <ProfileBar segments={profileBar(steps, thresholdSec)} />
          {totals && (
            <p className="px-1 text-13 leading-normal text-ink-400">
              {t.rich('quickTotals', { ...RICH, km: kmText(totals.distanceM), min: Math.round(totals.durationSec / 60) })}
              {typedPace && mainPace !== null && mainEffort?.zone && (
                <> {t.rich('quickKept', { ...RICH, pace: clockText(mainPace), zone: t(`zone.${mainEffort.zone}`), name: traineeName.split(' ')[0] })}</>
              )}
            </p>
          )}
        </>
      )}

      {book.needsThreshold && (
        <p className="rounded-[14px] bg-[#FDF0E2] px-3 py-2.5 text-sm font-bold text-[#8A4308]">{t('quickNoTest', { name: traineeName })}</p>
      )}
      {(loud.length > 0 || parse.unknown.length > 0) && (
        <ul className="space-y-1 px-1 text-13 text-[#8A4308]">
          {loud.map((a, i) => <li key={`${a.code}${i}`}>• {t(`assume.${a.code}`, { text: a.text })}</li>)}
          {parse.unknown.map(u => <li key={u}>• {t('unknownWords', { text: u })}</li>)}
        </ul>
      )}
    </FlowScreen>
  );
}
