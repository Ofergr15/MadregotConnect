'use client';

import { Fragment, useState, useEffect, useRef, useCallback, useMemo } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { PenSquare, MessageSquare, AlertCircle, LogIn, Star, X } from 'lucide-react';
import { getSupabase } from '@/lib/supabase/client';
import { useTranslations, useFormatter } from 'next-intl';
import { cn, dayKeyRelation, dayKeyToDate, feedDayKey, resolveGroup } from '@/lib/utils';
import { useApi } from '@/lib/api';
import { fetchFeed, deletePost, fetchFeedItem, fetchFeedItemByActivity } from '@/lib/feed-client';
import { feedFocusFromParams } from '@/lib/feed/deep-link';
import { FAVORITES_SQUAD } from '@/lib/feed/squad-filter';
import { FeedCard } from '@/components/FeedCard';
import { FeedCommentSheet } from '@/components/FeedCommentSheet';
import { FeedComposer } from '@/components/FeedComposer';
import { FeedAvatar } from '@/components/FeedAvatar';
import { FeedHighlightCard } from '@/components/FeedHighlightCard';
import { GroupRunCard } from '@/components/GroupRunCard';
import { groupFeedItems } from '@/lib/feed/group-runs';
import { SquadStandings } from '@/components/SquadStandings';
import { UpcomingEvents } from '@/components/UpcomingEvents';
import { SetupNudgeCard } from '@/components/onboarding/SetupNudgeCard';
import { WeekSummaryCard } from '@/components/feed/WeekSummaryCard';
import { NextSessionCard } from '@/components/feed/NextSessionCard';
import { EmptyState, Button, SkeletonList, Spinner } from '@/components/ui';
import type { FeedItem } from '@/lib/feed/project';
import type { FeedComment } from '@/lib/feed/comments';
import { appScrollTop } from '@/lib/app-scroll';

const PAGE_SIZE = 20;

/**
 * The filter chips above the list. `types` is empty for "everything"; the rest
 * map onto GET /api/feed's whitelisted `types` param so the narrowing happens in
 * the query. Filtering an already-fetched page client-side would show nothing
 * whenever the newest 20 items are all runs — which on an active club is most
 * days.
 */
const FILTERS = [
  { key: 'all', labelKey: 'filterAll', types: [] },
  { key: 'runs', labelKey: 'filterRuns', types: ['activity'] },
  { key: 'social', labelKey: 'filterSocial', types: ['post', 'achievement', 'announcement', 'new_plan'] },
] as const satisfies ReadonlyArray<{ key: string; labelKey: string; types: readonly string[] }>;

type FilterKey = (typeof FILTERS)[number]['key'];

/**
 * The squad chips, a second axis under the type chips (373ebe89: "add a filter on
 * the feed by squad 1/2/3/academy").
 *
 * A SECOND ROW rather than four more chips in the first one: the two questions are
 * independent — "just the runs, from my squad" is a real thing to ask — and seven
 * chips on one line wraps on a 352 px phone into something that reads like one
 * flat list of seven alternatives, which is exactly what it isn't.
 *
 * The list comes from /api/groups, which the Header already loads on every page,
 * so the chips cost nothing extra. `academy` is appended by hand because academy
 * membership is a flag and not a group — see lib/feed/squad-filter.ts.
 */
const ACADEMY_CHIP = 'academy';

/**
 * How many flagged athletes the academy needs before the feed offers to filter to
 * it (aae77577). One is the club's testing state, not an academy.
 */
const MIN_ACADEMY_FOR_CHIP = 2;

/**
 * One squad chip. Same shape as the type chips above it, with the squad's own
 * colour as the selected fill so the three דבוקות stay the colours they are
 * everywhere else in the app (GROUP_HEX via resolveGroup) — a squad filter that
 * highlighted in the app's ink would be the one place in the product where a
 * squad has no colour.
 */
