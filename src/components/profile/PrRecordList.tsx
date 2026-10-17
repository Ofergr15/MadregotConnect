'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { ChevronLeft } from 'lucide-react';
import { formatTime } from '@/lib/academy/benchmark';
import { cn } from '@/lib/utils';
import {
  PR_DIST_KEYS,
  PR_RETURN_KEY,
  agoMessage,
  prPace,
  recordHref,
  shortDay,
} from '@/components/profile/pr-format';

/**
 * The records on the PRs tab — one row per distance (mockups/prs-tab/mockup.html,
 * the "מוצע" phone, approved 2026-10-17).
 *
 * Each row answers the questions a runner actually brings to it, in the order
 * they bring them: the time, and the pace it means (pace is what a runner
 * compares with training); whether it is current ("set this year", or this
 * year's best beside an older record); where they stand in the club (own profile
 * only — see profileClubRanks); which run it was; and how it got here — "broken
 * 4 times, last 3 weeks ago", which opens the record's own screen.
 *
 * A record typed in by hand says so, and carries no watch history on this row:
 * it has no run behind it (overrides.ts). Its screen still shows what the watch
 * measured, under the stated time.
 */

export interface PrRow {
  key: string;
  meters?: number;
  seconds: number | null;
  date: string | null;
  activityName: string | null;
  activityId?: string | null;
  fromSegment?: boolean;
  sourceMeters?: number | null;
  source?: 'auto' | 'manual';
  note?: string | null;
}

export interface PrBreak {
  date: string;
  seconds: number;
  activityId: string | null;
  activityName: string | null;
}

const METERS: Record<string, number> = { '5k': 5000, '10k': 10000, hm: 21097, fm: 42195 };

