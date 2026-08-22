'use client';

import { useState } from 'react';
import { Medal } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useApi } from '@/lib/api';
import { Card, SegmentedControl, EmptyState, SkeletonList } from '@/components/ui';
import { cn } from '@/lib/utils';

interface LeaderboardEntry {
  id: string;
  name: string;
  groupId: string | null;
  distanceKm: number;
  runs: number;
  weekStreak: number;
  monthlyKm: number;
  eventCount: number;
}

interface LeaderboardData {
  leaderboard: LeaderboardEntry[];
  leaderboardByStreak: LeaderboardEntry[];
  leaderboardByRuns: LeaderboardEntry[];
  leaderboardMonthly: LeaderboardEntry[];
  leaderboardByEvents: LeaderboardEntry[];
}

type Metric = 'distance' | 'monthly' | 'streak' | 'runs' | 'events';

// Position-based squad colors — same mapping as the staff Groups page's own
// local getGroupColors (index 0/1/2 → green/yellow/orange), duplicated rather
// than imported since that one lives inline in groups/page.tsx, not lib/utils.
const DOT_COLORS = ['bg-green-400', 'bg-yellow-400', 'bg-orange-400'];

/**
 * Athlete-facing Leaderboards screen (roadmap #12) — the staff Groups page
 * already had a richer 3-metric ranked view; athletes only ever saw a
 * compact top-3-by-distance card on Feed. This is the "see everything"
 * destination: all 5 categories the checklist asks for (Weekly/Monthly KM,
 * Streak, Workouts, Event Participation), reusing the same
 * GET /api/groups/leaderboard the staff view already computes — no age/
 * gender filters yet, since those Personal Info fields are still empty for
 * almost every athlete (added this session) and a filter with no data behind
 * it isn't worth building yet.
 */
export function LeaderboardsScreen({ athleteId, groupId }: { athleteId: string; groupId: string | null }) {
  const t = useTranslations('profile');
  const tc = useTranslations('common');
  const [metric, setMetric] = useState<Metric>('distance');
  const [scope, setScope] = useState<'all' | 'group'>('all');

  const { data, isLoading } = useApi<LeaderboardData>('/api/groups/leaderboard');

  if (isLoading && !data) return <SkeletonList count={5} />;

  const lists: Record<Metric, LeaderboardEntry[]> = {
    distance: data?.leaderboard || [],
    monthly: data?.leaderboardMonthly || [],
    streak: data?.leaderboardByStreak || [],
    runs: data?.leaderboardByRuns || [],
    events: data?.leaderboardByEvents || [],
  };
  const groupIndexOf = new Map<string, number>();
  (data?.leaderboard || []).forEach((e) => {
    if (e.groupId && !groupIndexOf.has(e.groupId)) groupIndexOf.set(e.groupId, groupIndexOf.size);
  });

  let entries = lists[metric];
  if (scope === 'group' && groupId) entries = entries.filter((e) => e.groupId === groupId);

  const valueFor = (e: LeaderboardEntry) => {
    switch (metric) {
      case 'monthly': return `${e.monthlyKm} ${tc('km')}`;
      case 'streak': return `${e.weekStreak} 🔥`;
      case 'runs': return `${e.runs}`;
      case 'events': return `${e.eventCount}`;
      default: return `${e.distanceKm} ${tc('km')}`;
    }
  };

  const myRank = entries.findIndex((e) => e.id === athleteId) + 1;

  return (
    <div className="space-y-4">
      <SegmentedControl<Metric>
        value={metric}
        onChange={setMetric}
        options={[
          { value: 'distance', label: t('leaderboardWeeklyKm') },
          { value: 'monthly', label: t('leaderboardMonthlyKm') },
          { value: 'streak', label: t('leaderboardStreak') },
          { value: 'runs', label: t('leaderboardWorkouts') },
          { value: 'events', label: t('leaderboardEvents') },
        ]}
      />

      {groupId && (
        <SegmentedControl<'all' | 'group'>
          value={scope}
          onChange={setScope}
          options={[
            { value: 'all', label: t('leaderboardAllAthletes') },
            { value: 'group', label: t('leaderboardMyGroup') },
          ]}
          className="w-fit"
        />
      )}

      {myRank > 0 && (
        <p className="text-xs text-slate-400 px-1">{t('leaderboardMyRank', { rank: myRank })}</p>
      )}

      {entries.length === 0 ? (
        <EmptyState icon={Medal} title={t('leaderboardEmpty')} className="py-8" />
      ) : (
        <Card variant="solid" className="!p-0 overflow-hidden">
          <div className="divide-y divide-slate-700/50">
            {entries.map((entry, idx) => {
              const dotColor = entry.groupId && groupIndexOf.has(entry.groupId)
                ? DOT_COLORS[groupIndexOf.get(entry.groupId)! % DOT_COLORS.length]
                : 'bg-slate-500';
              const isMe = entry.id === athleteId;
              return (
                <div
                  key={entry.id}
                  className={cn('flex items-center justify-between px-4 py-3', isMe && 'bg-primary-600/10')}
                >
                  <div className="flex items-center gap-3">
                    <span className={cn(
                      'w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold shrink-0',
                      idx === 0 ? 'bg-yellow-500/20 text-yellow-400'
                        : idx === 1 ? 'bg-slate-400/20 text-slate-300'
                        : idx === 2 ? 'bg-orange-500/20 text-orange-400'
                        : 'bg-slate-700 text-slate-400',
                    )}>
                      {idx + 1}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className={cn('w-2 h-2 rounded-full shrink-0', dotColor)} />
                      <span className={cn('font-medium text-sm', isMe ? 'text-primary-400' : 'text-white')} dir="auto">
                        {entry.name}
                      </span>
                    </div>
                  </div>
                  <span className="font-bold font-mono text-sm text-white tabular-nums">{valueFor(entry)}</span>
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}
