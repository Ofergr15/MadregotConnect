'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { Heart, MessageCircle, MessagesSquare, Trash2, MapPin, Mountain, Share2, Award, Flame, Gauge, ExternalLink } from 'lucide-react';
import { activityDayRelation, cn, formatActivityDate, formatActivityTime, resolveGroup } from '@/lib/utils';
import { useTranslations, useFormatter, useLocale, useNow } from 'next-intl';
import { toggleLike } from '@/lib/feed-client';
import { FeedLikesSheet } from '@/components/FeedLikesSheet';
import { FeedAvatar } from '@/components/FeedAvatar';
import { ShareSheet } from '@/components/ShareSheet';
import { RouteMinimap } from '@/components/RouteMinimap';
import { FeedBodyText } from '@/components/FeedBodyText';
import { ExecutionBadge } from '@/components/activity/ExecutionBadge';
import { toAchievementPayload } from '@/lib/feed/project';
import { toSessionPhotos, sessionSubline, type SessionPhotosPayload } from '@/lib/quality-session/photos';
import type { FeedItem, FeedLiker, AchievementPayload } from '@/lib/feed/project';
import type { FeedComment } from '@/lib/feed/comments';
import { AthleteLink } from '@/components/AthleteLink';
import { PrBadge, usePrRuns } from '@/components/PrBadge';
import { displayRunName } from '@/lib/activities/run-name';

export function formatPace(secPerKm: number): string {
  const min = Math.floor(secPerKm / 60);
  const sec = Math.round(secPerKm % 60);
  return `${min}:${String(sec).padStart(2, '0')}`;
}

