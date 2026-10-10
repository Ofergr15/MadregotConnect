'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { useApi } from '@/lib/api';
import { SkeletonList } from '@/components/ui';
import type { TrendSeries } from '@/lib/academy/tests';
import type { TestInvitation } from '@/lib/academy/testInvite';
import type { TraineeHome } from '@/lib/academy/trainee-home';
import { sinceFirstTest } from '@/lib/academy/progress';
import { ImprovementChart } from '@/components/academy/ImprovementChart';
import { MyInvitation } from '@/components/academy/MyInvitation';
import { MyTestsCard } from '@/components/academy/MyTestsCard';
import { JourneyTiles } from './JourneyTiles';
import { CARD, RICH, Tag, clock, dm, monthName } from './ui';

// ── 7ג: קצב הסף והטסטים (trainee-experience-v2 phone 7ג, TP's fitness history · tests) ──
//
// "Am I faster": the threshold pace every pace and every ⚡ stands on, how far it moved
// since the first test, and the improvement graph from the old academy home, returned AS IS
// (ImprovementChart: first test on the left, faster = higher, so a threshold that improves
// climbs toward today — the same direction as every other chart). Under it the latest
// test, the next one (MyInvitation, unchanged), the tests card with its entry form, and
// below the fold the journey tiles that used to close the old home.

const PROTOCOL = '30min';

interface TestsResponse { trend?: TrendSeries; tableMissing?: boolean }

export function ThresholdScreen({ athleteId, home }: { athleteId: string; home: TraineeHome | null }) {
  const t = useTranslations('trainee.tests');
  const tp = useTranslations('trainee.progress');
  const locale = useLocale();
  const [hasInvitation, setHasInvitation] = useState(false);
  const [invitation, setInvitation] = useState<TestInvitation | null>(null);
  const [resultJustSent, setResultJustSent] = useState(false);
  const { data, error } = useApi<TestsResponse>(`/api/academy/tests?protocol=${PROTOCOL}&athleteId=${encodeURIComponent(athleteId)}`);

  if (!data && !error) return <SkeletonList count={4} />;
  const trend = data?.trend ?? null;
  const points = (trend?.points ?? []).filter(p => p.paceSec != null);
  const latest = points[points.length - 1] ?? null;
  const previous = points.length > 1 ? points[points.length - 2] : null;
  const since = sinceFirstTest(points);

  return (
    <div className="flex flex-col gap-2.5" dir="rtl">
      <div className={cn(CARD, 'px-4 py-3.5')}>
        {latest ? (
          <>
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[12.5px] font-bold text-ink-400">{t('yours')}</span>
              {since && since.fasterBy !== 0 && (
                <Tag tone={since.fasterBy > 0 ? 'g' : 'w'}>
                  {t.rich(since.fasterBy > 0 ? 'sinceFaster' : 'sinceSlower', { ...RICH, n: Math.abs(since.fasterBy), month: monthName(since.since, locale) })}
                </Tag>
              )}
            </div>
            <div className="mt-0.5 text-[34px] font-black leading-[1.15] text-ink-900">
              <bdi dir="ltr">{clock(latest.paceSec as number)}</bdi>{' '}
              <span className="text-[15px] font-extrabold text-ink-400">{t('perKm')}</span>
            </div>
          </>
        ) : (
          <p className="text-[16px] font-black text-ink-900">{t('none')}</p>
        )}
        <p className="text-13 leading-normal text-ink-500">{latest ? t('explain') : t('noneSub')}</p>
      </div>

      {trend && points.length > 0 && (
        // Unchanged: its own card, its own table. Only the heading says what the axes mean.
        <ImprovementChart trend={trend} heading={t('chart')} subtitle={t('axis')} className={CARD} />
      )}

      {latest && (
        <div className={cn(CARD, 'flex min-h-[56px] items-center gap-[11px] px-3.5')}>
          <span aria-hidden className="w-6 shrink-0 text-center text-[19px]">⏱️</span>
          <span className="min-w-0 flex-1 py-[9px]">
            <b className="block text-[14.5px] font-extrabold text-ink-900">
              {t.rich('latest', { ...RICH, month: monthName(latest.date, locale), pace: clock(latest.paceSec as number) })}
            </b>
            <small className="mt-px block text-[12.5px] text-ink-400">
              {!previous
                ? t.rich('latestFirst', { ...RICH, date: dm(latest.date) })
                : t.rich(
                  latest.deltaPrevSec == null || Math.round(latest.deltaPrevSec) === 0 ? 'latestSame' : latest.deltaPrevSec < 0 ? 'latestFaster' : 'latestSlower',
                  { ...RICH, date: dm(latest.date), n: Math.abs(Math.round(latest.deltaPrevSec ?? 0)), prev: monthName(previous.date, locale) },
                )}
            </small>
          </span>
          {previous && latest.deltaPrevSec != null && Math.round(latest.deltaPrevSec) !== 0 && (
            <Tag tone={latest.deltaPrevSec < 0 ? 'g' : 'w'}>
              {tp.rich(latest.deltaPrevSec < 0 ? 'threshold.faster' : 'threshold.slower', { ...RICH, n: Math.abs(Math.round(latest.deltaPrevSec)) })}
            </Tag>
          )}
        </div>
      )}

      {/* The next test: the invitation card itself, unchanged, under its heading. */}
      <div className={hasInvitation ? 'flex flex-col gap-1.5' : 'hidden'}>
        <h2 className="px-0.5 text-[15px] font-black text-ink-700">{t('next')}</h2>
        <MyInvitation
          athleteId={athleteId}
          watchConnected={home?.athlete?.hasWatch}
          onVisible={setHasInvitation}
          onInvitation={setInvitation}
          resultJustSent={resultJustSent}
        />
      </div>

      <MyTestsCard
        athleteId={athleteId}
        name={home?.athlete?.name ?? ''}
        invitation={invitation}
        protocol={PROTOCOL}
        onRecorded={() => setResultJustSent(true)}
      />

      {home?.journey && <div className="mt-3"><JourneyTiles journey={home.journey} /></div>}
    </div>
  );
}