function SquadChip({
  active,
  onClick,
  label,
  hex,
  icon: Icon,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  hex?: string;
  /** Only the favourites chip uses one — see the chip row below. */
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      // shrink-0: the row scrolls horizontally, so a chip must keep its own width
      // rather than being squeezed into an ellipsis by its neighbours.
      className={cn(
        'shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors',
        Icon && 'inline-flex items-center gap-1',
        active
          ? hex
            ? 'text-card'
            : 'bg-ink-700 text-card'
          : 'border border-page bg-card text-ink-400 hover:text-ink-500',
      )}
      style={active && hex ? { backgroundColor: hex } : undefined}
    >
      {Icon && <Icon className={cn('h-3 w-3', active && 'fill-current')} />}
      {label}
    </button>
  );
}

/**
 * A date rule between days, so a long scroll reads as "Today / Yesterday /
 * Tuesday 2 September" instead of one undifferentiated stack of cards. The label
 * goes through the locale formatter rather than the hardcoded en-US of
 * `formatActivityDate`, so a Hebrew reader gets Hebrew weekdays.
 */
function DayHeading({ dayKey }: { dayKey: string }) {
  const t = useTranslations('feed');
  const format = useFormatter();
  const relation = dayKeyRelation(dayKey);
  const label =
    relation === 'today'
      ? t('dayToday')
      : relation === 'yesterday'
        ? t('dayYesterday')
        // The key is a bare calendar day; read it back in UTC or a browser west
        // of Greenwich lands on the day before.
        : format.dateTime(dayKeyToDate(dayKey), {
            weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC',
          });

  return (
    <div className="flex items-center gap-3 pt-1">
      <span className="text-xs font-semibold text-ink-400">{label}</span>
      <span className="h-px flex-1 bg-ink-300/40" />
    </div>
  );
}

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
  const [filter, setFilter] = useState<FilterKey>('all');
  /** A group id, `ACADEMY_CHIP`, or null for the whole club. */
  const [squad, setSquad] = useState<string | null>(null);
  const { data: groupsData } = useApi<{
    groups?: { id: string; name: string }[];
    academyCount?: number | null;
  }>('/api/groups');

  const [myName, setMyName] = useState('');
  const [myAthleteId, setMyAthleteId] = useState<string | null>(null);
  const [isStaff, setIsStaff] = useState(false);

  // ── Deep link from a push ────────────────────────────────────────────────
  // "🏃 X finished a run" notifications carry the activity id, and tapping one
  // has to land on THAT run rather than the top of the feed. The run may be
  // anywhere — page 4 of the feed, or older than anything loaded — so it is
  // fetched directly by activity id (the feed_item for it always exists;
  // trg_feed_item_for_activity, migration 047) and pinned above the feed
  // instead of hunting for it in `items`.
  //
  // `kudos` is the legacy spelling of the same param, still sitting in every
  // notification row written before this link existed. And a like, a comment and
  // a new post are about the ITEM rather than a run — those pushes carry
  // `?item=`, which this page used to ignore entirely. `feedFocusFromParams`
  // holds both readings; see lib/feed/deep-link.
  const router = useRouter();
  const searchParams = useSearchParams();
  const focus = feedFocusFromParams(searchParams);
  const focusBy = focus?.by ?? null;
  const focusId = focus?.id ?? null;
  const [focusItem, setFocusItem] = useState<FeedItem | null>(null);
  const [focusError, setFocusError] = useState<string | null>(null);

  useEffect(() => {
    if (!focusId) { setFocusItem(null); setFocusError(null); return; }
    let cancelled = false;
    setFocusError(null);
    const load = focusBy === 'activity' ? fetchFeedItemByActivity(focusId) : fetchFeedItem(focusId);
    load
      .then(({ item }) => { if (!cancelled) setFocusItem(item); })
      // A deleted run, or one whose feed item was never created, must not break
      // the whole page — the feed below still renders normally.
      .catch((err: unknown) => { if (!cancelled) setFocusError((err as Error).message || t('loadError')); })
      .finally(() => { if (cancelled) setFocusItem(null); });
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusBy, focusId]);

  const clearFocus = () => {
    setFocusItem(null);
    setFocusError(null);
    router.replace('/feed', { scroll: false });
  };

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
    if (refreshing || appScrollTop() > 0) return;
    pullStartYRef.current = e.touches[0].clientY;
  };
  const handlePullMove = (e: React.TouchEvent) => {
    if (pullStartYRef.current == null) return;
    if (appScrollTop() > 0) { pullStartYRef.current = null; setPullDistance(0); return; }
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

  const activeTypes = FILTERS.find(f => f.key === filter)!.types;

  // Squad chips, in squad order. `resolveGroup` is the single source of truth for
  // "which of the three is this?" — keying off the stored name here would break
  // the moment a coach renames a squad, which the club's names ("SUB 2:30") show
  // is the normal case rather than the exception.
  const squadChips = useMemo(() => {
    const groups = groupsData?.groups || [];
    return groups
      .map(g => {
        const resolved = resolveGroup(g.name);
        return {
          id: g.id,
          index: resolved.index,
          hex: resolved.hex,
          // An unrecognised squad keeps its own name — better a real label than
          // "Squad 0" for something the club calls something else.
          label: resolved.index >= 0 ? t('filterSquadN', { n: resolved.index + 1 }) : g.name,
        };
      })
      .sort((a, b) => (a.index < 0 ? 1 : a.index) - (b.index < 0 ? 1 : b.index));
  }, [groupsData, t]);

  // Two, not one: a filter that can only ever return one person's runs is not a
  // filter. See the chip below.
  const academyCount = groupsData?.academyCount;
  const showAcademyChip = academyCount == null || academyCount >= MIN_ACADEMY_FOR_CHIP;

  const loadInitial = useCallback(async () => {
    // Skip the loading gate when a cached page is already on screen — pull-to-
    // refresh/retry then just swap fresh content in behind the existing list
    // instead of flashing back to a blank skeleton. A filter switch is the one
    // case that does want the skeleton: the cache only ever holds the unfiltered
    // feed, so leaving the old cards up would show runs under "posts".
    if (!lastFeedPage || filter !== 'all' || squad) setLoading(true);
    setError(null);
    try {
      const { items: page, nextCursor } = await fetchFeed(null, PAGE_SIZE, activeTypes, squad);
      setItems(page);
      setCursor(nextCursor);
      // Only the unfiltered club feed is cached — a squad's page under the "all"
      // key would come back as everyone's feed on the next visit.
      if (activeTypes.length === 0 && !squad) lastFeedPage = { items: page, cursor: nextCursor };
    } catch (err: unknown) {
      setError((err as Error).message || t('loadError'));
    } finally {
      setLoading(false);
    }
    // activeTypes is derived from `filter` and stable per value.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t, filter, squad]);

  const loadMore = useCallback(async () => {
    if (loadingMore || !cursor) return;
    setLoadingMore(true);
    try {
      const { items: page, nextCursor } = await fetchFeed(cursor, PAGE_SIZE, activeTypes, squad);
      setItems(prev => [...prev, ...page]);
      setCursor(nextCursor);
    } catch { /* silent — user can scroll again */ }
    finally { setLoadingMore(false); }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadingMore, cursor, filter, squad]);

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
      // Deleting the pinned run has to unpin it too, or the deep link keeps a
      // now-deleted card on screen.
      setFocusItem(prev => (prev?.id === item.id ? null : prev));
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

  // The sheet hands back the tail of the thread as well as the count, so the
  // card's inline preview updates with it — write a comment, close the sheet, and
  // it's there on the card.
  const handleCommentClose = (itemId: string, newCount: number, latest: FeedComment[]) => {
    setItems(prev => {
      const next = prev.map(item => (
        item.id === itemId ? { ...item, commentCount: newCount, commentPreview: latest } : item
      ));
      if (lastFeedPage) lastFeedPage = { ...lastFeedPage, items: next };
      return next;
    });
    setFocusItem(prev => (
      prev?.id === itemId ? { ...prev, commentCount: newCount, commentPreview: latest } : prev
    ));
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
      {/* The frames deliberately give the feed no title bar — the cards are the
          content and a heading would just eat a card's worth of screen. So this
          is `sr-only`: the app's most-visited screen had no h1 at all, which
          leaves a screen reader with nothing to announce on arrival and no
          landmark to skip to. Visual design unchanged. */}
      <h1 className="sr-only">{t('pageTitle')}</h1>

      {/* Pull-to-refresh affordance — grows with the swipe, shows a spinner
          while `refreshing` runs loadInitial(). */}
      <div
        className="flex items-center justify-center overflow-hidden transition-[height,opacity] duration-150"
        style={{ height: pullDistance, opacity: Math.min(pullDistance / PULL_THRESHOLD, 1) }}
      >
        <Spinner size={22} />
      </div>

      {/* ═══ The post or run a push notification was about ═══
          Pinned at the very top, above everything else: the notification
          promised this specific item, so it has to be the first thing on screen
          and not something to scroll for. */}
      {focusId && (focusItem || focusError) && (
        <div className="mb-4">
          <div className="flex items-center justify-between px-1 mb-2">
            <span className="text-xs font-medium text-ink-400">{t('focusedTitle')}</span>
            <button
              onClick={clearFocus}
              className="flex items-center gap-1 text-xs text-ink-400 hover:text-ink-500 min-h-[32px] px-1"
            >
              {t('focusedShowAll')}
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          {focusItem ? (
            <div className="rounded-2xl ring-2 ring-brand-600">
              <FeedCard
                item={focusItem}
                commentCount={focusItem.commentCount}
                myAthleteId={myAthleteId}
                isStaff={isStaff}
                onComment={i => setCommentItem(i)}
                onDelete={handleDelete}
              />
            </div>
          ) : (
            <div className="bg-card border border-page rounded-2xl px-4 py-3 text-center">
              <p className="text-sm text-ink-400">{t('focusedMissing')}</p>
            </div>
          )}
        </div>
      )}

      {/* ═══ WHAT'S NEXT ═══
          One line: tomorrow's session (from 20:00 the evening before), its
          distance, and whether Garmin has it. Tap opens the full session. Gone
          once it's run. Read-only on the watch question by design — see
          NextSessionCard. */}
      <div className="mb-4 empty:mb-0">
        <NextSessionCard />
      </div>

      {/* ═══ LAST WEEK ═══
          Saturday 18:00 → Sunday 10:00 only, and only for the reader's own week.
          Above the setup nudge because it is the shortest-lived block on the
          page — it has sixteen hours to be seen, the nudge has three
          appearances. Dismissible, keyed to the Saturday. See WeekSummaryCard. */}
      <div className="mb-4 empty:mb-0">
        <WeekSummaryCard />
      </div>

      {/* ═══ FINISH SETTING UP ═══
          Above everything about everyone else, and below the focused item only
          (a push promised that one specifically). The score and the checklist
          have existed for a while on /dashboard/profile — the one screen a member
          who hasn't finished setting up never opens — so this is the same rows in
          the place they will actually be seen. Self-hiding, skippable, and capped
          at three appearances: see SetupNudgeCard and nudge-ledger.ts. */}
      <div className="mb-4 empty:mb-0">
        <SetupNudgeCard />
      </div>

      {/* ═══ THE HIGHLIGHT CARD ═══
          One number about the reader, above everything about everyone else: the
          challenge they're mid-way through, or their own consistency when no
          challenge is running. Renders nothing when there's nothing true to say,
          so it costs no vertical space on a cold or empty account. */}
      <div className="mb-4 empty:mb-0">
        <FeedHighlightCard />
      </div>

      {/* ═══ SQUAD RIVALRY + WEEKLY LEADERBOARD — moved here from the (now
          hero-only) home page. Feed is where "how's everyone doing" content
          belongs; home is only "what do I do today". ═══ */}
      <div className="mb-4">
        <SquadStandings />
      </div>

      {/* ═══ WHAT'S COMING ═══
          Below the rivalry card and above the composer: a member scrolling the
          feed is being told what everyone DID, and this is the one block that
          says what is about to happen. Renders nothing when all three lanes are
          empty, so a quiet month costs no space. */}
      <div className="mb-4 empty:mb-0">
        <UpcomingEvents />
      </div>

      <div
        className="mb-4 bg-card rounded-2xl border border-page p-3 flex items-center gap-3 cursor-pointer hover:bg-page/40 transition-colors active:scale-[0.98]"
        onClick={() => setComposerOpen(true)}
      >
        <FeedAvatar
          name={myName}
          url={null}
          className="w-9 h-9 bg-brand-600/10"
          textClassName="text-brand-600"
        />
        <span className="flex-1 text-sm text-ink-400">{t('composerPlaceholder')}</span>
        <PenSquare className="h-4 w-4 text-ink-400" />
      </div>

      {/* ═══ What's in the feed — runs, or everything else ═══
          "I just want to see the runs" and "did I miss an announcement?" are the
          two ways people actually read this screen, and both used to mean
          scrolling past the other one. */}
      <div className="mb-3 flex items-center gap-2">
        {FILTERS.map(f => (
          <button
            key={f.key}
            onClick={() => setFilter(f.key)}
            aria-pressed={filter === f.key}
            className={cn(
              'px-3.5 py-1.5 rounded-full text-xs font-semibold transition-colors',
              filter === f.key
                ? 'bg-ink-700 text-card'
                : 'bg-card border border-page text-ink-400 hover:text-ink-500',
            )}
          >
            {t(f.labelKey)}
          </button>
        ))}
      </div>

      {/* ═══ Whose feed — the whole club, one דבוקה, or the academy ═══
          Reported as 373ebe89. Orthogonal to the row above, so "just the runs,
          from my squad" is two taps and not a mode. Ordered by resolveGroup's
          index (1/2/3) rather than by the roster's creation order, so the chips
          read in the order the club names its squads. */}
      {squadChips.length > 0 && (
        <div className="mb-3 flex items-center gap-2 overflow-x-auto pb-0.5">
          <SquadChip active={squad === null} onClick={() => setSquad(null)} label={t('filterSquadAll')} />
          {squadChips.map(chip => (
            <SquadChip
              key={chip.id}
              active={squad === chip.id}
              onClick={() => setSquad(chip.id)}
              label={chip.label}
              hex={chip.hex}
            />
          ))}
          {/* aae77577: hidden until the academy actually has members. The filter
              itself was never wrong — academy membership is the `is_academy` flag
              and not a group — but with one flagged athlete the chip was a filter
              down to one person, which reads as a bug rather than as a filter.
              `undefined`/`null` means the count did not answer, and then the chip
              stays: a failed read must not hide a working feature. */}
          {showAcademyChip && (
            <SquadChip
              active={squad === ACADEMY_CHIP}
              onClick={() => setSquad(ACADEMY_CHIP)}
              label={t('filterAcademy')}
            />
          )}
          {/* ff8d932e: "add to favorites for specific athletes, and then a
              Favorites view". It belongs on THIS row and not in a mode of its
              own — it answers the same question the squad chips do, whose runs
              am I looking at. The chip is always here, even before the member
              has favourited anybody, because the star that fills it lives on
              teammate profiles and this is the only place that explains why it
              is there; the empty state below says what to do next. */}
          <SquadChip
            active={squad === FAVORITES_SQUAD}
            onClick={() => setSquad(FAVORITES_SQUAD)}
            label={t('filterFavorites')}
            icon={Star}
          />
        </div>
      )}

      {deleteError && (
        <div className="mb-3 bg-accent-red/20 border border-accent-red/30 rounded-2xl px-4 py-3 text-center">
          <p className="text-sm text-accent-red">{deleteError}</p>
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

      {/* The headline is ours, not the server's. This branch used to render
          `error` itself as the title, which meant an API sentence written for a
          developer — in English, in an RTL Hebrew app — was the biggest text on
          the screen ("No membership found for this account"). The raw string
          stays as the small line underneath, where it still helps a bug report
          without pretending to be a message to the user. */}
      {!loading && error && error !== 'NOT_SIGNED_IN' && (
        <EmptyState
          icon={AlertCircle}
          title={t('loadError')}
          description={error}
          action={<Button onClick={loadInitial}>{t('retry')}</Button>}
        />
      )}

      {!loading && !error && items.length === 0 && (
        <EmptyState
          // The favourites lane gets its own copy: "no posts yet" is true but
          // useless here, because the thing to do about it is not on this screen
          // — it is the star on a teammate's profile, and nothing else would
          // tell you that.
          icon={squad === FAVORITES_SQUAD ? Star : MessageSquare}
          title={squad === FAVORITES_SQUAD ? t('emptyFavoritesTitle') : t('emptyTitle')}
          description={squad === FAVORITES_SQUAD ? t('emptyFavoritesBody') : t('emptyBody')}
          // A filtered feed that comes back empty is otherwise a dead end. Both
          // axes are cleared together: with two of them, "show me everything"
          // taking two taps in the empty state is the same dead end one level up.
          action={filter !== 'all' || squad
            ? <Button onClick={() => { setFilter('all'); setSquad(null); }}>{t('filterAll')}</Button>
            : undefined}
        />
      )}

      {!loading && items.length > 0 && (
        <div className="space-y-3">
          {/* The pinned card above is the same feed item, so skip it here
              rather than showing the run twice. Day headings are inserted on the
              way through: a card gets one when it opens a new calendar day.

              Grouping runs here — over the whole accumulated list, not per page —
              is deliberate: a club run recorded by eight people can straddle a
              pagination boundary, and grouping server-side per page would emit a
              group of five and then a group of three for the same run. */}
          {(() => {
            const visible = items.filter(item => item.id !== focusItem?.id);
            const entries = groupFeedItems(visible, myAthleteId);
            let lastDay = '';
            return entries.map(entry => {
              // A group sits at its newest member's position, so that member is
              // what the day rule reads. (items[0] is the viewer's own run when
              // they were on it, which isn't necessarily the newest — hence the
              // reduce rather than a plain index.)
              const dayItem =
                entry.kind === 'group'
                  ? entry.group.items.reduce((a, b) => (a.occurredAt >= b.occurredAt ? a : b))
                  : entry.item;
              const day = feedDayKey(dayItem.occurredAt, dayItem.activity?.startTime);
              const opensDay = day !== lastDay;
              lastDay = day;
              return (
                <Fragment key={entry.kind === 'group' ? entry.group.key : entry.item.id}>
                  {opensDay && <DayHeading dayKey={day} />}
                  {entry.kind === 'group' ? (
                    <GroupRunCard
                      group={entry.group}
                      myAthleteId={myAthleteId}
                      isStaff={isStaff}
                      onComment={i => setCommentItem(i)}
                      onDelete={handleDelete}
                    />
                  ) : (
                    <FeedCard
                      item={entry.item}
                      commentCount={entry.item.commentCount}
                      myAthleteId={myAthleteId}
                      isStaff={isStaff}
                      onComment={i => setCommentItem(i)}
                      onDelete={handleDelete}
                    />
                  )}
                </Fragment>
              );
            });
          })()}
        </div>
      )}

      <div ref={sentinelRef} className="h-1" />

      {loadingMore && (
        <div className="flex justify-center py-6">
          <Spinner size={20} />
        </div>
      )}

      {!hasMore && items.length > 0 && (
        <p className="text-center text-xs text-ink-400 py-6">{t('allLoaded')} ✓</p>
      )}

      {commentItem && (
        <FeedCommentSheet
          item={commentItem}
          myAthleteId={myAthleteId}
          onClose={(count, latest) => handleCommentClose(commentItem.id, count, latest)}
        />
      )}

      {composerOpen && (
        <FeedComposer
          onClose={() => setComposerOpen(false)}
          onPost={handlePost}
          myAthleteId={myAthleteId}
        />
      )}
    </div>
  );
}
