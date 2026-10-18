'use client';

import { Fragment, useCallback, useEffect, useRef, useState } from 'react';
import { useFormatter, useTranslations } from 'next-intl';
import { Loader2 } from 'lucide-react';
import { cn, dayKeyRelation, dayKeyToDate, feedDayKey } from '@/lib/utils';
import { deletePost, fetchFeed } from '@/lib/feed-client';
import type { FeedItem } from '@/lib/feed/project';
import type { FeedComment } from '@/lib/feed/comments';
import { FeedCard } from '@/components/FeedCard';
import { FeedCommentSheet } from '@/components/FeedCommentSheet';

// The profile's Activity tab: the feed, filtered to one athlete.
//
// The SAME FeedCard the club feed draws — map, plan verdict, likes, comments,
// share — so a run reads identically wherever it is, and a like or a comment
// made here is the one the feed shows. It replaced the profile's plain runs
// list, which showed a name and three numbers and led nowhere (#113).
//
// Not GroupRunCard: a group run folds teammates' runs into one card, and on
// one athlete's page the teammates aren't in the list to fold.

const PAGE_SIZE = 10;

const FILTERS = [
  { key: 'all', labelKey: 'filterAll', types: [] as string[] },
  { key: 'runs', labelKey: 'filterRuns', types: ['activity'] },
  { key: 'social', labelKey: 'filterSocial', types: ['post', 'achievement'] },
] as const;
type FilterKey = (typeof FILTERS)[number]['key'];

function DayHeading({ dayKey }: { dayKey: string }) {
  const t = useTranslations('feed');
  const format = useFormatter();
  const relation = dayKeyRelation(dayKey);
  const label =
    relation === 'today'
      ? t('dayToday')
      : relation === 'yesterday'
        ? t('dayYesterday')
        : format.dateTime(dayKeyToDate(dayKey), { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC' });
  return (
    <div className="flex items-center gap-3 pt-1">
      <span className="text-xs font-semibold text-ink-400">{label}</span>
      <span className="h-px flex-1 bg-ink-300/40" />
    </div>
  );
}

export function ProfileActivityFeed({ athleteId, runsOnly = false }: {
  athleteId: string;
  /** "הריצות שלי" (2026-10-19): the feed with the runs alone, and no filter row. */
  runsOnly?: boolean;
}) {
  const t = useTranslations('feed');
  const tp = useTranslations('profile');
  // Same source the feed screen reads its viewer from, so ownership (delete,
  // share) and staff powers match it exactly.
  const stored = (k: string) => { try { return typeof window === 'undefined' ? null : localStorage.getItem(k); } catch { return null; } };
  const [myAthleteId] = useState<string | null>(() => stored('athlete_id'));
  const [isStaff] = useState(() => !!stored('coach_email'));

  const [filter, setFilter] = useState<FilterKey>(runsOnly ? 'runs' : 'all');
  const [items, setItems] = useState<FeedItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [commentItem, setCommentItem] = useState<FeedItem | null>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);
  const seq = useRef(0);
  const types = FILTERS.find((f) => f.key === filter)!.types;

  const loadFirst = useCallback(async () => {
    const mine = ++seq.current;
    setLoading(true);
    setError(null);
    try {
      const page = await fetchFeed(null, PAGE_SIZE, types, null, athleteId);
      if (mine !== seq.current) return;
      setItems(page.items);
      setCursor(page.nextCursor);
    } catch (e) {
      if (mine === seq.current) setError((e as Error).message || t('loadError'));
    } finally {
      if (mine === seq.current) setLoading(false);
    }
    // `types` is derived from `filter`.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [athleteId, filter, t]);

  useEffect(() => { loadFirst(); }, [loadFirst]);

  const loadMore = useCallback(async () => {
    if (loadingMore || loading || !cursor) return;
    const mine = seq.current;
    setLoadingMore(true);
    try {
      const page = await fetchFeed(cursor, PAGE_SIZE, types, null, athleteId);
      if (mine !== seq.current) return;
      setItems((prev) => [...prev, ...page.items]);
      setCursor(page.nextCursor);
    } catch { /* silent — scrolling again retries */ }
    finally { setLoadingMore(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cursor, loadingMore, loading, athleteId, filter]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver((entries) => {
      if (entries[0].isIntersecting) loadMore();
    }, { rootMargin: '300px' });
    obs.observe(el);
    return () => obs.disconnect();
  }, [loadMore]);

  const handleDelete = useCallback(async (item: FeedItem) => {
    try {
      await deletePost(item.id);
      setItems((prev) => prev.filter((i) => i.id !== item.id));
    } catch (e) {
      setError((e as Error).message || t('deleteError'));
    }
  }, [t]);

  const handleCommentClose = (itemId: string, count: number, latest: FeedComment[]) => {
    setItems((prev) => prev.map((i) => (i.id === itemId ? { ...i, commentCount: count, commentPreview: latest } : i)));
    setCommentItem(null);
  };

  let lastDay = '';
  return (
    <div className="space-y-3">
      <div className={cn('flex gap-1.5', runsOnly && 'hidden')}>
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            aria-pressed={filter === f.key}
            className={cn(
              'h-[30px] rounded-pill px-3 text-xs font-bold transition-colors',
              filter === f.key ? 'bg-brand-600/10 text-brand-600' : 'bg-card text-ink-500',
            )}
          >
            {t(f.labelKey)}
          </button>
        ))}
      </div>

      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="h-5 w-5 animate-spin text-ink-400" /></div>
      ) : error && items.length === 0 ? (
        <div className="rounded-card bg-card p-5 text-center">
          <p className="text-sm text-ink-500">{error}</p>
          <button type="button" onClick={loadFirst} className="mt-3 text-sm font-bold text-brand-600">{t('retry')}</button>
        </div>
      ) : items.length === 0 ? (
        <p className="rounded-card bg-card p-5 text-center text-sm font-light text-ink-400">{tp('activityEmpty')}</p>
      ) : (
        items.map((item) => {
          const day = feedDayKey(item.occurredAt, item.activity?.startTime);
          const opensDay = day !== lastDay;
          lastDay = day;
          return (
            <Fragment key={item.id}>
              {opensDay && <DayHeading dayKey={day} />}
              <FeedCard
                item={item}
                commentCount={item.commentCount}
                myAthleteId={myAthleteId}
                isStaff={isStaff}
                onComment={setCommentItem}
                onDelete={handleDelete}
              />
            </Fragment>
          );
        })
      )}

      <div ref={sentinelRef} aria-hidden="true" />
      {loadingMore && (
        <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-ink-400" /></div>
      )}

      {commentItem && (
        <FeedCommentSheet
          item={commentItem}
          myAthleteId={myAthleteId}
          onClose={(count, latest) => handleCommentClose(commentItem.id, count, latest)}
        />
      )}
    </div>
  );
}
