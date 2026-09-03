'use client';

import { CheckCircle2, Trophy, Users } from 'lucide-react';
import { useTranslations, useLocale } from 'next-intl';
import { useApi } from '@/lib/api';
import { Card, EmptyState, SkeletonCard } from '@/components/ui';
import { cn } from '@/lib/utils';

interface ChallengeRow {
  id: string;
  nameHe: string;
  nameEn: string;
  descriptionHe: string | null;
  descriptionEn: string | null;
  icon: string;
  iconUrl: string | null;
  metric: 'distance_km' | 'workout_count' | 'elevation_m';
  targetValue: number;
  scope: 'individual' | 'group';
  startDate: string;
  endDate: string;
  current: number;
  completed: boolean;
  completedAt: string | null;
}

interface ChallengesData {
  challenges: ChallengeRow[];
}

// Roadmap #13, Phase 4 — Challenge System. Time-boxed, progress-tracked
// campaigns that award a badge on completion (see lib/challenges/engine.ts).
// Unlike BadgesGrid (a fixed-size catalog, always rendered even at 0 earned),
// this only ever shows CURRENTLY ACTIVE challenges — nothing to show when
// there are none is a real, valid state, not a loading glitch.
export function ChallengesGrid({ athleteId }: { athleteId: string }) {
  const t = useTranslations('profile');
  const locale = useLocale();
  const { data, isLoading } = useApi<ChallengesData>(
    athleteId ? `/api/challenges?athleteId=${encodeURIComponent(athleteId)}` : null,
  );

  if (isLoading && !data) {
    return (
      <div className="grid grid-cols-1 gap-3">
        {Array.from({ length: 2 }, (_, i) => (
          <SkeletonCard key={i} className="h-24" />
        ))}
      </div>
    );
  }

  const challenges = data?.challenges || [];

  if (challenges.length === 0) {
    return <EmptyState icon={Trophy} title={t('noChallengesActive')} description={t('noChallengesActiveBody')} className="py-8" />;
  }

  const metricUnit = (metric: ChallengeRow['metric']) =>
    metric === 'distance_km' ? t('challengeMetricKm') : metric === 'elevation_m' ? t('challengeMetricElevation') : t('challengeMetricWorkouts');

  const fmtValue = (v: number, metric: ChallengeRow['metric']) => (metric === 'workout_count' ? Math.round(v) : Math.round(v * 10) / 10);

  const daysLeft = (endDate: string) => {
    const end = new Date(`${endDate}T23:59:59`);
    const now = new Date();
    return Math.max(0, Math.ceil((end.getTime() - now.getTime()) / 86400000));
  };

  return (
    <div className="grid grid-cols-1 gap-3">
      {challenges.map((c) => {
        const name = locale === 'he' ? c.nameHe : c.nameEn;
        const description = locale === 'he' ? c.descriptionHe : c.descriptionEn;
        const pct = Math.min(100, Math.round((c.current / c.targetValue) * 100));
        const remaining = daysLeft(c.endDate);

        return (
          <Card key={c.id} className="!p-4">
            <div className="flex items-start gap-3">
              {c.iconUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={c.iconUrl} alt={name} className="h-9 w-9 object-contain shrink-0" />
              ) : (
                <span className="text-3xl leading-none shrink-0">{c.icon}</span>
              )}
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-bold text-ink-700 truncate" dir="auto">{name}</span>
                  {c.completed && <CheckCircle2 className="h-4 w-4 text-accent-600 shrink-0" />}
                </div>
                {description && (
                  <p className="text-2xs text-ink-400 mt-0.5 line-clamp-2" dir="auto">{description}</p>
                )}
                {c.scope === 'group' && (
                  <span className="inline-flex items-center gap-1 text-3xs text-indigo-600 mt-1">
                    <Users className="h-3 w-3" />
                    {t('challengeGroupTag')}
                  </span>
                )}
              </div>
            </div>

            <div className="mt-3">
              <div className="w-full h-1.5 bg-page/50 rounded-full overflow-hidden">
                <div
                  className={cn('h-full rounded-full transition-all', c.completed ? 'bg-accent-600' : 'bg-brand-600')}
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="flex items-center justify-between mt-1.5">
                <span className="text-xs font-semibold text-ink-500 tabular-nums">
                  {fmtValue(c.current, c.metric)} / {fmtValue(c.targetValue, c.metric)} {metricUnit(c.metric)}
                </span>
                <span className="text-2xs text-ink-400">
                  {c.completed
                    ? t('challengeCompleted')
                    : remaining === 0
                      ? t('challengeLastDay')
                      : t('challengeDaysLeft', { days: remaining })}
                </span>
              </div>
            </div>
          </Card>
        );
      })}
    </div>
  );
}
