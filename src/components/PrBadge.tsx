'use client';

import { useMemo } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Trophy } from 'lucide-react';
import { useApi } from '@/lib/api';
import { prRunsByActivity, type RecordBucketLike } from '@/lib/prs/pr-runs';

/**
 * The runs that hold a personal record (feedback #90; for everyone since 2026-10-16,
 * super user only before). One request for the whole feed: SWR shares it between cards, and
 * the route answers from the cached records row. That row is refreshed a few times
 * a day, so a record set this morning can take a few hours to earn its badge.
 */
export function usePrRuns(): Map<string, string[]> {
  const { data } = useApi<{ buckets?: RecordBucketLike[] }>('/api/club/records');
  return useMemo(() => prRunsByActivity(data?.buckets), [data]);
}

export function PrBadge({ buckets, href }: {
  buckets: string[] | undefined;
  /**
   * Where a tap goes — the record's timeline. Only where the badge is not already
   * inside a link: on the run page, not on a feed card (the whole card opens the run).
   */
  href?: string;
}) {
  const t = useTranslations('records');
  if (!buckets?.length) return null;
  const badge = (
    <span
      className="inline-flex shrink-0 items-center gap-1 rounded-full bg-gradient-to-b from-amber-300 to-amber-500 px-2.5 py-1 text-2xs font-extrabold text-amber-950 shadow-sm ring-1 ring-amber-600/30"
      aria-label={t('prBadgeAria', { buckets: buckets.map(b => t(`bucket_${b}`)).join(', ') })}
    >
      <Trophy className="h-3.5 w-3.5" aria-hidden />
      {t('prBadge')}
      <span className="font-bold opacity-80">{buckets.map(b => t(`bucket_${b}`)).join(' · ')}</span>
      {href && <span aria-hidden className="font-black">‹</span>}
    </span>
  );
  return href
    // The badge is drawn small; the target is not (44px, through the halo).
    ? <Link href={href} className="relative inline-flex after:absolute after:-inset-2.5 after:content-[''] active:opacity-70">{badge}</Link>
    : badge;
}
