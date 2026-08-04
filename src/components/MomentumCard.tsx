'use client';

import { Flame, TrendingUp, TrendingDown, Minus, Mountain, Trophy } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useApi } from '@/lib/api';
import { SkeletonCard } from '@/components/ui';

interface Summary {
  weekStreak: number;
  thisWeek: { km: number; runs: number };
  lastWeek: { km: number; runs: number };
  biggestWeek: { weekStart: string; km: number; runs: number } | null;
  totalRuns: number;
}

// Momentum card for the runner dashboard: a week-streak flame + a "this week vs
// last" recap. Derived from run history (no new capture). Hidden until the
// athlete has any runs. Athlete-scoped via the same auth as /prs. Cached via SWR
// (shared with StatTiles/PersonalRecords) so it opens instantly on revisit.
export function MomentumCard({ athleteId }: { athleteId: string }) {
  const t = useTranslations('momentum');
  const { data: s } = useApi<Summary>(
    athleteId ? `/api/athletes/summary?athleteId=${encodeURIComponent(athleteId)}` : null,
  );

  if (!s) return <SkeletonCard />; // true first load → shaped skeleton
  if (s.totalRuns === 0) return null; // loaded but no runs → hide entirely

  const deltaKm = Math.round((s.thisWeek.km - s.lastWeek.km) * 10) / 10;
  const TrendIcon = deltaKm > 0.05 ? TrendingUp : deltaKm < -0.05 ? TrendingDown : Minus;
  const trendColor = deltaKm > 0.05 ? 'text-emerald-400' : deltaKm < -0.05 ? 'text-amber-400' : 'text-slate-400';

  // Biggest week ever. If this week IS the peak (and it's a real week, ≥2 runs so
  // a single long run doesn't spuriously "win"), celebrate a new record.
  const peak = s.biggestWeek;
  const isRecordThisWeek =
    !!peak && peak.km > 0 && s.thisWeek.km >= peak.km && s.thisWeek.runs >= 2;

  return (
    <div className="rounded-2xl bg-slate-800/60 border border-slate-700/60 p-4 sm:p-5" dir="rtl">
      <div className="flex items-center gap-4">
        {/* Streak */}
        <div className="flex flex-col items-center justify-center shrink-0 w-20">
          <div className="flex items-center gap-1">
            <Flame className={s.weekStreak > 0 ? 'h-6 w-6 text-orange-400' : 'h-6 w-6 text-slate-600'} />
            <span className="text-3xl font-black text-white tabular-nums">{s.weekStreak}</span>
          </div>
          <span className="text-2xs text-slate-400 mt-0.5 text-center leading-tight">
            {s.weekStreak === 1 ? t('weekStreakOne') : t('weekStreak')}
          </span>
        </div>

        <div className="w-px self-stretch bg-slate-700/60" />

        {/* This week recap */}
        <div className="flex-1 min-w-0">
          <div className="flex items-baseline gap-2">
            <span className="text-2xl font-black text-white tabular-nums">{s.thisWeek.km}</span>
            <span className="text-sm text-slate-400">{t('kmThisWeek')}</span>
          </div>
          <div className="flex items-center gap-3 mt-1 text-xs">
            <span className="text-slate-400">{s.thisWeek.runs} {t('runs')}</span>
            <span className={`inline-flex items-center gap-1 font-semibold ${trendColor}`}>
              <TrendIcon className="h-3.5 w-3.5" />
              {deltaKm > 0 ? '+' : ''}{deltaKm} {t('vsLastWeek')}
            </span>
          </div>
        </div>
      </div>

      {/* Biggest week ever — a new record this week, or the peak as a target. */}
      {peak && peak.km > 0 && (
        isRecordThisWeek ? (
          <div className="mt-3 pt-3 border-t border-slate-700/60 flex items-center gap-2 text-xs font-bold text-amber-300">
            <Trophy className="h-4 w-4 shrink-0" />
            <span>{t('newRecordWeek', { km: peak.km })}</span>
          </div>
        ) : (
          <div className="mt-3 pt-3 border-t border-slate-700/60 flex items-center gap-2 text-xs text-slate-400">
            <Mountain className="h-4 w-4 shrink-0 text-slate-500" />
            <span>{t('biggestWeek')}</span>
            <span className="ms-auto font-bold text-slate-200 tabular-nums">{peak.km} {t('km')}</span>
          </div>
        )
      )}
    </div>
  );
}
