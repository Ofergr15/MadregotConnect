'use client';

import { Award, Lock } from 'lucide-react';
import { useTranslations, useLocale } from 'next-intl';
import { useApi } from '@/lib/api';
import { Card, EmptyState, SkeletonCard } from '@/components/ui';
import { cn } from '@/lib/utils';

interface BadgeRow {
  id: string;
  code: string;
  nameHe: string;
  nameEn: string;
  descriptionHe: string | null;
  descriptionEn: string | null;
  icon: string;
  iconUrl: string | null;
  earned: boolean;
  awardedAt: string | null;
  context: Record<string, unknown> | null;
}

interface BadgesData {
  badges: BadgeRow[];
  earnedCount: number;
  totalCount: number;
}

// Achievements & Badges (roadmap #11, Phase 3) — the full catalog, always
// shown as a grid (never "empty": there are always 11 cells). Earned badges
// render in full color with their real icon/name + "earned <date>"; unearned
// ones are greyed/locked. The award-evaluation engine (a separate task) is the
// only writer of athlete_badges — this is purely a read/display surface
// against GET /api/athletes/badges.
export function BadgesGrid({ athleteId }: { athleteId: string }) {
  const t = useTranslations('profile');
  const locale = useLocale();
  const { data, isLoading } = useApi<BadgesData>(
    athleteId ? `/api/athletes/badges?athleteId=${encodeURIComponent(athleteId)}` : null,
  );

  if (isLoading && !data) {
    return (
      <div className="grid grid-cols-3 gap-3">
        {Array.from({ length: 9 }, (_, i) => (
          <SkeletonCard key={i} className="h-28" />
        ))}
      </div>
    );
  }

  const badges = data?.badges || [];
  const earnedCount = data?.earnedCount ?? 0;

  const fmtDate = (iso: string) =>
    new Date(iso).toLocaleDateString(locale, { day: 'numeric', month: 'short' });

  return (
    <div className="space-y-4">
      {earnedCount === 0 && (
        <EmptyState icon={Award} title={t('noBadgesYet')} description={t('noBadgesYetBody')} className="py-8" />
      )}

      <div className="grid grid-cols-3 gap-3">
        {badges.map((b) => {
          const name = locale === 'he' ? b.nameHe : b.nameEn;
          const description = locale === 'he' ? b.descriptionHe : b.descriptionEn;
          return (
            <Card
              key={b.id}
              variant={b.earned ? 'solid' : 'muted'}
              title={description || undefined}
              className={cn(
                'relative flex flex-col items-center text-center gap-1 !p-3',
                !b.earned && 'opacity-40',
              )}
            >
              {!b.earned && (
                <Lock className="absolute top-2 end-2 h-3 w-3 text-ink-400" aria-label={t('locked')} />
              )}
              {b.iconUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={b.iconUrl}
                  alt={name}
                  className={cn('h-10 w-10 object-contain', !b.earned && 'grayscale')}
                />
              ) : (
                <span className={cn('text-3xl leading-none', !b.earned && 'grayscale')}>{b.icon}</span>
              )}
              <span
                className={cn('text-2xs font-semibold leading-tight line-clamp-2', b.earned ? 'text-ink-700' : 'text-ink-400')}
                dir="auto"
              >
                {name}
              </span>
              {b.earned && b.awardedAt && (
                <span className="text-3xs text-ink-400">
                  {t('earnedOn')} {fmtDate(b.awardedAt)}
                </span>
              )}
            </Card>
          );
        })}
      </div>
    </div>
  );
}
