'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { FORM_BANDS, signed } from '@/lib/academy/form-bands';
import { LEARNING_DAYS } from '@/lib/academy/pmc';
import type { TodayForm } from '@/lib/academy/trainee-today';
import { traineeProgressUrl } from '@/lib/academy/deep-links';
import { BAND_TILE, CARD, Chevron, RICH } from './ui';

// ── "איך אתה מגיע להיום" (mockup 1 / 1ב / 1ג) ────────────────────────────────────────────
//
// One number with one word and one sentence — form, as of yesterday — and the five bands
// with a marker, so the number is never read without its meaning. Until 42 days of runs
// are in, the honest "still learning you, N more days" instead (1ג); with too many runs
// that could not be priced, "not enough data". Never a 0.

export function FormCard({ form, when, gender, showBands }: {
  form: TodayForm;
  when: 'today' | 'tomorrow';
  gender: 'male' | 'female' | null;
  /** The 5-band scale — on a workout day (mockup 1); the rest day's card is shorter (1ב). */
  showBands: boolean;
}) {
  const t = useTranslations('trainee.home.form');
  const tt = useTranslations('trainee');
  const g = gender ?? 'other';

  const header = (
    <div className="flex items-baseline justify-between gap-2">
      <span className="text-[12.5px] font-bold text-ink-400">{t('title', { when, gender: g })}</span>
      {form.status === 'learning' ? (
        <span className="text-[12.5px] font-bold text-ink-400">{t.rich('daysOf', { ...RICH, seen: form.daysSeen, total: LEARNING_DAYS })}</span>
      ) : (
        <Link href={traineeProgressUrl()} className="relative z-10 -my-3 flex min-h-[44px] items-center gap-1 whitespace-nowrap text-[13px] font-extrabold text-brand-600">
          {t('progress')} <Chevron />
        </Link>
      )}
    </div>
  );

  if (form.status === 'learning') {
    return (
      <section className={cn(CARD, 'px-4 py-3.5')}>
        {header}
        <div className="mt-2 flex items-center gap-3">
          <div className="grid h-[58px] w-[58px] shrink-0 place-items-center rounded-[17px] bg-[#F0F0F4] text-[22px]" aria-hidden>⏳</div>
          <div className="min-w-0">
            <p className="text-[16px] font-black text-ink-900">{t.rich('learning', { ...RICH, n: form.daysLeft })}</p>
            <p className="text-[13px] leading-normal text-ink-500">{t.rich('learningSay', { ...RICH, total: LEARNING_DAYS })}</p>
          </div>
        </div>
        <div className="mt-[11px] h-[7px] overflow-hidden rounded-full bg-[#F4F4F8]" aria-hidden>
          <i className="block h-full rounded-full bg-brand-600" style={{ width: `${Math.round((form.daysSeen / LEARNING_DAYS) * 100)}%` }} />
        </div>
      </section>
    );
  }

  if (form.status === 'insufficient') {
    return (
      <section className={cn(CARD, 'px-4 py-3.5')}>
        {header}
        <div className="mt-2 flex items-center gap-3">
          <div className="grid h-[58px] w-[58px] shrink-0 place-items-center rounded-[17px] bg-[#F0F0F4] text-[22px]" aria-hidden>⌚</div>
          <div className="min-w-0">
            <p className="text-[16px] font-black text-ink-900">{t('insufficient')}</p>
            <p className="text-[13px] leading-normal text-ink-500">{t('insufficientSay')}</p>
          </div>
        </div>
      </section>
    );
  }

  const band = FORM_BANDS.find(b => b.key === form.band) ?? FORM_BANDS[2];
  const tile = BAND_TILE[band.key];
  const strip = (key: string) => key.replace(/^trainee\./, '');
  return (
    <section className={cn(CARD, 'px-4 py-3.5')}>
      {header}
      <div className="mt-2 flex items-center gap-3">
        <div className="grid h-[58px] w-[58px] shrink-0 place-items-center rounded-[17px] text-[23px] font-black" style={{ background: tile.bg, color: tile.ink }}>
          <bdi dir="ltr">{signed(form.value)}</bdi>
        </div>
        <div className="min-w-0">
          <p className="text-[16px] font-black text-ink-900">{tt(strip(band.longKey) as never, { gender: g } as never)}</p>
          {/* Two lines at most (mockup 1): the copy is written to fit, the clamp keeps it so. */}
          <p className="line-clamp-2 text-[13px] leading-normal text-ink-500">{tt(strip(form.sentenceKey) as never, { gender: g } as never)}</p>
        </div>
      </div>
      {showBands && (
        <div className="mt-[18px] flex gap-[3px]" role="img" aria-label={`${t('bandsLabel')}: ${tt(strip(band.wordKey) as never)}`}>
          {FORM_BANDS.map(b => {
            const on = b.key === band.key;
            return (
              <div key={b.key} className={cn('relative flex-1 text-center text-[10.5px] font-bold', on ? 'font-black text-ink-900' : 'text-ink-400')}>
                {on && <span aria-hidden className="absolute -top-[9px] left-1/2 -ml-1.5 border-[6px] border-transparent border-t-ink-900" />}
                <i aria-hidden className="mb-1 block h-[7px] rounded" style={{ background: b.color }} />
                {tt(strip(b.wordKey) as never)}
              </div>
            );
          })}
        </div>
      )}
    </section>
  );
}
