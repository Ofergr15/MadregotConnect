'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { useApi } from '@/lib/api';
import { SkeletonList } from '@/components/ui';
import { FORM_BANDS, signed, type FormBandKey } from '@/lib/academy/form-bands';
import type { LoadPayload, LoadRange } from '@/lib/academy/load-payload';
import { LEARNING_DAYS } from '@/lib/academy/pmc';
import { rampSentence, rangeOptions, thresholdRow, type Metric } from '@/lib/academy/progress';
import { FitnessChart, FAT, FIT } from './FitnessChart';
import { FormStrip } from './FormStrip';
import { JourneyTiles } from './JourneyTiles';
import type { HomeJourney } from '@/lib/academy/trainee-home';
import { ReconnectLink, useNoNumberText } from './NoNumberCard';
import { MetricSheet } from './MetricSheet';
import { BAND_TILE, CARD, Chevron, RICH, SHADOW, Segmented, Tag, clock, monthName, type TagTone } from './ui';

// ── התקדמות (trainee-experience-v2 screen 7, TP's PMC) ───────────────────────────────────
//
// "Am I improving": three numbers as TP shows them — fitness, fatigue, form — each one a
// tap away from what it means (7ב); one chart with two lines, time running left to right so
// fitness climbs toward "היום"; form as a strip of band colours per week (never bars under
// zero); one sentence about the build rate, whose word opens the sheet with the "above 8 a
// week" line; the threshold pace, a row into 7ג, and the body, a row into 8; below the
// fold the journey tiles ("המסע שלי"). The form strip opens the bands' sheet too.
//
// Every number is GET /api/academy/load's, the same diary the home and the board read.
// While the engine is still learning the trainee (fewer than 42 days) or the runs carry
// too little to price, the numbers and the chart are replaced by the home's honest copy —
// never a 0 or an empty chart.

const RAMP_TONE: Record<string, TagTone> = { tooFast: 'w', building: 'g', maintaining: 'n', recovering: 'b', easyWeek: 'b' };
const BAND_COLOR = Object.fromEntries(FORM_BANDS.map(b => [b.key, b.color]));

