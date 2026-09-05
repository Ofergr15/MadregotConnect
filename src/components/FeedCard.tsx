'use client';

import { useState, useCallback } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Heart, MessageCircle, MessagesSquare, Trash2, Route, MapPin, Mountain, Share2, Award, Flame, Gauge, ChevronRight } from 'lucide-react';
import { activityDayRelation, cn, formatActivityDate, formatActivityTime } from '@/lib/utils';
import { useTranslations, useFormatter, useLocale } from 'next-intl';
import { toggleLike } from '@/lib/feed-client';
import { FeedLikesSheet } from '@/components/FeedLikesSheet';
import { FeedAvatar } from '@/components/FeedAvatar';
import { FeedShareSheet } from '@/components/FeedShareSheet';
import { RouteMinimap } from '@/components/RouteMinimap';
import { FeedBodyText } from '@/components/FeedBodyText';
import { toAchievementPayload } from '@/lib/feed/project';
import type { FeedItem, FeedLiker, AchievementPayload } from '@/lib/feed/project';

function formatPace(secPerKm: number): string {
  const min = Math.floor(secPerKm / 60);
  const sec = Math.round(secPerKm % 60);
  return `${min}:${String(sec).padStart(2, '0')}`;
}

function formatDuration(seconds: number): string {
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
  const t = useTranslations('feed');
  const startTime = item.activity?.startTime;
  if (!startTime) return <>{format.relativeTime(new Date(item.occurredAt))}</>;

  const time = formatActivityTime(startTime);
  switch (activityDayRelation(startTime)) {
    case 'today': return <>{t('whenToday', { time })}</>;
    case 'yesterday': return <>{t('whenYesterday', { time })}</>;
    default: return <>{t('whenOn', { date: formatActivityDate(startTime), time })}</>;
  }
}

function AuthorRow({ item }: { item: FeedItem }) {
  const identity = (
    <>
      <FeedAvatar name={item.author.name} url={item.author.avatarUrl} />
      <div className="min-w-0">
        <p className="text-sm font-semibold text-ink-700 leading-tight truncate">{item.author.name}</p>
        <p className="text-xs text-ink-400 leading-tight">
          {item.author.groupName ? `${item.author.groupName} · ` : ''}
          <WhenLabel item={item} />
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
    <Link href={`/dashboard/teammate/${item.author.athleteId}`} className="flex items-center gap-3">
      {identity}
    </Link>
  );
}

function likeSummary(likers: FeedLiker[], total: number, t: Translate): string {
  const firstNames = likers.map(l => (l.name || '').split(' ')[0]).filter(Boolean);
  if (firstNames.length === 0) return String(total);

  const rest = total - firstNames.length;
  if (rest > 0) return t('namesAndMore', { names: firstNames.join(', '), count: rest });
  if (firstNames.length === 1) return firstNames[0];
  return t('namesAnd', {
    head: firstNames.slice(0, -1).join(', '),
    last: firstNames[firstNames.length - 1],
  });
}

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
          textClassName="text-[8px] text-brand-600"
        />
      ))}
    </div>
  );
}

