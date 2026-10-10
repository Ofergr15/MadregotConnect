'use client';

import { useTranslations } from 'next-intl';
import { Sheet } from '@/components/ui/Sheet';
import { cn } from '@/lib/utils';
import { FORM_BANDS, formBand, rampWord, signed } from '@/lib/academy/form-bands';
import { RAMP_BANDS, rampBandOf, type Metric } from '@/lib/academy/progress';
import { C, RICH, Tag, type TagTone } from './ui';

// ── 7ב: what a number means (trainee-experience-v2 phone 7ב, TP's ⓘ metric info) ──────
//
// One sheet for every number on the progress screen: what it is, how it is computed —
// with today's own numbers in the line — and, for form and the build rate, where today
// sits among the bands ("אתה כאן"). No abbreviations. Form gets the "negative is not bad"
// note, the build rate the one place the "above 8 a week" threshold is spelled out.

export interface MetricNumbers {
  fitness: number;
  fatigue: number;
  form: number;
  ramp: number;
}

const RAMP_TONE: Record<string, TagTone> = { tooFast: 'w', building: 'g', maintaining: 'n', recovering: 'b', easyWeek: 'b' };

export function MetricSheet({ open, onOpenChange, metric, numbers, gender, easyWeek = false }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  metric: Metric;
  numbers: MetricNumbers;
  gender: string;
  easyWeek?: boolean;
}) {
  const t = useTranslations('trainee.metric');
  const tt = useTranslations();
  const { fitness, fatigue, form, ramp } = numbers;
  const weekAgo = fitness - ramp;
  const params = { ...RICH, gender, fitness, fatigue, weekAgo };
  const band = formBand(form);
  const word = rampWord(ramp, { easyWeek });
  const value = metric === 'form' || metric === 'ramp' ? signed(metric === 'form' ? form : ramp) : String(metric === 'fitness' ? fitness : fatigue);

  // A band's bounds with a real minus and no plus: "5…29", "−10…4" (the mockup's).
  const n = (v: number) => (v < 0 ? `−${Math.abs(v)}` : String(v));
  const range = (min: number | null, max: number | null) => (
    min == null ? t.rich('atMost', { ...RICH, n: n(max as number) })
      : max == null ? t.rich('atLeast', { ...RICH, n: n(min) })
        : t.rich('between', { ...RICH, lo: n(min), hi: n(max) })
  );

  return (
    <Sheet
      open={open}
      onOpenChange={onOpenChange}
      bodyClassName="px-[18px] pb-2 pt-1"
      footer={(
        <div className="px-[18px] pb-[max(18px,env(safe-area-inset-bottom))] pt-1">
          <button type="button" onClick={() => onOpenChange(false)} className="flex h-[52px] w-full items-center justify-center rounded-[15px] bg-brand-600 text-[16px] font-extrabold text-white">
            {t('ok')}
          </button>
        </div>
      )}
    >
      <div dir="rtl">
        <div className="flex items-baseline justify-between gap-2">
          <h2 className="text-[20px] font-black text-ink-900">{t.rich(`title.${metric}`, { ...RICH, n: value })}</h2>
          {metric === 'form' && <Tag tone={band.key === 'veryTired' ? 'r' : band.key === 'fresh' ? 'b' : band.key === 'detraining' ? 'n' : 'g'}>{tt(band.longKey as never, { gender } as never)}</Tag>}
          {metric === 'ramp' && <Tag tone={RAMP_TONE[word.key]}>{tt(word.wordKey as never)}</Tag>}
        </div>
        <p className="mt-1.5 text-[14px] leading-normal text-ink-500">{t.rich(`what.${metric}`, params)}</p>
        <p className="mt-1 text-[14px] leading-normal text-ink-500">{t.rich(`how.${metric}`, params)}</p>

        {metric === 'form' && (
          <ul className="mt-3 flex flex-col gap-0.5">
            {/* Freshest first, as the mockup lists them. */}
            {[...FORM_BANDS].reverse().map(b => {
              const on = b.key === band.key;
              return (
                <li key={b.key} className={cn('flex min-h-[44px] items-center gap-2.5 rounded-xl px-2.5', on && 'bg-[#E5F6EC]')}>
                  <i aria-hidden className="h-3 w-3 shrink-0 rounded" style={{ background: b.color }} />
                  <b className={cn('w-24 shrink-0 text-[14px] font-extrabold', on ? 'text-[#0E7A3C]' : 'text-ink-900')}>{tt(b.wordKey as never)}</b>
                  <span className="min-w-0 text-[12.5px] text-ink-400">
                    {tt(b.meaningKey as never)}
                    {on && <> · <b className="text-[12.5px] font-extrabold text-ink-900">{t('here', { gender })}</b></>}
                  </span>
                  <em className={cn('ms-auto whitespace-nowrap text-[12.5px] font-bold not-italic', on ? 'text-[#0E7A3C]' : 'text-ink-400')}>{range(b.min, b.max)}</em>
                </li>
              );
            })}
          </ul>
        )}

        {metric === 'ramp' && (
          <ul className="mt-3 flex flex-col gap-0.5">
            {RAMP_BANDS.map(b => {
              const on = b.key === rampBandOf(ramp);
              return (
                <li key={b.key} className={cn('flex min-h-[44px] items-center gap-2.5 rounded-xl px-2.5', on && 'bg-[#E5F6EC]')}>
                  <i aria-hidden className="h-3 w-3 shrink-0 rounded" style={{ background: b.color }} />
                  <b className={cn('w-24 shrink-0 text-[14px] font-extrabold', on ? 'text-[#0E7A3C]' : 'text-ink-900')}>{tt(`trainee.ramp.${b.key}` as never)}</b>
                  <span className="min-w-0 text-[12.5px] text-ink-400">
                    {t(`rampBand.${b.key}`)}
                    {on && <> · <b className="text-[12.5px] font-extrabold text-ink-900">{t('here', { gender })}</b></>}
                  </span>
                  <em className={cn('ms-auto whitespace-nowrap text-[12.5px] font-bold not-italic', on ? 'text-[#0E7A3C]' : 'text-ink-400')}>{range(b.min, b.max)}</em>
                </li>
              );
            })}
          </ul>
        )}

        <p className="mt-2.5 text-[13px] leading-normal text-ink-500" style={metric === 'ramp' && word.warn ? { color: C.warn } : undefined}>
          {metric === 'form' ? t('formNote', { gender }) : t.rich(`${metric}Note`, RICH)}
        </p>
      </div>
    </Sheet>
  );
}
