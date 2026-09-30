'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import { Trophy } from 'lucide-react';
import { useApi } from '@/lib/api';
import { useIsSuperUser } from '@/lib/impersonation';
import { prRunsByActivity, type RecordBucketLike } from '@/lib/prs/pr-runs';

/**
 * The runs that hold a personal record, for the super user only until rollout
 * (feedback #90). One request for the whole feed: SWR shares it between cards, and
 * the route answers from the cached records row. That row is refreshed a few times
 * a day, so a record set this morning can take a few hours to earn its badge.
 */
export function usePrRuns(): Map<string, string[]> {
  const superUser = useIsSuperUser();
  const { data } = useApi<{ buckets?: RecordBucketLike[] }>(superUser ? '/api/club/records' : null);
  return useMemo(() => prRunsByActivity(data?.buckets), [data]);
}

export function PrBadge({ buckets }: { buckets: string[] | undefined }) {
  const t = useTranslations('records');
  if (!buckets?.length) return null;
  return (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-gradient-to-b from-amber-300 to-amber-500 px-2.5 py-1 text-2xs font-extrabold text-amber-950 shadow-sm ring-1 ring-amber-600/30"
      aria-label={t('prBadgeAria', { buckets: buckets.map(b => t(`bucket_${b}`)).join(', ') })}
    >
      <Trophy className="h-3.5 w-3.5" aria-hidden />
      {t('prBadge')}
      <span className="font-bold opacity-80">{buckets.map(b => t(`bucket_${b}`)).join(' · ')}</span>
    </span>
  );
}
