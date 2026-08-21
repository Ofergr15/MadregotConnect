'use client';

import { Flame } from 'lucide-react';
import { useApi } from '@/lib/api';
import { BigStat, SkeletonCard } from '@/components/ui';
import { ProfileBest } from '@/components/ProfileBest';
import { PersonalRecords } from '@/components/PersonalRecords';
import { RaceHistory } from '@/components/RaceHistory';
import { VolumeHistory } from '@/components/VolumeHistory';

interface SummaryData {
  totalKm: number;
  totalHours: number;
  totalRuns: number;
  weekStreak: number;
  longestStreak: number;
  activeWeeksRatio: { active: number; total: number } | null;
}

/**
 * Profile → Statistics — the Strava/Garmin-style "your numbers" hub (roadmap:
 * native-iOS redesign, Batch 1). Absorbs what used to be two separate Profile
 * rows (Records, Weekly Volume) into one screen: all-time hero totals,
 * consistency/streaks, volume trend, auto-detected PRs, race history, and the
 * academy benchmark board — each sub-section is an existing, already-built
 * component reused wholesale, not rebuilt.
 */
export function StatisticsScreen({ athleteId, athleteName }: { athleteId: string; athleteName: string }) {
  const { data } = useApi<SummaryData>(
    athleteId ? `/api/athletes/summary?athleteId=${encodeURIComponent(athleteId)}` : null,
  );

  const ratio = data?.activeWeeksRatio;
  const ratioPct = ratio && ratio.total > 0 ? Math.round((ratio.active / ratio.total) * 100) : 0;

  return (
    <div className="space-y-4">
      {/* All-time hero numbers */}
      {!data ? (
        <SkeletonCard className="h-24" />
      ) : (
        <div className="rounded-2xl bg-slate-800/80 border border-slate-700/50 p-5">
          <div className="grid grid-cols-3 gap-2">
            <BigStat value={data.totalKm.toLocaleString()} label="ק״מ סה״כ" />
            <BigStat value={data.totalHours} label="שעות ריצה" />
            <BigStat value={data.totalRuns} label="ריצות" />
          </div>
        </div>
      )}

      {/* Consistency: current + longest streak, active-weeks ratio */}
      {data && (data.weekStreak > 0 || data.longestStreak > 0 || ratio) && (
        <div className="rounded-2xl bg-slate-800/80 border border-slate-700/50 p-5">
          <div className="flex items-center gap-2 mb-4">
            <Flame className="h-4 w-4 text-orange-400" />
            <h2 className="text-sm font-semibold text-white uppercase tracking-wider">עקביות</h2>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div className="bg-slate-900/50 rounded-xl p-3 text-center">
              <div className="text-2xl font-black text-white tabular-nums">{data.weekStreak}</div>
              <div className="text-xs text-slate-400 mt-1">רצף נוכחי (שבועות)</div>
            </div>
            <div className="bg-slate-900/50 rounded-xl p-3 text-center">
              <div className="text-2xl font-black text-white tabular-nums">{data.longestStreak}</div>
              <div className="text-xs text-slate-400 mt-1">הרצף הארוך ביותר</div>
            </div>
          </div>
          {ratio && (
            <div className="mt-3 bg-slate-900/50 rounded-xl p-3">
              <div className="flex items-center justify-between text-xs text-slate-400 mb-1.5">
                <span>שבועות פעילים (שנה אחרונה)</span>
                <span className="font-bold text-white tabular-nums">{ratio.active}/{ratio.total}</span>
              </div>
              <div className="h-2 rounded-full bg-slate-700 overflow-hidden">
                <div className="h-full bg-primary-500 rounded-full" style={{ width: `${ratioPct}%` }} />
              </div>
            </div>
          )}
        </div>
      )}

      <VolumeHistory athleteId={athleteId} />
      <PersonalRecords athleteId={athleteId} />
      <RaceHistory athleteId={athleteId} />
      <ProfileBest athleteId={athleteId} athleteName={athleteName} />
    </div>
  );
}
