'use client';

import { useTranslations } from 'next-intl';
import { C, RICH, clock } from './ui';

// ── Every rep against the range the watch was given (mockup 5) ─────────────────────────
//
// HTML bars, not a time chart: a rep set is a row of numbered things, read the way the
// page reads — rep 1 on the RIGHT (the flex row runs right-to-left in RTL). Faster is
// taller, so "higher = better" holds here too. The green band is the watch range; a rep
// above it is ▲ green, below it ▼ orange, inside it plain.

const HEIGHT = 96;
/** Room above the tallest bar for its label. */
const TOP = 18;

export function RepsChart({ reps, band }: {
  reps: Array<{ paceSec: number; tone: 'in' | 'fast' | 'slow' }>;
  band: { min: number; max: number };
}) {
  const t = useTranslations('trainee.done');
  const paces = reps.map(r => r.paceSec);
  // A few seconds of air beyond the fastest rep and the band's slow edge.
  const fast = Math.min(...paces, band.min) - 5;
  const slow = Math.max(...paces, band.max) + 7;
  const h = (s: number) => ((slow - s) / (slow - fast)) * (HEIGHT - TOP);

  return (
    <div>
      <div className="relative mt-1.5" style={{ height: HEIGHT }}>
        <div
          aria-hidden
          className="absolute inset-x-0 rounded-lg border border-dashed border-[#9AD5B0] bg-[#E5F6EC]"
          style={{ bottom: h(band.max), height: Math.max(4, h(band.min) - h(band.max)) }}
        />
        <div className="absolute inset-0 flex items-end gap-2.5 px-2">
          {reps.map((r, i) => {
            const mark = r.tone === 'fast' ? '▲ ' : r.tone === 'slow' ? '▼ ' : '';
            const color = r.tone === 'fast' ? C.good : r.tone === 'slow' ? C.org : C.goodM;
            return (
              <div key={i} className="flex h-full flex-1 flex-col items-center justify-end" aria-label={`${t('repN', { n: i + 1 })}: ${clock(r.paceSec)}`}>
                <b className="mb-[3px] whitespace-nowrap text-[12px] font-black" style={{ color: r.tone === 'fast' ? C.good : r.tone === 'slow' ? C.warn : undefined }}>
                  {mark}<bdi dir="ltr">{clock(r.paceSec)}</bdi>
                </b>
                <i className="block w-full rounded-t-[7px] rounded-b-[3px]" style={{ height: Math.max(4, h(r.paceSec)), background: color, opacity: r.tone === 'in' ? 0.85 : 1 }} />
              </div>
            );
          })}
        </div>
      </div>
      <div className="flex gap-2.5 px-2 pt-1" aria-hidden>
        {reps.map((_, i) => <span key={i} className="flex-1 text-center text-[11px] font-bold text-ink-400"><bdi dir="ltr">{i + 1}</bdi></span>)}
      </div>
      <p className="mt-1 text-[13px] leading-normal text-ink-500">{t.rich('repsCaption', { ...RICH, range: `${clock(band.min)}–${clock(band.max)}` })}</p>
    </div>
  );
}
