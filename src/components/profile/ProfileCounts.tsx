'use client';

import { useTranslations } from 'next-intl';
import { useApi } from '@/lib/api';
import { cn } from '@/lib/utils';

// The profile's count row: runs this year · km this year · followers · following.
//
// Replaced the stat trio (followers · following · all-time km). The year is the
// number people compare — "how much have you run this year" — and all-time km
// didn't go anywhere: it's the line under the ten-week chart now.
//
// Reads the same two SWR keys AthleteProfileBody does, built byte-identically,
// so rendering it in the owner's header costs no extra request.

interface StatsSlice {
  yearKm?: number;
  yearRuns?: number;
}

interface Connections {
  followerCount: number;
  followingCount: number;
}

export function ProfileCounts({
  athleteId,
  viewerId,
  onFollowersClick,
  onFollowingClick,
  className,
}: {
  athleteId: string;
  /** Same meaning as on AthleteProfileBody — only shapes the connections key. */
  viewerId?: string;
  onFollowersClick?: () => void;
  onFollowingClick?: () => void;
  className?: string;
}) {
  const t = useTranslations('profile');
  const tt = useTranslations('teammate');
  const { data: stats } = useApi<StatsSlice>(athleteId ? `/api/athletes/${athleteId}/stats` : null);
  const { data: connections } = useApi<Connections>(
    athleteId
      ? `/api/athletes/${athleteId}/connections${viewerId ? `?viewerId=${encodeURIComponent(viewerId)}` : ''}`
      : null,
  );

  return (
    <div className={cn('grid grid-cols-4 [&>*+*]:border-s [&>*+*]:border-ink-300/60', className)}>
      <CountCell value={stats?.yearRuns} label={t('yearRuns')} />
      <CountCell value={stats?.yearKm} label={t('yearKm')} />
      <CountCell value={connections?.followerCount} label={tt('followers')} onClick={onFollowersClick} />
      <CountCell value={connections?.followingCount} label={tt('following')} onClick={onFollowingClick} />
    </div>
  );
}

function CountCell({ value, label, onClick }: { value: number | undefined; label: string; onClick?: () => void }) {
  const body = (
    <>
      <span className="block text-base font-black tabular-nums text-ink-700">
        {value == null ? '–' : value.toLocaleString('en-US')}
      </span>
      <span className="block truncate text-3xs font-light text-ink-400">{label}</span>
    </>
  );
  // A count with nowhere to go stays a div — see TrioCell, which this replaced.
  return onClick ? (
    <button type="button" onClick={onClick} className="min-w-0 px-1 text-center active:opacity-70">
      {body}
    </button>
  ) : (
    <div className="min-w-0 px-1 text-center">{body}</div>
  );
}