export function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.round(seconds % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// The award engine collapses a badge's admin-uploaded artwork and its emoji
// fallback into one `badgeIcon` string (`icon_url || icon` — see
// lib/badges/award-engine.ts's awardBadge). This tells the two apart so the
// card can render an <img> for real artwork and plain text for an emoji.
function isImageUrl(value: string): boolean {
  return /^https?:\/\//.test(value) || value.startsWith('/');
}

type Translate = ReturnType<typeof useTranslations<'feed'>>;

/**
 * The run's own clock time, the way Strava heads a feed card ("Today at 8:00
 * AM") rather than "6 hours ago".
 *
 * The relative form wasn't just less informative here, it was wrong: for an
 * activity `occurredAt` is `start_time` copied by migration 047's trigger, i.e.
 * the athlete's wall-clock stored as if it were UTC (Convention A in
 * lib/utils.ts). Measuring that against a real `Date.now()` understated every
 * activity by Israel's UTC offset — a flat -3h across live rows, so a run 10.7h
 * old read "7.7 hours ago" — and anything under 3h old came out in the FUTURE
 * ("in 2 hours"). Reading it via the Convention-A helpers instead needs no
 * offset arithmetic at all: the stored wall-clock is already the time to show.
 *
 * Posts, achievements and announcements carry a genuine instant in the same
 * field, so those keep the relative form.
 */
function WhenLabel({ item }: { item: FeedItem }) {
  const format = useFormatter();
  const locale = useLocale();
  const t = useTranslations('feed');
  // `now` is passed explicitly. Without it next-intl falls back to the ambient clock
  // and logs an ENVIRONMENT_FALLBACK error per card — eight of them on a five-card
  // feed, which is what the audit's first look at this screen actually found. The
  // warning is not cosmetic: the fallback reads the clock separately on the server and
  // on the client, so a card rendered either side of a minute boundary hydrates with
  // two different strings. `useNow` hands every card on the page the same instant.
  // (`dashboard/profile` already passed a `now`; these two call sites did not.)
  const now = useNow();
  const startTime = item.activity?.startTime;
  if (!startTime) return <>{format.relativeTime(new Date(item.occurredAt), now)}</>;

  const time = formatActivityTime(startTime);
  switch (activityDayRelation(startTime)) {
    case 'today': return <>{t('whenToday', { time })}</>;
    case 'yesterday': return <>{t('whenYesterday', { time })}</>;
    default: return <>{t('whenOn', { date: formatActivityDate(startTime, locale), time })}</>;
  }
}

/** Exported for GroupRunCard, which heads each runner's block with the same row
 *  so a grouped run and a solo run name their athlete identically. */
export function AuthorRow({ item }: { item: FeedItem }) {
  const t = useTranslations('feed');
  // The pack's own colour around the face and beside its name, "דבוקה N" rather
  // than the roster's "Group A - SUB 2:30" (feed redesign 2026-10-12): you see
  // whose run it is before you read.
  const pack = item.author.groupName ? resolveGroup(item.author.groupName) : null;
  const packName = pack && pack.index >= 0 ? t('filterSquadN', { n: pack.index + 1 }) : item.author.groupName;
  const identity = (
    <>
      <span className="shrink-0 rounded-full" style={pack && pack.index >= 0 ? { boxShadow: `0 0 0 2px #fff, 0 0 0 4px ${pack.hex}` } : undefined}>
        <FeedAvatar name={item.author.name} url={item.author.avatarUrl} className="h-[34px] w-[34px]" />
      </span>
      <div className="min-w-0">
        <p className="text-[15px] font-bold text-ink-900 leading-tight truncate">{item.author.name}</p>
        <p className="mt-0.5 flex items-center gap-1 text-xs text-ink-400 leading-tight">
          <WhenLabel item={item} />
          {packName && <>
            <span aria-hidden>·</span>
            {pack && pack.index >= 0 && <span className="h-1.5 w-1.5 rounded-full" style={{ background: pack.hex }} />}
            {packName}
          </>}
        </p>
      </div>
    </>
  );

  // author.athleteId is null for system-authored items (e.g. announcements
  // with no athlete row behind them) — nothing to link to in that case, so
  // fall back to the plain (non-interactive) row.
  if (!item.author.athleteId) {
    return <div className="flex items-center gap-3">{identity}</div>;
  }

  return (
    // `py-[5px] -my-[5px]`: the row measured 34 (a two-line name block beside a
    // 34px face) — 5px each way reaches 44 without moving the card's layout.
    <AthleteLink athleteId={item.author.athleteId} name={item.author.name} className="flex items-center gap-3 py-[5px] -my-[5px]">
      {identity}
    </AthleteLink>
  );
}

function likeSummary(likers: FeedLiker[], total: number, t: Translate): string {
  const firstNames = likers.map(l => (l.name || '').split(' ')[0]).filter(Boolean);
  // A SENTENCE, not the bare number this used to return. When the preview has no
  // names — every liker with a blank name, or a count that arrived without a
  // preview — the button that opens the likes sheet was the string "2": six
  // pixels wide, the smallest tap target the audit has ever measured here, and
  // a digit on its own line that says nothing about what it counts.
  if (firstNames.length === 0) return t('likeCountOnly', { count: total });

  const rest = total - firstNames.length;
  if (rest > 0) return t('namesAndMore', { names: firstNames.join(', '), count: rest });
  if (firstNames.length === 1) return firstNames[0];
  return t('namesAnd', {
    head: firstNames.slice(0, -1).join(', '),
    last: firstNames[firstNames.length - 1],
  });
}

// The one person-list in the app that is deliberately NOT tappable per person.
// These 20px faces live INSIDE the button that opens FeedLikesSheet, and that
// sheet is a full row per liker with a real profile link on each — so the people
// here are one tap away, and putting anchors in this button would be invalid
// markup (an <a> inside a <button>) for targets a thumb cannot hit anyway. Same
// reasoning for the hover tooltip below it: it is desktop-only and
// pointer-events-none, i.e. a preview of the sheet, not a control.
function LikerStack({ likers }: { likers: FeedLiker[] }) {
  if (likers.length === 0) return null;
  return (
    <div className="flex shrink-0">
      {likers.map((l, i) => (
        <FeedAvatar
          key={l.athleteId}
          name={l.name}
          url={l.avatarUrl}
          maxChars={1}
          className={cn('w-5 h-5 bg-brand-600/10 ring-2 ring-page', i > 0 && '-ms-1.5')}
          // 10px, not 8. This was the smallest type anywhere in the app, and it
          // is the fallback initial for a liker with no photo — the only thing
          // naming that person on the card. 20px of circle holds a 10px letter
          // with room to spare (see the same geometry in FeedbackAdmin's
          // duplicate stack); 8px was below the floor the scale now sets.
          textClassName="text-3xs text-brand-600"
        />
      ))}
    </div>
  );
}

/**
 * The tail of the conversation, right on the card.
 *
 * The card used to show comments as a bare number next to a speech bubble, which
 * tells you a thread exists but nothing about whether it's worth opening — so
 * threads stayed unopened and died. Two comments of context is what makes people
 * join in.
 *
 * The lines are deliberately NOT one big tap target: `FeedBodyText` renders
 * @mentions as real links, and an <a> inside a <button> is invalid markup that
 * also double-fires (navigate to the profile *and* open the sheet). The "all N
 * comments" button above them, plus the existing bubble in the action row, are
 * the ways in.
 */
function CommentPreview({
  comments,
  commentCount,
  onOpen,
}: {
  comments: FeedComment[];
  commentCount: number;
  onOpen: () => void;
}) {
  const t = useTranslations('feed');
  if (comments.length === 0) return null;

  return (
    <div className="pt-1.5 space-y-1">
      {/* `py-1.5 -my-1.5` on the button below buys the 24px WCAG 2.5.8 minimum
          out of a text line without moving anything. It was `py-1`, written for
          a 16px line box — the audit then measured the button at 22, because the
          line is 14, not 16. Three pixels a side and not two: the arithmetic has
          to hold for the line box the browser actually gives it. Not 44: this is
          a secondary way into the sheet — the comment bubble in the action row is
          the 44px one — and a 44px band here would push two comments of preview
          off the card, which is the whole reason the preview exists.
          The 6px reaches 2px past the 4px `space-y-1` gap into the first comment
          row below. That row's only control is the name link at its start, which
          is 18px tall, so it loses 2px off an edge and keeps its own centre. */}
      {commentCount > comments.length && (
        <button
          onClick={onOpen}
          className="block text-xs font-medium text-ink-400 hover:text-ink-500 transition-colors py-1.5 -my-1.5"
        >
          {t('viewAllComments', { count: commentCount })}
        </button>
      )}
      {comments.map(c => (
        <p key={c.id} className="text-xs text-ink-500 leading-relaxed line-clamp-2">
          {/* The audit measures this name at 19.6×18 and it stays that way. It is
              a link INSIDE a sentence, which is the one case WCAG 2.5.8 exempts
              by name: padding it out to 24 would push the words of the comment
              apart, and the first line of a two-line preview would collide with
              the second. The comment thread itself lists every author on a row
              of its own, at a full target size — that is the door for a thumb. */}
          <AthleteLink
            athleteId={c.author.athleteId}
            name={c.author.name}
            className="font-semibold text-ink-700 hover:underline"
          >
            {(c.author.name || '').split(' ')[0]}
          </AthleteLink>
          {' '}
          <FeedBodyText body={c.body} />
        </p>
      ))}
    </div>
  );
}

/**
 * Likes, comments, share, run-chat — per feed item.
 *
 * Exported because a group run card renders one of these PER RUNNER rather than
 * one for the card: a like is a gesture toward a person, not toward a card, and
 * the eight people who ran together each earn their own. That is also why the
 * grouping never merges the underlying feed_items — every runner keeps their own
 * row, their own like count and their own thread.
 */
export function ActionRow({
  item,
  commentCount,
  myAthleteId,
  isStaff,
  onCommentPress,
  onDelete,
  bleed = '-mx-3.5',
}: {
  item: FeedItem;
  commentCount: number;
  myAthleteId: string | null;
  isStaff: boolean;
  onCommentPress: () => void;
  onDelete?: () => void;
  /** Negative margin that takes the bar to the card's edges — the host's own padding. */
  bleed?: string;
}) {
  const router = useRouter();
  const [liked, setLiked] = useState(item.likedByMe);
  const [likeCount, setLikeCount] = useState(item.likeCount);
  const [likers, setLikers] = useState<FeedLiker[]>(item.likePreview);
  const t = useTranslations('feed');
  const tChat = useTranslations('runChat');
  const [busy, setBusy] = useState(false);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [shareOpen, setShareOpen] = useState(false);
  const isMyActivity = !!myAthleteId && item.activity?.athleteId === myAthleteId;
  const canOpenRunChat = !!item.activity && (isMyActivity || isStaff);
  const runChatLabel = isStaff && !isMyActivity ? tChat('chatWithRunner') : tChat('chatWithCoach');

  const handleLike = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    const next = !liked;
    setLiked(next);
    setLikeCount(c => c + (next ? 1 : -1));
    try {
      const res = await toggleLike(item.id);
      setLiked(res.liked);
      setLikeCount(res.likeCount);
      setLikers(res.likePreview);
    } catch {
      setLiked(!next);
      setLikeCount(c => c + (next ? -1 : 1));
    } finally {
      setBusy(false);
    }
  }, [busy, liked, item.id]);

  return (
    <>
      {likeCount > 0 && (
        <div className="pt-2">
          <button
            onClick={() => setSheetOpen(true)}
            // `py-2 -my-2` buys 16px of tap height out of the 8px above and the
            // 4px below without moving a pixel — the same trick as
            // CommentPreview's button. Asymmetric, and measured rather than
            // assumed: 8px is all there is above, and BELOW there are exactly 4,
            // because the action row's `pt-1` is the only gap between this button
            // and 44px of primary controls (like, comment, share). A symmetric
            // `py-2` was tried first and the audit caught it stealing 4px off the
            // top of the like button — this button is `relative`, so it paints
            // over its static siblings and wins every pixel it overlaps. 26px of
            // height clears WCAG 2.5.8; taking the other 18 would cost the like
            // button its own floor, which is the worse trade.
            className="group relative flex items-center gap-1.5 max-w-full text-start min-h-6 pt-2 -mt-2 pb-1 -mb-1"
          >
            <LikerStack likers={likers} />
            <span className="text-xs text-ink-400 group-hover:text-ink-500 transition-colors truncate">
              {likeSummary(likers, likeCount, t)}
            </span>

            {likers.length > 0 && (
              <span className="hidden md:block absolute bottom-full start-0 mb-1.5 px-2.5 py-1.5 bg-page border border-ink-300 rounded-lg opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none whitespace-nowrap shadow-lg z-50 text-start">
                {likers.map(l => (
                  <span key={l.athleteId} className="block text-xs text-ink-700 leading-relaxed">
                    {l.name}
                  </span>
                ))}
                {likeCount > likers.length && (
                  <span className="block text-2xs text-ink-400 leading-relaxed">
                    {t('andMore', { count: likeCount - likers.length })}
                  </span>
                )}
              </span>
            )}
          </button>
        </div>
      )}

      {/* Every button in this row is 44×44 (`min-h-11 min-w-11`), not the 40×28
          the padding alone gave them. These are the app's primary interactions —
          liking and commenting on a clubmate's run — and they were the smallest
          targets on the screen, on a card the whole club scrolls one-handed.
          The pill is `rounded-full` and only paints on hover/liked, so the extra
          height costs nothing visually; the row keeps its 4px rhythm. */}
      {/* A labelled bar, Strava's: like · comment · share, each an equal share of
          the card's width and 44px tall, divided by hairlines (2.41.x redesign).
          The icon-only pills it replaces were the smallest primary targets on the
          screen. Share stays own-runs-only, run-chat own-or-staff — see below. */}
      <div className={cn(bleed, 'mt-2 flex items-stretch border-t border-page')}>
        <button
          onClick={handleLike}
          aria-label={liked ? t('unlike') : t('like')}
          aria-pressed={liked}
          className={cn(
            'flex min-h-11 flex-1 items-center justify-center gap-1.5 text-[13px] font-semibold transition-colors active:bg-page/60',
            liked ? 'text-accent-red-ink' : 'text-ink-500 hover:text-ink-700',
          )}
        >
          <Heart className={cn('h-[18px] w-[18px]', liked && 'fill-accent-red text-accent-red')} />
          {t('actionLike')}
        </button>

        {/* The label is not decoration: without it VoiceOver announced a bare "3". */}
        <button
          onClick={onCommentPress}
          aria-label={t('comments')}
          className="flex min-h-11 flex-1 items-center justify-center gap-1.5 border-s border-page text-[13px] font-semibold text-ink-500 transition-colors hover:text-ink-700 active:bg-page/60"
        >
          <MessageCircle className="h-[18px] w-[18px]" />
          {t('actionComment')}
          {commentCount > 0 && <span className="tabular-nums text-ink-400">{commentCount}</span>}
        </button>

        {/* Your OWN runs only (72949cd6): the share card carries no name, so a
            teammate's run would become an unattributed image on your story. */}
        {item.activity && isMyActivity && (
          <button
            onClick={() => setShareOpen(true)}
            aria-label={t('shareToStory')}
            className="flex min-h-11 flex-1 items-center justify-center gap-1.5 border-s border-page text-[13px] font-semibold text-ink-500 transition-colors hover:text-ink-700 active:bg-page/60"
          >
            <Share2 className="h-[18px] w-[18px]" />
            {t('actionShare')}
          </button>
        )}

        {canOpenRunChat && (
          <button
            onClick={() => router.push(`/dashboard/run-chat/${item.activity!.id}`)}
            aria-label={runChatLabel}
            className="flex min-h-11 flex-1 items-center justify-center gap-1.5 border-s border-page text-[13px] font-semibold text-ink-500 transition-colors hover:text-brand-600 active:bg-page/60"
          >
            <MessagesSquare className="h-[18px] w-[18px]" />
            {t('actionChat')}
          </button>
        )}

        {onDelete && (
          <button
            onClick={onDelete}
            // ink-400, not ink-300: the icon is the whole control, so it has to clear 3:1.
            className="flex min-h-11 min-w-11 items-center justify-center border-s border-page text-ink-400 transition-colors hover:text-accent-red active:bg-accent-red/10"
            aria-label={t('deletePost')}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>

      <CommentPreview
        comments={item.commentPreview}
        commentCount={commentCount}
        onOpen={onCommentPress}
      />

      {sheetOpen && (
        <FeedLikesSheet
          itemId={item.id}
          likeCount={likeCount}
          seed={likers}
          onClose={() => setSheetOpen(false)}
        />
      )}

      {shareOpen && (
        <ShareSheet subject={{ kind: 'workout', item }} onClose={() => setShareOpen(false)} />
      )}
    </>
  );
}

/**
 * Distance / pace / time, the three numbers every card leads with.
 *
 * Exported so a runner's block inside a group run card renders the identical
 * tiles. Reads only what the projection shipped — a pace the athlete hid arrives
 * here already null (see maskHiddenStats) and shows as "—", which is exactly what
 * has to happen when their card is rendered beside a teammate's.
 */
export function ActivityStatTiles({ act }: { act: NonNullable<FeedItem['activity']> }) {
  const t = useTranslations('feed');
  const distKm = (act.distance / 1000).toFixed(1);
  const paceStr = act.averagePace ? formatPace(act.averagePace) : null;
  const durationStr = formatDuration(act.duration);
  const movingStr = act.movingDuration ? formatDuration(act.movingDuration) : null;
  // Moving time is only worth a caption when it actually differs from elapsed —
  // otherwise it's the same number twice.
  const showMoving = !!movingStr && movingStr !== durationStr;

  return (
    // Open numbers, not boxed tiles (feed redesign 2026-10-12): the three figures
    // are the content, in a rounded face big enough to read at arm's length.
    <div className="grid grid-cols-3 gap-2 mb-2">
      <div>
        <p className="text-[11px] text-ink-400">{t('statDistance')}</p>
        <p className="font-[ui-rounded,system-ui] text-[19px] font-bold leading-none tracking-tight text-ink-900 tabular-nums">
          {distKm}<span className="text-xs font-semibold text-ink-400 ms-0.5 tracking-normal">{t('km')}</span>
        </p>
      </div>
      <div>
        <p className="text-[11px] text-ink-400">{t('statPace')}</p>
        <p className="font-[ui-rounded,system-ui] text-[19px] font-bold leading-none tracking-tight text-ink-900 tabular-nums">
          {paceStr || '—'}<span className="text-xs font-semibold text-ink-400 ms-0.5 tracking-normal">{t('perKm')}</span>
        </p>
      </div>
      <div>
        <p className="text-[11px] text-ink-400">{t('statTime')}</p>
        <p className="font-[ui-rounded,system-ui] text-[19px] font-bold leading-none tracking-tight text-ink-900 tabular-nums">{durationStr}</p>
        {showMoving && (
          <p className="text-2xs text-ink-400 tabular-nums mt-0.5">{movingStr} {t('statMoving')}</p>
        )}
      </div>
    </div>
  );
}

/**
 * The activity card's three numbers in Strava's grammar (2.41.x redesign): label
 * above, value below, hairline between. Heart rate, calories, effort and climb moved
 * to the run page — a card that answers "how far, how fast, how long" reads at a
 * glance; the card that answered seven questions read as noise.
 */
function CardStats({ act }: { act: NonNullable<FeedItem['activity']> }) {
  const t = useTranslations('feed');
  const cells = [
    { label: t('statDistance'), value: (act.distance / 1000).toFixed(1), unit: t('km') },
    { label: t('statPace'), value: act.averagePace ? formatPace(act.averagePace) : '—', unit: t('perKm') },
    { label: t('statTime'), value: formatDuration(act.movingDuration || act.duration), unit: null },
  ];
  return (
    <div className="flex py-2">
      {cells.map((c, i) => (
        <div key={c.label} className={cn('min-w-0 flex-1', i > 0 && 'border-s border-page ps-3')}>
          <p className="text-xs text-ink-400">{c.label}</p>
          <p className="truncate text-xl font-bold leading-tight text-ink-900 tabular-nums">
            {c.value}
            {c.unit && <span className="ms-0.5 text-xs font-medium text-ink-400">{c.unit}</span>}
          </p>
        </div>
      ))}
    </div>
  );
}

/**
 * The secondary row — HR, calories, effort, elevation, place. Everything the
 * projection already ships and the card used to throw away.
 *
 * Same masking note as ActivityStatTiles: hidden HR and calories arrive null, so
 * the chip simply isn't rendered.
 */
export function ActivityChips({ act }: { act: NonNullable<FeedItem['activity']> }) {
  const t = useTranslations('feed');
  const tc = useTranslations('common');
  const showElevation = (act.elevationGain ?? 0) > 5;
  const anything =
    act.averageHr || act.maxHr || act.calories || act.perceivedRpe != null ||
    showElevation || act.locationName;
  if (!anything) return null;

  return (
    <div className="flex flex-wrap gap-x-4 gap-y-1 mb-2 text-xs text-ink-400">
      {act.averageHr && (
        <span className="flex items-center gap-1">
          <Heart className="h-3 w-3 text-accent-red" />
          {/* Rounded here as well as at ingest: rows synced from Strava before
              that fix still hold the raw float. */}
          {Math.round(act.averageHr)} {tc('bpm')}
          {act.maxHr ? <span className="text-ink-400">· {t('statMaxHr')} {Math.round(act.maxHr)}</span> : null}
        </span>
      )}
      {act.calories ? (
        <span className="flex items-center gap-1">
          <Flame className="h-3 w-3 text-band-3" />
          {act.calories} {t('statCalories')}
        </span>
      ) : null}
      {act.perceivedRpe != null && (
        <span className="flex items-center gap-1">
          <Gauge className="h-3 w-3 text-brand-600" />
          {t('statEffort')} {act.perceivedRpe.toFixed(0)}/10
          {act.perceivedFeel != null && (
            <span>{['😣', '😕', '😐', '🙂', '😄'][Math.round(act.perceivedFeel)] ?? ''}</span>
          )}
        </span>
      )}
      {showElevation && (
        <span className="flex items-center gap-1">
          <Mountain className="h-3 w-3 text-accent-600" />
          +{Math.round(act.elevationGain ?? 0)}m
        </span>
      )}
      {act.locationName && (
        <span className="flex items-center gap-1">
          <MapPin className="h-3 w-3" />
          {act.locationName}
        </span>
      )}
    </div>
  );
}

function ActivityCard({
  item,
  commentCount,
  myAthleteId,
  isStaff,
  onComment,
  onDelete,
}: {
  item: FeedItem;
  commentCount: number;
  myAthleteId: string | null;
  isStaff: boolean;
  onComment: () => void;
  onDelete?: () => void;
}) {
  const t = useTranslations('feed');
  const locale = useLocale();
  const router = useRouter();
  const act = item.activity!;
  const prBuckets = usePrRuns().get(act.id);

  // The card is a doorway to the full run: route map, per-km splits, pace/HR/
  // elevation charts. It used to be a dead end — the only tap target was the
  // run-chat button in the action row.
  const openDetail = () => router.push(`/dashboard/activities/${act.id}`);

  return (
    <div className="bg-card rounded-[20px] overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      {/* Compact pass (2026-10-16): 387px → ~260 for a run with a route, so two
          runs fit on a phone screen instead of one. Same content, less air. */}
      <div className="px-3.5 pt-3">
        {/* AuthorRow stays outside the tap target — it has its own link to the
            runner's profile, and nesting the two would swallow it. */}
        <div className="flex items-start gap-3 mb-1">
          <div className="flex-1 min-w-0">
            <AuthorRow item={item} />
          </div>
          {/* A record keeps the corner (#90). The decorative route glyph that sat
              here on every other card said nothing and did nothing — gone. */}
          {prBuckets && <div className="mt-1"><PrBadge buckets={prBuckets} /></div>}
        </div>

        <div
          role="button"
          tabIndex={0}
          onClick={openDetail}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              openDetail();
            }
          }}
          aria-label={t('viewDetails')}
          className="-mx-2 px-2 pt-1 pb-1 rounded-xl cursor-pointer transition-colors hover:bg-page/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-600/40"
        >
          {/* Hebrew for the watch's automatic names, the time of day for a bare
              "Running" — see lib/activities/run-name.ts. */}
          <p className="text-lg font-extrabold leading-snug tracking-tight text-ink-900" dir="auto">
            {displayRunName(act.activityName, act.startTime, locale)}
          </p>

          <CardStats act={act} />

          {/* Whether these were the numbers asked for — one slim line, for the
              runner and staff only (the payload carries no score for anyone else). */}
          <ExecutionBadge summary={act.planVerdict} showChevron compact className="mb-2" />

          {act.routePreview && act.routePreview.length > 2 && (
            // Full width, edge to edge (Strava's card): the route is the picture.
            <div className="-mx-3.5 mb-1 overflow-hidden">
              <RouteMinimap points={act.routePreview} paces={act.paceBands} hd={act.routeHd} width={390} height={210} flush />
            </div>
          )}
        </div>

        {item.body && (
          <p className="text-sm text-ink-500 mb-2 leading-relaxed"><FeedBodyText body={item.body} /></p>
        )}

        <ActionRow
          item={item}
          commentCount={commentCount}
          myAthleteId={myAthleteId}
          isStaff={isStaff}
          onCommentPress={onComment}
          onDelete={onDelete}
        />
      </div>
    </div>
  );
}

