'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import type { ClubWeek, Trend } from '@/lib/admin/club-week';

/**
 * The admin home's number tiles — option B of #71 ("numbers first").
 *
 * Six questions, each one tile: did people run, how much, how often, did they even
 * open the app, who has gone quiet, and did the workouts reach their watches. Each
 * trend compares with the same days of last week (see lib/admin/club-week), so a
 * Monday doesn't read as a collapse.
 *
 * "Opened the app" comes from PostHog and only renders when the server has a key
 * for it; the grid just has one tile fewer until then.
 */

function TrendLine({ trend, unit = 'abs' }: { trend: Trend; unit?: 'abs' | 'pct' }) {
  const t = useTranslations('controlRoom');
  const diff = trend.now - trend.prev;
  if (diff === 0) return <span className="text-2xs font-bold text-ink-400">{t('sameAsLastWeek')}</span>;
  const up = diff > 0;
  const amount = unit === 'pct' && trend.prev > 0
    ? `${Math.round((Math.abs(diff) / trend.prev) * 100)}%`
    : String(Math.abs(diff));
  return (
    <span className={cn('text-2xs font-bold', up ? 'text-accent-900' : 'text-accent-red')}>
      <bdi dir="ltr">{up ? '▲' : '▼'} {amount}</bdi> {t('vsLastWeek')}
    </span>
  );
}

function Tile({
  label,
  value,
  of,
  foot,
  href,
  valueClassName,
}: {
  label: string;
  value: React.ReactNode;
  of?: number;
  foot?: React.ReactNode;
  href?: string;
  valueClassName?: string;
}) {
  const body = (
    <>
      <span className="block text-2xs font-medium text-ink-400">{label}</span>
      <span dir="ltr" className={cn('mt-1 block text-end text-[28px] font-black leading-none tabular-nums text-ink-700', valueClassName)}>
        {value}
        {of != null && <span className="text-sm font-bold text-ink-400">/{of}</span>}
      </span>
      <span className="mt-1.5 block min-h-[14px]">{foot}</span>
    </>
  );
  const cls = 'block rounded-card bg-card p-3.5';
  return href ? <Link href={href} className={cls}>{body}</Link> : <div className={cls}>{body}</div>;
}

export function ClubWeekTiles({
  week,
  deliverySuccessRate,
}: {
  week: ClubWeek | undefined;
  deliverySuccessRate: number | null | undefined;
}) {
  const t = useTranslations('controlRoom');

  if (!week) {
    return (
      <section className="grid grid-cols-2 gap-2.5" aria-busy="true">
        {Array.from({ length: 6 }, (_, i) => <div key={i} className="h-[92px] animate-pulse rounded-card bg-card/60" />)}
      </section>
    );
  }

  return (
    <section className="grid grid-cols-2 gap-2.5">
      <Tile
        label={t('ranThisWeek')}
        value={week.activeMembers.now}
        of={week.members}
        foot={<TrendLine trend={week.activeMembers} />}
        href="/dashboard/athletes"
      />
      <Tile label={t('clubKm')} value={week.km.now} foot={<TrendLine trend={week.km} unit="pct" />} />
      <Tile label={t('runsThisWeek')} value={week.runs.now} foot={<TrendLine trend={week.runs} />} />
      {week.appOpeners && (
        <Tile
          label={t('openedApp')}
          value={week.appOpeners.now}
          of={week.members}
          foot={<TrendLine trend={week.appOpeners} />}
        />
      )}
      <Tile
        label={t('silent7d')}
        value={week.silent7d}
        valueClassName={week.silent7d > 0 ? 'text-accent-red' : undefined}
        foot={<span className="text-2xs text-ink-400">{t('silent7dHint')}</span>}
        href="/dashboard/athletes"
      />
      <Tile
        label={t('delivery')}
        // No deliveries at all is "nothing sent yet", not a 0% failure.
        value={deliverySuccessRate == null ? '—' : `${deliverySuccessRate}%`}
        valueClassName={deliverySuccessRate != null && deliverySuccessRate < 90 ? 'text-accent-red' : undefined}
        foot={<span className="text-2xs text-ink-400">{t('deliveryHint')}</span>}
      />
    </section>
  );
}
