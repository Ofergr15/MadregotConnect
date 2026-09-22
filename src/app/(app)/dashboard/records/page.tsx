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
          <p className="mt-3 px-1 text-2xs text-ink-400">{t('derivedNote')}</p>
        </>
      )}
    </div>
  );
}

function RecordRow({ entry, rank, isMe }: { entry: Entry; rank: number; isMe: boolean }) {
  const t = useTranslations('records');
  const year = recordYear(entry.date);

  return (
    // The WHOLE row is the link, not just the name.
    //
    // The docblock above already promises "every row links to that teammate's
    // profile … rather than a dead end", but the anchor was wrapped around the
    // name text alone: `block truncate text-sm font-bold`, which measured
    // 237×20px at 393px and 219×20px at 375px. 20px of height is under half the
    // 44px floor, on a list whose whole purpose is to be tapped, and the row
    // read as tappable everywhere (the rank, the time, the run name) while only
    // one 20px strip of it was.
    //
    // Nothing else in the row is interactive, so there is no nesting problem and
    // no need for the `role="button"` treatment InsetList documents — a real
    // anchor spanning the row is both correct and 52px tall for free (py-3 plus
    // the two text lines). The name below is now a plain span: it is the link's
    // visible content, and AthleteLink already carries the accessible name.
    <AthleteLink
      athleteId={entry.athleteId}
      name={entry.name}
      className={cn(
        'flex items-center gap-3 border-b border-page/50 px-4 py-3 last:border-b-0 transition-colors active:bg-page/60',
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

      {/* Spans and not divs/paragraphs: the fallback branch of AthleteLink (an
          athlete with no id) renders a <span>, and a <div>/<p> inside a <span>
          is invalid markup React will complain about in the console. */}
      <span className="block min-w-0 flex-1">
        <span className="block truncate text-sm font-bold text-ink-700" dir="auto">{entry.name}</span>
        {/* 11px and not 10: where the record came from is DATA — a different
            string every row, decoded every time — and it was the smallest type
            on the screen. The hierarchy that made it small is still intact: the
            time next to it is 16px extra-bold, so the row still reads
            time-first. Same reason for the year below. */}
        <span className="block truncate text-2xs text-ink-400" dir="auto">
          {entry.source === 'manual'
            ? entry.note || t('stated')
            : entry.activityName || t('fromRuns')}
        </span>
      </span>

      <span className="block shrink-0 text-end">
        {/* dir="ltr": a time is not RTL text — bidi moves the colon. */}
        <span dir="ltr" className="block text-base font-extrabold tabular-nums text-ink-700">
          {formatTime(entry.seconds)}
        </span>
        {year && <span className="block text-2xs text-ink-400 tabular-nums">{year}</span>}
      </span>
    </AthleteLink>
  );
}