// Celebratory card for badges/achievements (roadmap #11). Reads the award-
// engine's fixed `payload` contract (badgeCode/badgeIcon/badgeNameHe/
// badgeNameEn — see toAchievementPayload) and gives it its own amber/gold
// treatment — a decorative glow, an "achievement unlocked" label, and the
// badge's real icon/name front and center — distinct from the plain PostCard
// shell used for free posts, announcements, and new-plan notices.
function AchievementCard({
  item,
  achievement,
  commentCount,
  onComment,
  onDelete,
}: {
  item: FeedItem;
  achievement: AchievementPayload;
  commentCount: number;
  onComment: () => void;
  onDelete?: () => void;
}) {
  const t = useTranslations('feed');
  const locale = useLocale();
  const badgeName = locale === 'he' ? achievement.badgeNameHe : achievement.badgeNameEn;

  return (
    <div className="relative overflow-hidden rounded-2xl border border-band-3 bg-gradient-to-br from-band-3/15 via-card/90 to-card p-4">
      <div className="absolute top-0 end-0 w-28 h-28 bg-band-3/10 rounded-full -translate-y-1/2 translate-x-1/2 blur-2xl pointer-events-none" />

      <div className="relative">
        <div className="flex items-start gap-3 mb-1.5">
          <div className="flex-1 min-w-0">
            <AuthorRow item={item} />
          </div>
          <div className="w-7 h-7 rounded-full bg-band-3/10 flex items-center justify-center shrink-0 mt-1">
            <Award className="h-3.5 w-3.5 text-band-3" />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="w-14 h-14 rounded-2xl bg-band-3/10 border border-band-3 flex items-center justify-center text-3xl shrink-0 shadow-lg shadow-band-3/10 overflow-hidden">
            {isImageUrl(achievement.badgeIcon) ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={achievement.badgeIcon} alt={badgeName} className="h-9 w-9 object-contain" />
            ) : (
              achievement.badgeIcon
            )}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-2xs font-bold uppercase tracking-wider text-band-3-ink">{t('newBadgeEarned')}</p>
            <p className="text-lg font-black text-ink-700 truncate" dir="auto">{badgeName}</p>
          </div>
        </div>

        {item.body && (
          <p className="mt-3 text-sm text-ink-500 whitespace-pre-line leading-relaxed"><FeedBodyText body={item.body} /></p>
        )}

        {/* Achievements are never activities — no run-chat CTA */}
        <ActionRow
          bleed="-mx-4"
          item={item}
          commentCount={commentCount}
          myAthleteId={null}
          isStaff={false}
          onCommentPress={onComment}
          onDelete={onDelete}
        />
      </div>
    </div>
  );
}

