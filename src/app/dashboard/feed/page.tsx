'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import Link from 'next/link';
import { PenSquare, MessageSquare, AlertCircle, LogIn } from 'lucide-react';
import { getSupabase } from '@/lib/supabase/client';
import { useTranslations } from 'next-intl';
import { fetchFeed, deletePost } from '@/lib/feed-client';
import { FeedCard } from '@/components/FeedCard';
import { FeedCommentSheet } from '@/components/FeedCommentSheet';
import { FeedComposer } from '@/components/FeedComposer';
import { FeedAvatar } from '@/components/FeedAvatar';
import { SquadStandings } from '@/components/SquadStandings';
import { WeeklyLeaderboardCard } from '@/components/WeeklyLeaderboardCard';
import { EmptyState, Button, SkeletonList, Spinner } from '@/components/ui';
import type { FeedItem } from '@/lib/feed/project';

const PAGE_SIZE = 20;

// Last successfully loaded first page, kept in module scope (survives
// client-side navigation away and back, unlike component state). Feed's own
// fetch requires a real Supabase JWT (see feed-client.ts), so it can't go
// through useApi's shared x-user-email-based cache like the other pages —
// this is the same "instant paint from last-seen data" win without fighting
// that auth model. Purely a seed for initial state: loadInitial() below still
// runs on every mount and fully replaces it with fresh data, so pagination
// (loadMore) and optimistic mutations are untouched.
let lastFeedPage: { items: FeedItem[]; cursor: string | null } | null = null;