function ActionRow({
  item,
  commentCount,
  myAthleteId,
  isStaff,
  onCommentPress,
  onDelete,
}: {
  item: FeedItem;
  commentCount: number;
  myAthleteId: string | null;
  isStaff: boolean;
  onCommentPress: () => void;
  onDelete?: () => void;
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
            className="group relative flex items-center gap-1.5 max-w-full text-start"
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
                  <span className="block text-[10px] text-ink-400 leading-relaxed">
                    {t('andMore', { count: likeCount - likers.length })}
                  </span>
                )}
              </span>
            )}
          </button>
        </div>
      )}

      <div className="flex items-center gap-1 pt-1 -ms-1">
        <button
          onClick={handleLike}
          aria-label={liked ? t('unlike') : t('like')}
          aria-pressed={liked}
          className={cn(
            'flex items-center px-3 py-1.5 rounded-full transition-all active:scale-90',
            liked ? 'text-accent-red bg-accent-red/10' : 'text-ink-400 hover:text-ink-500 hover:bg-page',
          )}
        >
          <Heart className={cn('h-4 w-4', liked && 'fill-accent-red')} />
        </button>

        <button
          onClick={onCommentPress}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium text-ink-400 hover:text-ink-500 hover:bg-page transition-all active:scale-90"
        >
          <MessageCircle className="h-4 w-4" />
          {commentCount > 0 && <span className="tabular-nums text-xs">{commentCount}</span>}
        </button>

        {item.activity && (
          <button
            onClick={() => setShareOpen(true)}
            aria-label={t('shareToStory')}
            className="flex items-center px-3 py-1.5 rounded-full text-ink-400 hover:text-ink-500 hover:bg-page transition-all active:scale-90"
          >
            <Share2 className="h-4 w-4" />
          </button>
        )}

        {canOpenRunChat && (
          <button
            onClick={() => router.push(`/dashboard/run-chat/${item.activity!.id}`)}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium text-ink-400 hover:text-brand-600 hover:bg-brand-600/10 transition-all active:scale-90"
          >
            {/* Distinct from the comment button's icon just above — same
                glyph for two different actions in one row read as a visual
                duplication bug, not two intentional buttons. */}
            <MessagesSquare className="h-4 w-4" />
            <span className="text-xs">{runChatLabel}</span>
          </button>
        )}

        {onDelete && (
          <button
            onClick={onDelete}
            className="ms-auto p-2 rounded-full text-ink-300 hover:text-accent-red hover:bg-accent-red/10 transition-all"
            aria-label={t('deletePost')}
          >
            <Trash2 className="h-4 w-4" />
          </button>
        )}
      </div>

      {sheetOpen && (
        <FeedLikesSheet
          itemId={item.id}
          likeCount={likeCount}
          seed={likers}
          onClose={() => setSheetOpen(false)}
        />
      )}

      {shareOpen && <FeedShareSheet item={item} onClose={() => setShareOpen(false)} />}
    </>
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
  const router = useRouter();
  const act = item.activity!;
  const distKm = (act.distance / 1000).toFixed(1);
  const paceStr = act.averagePace ? formatPace(act.averagePace) : null;
  const durationStr = formatDuration(act.duration);
  const movingStr = act.movingDuration ? formatDuration(act.movingDuration) : null;
  const showElevation = (act.elevationGain ?? 0) > 5;
  // Moving time is only worth a chip when it actually differs from elapsed —
  // otherwise it's the same number twice.
  const showMoving = !!movingStr && movingStr !== durationStr;

  // The card is a doorway to the full run: route map, per-km splits, pace/HR/
  // elevation charts. It used to be a dead end — the only tap target was the
  // run-chat button in the action row.
  const openDetail = () => router.push(`/dashboard/activities/${act.id}`);

  return (
    <div className="bg-card rounded-card border border-page overflow-hidden">
      <div className="p-4">
        {/* AuthorRow stays outside the tap target — it has its own link to the
            runner's profile, and nesting the two would swallow it. */}
        <div className="flex items-start gap-3 mb-3">
          <div className="flex-1 min-w-0">
            <AuthorRow item={item} />
          </div>
          <div className="w-7 h-7 rounded-full bg-brand-600/10 flex items-center justify-center shrink-0 mt-1">
            <Route className="h-3.5 w-3.5 text-brand-600" />
          </div>
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
          {act.activityName && (
            <p className="text-sm text-ink-700 font-semibold mb-3">{act.activityName}</p>
          )}

          <div className="grid grid-cols-3 gap-2 mb-3">
            <div className="bg-page rounded-xl p-2.5 text-center">
              <p className="text-[10px] text-ink-400 font-medium mb-0.5">{t('statDistance')}</p>
              <p className="text-base font-black text-ink-700 tabular-nums">
                {distKm}<span className="text-[10px] text-ink-400 ms-0.5">{t('km')}</span>
              </p>
            </div>
            <div className="bg-page rounded-xl p-2.5 text-center">
              <p className="text-[10px] text-ink-400 font-medium mb-0.5">{t('statPace')}</p>
              <p className="text-base font-black text-ink-700 tabular-nums">
                {paceStr || '—'}<span className="text-[10px] text-ink-400 ms-0.5">{t('perKm')}</span>
              </p>
            </div>
            <div className="bg-page rounded-xl p-2.5 text-center">
              <p className="text-[10px] text-ink-400 font-medium mb-0.5">{t('statTime')}</p>
              <p className="text-base font-black text-ink-700 tabular-nums">{durationStr}</p>
              {showMoving && (
                <p className="text-[10px] text-ink-400 tabular-nums mt-0.5">{movingStr} {t('statMoving')}</p>
              )}
            </div>
          </div>

          {/* Chips for the rest of what the projection already ships — max HR,
              calories and the athlete's own effort rating were being fetched and
              thrown away. */}
          {(act.averageHr || act.maxHr || act.calories || act.perceivedRpe != null || showElevation || act.locationName) && (
            <div className="flex flex-wrap gap-x-4 gap-y-1 mb-3 text-xs text-ink-400">
              {act.averageHr && (
                <span className="flex items-center gap-1">
                  <Heart className="h-3 w-3 text-accent-red" />
                  {act.averageHr} bpm
                  {act.maxHr ? <span className="text-ink-400">· {t('statMaxHr')} {act.maxHr}</span> : null}
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
          )}

          {act.routePreview && act.routePreview.length > 2 && (
            <div className="mb-3">
              <RouteMinimap points={act.routePreview} />
            </div>
          )}

          <p className="flex items-center gap-1 mb-3 text-xs font-semibold text-brand-600">
            {t('viewDetails')}
            <ChevronRight className="h-3.5 w-3.5 rtl:rotate-180" />
          </p>
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
        <div className="flex items-start gap-3 mb-3">
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
            <p className="text-2xs font-bold uppercase tracking-wider text-band-3">{t('newBadgeEarned')}</p>
            <p className="text-lg font-black text-ink-700 truncate" dir="auto">{badgeName}</p>
          </div>
        </div>

        {item.body && (
          <p className="mt-3 text-sm text-ink-500 whitespace-pre-line leading-relaxed"><FeedBodyText body={item.body} /></p>
        )}

        {/* Achievements are never activities — no run-chat CTA */}
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
    <div className="bg-card rounded-card border border-page overflow-hidden">
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
    case 'post':
    case 'announcement':
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