/**
 * "Photos from the quality session" (#106): the club's card for one morning — up
 * to six photos picked for the feed, and the button to everything else (the
 * photographer's Drive / Google Photos / WhatsApp album). Opened in a new tab:
 * those albums are other sites, and the feed must still be there behind them.
 */
function SessionPhotosCard({
  item,
  photos,
  commentCount,
  onComment,
  onDelete,
}: {
  item: FeedItem;
  photos: SessionPhotosPayload;
  commentCount: number;
  onComment: () => void;
  onDelete?: () => void;
}) {
  const t = useTranslations('feed');
  const shown = item.media.slice(0, 3);
  const more = item.media.length - shown.length;
  return (
    <div className="bg-card rounded-[26px] overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <div className="p-4">
        <div className="flex items-center gap-3">
          <span className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-full bg-[#FFF1E8] text-lg" aria-hidden>📸</span>
          <div className="min-w-0">
            <p className="text-[15px] font-bold leading-tight text-ink-900">{t('sessionPhotosTitle')}</p>
            <p className="mt-0.5 truncate text-xs leading-tight text-ink-400">
              {sessionSubline(photos.date, photos.workoutName)}
            </p>
          </div>
        </div>

        {shown.length > 0 && (
          <div
            className={cn(
              'mt-3 grid gap-[3px] overflow-hidden rounded-[14px]',
              shown.length === 1 ? 'grid-cols-1' : 'grid-cols-[2fr_1fr] grid-rows-2',
            )}
            style={{ height: shown.length === 1 ? 260 : 200 }}
          >
            {shown.map((m, i) => (
              <div
                key={m.path}
                className={cn('relative overflow-hidden bg-page', shown.length === 3 && i === 0 && 'row-span-2', shown.length === 2 && 'row-span-2')}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={m.url} alt="" className="h-full w-full object-cover" />
                {more > 0 && i === shown.length - 1 && (
                  <span className="absolute inset-0 flex items-center justify-center bg-black/45 text-xl font-black text-white">
                    <bdi dir="ltr">+{more}</bdi>
                  </span>
                )}
              </div>
            ))}
          </div>
        )}

        <a
          href={photos.link}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-3 flex min-h-[44px] items-center justify-center gap-2 rounded-pill bg-brand-600 text-sm font-extrabold text-white active:opacity-80"
        >
          <ExternalLink className="h-4 w-4" />
          {t('sessionPhotosOpen')}
        </a>

        {/* Session photos are never activities — no run-chat CTA */}
        <ActionRow
          item={item}
          commentCount={commentCount}
          myAthleteId={null}
          isStaff={false}
          onCommentPress={onComment}
          onDelete={onDelete}
        />
      </div>
    </div>
  );
}

function PostCard({
  item,
  commentCount,
  onComment,
  onDelete,
}: {
  item: FeedItem;
  commentCount: number;
  onComment: () => void;
  onDelete?: () => void;
}) {
  return (
    <div className="bg-card rounded-[26px] overflow-hidden shadow-[0_1px_2px_rgba(0,0,0,0.04)]">
      <div className="p-4">
        <AuthorRow item={item} />

        {item.body && (
          <p className="mt-3 text-sm text-ink-700 whitespace-pre-line leading-relaxed"><FeedBodyText body={item.body} /></p>
        )}

        {item.media.length > 0 && (
          <div
            className={cn(
              'mt-3',
              item.media.length >= 2 && 'grid gap-1',
              item.media.length === 2 && 'grid-cols-2',
              item.media.length >= 3 && 'grid-cols-2',
            )}
          >
            {item.media.map((m, i) => (
              <div
                key={m.path}
                className={cn(
                  'overflow-hidden rounded-xl bg-page',
                  item.media.length === 3 && i === 0 && 'col-span-2',
                )}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={m.url}
                  alt=""
                  className="w-full object-cover"
                  style={{
                    aspectRatio: m.w && m.h ? `${m.w}/${m.h}` : '4/3',
                    maxHeight: item.media.length === 1 ? '480px' : '240px',
                  }}
                />
              </div>
            ))}
          </div>
        )}

        {/* Posts are never activities — no run-chat CTA */}
        <ActionRow
          bleed="-mx-4"
          item={item}
          commentCount={commentCount}
          myAthleteId={null}
          isStaff={false}
          onCommentPress={onComment}
          onDelete={onDelete}
        />
      </div>
    </div>
  );
}

export function FeedCard({
  item,
  commentCount,
  myAthleteId = null,
  isStaff = false,
  onComment,
  onDelete,
}: {
  item: FeedItem;
  commentCount: number;
  myAthleteId?: string | null;
  isStaff?: boolean;
  onComment: (item: FeedItem) => void;
  onDelete?: (item: FeedItem) => void;
}) {
  const handleComment = () => onComment(item);
  const handleDelete = item.canDelete ? () => onDelete?.(item) : undefined;

  switch (item.type) {
    case 'activity':
      if (item.activity) {
        return (
          <ActivityCard
            item={item}
            commentCount={commentCount}
            myAthleteId={myAthleteId}
            isStaff={isStaff}
            onComment={handleComment}
            onDelete={handleDelete}
          />
        );
      }
      return (
        <PostCard
          item={item}
          commentCount={commentCount}
          onComment={handleComment}
          onDelete={handleDelete}
        />
      );
    case 'achievement': {
      const achievement = toAchievementPayload(item.payload);
      if (achievement) {
        return (
          <AchievementCard
            item={item}
            achievement={achievement}
            commentCount={commentCount}
            onComment={handleComment}
            onDelete={handleDelete}
          />
        );
      }
      // Malformed/missing payload (shouldn't happen once the award engine is
      // live) — fall back to the generic shell rather than render broken text.
      return (
        <PostCard
          item={item}
          commentCount={commentCount}
          onComment={handleComment}
          onDelete={handleDelete}
        />
      );
    }
    case 'announcement': {
      const photos = toSessionPhotos(item.payload);
      if (photos) {
        return (
          <SessionPhotosCard
            item={item}
            photos={photos}
            commentCount={commentCount}
            onComment={handleComment}
            onDelete={handleDelete}
          />
        );
      }
      return (
        <PostCard
          item={item}
          commentCount={commentCount}
          onComment={handleComment}
          onDelete={handleDelete}
        />
      );
    }
    case 'post':
    case 'new_plan':
      return (
        <PostCard
          item={item}
          commentCount={commentCount}
          onComment={handleComment}
          onDelete={handleDelete}
        />
      );
    default: {
      const exhaustive: never = item.type;
      throw new Error(`Unsupported feed item type: ${exhaustive}`);
    }
  }
}
