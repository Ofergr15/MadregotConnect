'use client';

import { useTranslations } from 'next-intl';
import { TrendingUp, TrendingDown } from 'lucide-react';
import { Card, BigStat } from '@/components/ui';
import { cn } from '@/lib/utils';

/**
 * The coach's slim stat strip on /dashboard (everything else lives in Coach Pulse and
 * the roster). Split out of the page and loaded with next/dynamic: it renders for the
 * one coach only, so a runner never downloads it.
 */
export function CoachStatStrip({ weekly, stats }: {
  weekly: { weekTotalMin: number; weekTotalMax: number; weekDelta: number; trainingDays: number } | undefined;
  stats: { athleteCount: number; groupCount: number; deliverySuccessRate: number } | undefined;
}) {
  const t = useTranslations('dashboard');
  const tc = useTranslations('common');
  const hasData = weekly && weekly.weekTotalMax > 0;
  return (
      <section className="grid grid-cols-2 sm:grid-cols-4 gap-3 sm:gap-4">
        <Card variant="muted">
          <BigStat
            value={hasData ? <>{Math.round(weekly!.weekTotalMin)}–{Math.round(weekly!.weekTotalMax)}<span className="text-sm font-medium text-ink-400"> {tc('km')}</span></> : '—'}
            label={t('weeklyVolume')}
          />
          {weekly?.weekDelta !== 0 && weekly?.weekDelta !== undefined && (
            <div className="flex items-center justify-center gap-1 mt-2">
              {weekly.weekDelta > 0 ? <TrendingUp className="h-3.5 w-3.5 text-accent-600" /> : <TrendingDown className="h-3.5 w-3.5 text-band-3" />}
              <span className={cn('text-sm font-semibold', weekly.weekDelta > 0 ? 'text-accent-900' : 'text-band-3-ink')}>
                {weekly.weekDelta > 0 ? '+' : ''}{weekly.weekDelta}%
              </span>
            </div>
          )}
        </Card>
        <Card variant="muted">
          <BigStat value={stats?.athleteCount || 0} label="Athletes" />
          <p className="text-sm text-ink-400 mt-1 text-center">{stats?.groupCount || 0} groups</p>
        </Card>
        <Card variant="muted">
          <BigStat
            value={<>{stats?.deliverySuccessRate || 0}<span className="text-sm font-medium text-ink-400">%</span></>}
            label={t('delivery')}
          />
          <p className="text-sm text-ink-400 mt-1 text-center">{t('successRate')}</p>
        </Card>
        <Card variant="muted">
          <BigStat
            value={<>{weekly?.trainingDays || 0}<span className="text-sm font-medium text-ink-400">/7</span></>}
            label={t('trainingDays')}
          />
          <p className="text-sm text-ink-400 mt-1 text-center">{t('thisWeek')}</p>
        </Card>
      </section>
  );
}
