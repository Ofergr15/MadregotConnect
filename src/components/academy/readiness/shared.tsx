'use client';

import { useCallback, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import type { FormBandKey } from '@/lib/academy/form-bands';
import { signed } from '@/lib/academy/form-bands';
import type { LoadStatus } from '@/lib/academy/pmc';
import type { GateReason } from '@/lib/academy/readiness';
import type { PaceReadiness } from '@/lib/academy/coach-tools-payload';
import { cn } from '@/lib/utils';

// ── The coach's readiness words and colours (C1, C2, the pace screen) ──────────────────
//
// One place for the chip (signed number + word in the band's colour), the reasons a pace
// suggestion is held, and the sentence that says why it is not — so the board, the
// trainee's sheet and PaceSuggestionScreen never word the same fact two ways.

/** The chip per band (mockup C1 `.fchip`): red, green, green, blue, grey. */
export const CHIP: Record<FormBandKey | 'none', { bg: string; ink: string }> = {
  veryTired: { bg: '#FDE7E5', ink: '#BF2F2A' },
  working: { bg: '#E5F6EC', ink: '#0E7A3C' },
  maintain: { bg: '#E5F6EC', ink: '#0E7A3C' },
  fresh: { bg: '#E8F1FE', ink: '#1D5FD0' },
  detraining: { bg: '#F0F0F4', ink: '#4A4B57' },
  none: { bg: '#F0F0F4', ink: '#4A4B57' },
};

/** The spark's line per band (mockup C1 `data-c`). */
export const SPARK_COLOR: Record<FormBandKey | 'none', string> = {
  veryTired: '#E5484D',
  working: '#1FA55B',
  maintain: '#1FA55B',
  fresh: '#5B9BF0',
  detraining: '#9A9BA6',
  none: '#C9CBD6',
};

export const M = { m: (c: ReactNode) => <bdi dir="ltr">{c}</bdi> };
export const MB = { ...M, b: (c: ReactNode) => <b className="font-extrabold text-ink-900">{c}</b>, bdi: (c: ReactNode) => <bdi>{c}</bdi> };

/** The form chip: "−9 / שומר"; grey "לומד / עוד 23 ימים" while the engine learns them. */
export function FormChip({ form, bandKey, status, gender }: {
  form: number | null;
  bandKey: FormBandKey | null;
  status: LoadStatus;
  gender: string | null;
}) {
  const t = useTranslations('readiness.chip');
  const tone = form != null && bandKey ? CHIP[bandKey] : CHIP.none;
  return (
    <span className="w-[70px] shrink-0 rounded-[11px] px-1 py-1 text-center leading-[1.2]" style={{ background: tone.bg, color: tone.ink }}>
      {form != null && bandKey ? (
        <>
          <b className="block text-[15px] font-black"><bdi dir="ltr">{signed(form)}</bdi></b>
          <span className="block text-[10.5px] font-bold">{t(bandKey, { gender: gender ?? 'other' })}</span>
        </>
      ) : status.kind === 'learning' ? (
        <>
          <b className="block text-[13px] font-black">{t('learning')}</b>
          <span className="block text-[10.5px] font-bold">{t.rich('learningDays', { ...M, n: status.daysLeft })}</span>
        </>
      ) : (
        <>
          <b className="block text-[12px] font-black">{t('insufficient')}</b>
          <span className="block text-[10.5px] font-bold">{t('insufficientSub')}</span>
        </>
      )}
    </span>
  );
}

/** "עייף מאוד · דופק במנוחה מעל הטווח" — why a pace-up suggestion is held. */
export function useReasonsText() {
  const t = useTranslations('readiness.reason');
  return useCallback((reasons: GateReason[], gender: string | null) => reasons.map(r => t(r, { gender: gender ?? 'other' })).join(' · '), [t]);
}

/**
 * "לא עייף מדי (−9, שומר), בלי כאב, והדופק לא מעל הטווח 3 בקרים. אפשר לאשר." — the gate,
 * said out loud for a suggestion that goes through. A form still being learned and an RHR
 * range still being learned are said as such, never as "fine".
 */
export function GateSentence({ readiness, className }: { readiness: PaceReadiness; className?: string }) {
  const t = useTranslations('readiness.gate');
  const tc = useTranslations('readiness.chip');
  const gender = readiness.gender ?? 'other';
  return (
    <span className={cn(className)}>
      {readiness.form != null && readiness.bandKey
        ? t.rich('form', { ...M, gender, form: signed(readiness.form), word: tc(readiness.bandKey, { gender }) })
        : t('formUnknown')}
      {', '}{t('pain')}{', '}
      {readiness.rhrKnown ? t.rich('rhr', M) : t('rhrUnknown')}
      {'. '}{t('ok')}
    </span>
  );
}
