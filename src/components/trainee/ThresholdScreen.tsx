'use client';

import { useEffect, useRef, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { useApi } from '@/lib/api';
import { SkeletonList } from '@/components/ui';
import type { TrendSeries } from '@/lib/academy/tests';
import type { TestInvitation } from '@/lib/academy/testInvite';
import type { TraineeHome } from '@/lib/academy/trainee-home';
import { sinceFirstTest } from '@/lib/academy/progress';
import { MyInvitation } from '@/components/academy/MyInvitation';
import { MyTestsCard } from '@/components/academy/MyTestsCard';
import { ThresholdChart } from './ThresholdChart';
import { CARD, RICH, Tag, clock, dm, monthName } from './ui';

// ── 7ג: קצב הסף והטסטים (trainee-experience-v2 phone 7ג, TP's fitness history · tests) ──
//
// "Am I faster": the threshold pace every pace and every ⚡ stands on and how far it moved
// since the first test (▲ = faster, the one sign on this screen), the chart of every test
// (ThresholdChart: first test on the left, faster higher), the latest test and the next one
// (MyInvitation, unchanged). The full tests card with its entry form ("שליחת טסט למאמן")
// is one tap away under "כל הטסטים ושליחת תוצאה", and opens by itself when the trainee
// arrives to send a result (?test=mine). The journey tiles live on screen 7.

const PROTOCOL = '30min';

interface TestsResponse { trend?: TrendSeries; tableMissing?: boolean }

export function ThresholdScreen({ athleteId, home, focusTests = false }: {
  athleteId: string;
  home: TraineeHome | null;
  /** Arrived by ?test=mine: the next test / the tests card is the point, so it is in view. */
  focusTests?: boolean;
}) {
  const t = useTranslations('trainee.tests');
  const tp = useTranslations('trainee.progress');
  const locale = useLocale();
  const [hasInvitation, setHasInvitation] = useState(false);
  const [invitation, setInvitation] = useState<TestInvitation | null>(null);
  const [resultJustSent, setResultJustSent] = useState(false);
  const [more, setMore] = useState(focusTests);
  const focusRef = useRef<HTMLDivElement>(null);
  const { data, error } = useApi<TestsResponse>(`/api/academy/tests?protocol=${PROTOCOL}&athleteId=${encodeURIComponent(athleteId)}`);

  // A deep link to the tests scrolls the invitation (or the tests card) into view once the
  // screen has its content, whatever sits above it.
  const ready = !!data || !!error;
  useEffect(() => {
    if (!focusTests || !ready) return;
    const id = window.setTimeout(() => focusRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 80);
    return () => window.clearTimeout(id);
  }, [focusTests, ready, hasInvitation]);

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
          // No usable test: which kind of "no" — none, waiting for approval, or only a 2000 m.
          <p className="text-[16px] font-black text-ink-900">
            {home?.test?.kind === 'pending' ? t('pending') : home?.test?.kind === 'otherProtocol' ? t('otherProtocol') : t('none')}
          </p>
        )}
        <p className="text-13 leading-normal text-ink-500">
          {latest ? t('explain') : home?.test?.kind === 'pending' ? t('pendingSub') : home?.test?.kind === 'otherProtocol' ? t('otherProtocolSub') : t('noneSub')}
        </p>
        {latest && home?.test?.kind === 'ok' && home.test.old && (
          <p className="mt-1 text-[13px] font-bold leading-snug text-[#A8510A]">{t.rich('old', { ...RICH, months: Math.round(home.test.ageDays / 30) })}</p>
        )}
      </div>

      {points.length > 0 && <ThresholdChart points={points.map(p => ({ date: p.date, paceSec: p.paceSec as number }))} />}

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
      <div ref={focusRef} className="scroll-mt-3" />
      <div className={hasInvitation ? 'flex flex-col gap-1.5' : 'hidden'}>
        <h2 className="px-0.5 text-[15px] font-black text-ink-700">{t('next')}</h2>
        <MyInvitation
          athleteId={athleteId}
          watchConnected={home?.athlete?.hasWatch}
          coachName={home?.coach?.name ?? null}
          onVisible={setHasInvitation}
          onInvitation={setInvitation}
          resultJustSent={resultJustSent}
        />
      </div>

      <button
        type="button"
        onClick={() => setMore(m => !m)}
        aria-expanded={more}
        className="flex min-h-[44px] items-center justify-center gap-1 text-[15px] font-bold text-brand-600"
      >
        {more ? t('less') : t('more')}
      </button>
      {more && (
        <MyTestsCard
          athleteId={athleteId}
          name={home?.athlete?.name ?? ''}
          invitation={invitation}
          protocol={PROTOCOL}
          onRecorded={() => setResultJustSent(true)}
        />
      )}
    </div>
  );
}
