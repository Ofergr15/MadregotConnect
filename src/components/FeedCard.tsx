'use client';

import { useState, useCallback } from 'react';
import { Heart, MessageCircle, Trash2, Route, MapPin, Mountain } from 'lucide-react';
import { cn } from '@/lib/utils';
import { toggleLike } from '@/lib/feed-client';
import type { FeedItem } from '@/lib/feed/project';

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

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'עכשיו';
  if (mins < 60) return `לפני ${mins} דק׳`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 24) return `לפני ${hrs} שע׳`;
  const days = Math.floor(hrs / 24);
  if (days === 1) return 'אתמול';
  if (days < 7) return `לפני ${days} ימים`;
  return new Date(iso).toLocaleDateString('he-IL', { day: 'numeric', month: 'long' });
}

// SVG minimap from the ~60-point route_preview. No Leaflet in the list view —
// Leaflet is only used in the full activity detail.
function RouteMinimap({ points }: { points: Array<{ lat: number; lng: number }> }) {
  if (points.length < 2) return null;
  const lats = points.map(p => p.lat);
  const lngs = points.map(p => p.lng);
  const minLat = Math.min(...lats), maxLat = Math.max(...lats);
  const minLng = Math.min(...lngs), maxLng = Math.max(...lngs);
  const latRange = maxLat - minLat || 0.001;
  const lngRange = maxLng - minLng || 0.001;
  const W = 300, H = 100, P = 10;
  const pts = points.map(p => ({
    x: P + ((p.lng - minLng) / lngRange) * (W - 2 * P),
    // invert y so north is up
    y: P + ((maxLat - p.lat) / latRange) * (H - 2 * P),
  }));
  const d = pts.map((p, i) => `${i === 0 ? 'M' : 'L'} ${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full rounded-xl" style={{ height: 80 }}>
      <rect width={W} height={H} rx="12" fill="#0f172a" />
      <path d={d} fill="none" stroke="#6366f1" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx={pts[0].x.toFixed(1)} cy={pts[0].y.toFixed(1)} r="4" fill="#22c55e" stroke="#0f172a" strokeWidth="1.5" />
      <circle cx={pts[pts.length - 1].x.toFixed(1)} cy={pts[pts.length - 1].y.toFixed(1)} r="4" fill="#ef4444" stroke="#0f172a" strokeWidth="1.5" />
    </svg>
  );
}

function Avatar({ name, url }: { name: string; url: string | null }) {
  const initials = (name || '??').slice(0, 2).toUpperCase();
  return (
    <div className="w-9 h-9 rounded-full bg-primary-600/20 flex items-center justify-center shrink-0 overflow-hidden">
      {url
        // Avatar URLs come from Garmin/Supabase storage — origin unknown at build time,
        // so we can't use next/image without listing every possible domain.
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={url} alt={name} className="w-full h-full object-cover" />
        : <span className="text-primary-400 text-xs font-bold">{initials}</span>}
    </div>
  );
}

function AuthorRow({ item }: { item: FeedItem }) {
  return (
    <div className="flex items-center gap-3">
      <Avatar name={item.author.name} url={item.author.avatarUrl} />
      <div className="min-w-0">
        <p className="text-sm font-semibold text-white leading-tight truncate">{item.author.name}</p>
        <p className="text-xs text-slate-500 leading-tight">
          {item.author.groupName ? `${item.author.groupName} · ` : ''}{timeAgo(item.occurredAt)}
        </p>
      </div>
    </div>
  );
}

function ActionRow({
  item,
  commentCount,
  onCommentPress,
  onDelete,
}: {
  item: FeedItem;
  commentCount: number;
  onCommentPress: () => void;
  onDelete?: () => void;
}) {
  const [liked, setLiked] = useState(item.likedByMe);
  const [likeCount, setLikeCount] = useState(item.likeCount);
  const [busy, setBusy] = useState(false);

  const handleLike = useCallback(async () => {
    if (busy) return;
    setBusy(true);
    const next = !liked;
    // Optimistic
    setLiked(next);
    setLikeCount(c => c + (next ? 1 : -1));
    try {
      const res = await toggleLike(item.id);
      setLiked(res.liked);
      setLikeCount(res.likeCount);
    } catch {
      setLiked(!next);
      setLikeCount(c => c + (next ? -1 : 1));
    } finally {
      setBusy(false);
    }
  }, [busy, liked, item.id]);

  return (
    <div className="flex items-center gap-1 pt-1 -ms-1">
      <button
        onClick={handleLike}
        className={cn(
          'flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium transition-all active:scale-90',
          liked ? 'text-rose-400 bg-rose-500/10' : 'text-slate-400 hover:text-slate-300 hover:bg-slate-700/50',
        )}
      >
        <Heart className={cn('h-4 w-4', liked && 'fill-rose-400')} />
        {likeCount > 0 && <span className="tabular-nums text-xs">{likeCount}</span>}
      </button>

      <button
        onClick={onCommentPress}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-medium text-slate-400 hover:text-slate-300 hover:bg-slate-700/50 transition-all active:scale-90"
      >
        <MessageCircle className="h-4 w-4" />
        {commentCount > 0 && <span className="tabular-nums text-xs">{commentCount}</span>}
      </button>

      {onDelete && (
        <button
          onClick={onDelete}
          className="ms-auto p-2 rounded-full text-slate-600 hover:text-red-400 hover:bg-red-500/10 transition-all"
          aria-label="מחק פוסט"
        >
          <Trash2 className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

function ActivityCard({
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
  const act = item.activity!;
  const distKm = (act.distance / 1000).toFixed(1);
  const paceStr = act.averagePace ? formatPace(act.averagePace) : null;
  const durationStr = formatDuration(act.duration);

  return (
    <div className="bg-slate-800/50 rounded-2xl border border-slate-700/30 overflow-hidden">
      <div className="p-4">
        <div className="flex items-start gap-3 mb-3">
          <div className="flex-1 min-w-0">
            <AuthorRow item={item} />
          </div>
          <div className="w-7 h-7 rounded-full bg-primary-600/15 flex items-center justify-center shrink-0 mt-1">
            <Route className="h-3.5 w-3.5 text-primary-400" />
          </div>
        </div>

        {act.activityName && (
          <p className="text-sm text-white font-semibold mb-3">{act.activityName}</p>
        )}

        <div className="grid grid-cols-3 gap-2 mb-3">
          <div className="bg-slate-900/50 rounded-xl p-2.5 text-center">
            <p className="text-[10px] text-slate-500 font-medium mb-0.5">מרחק</p>
            <p className="text-base font-black text-white tabular-nums">
              {distKm}<span className="text-[10px] text-slate-400 ms-0.5">ק״מ</span>
            </p>
          </div>
          <div className="bg-slate-900/50 rounded-xl p-2.5 text-center">
            <p className="text-[10px] text-slate-500 font-medium mb-0.5">קצב</p>
            <p className="text-base font-black text-white tabular-nums">
              {paceStr || '—'}<span className="text-[10px] text-slate-400 ms-0.5">/ק״מ</span>
            </p>
          </div>
          <div className="bg-slate-900/50 rounded-xl p-2.5 text-center">
            <p className="text-[10px] text-slate-500 font-medium mb-0.5">זמן</p>
            <p className="text-base font-black text-white tabular-nums">{durationStr}</p>
          </div>
        </div>

        {(act.averageHr || (act.elevationGain && act.elevationGain > 5) || act.locationName) && (
          <div className="flex flex-wrap gap-x-4 gap-y-1 mb-3 text-xs text-slate-400">
            {act.averageHr && (
              <span className="flex items-center gap-1">
                <Heart className="h-3 w-3 text-rose-400" />
                {act.averageHr} bpm
              </span>
            )}
            {act.elevationGain && act.elevationGain > 5 && (
              <span className="flex items-center gap-1">
                <Mountain className="h-3 w-3 text-green-400" />
                +{Math.round(act.elevationGain)}m
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

        {item.body && (
          <p className="text-sm text-slate-300 mb-2 leading-relaxed">{item.body}</p>
        )}

        <ActionRow item={item} commentCount={commentCount} onCommentPress={onComment} onDelete={onDelete} />
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
    <div className="bg-slate-800/50 rounded-2xl border border-slate-700/30 overflow-hidden">
      <div className="p-4">
        <AuthorRow item={item} />

        {item.body && (
          <p className="mt-3 text-sm text-slate-100 whitespace-pre-line leading-relaxed">{item.body}</p>
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
                  'overflow-hidden rounded-xl bg-slate-900',
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

        <ActionRow item={item} commentCount={commentCount} onCommentPress={onComment} onDelete={onDelete} />
      </div>
    </div>
  );
}

export function FeedCard({
  item,
  commentCount,
  onComment,
  onDelete,
}: {
  item: FeedItem;
  commentCount: number;
  onComment: (item: FeedItem) => void;
  onDelete?: (item: FeedItem) => void;
}) {
  const handleComment = () => onComment(item);
  const handleDelete = item.canDelete ? () => onDelete?.(item) : undefined;

  if (item.type === 'activity' && item.activity) {
    return (
      <ActivityCard
        item={item}
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
