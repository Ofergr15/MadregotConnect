'use client';

import { useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Trophy } from 'lucide-react';
import { useApi } from '@/lib/api';
import { SkeletonList, SegmentedControl, EmptyState } from '@/components/ui';
import { AthleteLink } from '@/components/AthleteLink';
import { formatTime } from '@/lib/academy/benchmark';
import { cn } from '@/lib/utils';

/**
 * The club records board — one ranked table per distance.
 *
 * Asked for twice in the same words: "it'd be nice to have a table with
 * everyone's records" (a798197f) and "tables with everyone's personal records by
 * distance" (f6c7b8dc). Until now a PR only existed on one profile at a time.
 *
 * ── ONE TABLE AT A TIME, NOT FOUR STACKED ───────────────────────────────────
 * Four full tables down one phone screen means the marathon board is three
 * scrolls below the fold, and the question anyone actually arrives with is about
 * one distance. So the buckets are a segmented control and the table under it is
 * whole — with the reader's own row marked, because "where am I in this" is the
 * second question and nobody should have to hunt their own name.
 *
 * Every row links to that teammate's profile via AthleteLink, so the board is
 * also a way into the club rather than a dead end.
 */

interface Entry {
  athleteId: string;
  name: string;
  seconds: number;
  date: string | null;
  activityId: string | null;
  activityName: string | null;
  fromSegment: boolean;
  source: 'auto' | 'manual';
  note: string | null;
}

interface Bucket {
  key: string;
  label: string;
  meters: number;
  entries: Entry[];
}

/** Year only. A record's day is noise in a ranked list; the year is context. */
function recordYear(date: string | null): string {
  return date ? date.slice(0, 4) : '';
}

export default function ClubRecordsPage() {
  const t = useTranslations('records');
  const { data } = useApi<{ buckets?: Bucket[]; computedAt?: string; athleteCount?: number }>('/api/club/records');
  // Memoised, not `data?.buckets || []`: a fresh [] every render would be a new
  // dependency for the useMemo below on every render.
  const buckets = useMemo(() => data?.buckets || [], [data]);
  const loading = !data;

  const [active, setActive] = useState('5k');
  const [me, setMe] = useState<string | null>(null);
  useEffect(() => setMe(localStorage.getItem('athlete_id')), []);

  const bucket = useMemo(() => buckets.find((b) => b.key === active) || buckets[0], [buckets, active]);

  return (
    <div className="max-w-2xl mx-auto">
      <div className="mb-5">
        <h1 className="flex items-center gap-2 text-3xl font-extrabold tracking-tight text-ink-700">
          <Trophy className="h-6 w-6 text-brand-600" /> {t('title')}
        </h1>
        <p className="mt-1 text-sm text-ink-400">{t('subtitle')}</p>
      </div>

      {loading ? (
        <SkeletonList count={6} />
      ) : buckets.length === 0 ? (
        <EmptyState icon={Trophy} title={t('empty')} />
      ) : (
        <>
          <SegmentedControl
            value={bucket?.key || '5k'}
            onChange={setActive}
            options={buckets.map((b) => ({ value: b.key, label: t(`bucket_${b.key}` as never) }))}
            className="mb-4"
          />

          {!bucket || bucket.entries.length === 0 ? (
            <EmptyState icon={Trophy} title={t('emptyBucket')} />
          ) : (
            <div className="overflow-hidden rounded-card border border-page/50 bg-card/50">
              {bucket.entries.map((entry, index) => (
                <RecordRow key={entry.athleteId} entry={entry} rank={index + 1} isMe={entry.athleteId === me} />
              ))}
            </div>
          )}

          {/* Said plainly rather than hidden: the board is a snapshot, so a run
              from this morning may not be on it yet, and a member comparing it
              with their own profile deserves to know why. */}
          <p className="mt-3 px-1 text-3xs text-ink-400">{t('derivedNote')}</p>
        </>
      )}
    </div>
  );
}

function RecordRow({ entry, rank, isMe }: { entry: Entry; rank: number; isMe: boolean }) {
  const t = useTranslations('records');
  const year = recordYear(entry.date);

  return (
    <div
      className={cn(
        'flex items-center gap-3 border-b border-page/50 px-4 py-3 last:border-b-0',
        isMe && 'bg-brand-600/5',
      )}
    >
      <span
        className={cn(
          'w-6 shrink-0 text-center text-sm font-extrabold tabular-nums',
          rank === 1 ? 'text-brand-600' : 'text-ink-400',
        )}
      >
        {rank}
      </span>

      <div className="min-w-0 flex-1">
        <AthleteLink athleteId={entry.athleteId} name={entry.name} className="block truncate text-sm font-bold text-ink-700">
          {entry.name}
        </AthleteLink>
        <p className="truncate text-3xs text-ink-400">
          {entry.source === 'manual'
            ? entry.note || t('stated')
            : entry.activityName || t('fromRuns')}
        </p>
      </div>

      <div className="shrink-0 text-end">
        {/* dir="ltr": a time is not RTL text — bidi moves the colon. */}
        <span dir="ltr" className="block text-base font-extrabold tabular-nums text-ink-700">
          {formatTime(entry.seconds)}
        </span>
        {year && <span className="block text-3xs text-ink-400 tabular-nums">{year}</span>}
      </div>
    </div>
  );
}
