'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Trophy } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { SegmentedControl } from '@/components/ui';
import { apiHeaders, useApi } from '@/lib/api';

interface Props {
  athleteId: string | null;
}

// The club's top-3 for the week, filterable by squad.
//
// This used to render my own 12-week volume chart beside the podium. That half
// is now WeeklyVolumeCard on the profile landing: the feed is "how is everyone
// doing", and a chart of nothing but my own weekly totals is the most personal
// thing in the app. The split also took two requests off the feed's first
// paint — the activities fetch and /api/dashboard/weekly were both feeding the
// chart only.
export function WeeklyLeaderboardCard({ athleteId }: Props) {
  const t = useTranslations('dashboard');
  const tc = useTranslations('common');
  const [leaderboard, setLeaderboard] = useState<Array<{ id: string; name: string; groupId: string; distanceKm: number; runs: number }>>([]);
  const [leaderboardFilter, setLeaderboardFilter] = useState<'all' | string>('all');
  // Group names for the leaderboard filter chips. Same SWR key the Header uses
  // on every screen, so this reads the cache instead of re-running a 4KB
  // groups+athletes join for three labels.
  const { data: groupsData } = useApi<{ groups?: Array<{ id: string; name: string }> } | Array<{ id: string; name: string }>>(
    athleteId ? '/api/groups' : null,
  );
  const groups = Array.isArray(groupsData) ? groupsData : (groupsData?.groups || []);

  useEffect(() => {
    if (!athleteId) return;
    (async () => {
      try {
        // Session-gated, so resolve the bearer header first. The leaderboard is
        // aggregated server-side — this card downloads no activities of its own.
        const headers = await apiHeaders();
        const lbRes = await fetch('/api/groups/leaderboard', { headers });
        if (lbRes.ok) setLeaderboard((await lbRes.json()).leaderboard || []);
      } catch { /* best-effort — section just hides if nothing loads */ }
    })();
  }, [athleteId]);

  if (leaderboard.length === 0) return null;

  const filtered = leaderboardFilter === 'all' ? leaderboard : leaderboard.filter(a => a.groupId === leaderboardFilter);
  const top3 = filtered.slice(0, 3);
  const myRank = filtered.findIndex(a => a.id === athleteId) + 1;

  return (
    <section className="bg-card rounded-card border border-page p-4 sm:p-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
        <div className="flex items-center gap-1.5">
          <Trophy className="h-3.5 w-3.5 text-band-3" />
          <span className="text-xs font-semibold uppercase tracking-wider text-ink-400">{t('top3')}</span>
        </div>
        {groups.length > 1 && (
          <SegmentedControl
            value={leaderboardFilter}
            onChange={setLeaderboardFilter}
            options={[
              { value: 'all', label: tc('all') },
              ...groups.map(g => ({ value: g.id, label: g.name.replace('Group ', '').replace(' - SUB ', ' ') })),
            ]}
          />
        )}
      </div>
      <div className="flex items-end justify-center gap-5 px-2" style={{ height: '100px' }}>
        {top3.length >= 2 && (
          <div className="flex flex-col items-center" style={{ width: '56px' }}>
            <span className="text-2xs font-bold text-ink-500 mb-1 tabular-nums">{top3[1].distanceKm}</span>
            <div className="w-6 rounded-t bg-ink-300/80" style={{ height: '50px' }} />
            <Link
              href={`/dashboard/teammate/${top3[1].id}`}
              className="text-2xs text-ink-500 mt-1.5 font-medium whitespace-nowrap"
            >
              {top3[1].name.split(' ')[0]}
            </Link>
          </div>
        )}
        {top3.length >= 1 && (
          <div className="flex flex-col items-center" style={{ width: '56px' }}>
            <span className="text-sm mb-0.5">👑</span>
            <span className="text-xs font-black text-band-3-ink mb-1 tabular-nums">{top3[0].distanceKm}</span>
            <div className="w-6 rounded-t bg-band-3" style={{ height: '70px' }} />
            <Link
              href={`/dashboard/teammate/${top3[0].id}`}
              className="text-2xs text-ink-700 font-bold mt-1.5 whitespace-nowrap"
            >
              {top3[0].name.split(' ')[0]}
            </Link>
          </div>
        )}
        {top3.length >= 3 && (
          <div className="flex flex-col items-center" style={{ width: '56px' }}>
            <span className="text-2xs font-bold text-band-3-ink mb-1 tabular-nums">{top3[2].distanceKm}</span>
            <div className="w-6 rounded-t bg-band-3/80" style={{ height: '35px' }} />
            <Link
              href={`/dashboard/teammate/${top3[2].id}`}
              className="text-2xs text-ink-500 mt-1.5 font-medium whitespace-nowrap"
            >
              {top3[2].name.split(' ')[0]}
            </Link>
          </div>
        )}
      </div>
      {/* Was a hardcoded "You: #14" — English, in the middle of a Hebrew
          screen, on the one line of this card that is about the reader. */}
      {myRank > 3 && (
        <p className="text-3xs text-ink-400 text-center mt-2">{t('yourRank', { rank: myRank })}</p>
      )}
    </section>
  );
}