export function PrRecordList({
  athleteId,
  prs,
  history,
  year,
  yearBests,
  ranks,
  today,
}: {
  athleteId: string;
  prs: PrRow[];
  history: Record<string, PrBreak[]> | undefined;
  year: string | undefined;
  yearBests: Record<string, number | null> | undefined;
  /** Empty on a teammate's profile — the rank is only ever shown to its owner. */
  ranks: Record<string, { rank: number; of: number }>;
  /** Israel's calendar date, YYYY-MM-DD, for "last … ago". */
  today: string;
}) {
  const t = useTranslations('profile');
  const ago = (iso: string) => {
    const { key, n } = agoMessage(iso, today);
    return t(key, { n });
  };
  const leaveForRecord = () => {
    try {
      sessionStorage.setItem(PR_RETURN_KEY, athleteId);
    } catch {
      /* private mode: coming back lands on Overview, nothing worse */
    }
  };

  return (
    <div className="mt-3 space-y-2">
      {prs.map((p) => {
        const label = t(PR_DIST_KEYS[p.key] ?? 'prDist_5k');
        // No record at this distance: a grey row that says so and goes nowhere.
        if (p.seconds == null) {
          return (
            <div
              key={p.key}
              className="flex min-h-[44px] items-center gap-3 rounded-[14px] bg-page/50 px-3.5"
            >
              <span className="text-[13px] font-extrabold text-ink-400">{label}</span>
              <span className="text-sm text-ink-400">{t('prNone')}</span>
            </div>
          );
        }

        const meters = p.meters ?? METERS[p.key] ?? 5000;
        const manual = p.source === 'manual';
        const breaks = history?.[p.key] ?? [];
        const rank = ranks[p.key];
        const thisYear = !!(year && p.date && p.date.startsWith(year));
        const yearBest = yearBests?.[p.key] ?? null;
        const last = breaks.length ? breaks[breaks.length - 1] : null;

        return (
          <div key={p.key} className="rounded-[14px] bg-page/50 px-3.5 pt-3">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[13px] font-extrabold tracking-[.2px] text-brand-600">{label}</span>
              {rank && (
                // The pill is 24px; the ::after halo makes the tap 44 without
                // moving anything, and nothing else sits within 10px of it.
                <Link
                  href={`/dashboard/records?d=${encodeURIComponent(p.key)}`}
                  aria-label={t('prClubRankAria', { rank: rank.rank, of: rank.of })}
                  className="relative inline-flex items-center gap-1 rounded-pill bg-card px-2.5 py-1 text-xs font-bold text-ink-700 after:absolute after:-inset-x-1 after:-inset-y-2.5 after:content-[''] active:opacity-60"
                >
                  {t.rich('prClubRank', {
                    rank: rank.rank,
                    of: rank.of,
                    b: (c) => (
                      <b className="text-brand-600">
                        <bdi dir="ltr">{c}</bdi>
                      </b>
                    ),
                    n: (c) => <bdi dir="ltr">{c}</bdi>,
                  })}
                  <ChevronLeft className="h-3.5 w-3.5 text-brand-600" />
                </Link>
              )}
            </div>

            <div className="mt-0.5 flex items-baseline gap-2.5">
              {/* A time is not RTL text: bidi moves the colon in "1:19:57". */}
              <span dir="ltr" className="text-[30px] font-extrabold leading-[1.1] tracking-[-.5px] tabular-nums text-ink-900">
                {formatTime(p.seconds)}
              </span>
              <span className="text-[13px] font-medium text-ink-400">
                <bdi dir="ltr">{prPace(p.seconds, meters)}</bdi> {t('prPerKm')}
              </span>
              {thisYear ? (
                <span className="ms-auto shrink-0 rounded-pill bg-accent-900/10 px-2.5 py-0.5 text-2xs font-bold text-accent-900">
                  {t('prSetThisYear')}
                </span>
              ) : yearBest != null ? (
                <span className="ms-auto shrink-0 rounded-pill bg-card px-2.5 py-0.5 text-2xs font-semibold text-ink-400">
                  {t('prThisYear')} <bdi dir="ltr">{formatTime(yearBest)}</bdi>
                </span>
              ) : null}
            </div>

            {/* The run it was set on. A stated time has none, so the line is
                inert: its date and where it came from, in the athlete's words. */}
            {manual ? (
              (p.date || p.note) && (
                <p className="flex min-h-[32px] items-center gap-1 text-[12.5px] text-ink-500" dir="auto">
                  {p.date && <bdi dir="ltr">{shortDay(p.date)}</bdi>}
                  {p.date && p.note ? ' · ' : ''}
                  {p.note}
                </p>
              )
            ) : (
              <RunLine p={p} />
            )}

            {/* How it got here. Opens the record's own screen. */}
            <Link
              href={recordHref(athleteId, p.key) ?? '/dashboard/profile'}
              onClick={leaveForRecord}
              className="flex min-h-[44px] items-center justify-between gap-2 border-t border-ink-300/40 text-xs text-ink-500 active:opacity-60"
            >
              <span className="min-w-0 truncate">
                {manual ? (
                  <span className="font-bold text-ink-700">{t('prEnteredByHand')}</span>
                ) : (
                  <>
                    {t.rich('prBroken', {
                      count: breaks.length || 1,
                      b: (c) => (
                        <b className="text-ink-700">
                          <bdi dir="ltr">{c}</bdi>
                        </b>
                      ),
                    })}
                    {(last?.date || p.date) && (
                      <>
                        {' · '}
                        {t('prLastAgo', { ago: ago(last?.date || (p.date as string)) })}
                      </>
                    )}
                  </>
                )}
              </span>
              <ChevronLeft className="h-4 w-4 shrink-0 text-brand-600" />
            </Link>
          </div>
        );
      })}
    </div>
  );
}

function RunLine({ p }: { p: PrRow }) {
  const t = useTranslations('profile');
  const body = (
    <>
      <span className="min-w-0 truncate" dir="auto">
        {p.date && <bdi dir="ltr">{shortDay(p.date)}</bdi>}
        {' · '}
        {p.fromSegment && p.sourceMeters
          ? t.rich('prInRun', {
              km: (p.sourceMeters / 1000).toFixed(1),
              n: (c) => <bdi dir="ltr">{c}</bdi>,
            })
          : p.activityName || t('prRunFallback')}
      </span>
      {p.activityId && <ChevronLeft className="h-4 w-4 shrink-0 text-brand-600" />}
    </>
  );
  const cls = 'flex min-h-[44px] items-center gap-1 text-[12.5px] text-ink-500';
  if (!p.activityId) return <p className={cls}>{body}</p>;
  return (
    <Link href={`/dashboard/activities/${p.activityId}`} className={cn(cls, 'active:opacity-60')}>
      {body}
    </Link>
  );
}
