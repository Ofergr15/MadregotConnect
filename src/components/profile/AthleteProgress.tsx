'use client';

import type { ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { useApi } from '@/lib/api';
import { MyWeekCard, type WeekAccent } from '@/components/profile/MyWeekCard';
import { PaceAtHrCard } from '@/components/profile/PaceAtHrCard';
import { ProfileActivityFeed } from '@/components/profile/ProfileActivityFeed';
import { PrSection, TenWeekChart, type StatsData } from '@/components/profile/AthleteProfileBody';
import { progressParts, type ProgressViewer } from '@/lib/athletes/progress-parts';

/**
 * A runner's progress, as one scroll: the week (and ten weeks, month, year), the records,
 * the improvement, the last runs. Nothing here is new — each card is the club runner's own,
 * over the same APIs, so an academy trainee's page and a club runner's profile read the same
 * numbers the same way (progress-parts.ts says who sees which).
 *
 * `afterWeek` slots something between the week and the rest — the trainee page's "מה צפוי".
 */
export function AthleteProgress({ athleteId, viewer, athleteName, accent = 'club', academyLane = false, compact = false, afterWeek }: {
  athleteId: string;
  viewer: ProgressViewer;
  athleteName?: string;
  accent?: WeekAccent;
  academyLane?: boolean;
  compact?: boolean;
  afterWeek?: ReactNode;
}) {
  const t = useTranslations('profile');
  const tc = useTranslations('common');
  const parts = progressParts(athleteId, viewer);
  // The academy's screens read the weeks in the plan's Sunday→Saturday week, the same week
  // as the card's ring (`?week=plan`); a club runner's own profile is not this component.
  const { data: stats } = useApi<StatsData>(parts.records || parts.week ? `/api/athletes/${athleteId}/stats${accent === 'academy' ? '?week=plan' : ''}` : null);
  return (
    <div className="space-y-3">
      {parts.week && (
        <MyWeekCard athleteId={athleteId} owner={viewer === 'owner'} athleteName={athleteName} accent={accent} academyLane={academyLane} compact={compact} tenWeeks={false} />
      )}
      {/* The weeks as the runner's profile draws them: y-axis, a week to tap, the average,
          "vs same days", the table — from the same stats read. The month tile only where
          the week card doesn't already carry one (compact = inside a sheet). */}
      {parts.week && stats && (
        <TenWeekChart
          weeks={stats.weeks || []}
          title={t('lastTenWeeks')}
          emptyLabel={t('noKmHistory')}
          unit={tc('km')}
          currentTrendPct={stats.weekTrendPct ?? null}
          month={compact ? { km: stats.monthKm, day: stats.monthDay } : null}
          accent={accent}
        />
      )}
      {afterWeek}
      {parts.records && stats && (
        <PrSection
          athleteId={athleteId}
          prs={stats.prs || []}
          history={stats.prHistory}
          year={stats.prYear}
          yearBests={stats.prYearBests}
        />
      )}
      {parts.improvement && <PaceAtHrCard athleteId={athleteId} owner={viewer === 'owner'} />}
      {parts.runs && (
        <section aria-label={t('recentRuns')}>
          <h2 className="px-1 pb-2 pt-1 text-xl font-bold text-ink-700">{t('recentRuns')}</h2>
          <ProfileActivityFeed athleteId={athleteId} runsOnly max={parts.runsMax} moreHref={parts.runsHref} />
        </section>
      )}
    </div>
  );
}
