'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Search, Users } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { apiHeaders, useApi } from '@/lib/api';
import { EmptyState, SkeletonList, Button } from '@/components/ui';
import { FeedAvatar } from '@/components/FeedAvatar';
import { cn } from '@/lib/utils';

interface DiscoverAthlete {
  id: string;
  name: string;
  avatarUrl: string | null;
  groupName: string | null;
  isFollowing: boolean;
}

interface DiscoverData {
  athletes: DiscoverAthlete[];
}

/**
 * Member Discovery (roadmap #21, Phase 6) — search/browse the roster to find
 * someone to follow. The Follow system itself (migration 060) only ever had
 * two entry points before this: a teammate's own profile page, or a name
 * already showing up in the feed/leaderboards. Optimistic follow/unfollow —
 * the toggle flips instantly and only reverts on a failed request, matching
 * the teammate-profile page's own follow button.
 */
export function MemberDiscovery({ viewerId }: { viewerId: string }) {
  const t = useTranslations('profile');
  const [query, setQuery] = useState('');
  const [pending, setPending] = useState<Record<string, boolean>>({});
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});

  // The route takes the viewer from the session, so viewerId is no longer in
  // the URL — it's kept as the fetch gate (don't ask for a follow-flagged
  // roster before we know who's looking) and for the follow call below.
  const { data, isLoading } = useApi<DiscoverData>(viewerId ? '/api/athletes/discover' : null);

  const athletes = useMemo(() => {
    const list = data?.athletes || [];
    const q = query.trim().toLowerCase();
    const filtered = q ? list.filter((a) => a.name.toLowerCase().includes(q)) : list;
    return filtered.map((a) => ({ ...a, isFollowing: overrides[a.id] ?? a.isFollowing }));
  }, [data, query, overrides]);

  const toggleFollow = async (athlete: DiscoverAthlete) => {
    const nextFollowing = !(overrides[athlete.id] ?? athlete.isFollowing);
    setOverrides((prev) => ({ ...prev, [athlete.id]: nextFollowing }));
    setPending((prev) => ({ ...prev, [athlete.id]: true }));
    try {
      const res = await fetch('/api/athletes/follow', {
        method: nextFollowing ? 'POST' : 'DELETE',
        // The route checks the caller IS followerId, from the verified session.
        headers: await apiHeaders(true),
        body: JSON.stringify({ followerId: viewerId, followeeId: athlete.id }),
      });
      if (!res.ok) throw new Error('failed');
    } catch {
      setOverrides((prev) => ({ ...prev, [athlete.id]: !nextFollowing })); // revert on failure
    } finally {
      setPending((prev) => ({ ...prev, [athlete.id]: false }));
    }
  };

  if (isLoading && !data) return <SkeletonList count={5} />;

  return (
    <div className="space-y-3">
      <div className="relative">
        <Search className="absolute start-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-500" />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('discoverSearchPlaceholder')}
          className="w-full bg-slate-900/50 border border-slate-700/50 rounded-xl ps-10 pe-3 h-11 text-sm text-white placeholder:text-slate-500 focus:outline-none focus:border-primary-600/50"
        />
      </div>

      {athletes.length === 0 ? (
        <EmptyState icon={Users} title={t('discoverEmpty')} className="py-8" />
      ) : (
        <div className="space-y-2">
          {athletes.map((a) => (
            <div
              key={a.id}
              className="flex items-center gap-3 bg-slate-800/50 rounded-2xl border border-slate-700/30 px-3 py-2.5"
            >
              <Link href={`/dashboard/teammate/${a.id}`} className="flex items-center gap-3 flex-1 min-w-0">
                <FeedAvatar name={a.name} url={a.avatarUrl} className="w-10 h-10 shrink-0" />
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-white truncate" dir="auto">{a.name}</p>
                  {a.groupName && <p className="text-2xs text-slate-500 truncate">{a.groupName}</p>}
                </div>
              </Link>
              <Button
                size="sm"
                variant={a.isFollowing ? 'secondary' : 'primary'}
                disabled={pending[a.id]}
                onClick={() => toggleFollow(a)}
                className={cn('shrink-0', a.isFollowing && 'opacity-80')}
              >
                {a.isFollowing ? t('discoverFollowing') : t('discoverFollow')}
              </Button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