export function ProgressScreen({ athleteId, gender, testsHref, bodyHref, journey }: {
  athleteId: string;
  gender: string;
  testsHref: string;
  /** 8, the body screen — a row under the threshold one. */
  bodyHref?: string;
  /** "המסע שלי", below the cards (the mockup's build notes: under screen 7's cards). */
  journey?: HomeJourney | null;
}) {
  const t = useTranslations('trainee.progress');
  const tt = useTranslations();
  const locale = useLocale();
  const [range, setRange] = useState<LoadRange>('3m');
  const [sheet, setMetric] = useState<Metric>('form');
  const [open, setOpen] = useState(false);
  const setSheet = (m: Metric) => { setMetric(m); setOpen(true); };
  const { data, error } = useApi<LoadPayload>(`/api/academy/load?athleteId=${encodeURIComponent(athleteId)}&range=${range}`, { keepPreviousData: true });

  if (!data) return error ? <p className="py-8 text-center text-sm text-ink-400">{tt('trainee.loadSheetUi.none')}</p> : <SkeletonList count={4} />;

  const now = data.today;
  const ramp = rampSentence(data);
  const threshold = thresholdRow(data);
  const easyWeek = data.weekly.length ? data.weekly[data.weekly.length - 1].easy : false;
  const options = rangeOptions(data.raceDate);
  const shownRange = options.includes(range) ? range : '3m';

  return (
    <div className="flex flex-col gap-2.5" dir="rtl">
      {now ? (
        <MetricTiles numbers={now} gender={gender} onOpen={setSheet} />
      ) : (
        <LearningCard status={data.status} />
      )}

      {now && (
        <>
          <Segmented value={shownRange} onChange={setRange} label={t('range.label')}
            options={options.map(o => ({ value: o, label: t(`range.${o}`) }))} />
          <div className={cn(CARD, 'px-4 py-3.5')}>
            <div className="flex items-baseline justify-between gap-2">
              <div className="flex gap-3 text-[12px] text-ink-500">
                <span className="flex items-center gap-[5px]"><i aria-hidden className="inline-block h-[5px] w-4 rounded-[3px]" style={{ background: FIT }} />{t('legend.fitness')}</span>
                <span className="flex items-center gap-[5px]"><i aria-hidden className="inline-block h-[2px] w-4 rounded-[3px]" style={{ background: FAT }} />{t('legend.fatigue')}</span>
              </div>
              <span className="text-[12.5px] font-bold text-ink-400">{t('axis')}</span>
            </div>
            <div className="mt-1.5"><FitnessChart series={data.series} /></div>
            {data.formWeeks.length > 0 && (
              <>
                <div className="mb-[5px] mt-2.5 text-[12.5px] font-bold text-ink-400">{t('strip')}</div>
                <FormStrip weeks={data.formWeeks} gender={gender} onOpen={() => setSheet('form')} />
              </>
            )}
          </div>
        </>
      )}

      <div className={cn(CARD, 'overflow-hidden')}>
        {ramp && now && (
          <button type="button" onClick={() => setSheet('ramp')} className="flex min-h-[56px] w-full items-center gap-[11px] border-b border-[#EFEFF4] px-3.5 text-start">
            <span aria-hidden className="w-6 shrink-0 text-center text-[19px]">📈</span>
            <span className="min-w-0 flex-1 py-[9px]">
              <b className="block text-[14.5px] font-extrabold text-ink-900">{t.rich(`ramp.${ramp.key}`, { ...RICH, n: ramp.n })}</b>
              <small className="mt-px block text-[12.5px] leading-snug text-ink-400">
                {ramp.afterHeavy && <>{t('ramp.afterHeavy')} </>}
                {ramp.since
                  ? t.rich(ramp.since.rise > 0 ? 'ramp.sinceUp' : 'ramp.sinceDown', { ...RICH, month: monthName(ramp.since.date, locale), n: Math.abs(ramp.since.rise) })
                  : t('ramp.steady')}
              </small>
            </span>
            <Tag tone={RAMP_TONE[now.rampWord] ?? 'n'}>{tt(`trainee.ramp.${now.rampWord}` as never)}</Tag>
          </button>
        )}
        <Link href={testsHref} className="flex min-h-[56px] items-center gap-[11px] px-3.5">
          <span aria-hidden className="w-6 shrink-0 text-center text-[19px]">⏱️</span>
          <span className="min-w-0 flex-1 py-[9px]">
            {threshold ? (
              <>
                <b className="block text-[14.5px] font-extrabold text-ink-900">
                  {threshold.previous
                    ? t.rich('threshold.title', { ...RICH, pace: clock(threshold.paceSec), prev: clock(threshold.previous.paceSec) })
                    : t.rich('threshold.titleOnly', { ...RICH, pace: clock(threshold.paceSec) })}
                </b>
                <small className="mt-px block text-[12.5px] text-ink-400">
                  {t('threshold.sub', { month: monthName((threshold.previous?.date ?? threshold.testDate) || '', locale) })}
                </small>
              </>
            ) : (
              <>
                <b className="block text-[14.5px] font-extrabold text-ink-900">{t('threshold.none')}</b>
                <small className="mt-px block text-[12.5px] text-ink-400">{t('threshold.noneSub')}</small>
              </>
            )}
          </span>
          {threshold?.previous && threshold.previous.fasterBy !== 0 && (
            <Tag tone={threshold.previous.fasterBy > 0 ? 'g' : 'w'}>
              {t.rich(threshold.previous.fasterBy > 0 ? 'threshold.faster' : 'threshold.slower', { ...RICH, n: Math.abs(threshold.previous.fasterBy) })}
            </Tag>
          )}
          <span aria-hidden className="grid h-11 w-6 shrink-0 place-items-center text-ink-300"><Chevron className="h-[14px] w-[9px]" /></span>
        </Link>
        {bodyHref && (
          <Link href={bodyHref} className="flex min-h-[56px] items-center gap-[11px] border-t border-[#EFEFF4] px-3.5">
            <span aria-hidden className="w-6 shrink-0 text-center text-[19px]">❤️</span>
            <span className="min-w-0 flex-1 py-[9px]">
              <b className="block text-[14.5px] font-extrabold text-ink-900">{t('bodyRow')}</b>
              <small className="mt-px block text-[12.5px] text-ink-400">{t('bodyRowSub')}</small>
            </span>
            <span aria-hidden className="grid h-11 w-6 shrink-0 place-items-center text-ink-300"><Chevron className="h-[14px] w-[9px]" /></span>
          </Link>
        )}
      </div>

      {journey && <div className="mt-3"><JourneyTiles journey={journey} /></div>}

      {now && (
        // Kept mounted once opened, on the last metric, so the sheet animates out.
        <MetricSheet open={open} onOpenChange={setOpen} metric={sheet}
          numbers={{ fitness: now.fitness, fatigue: now.fatigue, form: now.form, ramp: now.ramp }} gender={gender} easyWeek={easyWeek} />
      )}
    </div>
  );
}

