'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Trophy } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import { FeedAvatar } from '@/components/FeedAvatar';
import { SegmentedControl } from '@/components/ui';
import { apiHeaders, useApi } from '@/lib/api';

interface Props {
  athleteId: string | null;
}

interface Entry {
  id: string;
  name: string;
  groupId: string;
  distanceKm: number;
  runs: number;
}

// Gold/silver/bronze. Emoji rather than colour tokens on purpose: the palette
// has no medal colours — `band-1/2/3` are the three דבוקה squad colours, and
// the old podium borrowed `band-3` (the orange squad) as "gold" and `ink-300`
// as "silver", which is why 2nd place came out grey while 3rd came out orange.
// The card already speaks emoji (🏆 in the header, 👑 on the leader).
const MEDALS = ['🥇', '🥈', '🥉'];

// The club's week, ranked, filterable by squad.
//
// Rebuilt from a three-column podium whose bar heights were hardcoded 70/50/35px
// — rank, not distance, so 174.5 / 138.1 / 115.9 always drew the same three
// bars and the one quantitative channel in the chart carried no information.
// Rows with proportional bars fix that, and fix three other things the podium
// could not: names no longer have to fit a 56px column, the fourth-place reader
// gets a real row instead of a stranded "You: #14" line, and the layout has no
// intrinsic width so it survives a 320pt screen.
//
// Lives on the dashboard (לוח בקרה) rather than the feed — it is the club's
// standings, which is what that screen is for.
export function WeeklyLeaderboardCard({ athleteId }: Props) {
  const t = useTranslations('dashboard');
  const tc = useTranslations('common');
  const [leaderboard, setLeaderboard] = useState<Entry[]>([]);
  const [filter, setFilter] = useState<'all' | string>('all');
  // Group names for the filter chips. Same SWR key the Header uses on every
  // screen, so this reads the cache instead of re-running a 4KB groups+athletes
  // join for three labels.
  const { data: groupsData } = useApi<{ groups?: Array<{ id: string; name: string }> } | Array<{ id: string; name: string }>>('/api/groups');
  const groups = Array.isArray(groupsData) ? groupsData : (groupsData?.groups || []);

  // Not gated on `athleteId`. The standings are club-wide, and a coach without
  // an athlete profile of their own has none — the old guard meant the card
  // silently never loaded for exactly the people whose screen this is. All
  // `athleteId` decides is whose row gets highlighted.
  useEffect(() => {
    (async () => {
      try {
        // Session-gated, so resolve the bearer header first. The leaderboard is
        // aggregated server-side — this card downloads no activities of its own.
        const headers = await apiHeaders();
        const res = await fetch('/api/groups/leaderboard', { headers });
        if (res.ok) setLeaderboard((await res.json()).leaderboard || []);
      } catch { /* best-effort — section just hides if nothing loads */ }
    })();
  }, []);

  if (leaderboard.length === 0) return null;

  const ranked = filter === 'all' ? leaderboard : leaderboard.filter(a => a.groupId === filter);
  const top3 = ranked.slice(0, 3);
  const myRank = ranked.findIndex(a => a.id === athleteId) + 1;
  const me = myRank > 3 ? ranked[myRank - 1] : null;
  // Every bar is a share of the leader's week, so the top row is always full.
  const leaderKm = top3[0]?.distanceKm || 1;

  // "Group 1" → "קבוצה 1". Anything that isn't the seeded English name (a real
  // squad name, "SUB 2:30") is already what the coach typed and is left alone.
  // The chips used to be `name.replace('Group ', '')`, i.e. three bare digits
  // sitting directly above a podium — unreadable as a filter, and easy to read
  // as the rank labels they were adjacent to.
  const chipLabel = (name: string) => {
    const m = /^Group\s+(.+)$/.exec(name);
    return m ? t('groupLabel', { name: m[1] }) : name;
  };

  const row = (a: Entry, badge: React.ReactNode, isMe: boolean) => (
    <li key={a.id} className="flex items-center gap-2.5">
      <span className="w-6 shrink-0 text-center text-base leading-none">{badge}</span>
      <FeedAvatar name={a.name} url={null} className="w-8 h-8" textClassName="text-2xs" />
      <div className="flex-1 min-w-0">
        <div className="flex items-baseline gap-2">
          <Link
            href={`/dashboard/teammate/${a.id}`}
            dir="auto"
            className={cn(
              'text-sm truncate rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600',
              isMe ? 'font-black text-brand-600' : 'font-bold text-ink-700',
            )}
          >
            {a.name}
          </Link>
          {a.runs > 0 && (
            <span className="text-3xs text-ink-400 shrink-0">{t('runsCount', { count: a.runs })}</span>
          )}
          {/* dir="ltr" so the unit stays to the right of its number instead of
              bidi parking it on the far side of the row. */}
          <span dir="ltr" className="ms-auto shrink-0 text-sm font-black text-ink-700 tabular-nums">
            {a.distanceKm}
            <span className="ms-1 text-3xs font-bold text-ink-400">{tc('km')}</span>
          </span>
        </div>
        <div className="mt-1.5 h-1.5 rounded-full bg-page overflow-hidden">
          <div
            className={cn('h-full rounded-full transition-all', isMe ? 'bg-brand-600' : 'bg-[#fc5200]')}
            style={{
              width: `${Math.max(4, Math.min(100, (a.distanceKm / leaderKm) * 100))}%`,
              // The leader is the reference, so only they get the full-strength
              // fill; everyone else reads as a share of it.
              opacity: isMe || a.distanceKm === leaderKm ? 1 : 0.55,
            }}
          />
        </div>
      </div>
    </li>
  );

  return (
    <section className="bg-card rounded-card border border-page p-4 sm:p-5">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-4">
        <div className="flex items-center gap-1.5">
          <Trophy className="h-3.5 w-3.5 text-band-3" />
          <span className="text-xs font-semibold uppercase tracking-wider text-ink-400">{t('top3')}</span>
        </div>
        {groups.length > 1 && (
          <SegmentedControl
            value={filter}
            onChange={setFilter}
            options={[
              { value: 'all', label: tc('all') },
              ...groups.map(g => ({ value: g.id, label: chipLabel(g.name) })),
            ]}
          />
        )}
      </div>

      {top3.length === 0 ? (
        <p className="text-sm text-ink-400 text-center py-4">{t('noLeaderboardYet')}</p>
      ) : (
        <ul className="space-y-3">
          {top3.map((a, i) => row(a, MEDALS[i], a.id === athleteId))}
          {/* Outside the top three, the reader gets their own row on the same
              scale rather than a bare "You: #14" caption under the chart. */}
          {me && (
            <>
              <li className="border-t border-page pt-3 -mb-1" aria-hidden="true" />
              {row(me, <span className="text-xs font-black text-ink-400 tabular-nums">{myRank}</span>, true)}
            </>
          )}
        </ul>
      )}
    </section>
  );
}
