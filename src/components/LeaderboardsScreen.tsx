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
  gender: 'male' | 'female' | null;
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
// local getGroupColors (index 0/1/2 → green/sky blue/orange), duplicated rather
// than imported since that one lives inline in groups/page.tsx, not lib/utils.
const DOT_COLORS = ['bg-accent-600', 'bg-band-2', 'bg-band-3'];

/**
 * Athlete-facing Leaderboards screen (roadmap #12) — the staff Groups page
 * already had a richer 3-metric ranked view; athletes only ever saw a
 * compact top-3-by-distance card on Feed. This is the "see everything"
 * destination: all 5 categories the checklist asks for (Weekly/Monthly KM,
 * Streak, Workouts, Event Participation), reusing the same
 * GET /api/groups/leaderboard the staff view already computes. No age filter
 * yet — birth_date is populated for only a handful of athletes so far, and a
 * filter with almost no data behind it isn't worth building. Gender is
 * fully populated (added this session, backfilled for every athlete), so
 * that filter is real.
 */
export function LeaderboardsScreen({ athleteId, groupId }: { athleteId: string; groupId: string | null }) {
  const t = useTranslations('profile');
  const tc = useTranslations('common');
  const ts = useTranslations('settings'); // genderMale/genderFemale live here, not 'profile'
  const [metric, setMetric] = useState<Metric>('distance');
  const [scope, setScope] = useState<'all' | 'group'>('all');
  const [genderFilter, setGenderFilter] = useState<'all' | 'male' | 'female'>('all');

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
  if (genderFilter !== 'all') entries = entries.filter((e) => e.gender === genderFilter);

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

      <div className="flex flex-wrap gap-2">
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
        <SegmentedControl<'all' | 'male' | 'female'>
          value={genderFilter}
          onChange={setGenderFilter}
          options={[
            { value: 'all', label: t('leaderboardAllGenders') },
            { value: 'male', label: ts('genderMale') },
            { value: 'female', label: ts('genderFemale') },
          ]}
          className="w-fit"
        />
      </div>

      {myRank > 0 && (
        <p className="text-xs text-ink-400 px-1">{t('leaderboardMyRank', { rank: myRank })}</p>
      )}

      {entries.length === 0 ? (
        <EmptyState icon={Medal} title={t('leaderboardEmpty')} className="py-8" />
      ) : (
        <Card variant="solid" className="!p-0 overflow-hidden">
          <div className="divide-y divide-page/50">
            {entries.map((entry, idx) => {
              const dotColor = entry.groupId && groupIndexOf.has(entry.groupId)
                ? DOT_COLORS[groupIndexOf.get(entry.groupId)! % DOT_COLORS.length]
                : 'bg-ink-300';
              const isMe = entry.id === athleteId;
              return (
                <div
                  key={entry.id}
                  className={cn('flex items-center justify-between px-4 py-3', isMe && 'bg-brand-600/10')}
                >
                  <div className="flex items-center gap-3">
                    <span className={cn(
                      'w-7 h-7 rounded-full flex items-center justify-center text-sm font-bold shrink-0',
                      idx === 0 ? 'bg-band-3/20 text-band-3'
                        : idx === 1 ? 'bg-ink-300/20 text-ink-500'
                        : idx === 2 ? 'bg-band-3/20 text-band-3'
                        : 'bg-page text-ink-400',
                    )}>
                      {idx + 1}
                    </span>
                    <div className="flex items-center gap-2">
                      <span className={cn('w-2 h-2 rounded-full shrink-0', dotColor)} />
                      <span className={cn('font-medium text-sm', isMe ? 'text-brand-600' : 'text-ink-700')} dir="auto">
                        {entry.name}
                      </span>
                    </div>
                  </div>
                  <span className="font-bold font-mono text-sm text-ink-700 tabular-nums">{valueFor(entry)}</span>
                </div>
              );
            })}
          </div>
        </Card>
      )}
    </div>
  );
}