/** In place of the numbers while the engine learns the trainee — the home's copy (1ג). */
function LearningCard({ status }: { status: LoadPayload['status'] }) {
  const tf = useTranslations('trainee.home.form');
  const noNumber = useNoNumberText();
  if (status.kind === 'learning' && status.cause !== 'unpriced') {
    return (
      <div className={cn(CARD, 'px-4 py-3.5')}>
        <div className="flex items-baseline justify-between gap-2">
          <p className="text-[16px] font-black text-ink-900">⏳ {tf.rich('learning', { ...RICH, n: status.daysLeft })}</p>
          <span className="whitespace-nowrap text-[12.5px] font-bold text-ink-400">{tf.rich('daysOf', { ...RICH, seen: status.daysSeen, total: LEARNING_DAYS })}</span>
        </div>
        <p className="mt-1 text-[13px] leading-normal text-ink-500">{tf.rich('learningSay', { ...RICH, total: LEARNING_DAYS })}</p>
        <div className="mt-2.5 h-[7px] overflow-hidden rounded-full bg-[#F0F0F4]">
          <i className="block h-full rounded-full bg-brand-600" style={{ width: `${Math.round((status.daysSeen / LEARNING_DAYS) * 100)}%` }} />
        </div>
      </div>
    );
  }
  if (status.kind === 'ok') return null;
  const text = noNumber(status);
  return (
    <div className={cn(CARD, 'px-4 py-3.5')}>
      <p className="text-[16px] font-black text-ink-900">{text.icon} {text.title}</p>
      <p className="mt-1 text-[13px] leading-normal text-ink-500">{text.say}</p>
      {text.action && <ReconnectLink />}
    </div>
  );
}

/**
 * The three numbers — fitness ▲ ramp, fatigue, form in its band's tint — each a tap into
 * 7ב. Shared with the coach's C2 (readiness/TraineeReadiness.tsx), which words the fitness
 * line its own way ("שומר, אחרי שבוע עמוס").
 */
export function MetricTiles({ numbers: now, gender, onOpen, fitnessSub }: {
  numbers: { fitness: number; fatigue: number; form: number; ramp: number; band: FormBandKey };
  gender: string;
  onOpen: (m: Metric) => void;
  fitnessSub?: React.ReactNode;
}) {
  const t = useTranslations('trainee.progress');
  const tt = useTranslations();
  return (
    <div className="grid grid-cols-3 gap-2">
      <MetricTile color={FIT} onOpen={() => onOpen('fitness')} label={t('tile.fitness')}
        value={<><bdi dir="ltr">{now.fitness}</bdi>{now.ramp !== 0 && <small className="ms-1 text-[13px] font-extrabold">{now.ramp > 0 ? '▲' : '▼'} <bdi dir="ltr">{Math.abs(now.ramp)}</bdi></small>}</>}
        valueColor={FIT} sub={fitnessSub ?? t.rich('tile.fitnessSub', RICH)} />
      <MetricTile color={FAT} onOpen={() => onOpen('fatigue')} label={t('tile.fatigue')}
        value={<bdi dir="ltr">{now.fatigue}</bdi>} sub={t.rich('tile.fatigueSub', RICH)} />
      <MetricTile color={BAND_COLOR[now.band]} tint={BAND_TILE[now.band]?.bg} onOpen={() => onOpen('form')} label={t('tile.form')}
        value={<bdi dir="ltr">{signed(now.form)}</bdi>} valueColor={BAND_TILE[now.band]?.ink}
        sub={tt(FORM_BANDS.find(b => b.key === now.band)!.longKey as never, { gender } as never)} />
    </div>
  );
}

function MetricTile({ color, tint, onOpen, label, value, valueColor, sub }: {
  color: string;
  tint?: string;
  onOpen: () => void;
  label: string;
  value: React.ReactNode;
  valueColor?: string;
  sub: React.ReactNode;
}) {
  return (
    <button type="button" onClick={onOpen} aria-haspopup="dialog"
      className={cn('min-h-[44px] rounded-2xl border-b-[3px] bg-white px-[11px] pb-2.5 pt-[9px] text-start', SHADOW)}
      style={{ borderBottomColor: color, background: tint }}>
      <b className="block text-[27px] font-black leading-[1.1]" style={{ color: valueColor }}>{value}</b>
      <span className="mt-px block text-[12.5px] font-extrabold text-ink-900">{label}</span>
      <span className="mt-0.5 block text-[11px] leading-[1.35] text-ink-400">{sub}</span>
    </button>
  );
}