export default function FeedPage() {
  const t = useTranslations('feed');
  const [items, setItems] = useState<FeedItem[]>(() => lastFeedPage?.items ?? []);
  const [cursor, setCursor] = useState<string | null>(() => lastFeedPage?.cursor ?? null);
  const [loading, setLoading] = useState(() => !lastFeedPage);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [commentItem, setCommentItem] = useState<FeedItem | null>(null);
  const [deleteError, setDeleteError] = useState<string | null>(null);

  const [myName, setMyName] = useState('');
  const [myAthleteId, setMyAthleteId] = useState<string | null>(null);
  const [isStaff, setIsStaff] = useState(false);

  const sentinelRef = useRef<HTMLDivElement>(null);
  const hasMore = cursor !== null;

  // Pull-to-refresh (swipe down at the top of the feed) — the default native
  // expectation for a social feed, alongside the existing infinite-scroll-down
  // pagination. Passive touch tracking only (no preventDefault, which React 17+
  // makes a no-op on touchmove) — the pull is only armed when already scrolled
  // to the top, so the native rubber-band and this indicator move together.
  const [pullDistance, setPullDistance] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const pullStartYRef = useRef<number | null>(null);
  const PULL_THRESHOLD = 64;
  const PULL_MAX = 96;

  const handlePullStart = (e: React.TouchEvent) => {
    if (refreshing || window.scrollY > 0) return;
    pullStartYRef.current = e.touches[0].clientY;
  };
  const handlePullMove = (e: React.TouchEvent) => {
    if (pullStartYRef.current == null) return;
    if (window.scrollY > 0) { pullStartYRef.current = null; setPullDistance(0); return; }
    const delta = e.touches[0].clientY - pullStartYRef.current;
    setPullDistance(delta > 0 ? Math.min(delta * 0.5, PULL_MAX) : 0);
  };
  const handlePullEnd = async () => {
    if (pullStartYRef.current == null) return;
    pullStartYRef.current = null;
    if (pullDistance >= PULL_THRESHOLD) {
      setRefreshing(true);
      setPullDistance(PULL_THRESHOLD);
      await loadInitial();
      setRefreshing(false);
    }
    setPullDistance(0);
  };

  useEffect(() => {
    // Seed from localStorage for instant paint, then re-resolve from the live
    // session so a Dev identity switch can't leave a stale athlete_id around.
    const storedId = localStorage.getItem('athlete_id');
    const storedName = localStorage.getItem('athlete_name');
    if (storedId) setMyAthleteId(storedId);
    if (storedName) setMyName(storedName);
    if (localStorage.getItem('coach_email')) setIsStaff(true);

    getSupabase().auth.getSession().then(async ({ data }) => {
      const session = data.session;
      const email = session?.user?.email;
      const name = session?.user?.user_metadata?.full_name ||
        email?.split('@')[0] ||
        storedName ||
        '';
      if (name) setMyName(name);
      if (!email) return;

      try {
        const res = await fetch('/api/auth/resolve-role', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, name }),
        });
        if (!res.ok) return;
        const data = await res.json();
        const staff =
          data.role === 'admin' ||
          data.role === 'coach' ||
          data.role === 'academy_coach' ||
          !!data.coach ||
          !!localStorage.getItem('coach_email');
        setIsStaff(staff);
        if (staff) localStorage.setItem('coach_email', email);
        if (data.athlete?.id) {
          setMyAthleteId(data.athlete.id);
          localStorage.setItem('athlete_id', data.athlete.id);
          if (data.athlete.name) {
            setMyName(data.athlete.name);
            localStorage.setItem('athlete_name', data.athlete.name);
          }
          localStorage.setItem('athlete_email', data.athlete.email || email);
        }
      } catch { /* keep localStorage fallback */ }
    });
  }, []);

  const loadInitial = useCallback(async () => {
    // Skip the loading gate when a cached page is already on screen — pull-to-
    // refresh/retry then just swap fresh content in behind the existing list
    // instead of flashing back to a blank skeleton.
    if (!lastFeedPage) setLoading(true);
    setError(null);
    try {
      const { items: page, nextCursor } = await fetchFeed(null, PAGE_SIZE);
      setItems(page);
      setCursor(nextCursor);
      lastFeedPage = { items: page, cursor: nextCursor };
    } catch (err: unknown) {
      setError((err as Error).message || t('loadError'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !cursor) return;
    setLoadingMore(true);
    try {
      const { items: page, nextCursor } = await fetchFeed(cursor, PAGE_SIZE);
      setItems(prev => [...prev, ...page]);
      setCursor(nextCursor);
    } catch { /* silent — user can scroll again */ }
    finally { setLoadingMore(false); }
  }, [loadingMore, cursor]);

  useEffect(() => { loadInitial(); }, [loadInitial]);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(entries => {
      if (entries[0].isIntersecting && hasMore && !loadingMore && !loading) {
        loadMore();
      }
    }, { rootMargin: '200px' });
    obs.observe(el);
    return () => obs.disconnect();
  }, [hasMore, loadingMore, loading, loadMore]);

  const handleDelete = async (item: FeedItem) => {
    try {
      await deletePost(item.id);
      setItems(prev => {
        const next = prev.filter(i => i.id !== item.id);
        if (lastFeedPage) lastFeedPage = { ...lastFeedPage, items: next };
        return next;
      });
    } catch (err: unknown) {
      setDeleteError((err as Error).message || t('deleteError'));
      setTimeout(() => setDeleteError(null), 4000);
    }
  };

  const handleCommentClose = (itemId: string, newCount: number) => {
    setItems(prev => {
      const next = prev.map(item => (
        item.id === itemId ? { ...item, commentCount: newCount } : item
      ));
      if (lastFeedPage) lastFeedPage = { ...lastFeedPage, items: next };
      return next;
    });
    setCommentItem(null);
  };

  const handlePost = (newItem: FeedItem) => {
    setItems(prev => {
      const next = [newItem, ...prev];
      if (lastFeedPage) lastFeedPage = { ...lastFeedPage, items: next };
      return next;
    });
  };

  return (
    <div
      className="max-w-xl mx-auto"
      onTouchStart={handlePullStart}
      onTouchMove={handlePullMove}
      onTouchEnd={handlePullEnd}
    >
      {/* Pull-to-refresh affordance — grows with the swipe, shows a spinner
          while `refreshing` runs loadInitial(). */}
      <div
        className="flex items-center justify-center overflow-hidden transition-[height,opacity] duration-150"
        style={{ height: pullDistance, opacity: Math.min(pullDistance / PULL_THRESHOLD, 1) }}
      >
        <Spinner size={22} />
      </div>

      {/* ═══ SQUAD RIVALRY + WEEKLY LEADERBOARD — moved here from the (now
          hero-only) home page. Feed is where "how's everyone doing" content
          belongs; home is only "what do I do today". ═══ */}
      <div className="mb-4">
        <SquadStandings />
      </div>
      {!isStaff && (
        <div className="mb-4">
          <WeeklyLeaderboardCard athleteId={myAthleteId} />
        </div>
      )}

      <div
        className="mb-4 bg-slate-800/50 rounded-2xl border border-slate-700/30 p-3 flex items-center gap-3 cursor-pointer hover:bg-slate-800/70 transition-colors active:scale-[0.98]"
        onClick={() => setComposerOpen(true)}
      >
        <FeedAvatar
          name={myName}
          url={null}
          className="w-9 h-9 bg-primary-600/20"
          textClassName="text-primary-400"
        />
        <span className="flex-1 text-sm text-slate-500">{t('composerPlaceholder')}</span>
        <PenSquare className="h-4 w-4 text-slate-600" />
      </div>

      {deleteError && (
        <div className="mb-3 bg-red-900/20 border border-red-700/30 rounded-2xl px-4 py-3 text-center">
          <p className="text-sm text-red-400">{deleteError}</p>
        </div>
      )}

      {loading && <SkeletonList count={3} />}

      {/* NOT_SIGNED_IN specifically means the Supabase session itself expired
          (this feed API requires a real JWT, not just cached localStorage
          identity, so comments/posts can't be spoofed as someone else) —
          "Try again" would just fail the same way, so this case gets its own
          message and a real way out instead of the raw error code. */}
      {!loading && error === 'NOT_SIGNED_IN' && (
        <EmptyState
          icon={LogIn}
          title={t('sessionExpiredTitle')}
          description={t('sessionExpiredBody')}
          action={<Link href="/"><Button>{t('signInAgain')}</Button></Link>}
        />
      )}

      {!loading && error && error !== 'NOT_SIGNED_IN' && (
        <EmptyState
          icon={AlertCircle}
          title={error}
          action={<Button onClick={loadInitial}>{t('retry')}</Button>}
        />
      )}

      {!loading && !error && items.length === 0 && (
        <EmptyState icon={MessageSquare} title={t('emptyTitle')} description={t('emptyBody')} />
      )}

      {!loading && items.length > 0 && (
        <div className="space-y-3">
          {items.map(item => (
            <FeedCard
              key={item.id}
              item={item}
              commentCount={item.commentCount}
              myAthleteId={myAthleteId}
              isStaff={isStaff}
              onComment={i => setCommentItem(i)}
              onDelete={handleDelete}
            />
          ))}
        </div>
      )}

      <div ref={sentinelRef} className="h-1" />

      {loadingMore && (
        <div className="flex justify-center py-6">
          <Spinner size={20} />
        </div>
      )}

      {!hasMore && items.length > 0 && (
        <p className="text-center text-xs text-slate-600 py-6">{t('allLoaded')} ✓</p>
      )}

      {commentItem && (
        <FeedCommentSheet
          item={commentItem}
          onClose={count => handleCommentClose(commentItem.id, count)}
        />
      )}

      {composerOpen && (
        <FeedComposer
          onClose={() => setComposerOpen(false)}
          onPost={handlePost}
        />
      )}
    </div>
  );
}
