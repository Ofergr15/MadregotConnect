'use client';

import { useTranslations } from 'next-intl';
import { FORM_BANDS } from '@/lib/academy/form-bands';
import type { LoadPayload } from '@/lib/academy/load-payload';
import { formStrip } from '@/lib/academy/progress';
import { BAND_TILE } from './ui';

// ── רעננות לפי שבוע (trainee-experience-v2 screen 7) ─────────────────────────────────────
//
// Form as a strip of colour, never bars: bars under zero read as failing, and in a build
// block form is negative most of the time on purpose. One cell per week, all the same
// height, coloured by its band (the mockup's --b1..--b5), oldest LEFT and this week at the
// right, outlined — with today's word after it at the right end.

const COLOR = Object.fromEntries(FORM_BANDS.map(b => [b.key, b.color]));

export function FormStrip({ weeks, gender, onOpen }: {
  weeks: LoadPayload['formWeeks'];
  gender: string;
  /** A tap explains the bands (7ב, the form sheet) — spec P2. */
  onOpen?: () => void;
}) {
  const t = useTranslations();
  const strip = formStrip(weeks);
  if (!strip) return null;
  const band = FORM_BANDS.find(b => b.key === strip.band)!;
  const label = `${t('trainee.progress.stripAria', { n: strip.cells.length })} · ${t(band.wordKey as never)}`;
  const body = (
    <>
      {strip.cells.map(c => (
        <i key={c.weekStart} aria-hidden className="block h-3.5 flex-1 rounded"
          style={{ background: COLOR[c.band], outline: c.current ? '2px solid #16171F' : undefined, outlineOffset: c.current ? 1 : undefined }} />
      ))}
      {/* A fixed physical gap from the outlined square (its outline reaches 3px out): the
          row is LTR, so the word's space is on its LEFT whatever its own direction. */}
      <span dir="rtl" className="ml-2.5 shrink-0 whitespace-nowrap text-[12px] font-black" style={{ color: BAND_TILE[band.key]?.ink }}>
        {t(band.wordKey as never, { gender } as never)}
      </span>
    </>
  );
  if (!onOpen) {
    return <div dir="ltr" className="flex items-center gap-[3px]" role="img" aria-label={label}>{body}</div>;
  }
  // The hit area is 44px tall without moving the 14px strip: equal padding and negative margin.
  return (
    <button type="button" dir="ltr" onClick={onOpen} aria-label={label} className="-my-[15px] flex w-full items-center gap-[3px] py-[15px]">
      {body}
    </button>
  );
}
